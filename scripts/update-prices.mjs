// Relevé quotidien des cours pour Krach Club.
// Lancé chaque soir par GitHub Actions : lit les symboles joués cette semaine,
// récupère les cours sur Yahoo Finance, convertit en dollars et écrit un document runs/<date>.
import YahooFinance from "yahoo-finance2";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const CATALOG = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "NFLX", "JPM", "KO",
  "MC.PA", "RMS.PA", "OR.PA", "AIR.PA", "TTE.PA", "BNP.PA", "ASML.AS", "SAP.DE",
  "SPY", "QQQ", "VT", "CW8.PA", "GLD", "TLT", "BTC-USD", "ETH-USD", "SOL-USD", "DOGE-USD"];
const SYM_RE = /^[A-Z0-9][A-Z0-9.\-]{0,19}$/;
// Devises cotées en centièmes (ex : actions de Londres en pence).
const MINOR = { GBp: ["GBP", 100], GBX: ["GBP", 100], ILA: ["ILS", 100], ZAc: ["ZAR", 100] };

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error("Secret FIREBASE_SERVICE_ACCOUNT manquant."); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const parisDate = ms => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
function isoWeek(ds) {
  const [y, m, d] = ds.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d)); const dn = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dn + 3);
  const fy = t.getUTCFullYear(); const f = new Date(Date.UTC(fy, 0, 4)); const w = 1 + Math.round(((t - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7);
  return fy + "-W" + String(w).padStart(2, "0");
}

async function quotes(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 40) {
    const chunk = symbols.slice(i, i + 40);
    try {
      const res = await yf.quote(chunk, {}, { validateResult: false });
      for (const q of [].concat(res || [])) if (q && q.symbol) out[q.symbol] = q;
    } catch (e) {
      // Un symbole invalide peut faire échouer le lot : on réessaie un par un.
      for (const s of chunk) { try { const q = await yf.quote(s, {}, { validateResult: false }); if (q && q.symbol) out[q.symbol] = q; } catch { /* introuvable */ } }
    }
  }
  return out;
}

const now = Date.now();
const date = parisDate(now), week = isoWeek(date);

// Symboles joués ces 8 derniers jours + catalogue.
const since = new Date(now - 8 * 864e5);
const ordersSnap = await db.collection("orders").where("ts", ">=", since).get();
const syms = new Set(CATALOG);
ordersSnap.forEach(d => { const s = d.get("sym"); if (typeof s === "string" && SYM_RE.test(s)) syms.add(s); });
const list = [...syms];

const q = await quotes(list);

// Taux de change vers le dollar.
const curs = new Set();
for (const s of list) { const c = q[s]?.currency; if (c && c !== "USD") curs.add(MINOR[c]?.[0] || c); }
const fxq = await quotes([...curs].map(c => c + "USD=X"));
const fx = { USD: 1 };
for (const c of curs) { const r = fxq[c + "USD=X"]?.regularMarketPrice; if (r > 0) fx[c] = r; }

const prices = {}, bad = [];
for (const s of list) {
  const x = q[s];
  const px = x?.regularMarketPrice;
  if (!(px > 0)) { bad.push(s); continue; }
  let cur = x.currency || "USD", div = 1;
  if (MINOR[cur]) { [cur, div] = MINOR[cur]; }
  const rate = fx[cur];
  if (!(rate > 0)) { bad.push(s); continue; }
  prices[s] = {
    usd: Math.round((px / div) * rate * 1e6) / 1e6,
    px: px / div, cur,
    chg: typeof x.regularMarketChangePercent === "number" ? Math.round(x.regularMarketChangePercent * 100) / 100 : 0,
    name: String(x.shortName || x.longName || s).slice(0, 60),
    t: x.regularMarketTime ? new Date(x.regularMarketTime).toISOString() : null
  };
}

await db.collection("runs").doc(date).set({ at: FieldValue.serverTimestamp(), date, week, prices, fx, bad });
console.log(`Relevé ${date} (${week}) : ${Object.keys(prices).length} cours, ${ordersSnap.size} ordres récents, introuvables : ${bad.join(", ") || "aucun"}.`);
process.exit(0);

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, setDoc, updateDoc, addDoc, collection, onSnapshot, query, where, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const START = 1000;
const CATALOG = [
  ["AAPL", "Apple", "Actions US"], ["MSFT", "Microsoft", "Actions US"], ["NVDA", "Nvidia", "Actions US"],
  ["TSLA", "Tesla", "Actions US"], ["AMZN", "Amazon", "Actions US"], ["GOOGL", "Alphabet (Google)", "Actions US"],
  ["META", "Meta", "Actions US"], ["NFLX", "Netflix", "Actions US"], ["JPM", "JPMorgan Chase", "Actions US"], ["KO", "Coca-Cola", "Actions US"],
  ["MC.PA", "LVMH", "Actions Europe"], ["RMS.PA", "Hermès", "Actions Europe"], ["OR.PA", "L'Oréal", "Actions Europe"], ["AIR.PA", "Airbus", "Actions Europe"],
  ["TTE.PA", "TotalEnergies", "Actions Europe"], ["BNP.PA", "BNP Paribas", "Actions Europe"], ["ASML.AS", "ASML", "Actions Europe"], ["SAP.DE", "SAP", "Actions Europe"],
  ["SPY", "ETF S&P 500 (SPDR)", "ETF"], ["QQQ", "ETF Nasdaq 100 (Invesco)", "ETF"], ["VT", "ETF Monde (Vanguard)", "ETF"],
  ["CW8.PA", "ETF MSCI World (Amundi)", "ETF"], ["GLD", "ETF Or (SPDR Gold)", "ETF"], ["TLT", "ETF Obligations US 20 ans", "ETF"],
  ["BTC-USD", "Bitcoin", "Crypto"], ["ETH-USD", "Ethereum", "Crypto"], ["SOL-USD", "Solana", "Crypto"], ["DOGE-USD", "Dogecoin", "Crypto"]
].map(([s, n, k]) => ({ s, n, k }));
const CATS = ["Tout", "Actions US", "Actions Europe", "ETF", "Crypto", "Autres"];
const SYM_RE = /^[A-Z0-9][A-Z0-9.\-]{0,19}$/;

/* ---------- Firebase ---------- */
const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

/* ---------- utils ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n, d = 2) => (n < 0 ? "−" : "") + Math.abs(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }) + " $";
const pct = n => (n >= 0 ? "+" : "−") + Math.abs(n * 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " %";
const qtyFmt = q => q.toLocaleString("fr-FR", { maximumFractionDigits: q < 1 ? 6 : 3 });
const PFMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const parisDate = ms => PFMT.format(new Date(ms));
function isoWeek(ds) {
  const [y, m, d] = ds.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d)); const dn = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dn + 3);
  const fy = t.getUTCFullYear(); const f = new Date(Date.UTC(fy, 0, 4)); const w = 1 + Math.round(((t - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7);
  return fy + "-W" + String(w).padStart(2, "0");
}
function weekLabel(wk) {
  const [y, w] = wk.split("-W").map(Number); const f = new Date(Date.UTC(y, 0, 4)); const mon = new Date(f); mon.setUTCDate(f.getUTCDate() - ((f.getUTCDay() + 6) % 7) + (w - 1) * 7);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6); const o = { day: "numeric", month: "short", timeZone: "UTC" };
  return mon.toLocaleDateString("fr-FR", o) + " – " + sun.toLocaleDateString("fr-FR", o);
}
const nowWeek = () => isoWeek(parisDate(Date.now()));
const COLORS = ["#2f5bff", "#00a86b", "#f0353f", "#e8a100", "#7b3fe4", "#0b0b0c", "#ff6a00", "#0091c2"];
function colorOf(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; }
function logo(s) { const base = s.split(".")[0].replace("-USD", ""); return `<span class="logo" style="background:${colorOf(s)}">${esc(base.slice(0, 4))}</span>`; }
function toast(t) { const el = document.createElement("div"); el.className = "toast"; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 2600); }
const tsMs = t => t && typeof t.toMillis === "function" ? t.toMillis() : (typeof t === "number" ? t : Date.now());

/* ---------- état ---------- */
const S = { uid: null, players: {}, banks: {}, runs: [], orders: [], tab: "pf", bank: null, week: null, cat: "Tout", q: "", authMode: "login",
  ready: { p: false, b: false, r: false, o: false }, unsubs: [], unsubOrders: null, ordersBank: null };
try { S.bank = localStorage.getItem("kc-bank"); } catch (e) {}

/* ---------- données de marché ---------- */
const runWeek = r => r.week || isoWeek(r.date || parisDate(r.atMs));
function lastQuote(sym, uptoIdx = S.runs.length - 1) { for (let i = uptoIdx; i >= 0; i--) { const p = S.runs[i].prices?.[sym]; if (p && p.usd > 0) return { ...p, run: i }; } return null; }
const history = sym => S.runs.map(r => r.prices?.[sym]?.usd).filter(v => v > 0);
function instruments() {
  const m = new Map(CATALOG.map(c => [c.s, { ...c }]));
  for (const r of S.runs) for (const [s, p] of Object.entries(r.prices || {})) if (!m.has(s)) m.set(s, { s, n: p.name || s, k: /-USD$/.test(s) ? "Crypto" : "Autres" });
  for (const o of S.orders) if (o.sym && !m.has(o.sym) && SYM_RE.test(o.sym)) m.set(o.sym, { s: o.sym, n: o.name || o.sym, k: /-USD$/.test(o.sym) ? "Crypto" : "Autres" });
  return [...m.values()];
}
const nameOf = sym => instruments().find(i => i.s === sym)?.n || sym;

/* ---------- moteur de portefeuille (déterministe, identique pour tous) ---------- */
function portfolio(pid, bankId, week) {
  const orders = S.orders.filter(o => o.uid === pid && o.bank === bankId && o.week === week && SYM_RE.test(o.sym || "")).sort((a, b) => a.tsMs - b.tsMs);
  const runIdx = S.runs.map((r, i) => [r, i]).filter(([r]) => runWeek(r) === week).map(([, i]) => i);
  const curWeek = week === nowWeek();
  const ev = orders.map(o => {
    // Un ordre s'exécute au premier relevé qui suit son horodatage serveur, dans la même semaine.
    const fi = o.pending ? undefined : runIdx.find(i => S.runs[i].atMs > o.tsMs);
    let st = "wait", price = null;
    if (fi !== undefined) { const q = S.runs[fi].prices?.[o.sym]; if (q && q.usd > 0) { st = "fill"; price = q.usd; } else st = "bad"; }
    else if (!curWeek) st = "exp";
    return { o, fi, st, price };
  });
  const res = { cash: START, pos: {}, cost: {}, series: [START] };
  const fills = ev.filter(e => e.st === "fill").sort((a, b) => a.fi - b.fi || a.o.tsMs - b.o.tsMs);
  const apply = e => {
    const o = e.o;
    if (o.side === "buy") {
      if (o.amount > 0 && o.amount <= res.cash + 1e-9) { res.cash -= o.amount; res.pos[o.sym] = (res.pos[o.sym] || 0) + o.amount / e.price; res.cost[o.sym] = (res.cost[o.sym] || 0) + o.amount; }
      else e.st = "nofund";
    } else {
      const have = res.pos[o.sym] || 0, f = Math.min(Math.max(o.frac || 0, 0), 1);
      if (have > 0 && f > 0) { const q = have * f; res.cash += q * e.price; res.cost[o.sym] = (res.cost[o.sym] || 0) * (1 - f); res.pos[o.sym] = have - q; if (res.pos[o.sym] < 1e-12) { delete res.pos[o.sym]; delete res.cost[o.sym]; } }
      else e.st = "nopos";
    }
  };
  const valueAt = i => res.cash + Object.entries(res.pos).reduce((s, [sym, q]) => s + q * (lastQuote(sym, i)?.usd || 0), 0);
  let k = 0;
  for (const i of runIdx) { while (k < fills.length && fills[k].fi === i) { apply(fills[k]); k++; } res.series.push(valueAt(i)); }
  res.value = runIdx.length ? valueAt(runIdx[runIdx.length - 1]) : START;
  res.pendingBuy = ev.filter(e => e.st === "wait" && e.o.side === "buy").reduce((s, e) => s + (e.o.amount || 0), 0);
  res.available = Math.max(0, res.cash - res.pendingBuy);
  res.orders = ev.sort((a, b) => b.o.tsMs - a.o.tsMs);
  return res;
}

/* ---------- graphiques ---------- */
function drawLine(canvas, vals, { base = null, height = 180, fill = true } = {}) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth || 300, H = canvas.clientHeight || height;
  canvas.width = W * dpr; canvas.height = H * dpr; const g = canvas.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
  if (vals.length < 2) return;
  const ref = base ?? vals[0]; let lo = Math.min(...vals, ref), hi = Math.max(...vals, ref); if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const pad = fill ? 14 : 3, X = i => pad / 2 + (W - pad) * i / (vals.length - 1), Y = v => pad + (H - 2 * pad) * (1 - (v - lo) / (hi - lo));
  const up = vals[vals.length - 1] >= ref, col = up ? "#00a86b" : "#f0353f";
  if (fill) {
    g.setLineDash([3, 4]); g.strokeStyle = "#d6d6db"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Y(ref)); g.lineTo(W, Y(ref)); g.stroke(); g.setLineDash([]);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, up ? "rgba(0,168,107,.18)" : "rgba(240,53,63,.18)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.beginPath(); vals.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.lineTo(X(vals.length - 1), H); g.lineTo(X(0), H); g.closePath(); g.fill();
  }
  g.strokeStyle = col; g.lineWidth = fill ? 2.5 : 1.6; g.lineJoin = "round"; g.beginPath(); vals.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.stroke();
  if (fill) { const lx = X(vals.length - 1), ly = Y(vals[vals.length - 1]); g.fillStyle = col; g.beginPath(); g.arc(lx, ly, 4.5, 0, 7); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 2; g.stroke(); }
}
function paintSparks() { document.querySelectorAll("canvas[data-spark]").forEach(c => drawLine(c, history(c.dataset.spark).slice(-14), { fill: false, height: 24 })); }

/* ---------- rendu ---------- */
function myBanks() { return Object.entries(S.banks).filter(([, b]) => b.members && b.members[S.uid]).map(([id, b]) => ({ id, ...b })).sort((a, b) => tsMs(a.createdAt) - tsMs(b.createdAt)); }
function curBank() { const mb = myBanks(); if (!mb.find(b => b.id === S.bank)) S.bank = mb[0]?.id || null; return mb.find(b => b.id === S.bank) || null; }
const pseudo = pid => S.players[pid]?.pseudo || "Joueur";

function watchOrders() {
  const bank = curBank();
  const id = bank?.id || null;
  if (id === S.ordersBank) return;
  if (S.unsubOrders) S.unsubOrders();
  S.ordersBank = id; S.orders = []; S.unsubOrders = null;
  if (!id) { S.ready.o = true; return; }
  S.ready.o = false;
  S.unsubOrders = onSnapshot(query(collection(db, "orders"), where("bank", "==", id)), snap => {
    S.orders = snap.docs.map(d => { const o = d.data({ serverTimestamps: "estimate" }); const t = tsMs(o.ts); return { id: d.id, ...o, tsMs: t, week: isoWeek(parisDate(t)), pending: d.metadata.hasPendingWrites }; });
    S.ready.o = true; refresh();
  }, err => console.error(err));
}

function refresh() { if (!$("#layer").innerHTML) render(); }

function render() {
  const app = $("#app");
  if (!S.uid) { renderAuth(); return; }
  if (!(S.ready.p && S.ready.b && S.ready.r)) return;
  if (!S.players[S.uid]) { renderPseudo(); return; }
  watchOrders();
  if (!S.ready.o) return;
  $("#tabs").hidden = false;
  document.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-current", b.dataset.tab === S.tab ? "page" : "false"));
  const bank = curBank();
  if (!bank && S.tab !== "bk") S.tab = "bk";
  const top = `<div class="top"><button class="bankpick" id="goBanks"><span class="ic">${esc((bank?.name || "?").slice(0, 1).toUpperCase())}</span><span class="n">${esc(bank?.name || "Aucune banque")}</span><span aria-hidden="true">▾</span></button><span class="weekchip">Semaine du ${weekLabel(nowWeek())}</span></div>`;
  let body = "";
  if (S.tab === "pf") body = viewPortfolio(bank);
  if (S.tab === "mk") body = viewMarket();
  if (S.tab === "rk") body = viewRanking(bank);
  if (S.tab === "bk") body = viewBanks(bank);
  app.innerHTML = top + body;
  $("#goBanks").onclick = () => { S.tab = "bk"; render(); };
  bindView();
}

function renderAuth() {
  $("#tabs").hidden = true;
  const login = S.authMode === "login";
  $("#app").innerHTML = `<div class="center"><div class="brand">Krach<br>Club</div>
    <p>Chaque semaine, 1 000 $ fictifs. Tu investis sur de vrais cours, et le pire trader de ta banque se fait afficher.</p>
    <form class="auth" id="authForm" novalidate>
      ${login ? "" : `<label class="field" for="aPseudo">Pseudo<input id="aPseudo" maxlength="20" autocomplete="nickname" placeholder="ex : Marco" required></label>`}
      <label class="field" for="aEmail">E-mail<input id="aEmail" type="email" autocomplete="email" required></label>
      <label class="field" for="aPass">Mot de passe<input id="aPass" type="password" minlength="6" autocomplete="${login ? "current-password" : "new-password"}" required></label>
      <button class="btn dark" type="submit">${login ? "Se connecter" : "Créer mon compte"}</button>
      <span class="err" id="aErr"></span>
      <button class="linkbtn" type="button" id="aSwitch">${login ? "Pas encore de compte ? Inscris-toi" : "Déjà un compte ? Connecte-toi"}</button>
      ${login ? `<button class="linkbtn" type="button" id="aReset">Mot de passe oublié</button>` : ""}
    </form></div>`;
  $("#aSwitch").onclick = () => { S.authMode = login ? "signup" : "login"; renderAuth(); };
  if (login) $("#aReset").onclick = async () => {
    const em = $("#aEmail").value.trim(); if (!em) { $("#aErr").textContent = "Entre ton e-mail d'abord."; return; }
    try { await sendPasswordResetEmail(auth, em); toast("E-mail de réinitialisation envoyé"); } catch (e) { $("#aErr").textContent = "Impossible d'envoyer l'e-mail. Vérifie l'adresse."; }
  };
  $("#authForm").onsubmit = async e => {
    e.preventDefault();
    const em = $("#aEmail").value.trim(), pw = $("#aPass").value;
    const msgs = { "auth/invalid-email": "Adresse e-mail invalide.", "auth/weak-password": "Mot de passe trop court (6 caractères minimum).", "auth/email-already-in-use": "Un compte existe déjà avec cet e-mail. Connecte-toi.", "auth/invalid-credential": "E-mail ou mot de passe incorrect.", "auth/too-many-requests": "Trop d'essais. Réessaie dans quelques minutes." };
    try {
      if (login) await signInWithEmailAndPassword(auth, em, pw);
      else {
        const ps = $("#aPseudo").value.trim(); if (!ps) { $("#aErr").textContent = "Choisis un pseudo."; return; }
        S.pendingPseudo = ps;
        await createUserWithEmailAndPassword(auth, em, pw);
      }
    } catch (err) { $("#aErr").textContent = msgs[err.code] || "Connexion impossible. Réessaie."; }
  };
}

function renderPseudo() {
  $("#tabs").hidden = true;
  $("#app").innerHTML = `<div class="center stack"><div class="brand">Krach<br>Club</div>
    <label class="field" for="pseudo">Ton pseudo<input id="pseudo" maxlength="20" autocomplete="nickname" placeholder="ex : Marco"></label>
    <button class="btn dark" id="savePseudo">Entrer dans le club</button><p class="err" id="perr"></p></div>`;
  $("#savePseudo").onclick = async () => {
    const v = $("#pseudo").value.trim(); if (!v) { $("#perr").textContent = "Choisis un pseudo."; return; }
    try { await setDoc(doc(db, "players", S.uid), { pseudo: v, createdAt: serverTimestamp() }); } catch (e) { $("#perr").textContent = "Impossible d'enregistrer le pseudo."; }
  };
}

function viewPortfolio(bank) {
  if (!bank) return "";
  const p = portfolio(S.uid, bank.id, nowWeek()), gain = p.value - START;
  const pos = Object.entries(p.pos).map(([sym, q]) => {
    const lq = lastQuote(sym); const v = q * (lq?.usd || 0); const c = p.cost[sym] || 0; const g = c ? v / c - 1 : 0;
    return `<button class="row" data-open="${esc(sym)}">${logo(sym)}<span class="t"><b>${esc(nameOf(sym))}</b><small class="num">${qtyFmt(q)} · ${esc(sym)}</small></span><span class="r"><b class="num">${money(v)}</b><small class="num ${g >= 0 ? "up" : "down"}">${pct(g)}</small></span></button>`;
  }).join("");
  const ord = p.orders.slice(0, 12).map(e => {
    const o = e.o; const d = new Date(o.tsMs).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" });
    const lab = { wait: ["En attente", "wait"], fill: [o.side === "buy" ? "Acheté à " + money(e.price) : "Vendu à " + money(e.price), "ok"], bad: ["Symbole introuvable", "ko"], exp: ["Expiré", "ko"], nofund: ["Fonds insuffisants", "ko"], nopos: ["Rien à vendre", "ko"] }[e.st];
    const what = o.side === "buy" ? "Achat " + money(o.amount, 0) : "Vente " + Math.round((o.frac || 0) * 100) + " %";
    return `<div class="row">${logo(o.sym)}<span class="t"><b>${esc(what)} · ${esc(nameOf(o.sym))}</b><small>${esc(d)}</small></span><span class="r"><span class="pill ${lab[1]}">${esc(lab[0])}</span></span></div>`;
  }).join("");
  return `<section class="hero"><span class="lbl">Portefeuille · ${esc(bank.name)}</span>
    <span class="val num">${money(p.value)}</span>
    <span class="chg num ${gain >= 0 ? "up" : "down"}">${gain >= 0 ? "▲" : "▼"} ${money(Math.abs(gain))} (${pct(gain / START)}) cette semaine</span></section>
    <div class="chart"><canvas id="pfChart" height="180"></canvas>${p.series.length < 2 ? `<div class="empty">La courbe démarre au premier relevé des cours de la semaine (chaque soir après la clôture de Wall Street).</div>` : ""}</div>
    <div class="kv"><span>Espèces disponibles</span><span class="num">${money(p.available)}</span></div>
    ${p.pendingBuy ? `<div class="kv"><span>Réservé pour ordres en attente</span><span class="num">${money(p.pendingBuy)}</span></div>` : ""}
    <h2>Positions</h2>${pos ? `<div class="list">${pos}</div>` : `<div class="card"><b>Aucune position</b><span class="note">Tu as ${money(p.available, 0)} à investir cette semaine. Va dans Marché pour passer ton premier ordre.</span><button class="btn dark" data-tabgo="mk">Ouvrir le marché</button></div>`}
    ${ord ? `<h2>Ordres <small>exécutés au relevé du soir</small></h2><div class="list">${ord}</div>` : ""}`;
}

function viewMarket() {
  const q = S.q.trim().toLowerCase();
  let items = instruments().filter(i => S.cat === "Tout" || i.k === S.cat);
  if (q) items = items.filter(i => i.n.toLowerCase().includes(q) || i.s.toLowerCase().includes(q));
  const rows = items.map(i => {
    const lq = lastQuote(i.s);
    return `<button class="row mk" data-open="${esc(i.s)}">${logo(i.s)}<span class="t"><b>${esc(i.n)}</b><small>${esc(i.s)}</small></span><span class="r"><canvas class="spark" data-spark="${esc(i.s)}"></canvas><div>${lq ? `<b class="num">${money(lq.usd)}</b><small class="num ${(lq.chg || 0) >= 0 ? "up" : "down"}">${pct((lq.chg || 0) / 100)}</small>` : `<small class="note">Cours ce soir</small>`}</div></span></button>`;
  }).join("");
  const upper = S.q.trim().toUpperCase();
  const last = S.runs[S.runs.length - 1];
  return `<h2>Marché</h2>
    <input class="search" id="q" type="search" placeholder="Rechercher une action, un ETF, une crypto…" value="${esc(S.q)}" autocomplete="off">
    <div class="cats">${CATS.map(c => `<button data-cat="${c}" aria-pressed="${S.cat === c}">${c}</button>`).join("")}</div>
    <div class="list">${rows || `<p class="note">Rien dans la liste pour « ${esc(S.q)} ».</p>`}</div>
    ${S.q.trim() ? `<div class="card" style="margin-top:12px"><b>Pas dans la liste ?</b><span class="note">Toutes les actions, ETF et cryptos du monde sont jouables. Trouve le symbole Yahoo Finance, tape-le ici, puis place ton ordre : le cours arrive au prochain relevé.</span>
      <a class="btn ghost" style="text-align:center;text-decoration:none" href="https://finance.yahoo.com/lookup?s=${encodeURIComponent(S.q.trim())}" target="_blank" rel="noopener">Chercher « ${esc(S.q.trim())} » sur Yahoo Finance</a>
      ${SYM_RE.test(upper) ? `<button class="btn dark" data-open="${esc(upper)}">Utiliser le symbole ${esc(upper)}</button>` : ""}
      <span class="note">Exemples : NVDA, AIR.PA, 7203.T, VOD.L, BTC-USD.</span></div>` : ""}
    <p class="note" style="margin-top:14px">${last ? `Dernier relevé : ${new Date(last.atMs).toLocaleString("fr-FR", { weekday: "long", hour: "2-digit", minute: "2-digit" })}. Prix en dollars US.` : "Premier relevé des cours ce soir."}</p>`;
}

function viewRanking(bank) {
  if (!bank) return "";
  const weeks = new Set([nowWeek()]); S.runs.forEach(r => weeks.add(runWeek(r))); S.orders.forEach(o => weeks.add(o.week));
  const ws = [...weeks].sort().reverse().slice(0, 10);
  if (!S.week || !ws.includes(S.week)) S.week = ws[0];
  const wk = S.week, live = wk === nowWeek();
  const rows = Object.keys(bank.members || {}).map(pid => { const p = portfolio(pid, bank.id, wk); return { pid, v: p.value, g: p.value / START - 1 }; }).sort((a, b) => b.v - a.v);
  const played = rows.filter(r => Math.abs(r.g) > 1e-9);
  const loser = rows.length > 1 && played.length ? rows[rows.length - 1] : null;
  const shame = loser
    ? `<div class="shame ${live ? "pending" : ""}"><span class="k">${live ? "Lanterne rouge provisoire" : "Lanterne rouge de la semaine"}</span><span class="who">${esc(pseudo(loser.pid))}</span><span class="how num">${pct(loser.g)} · ${money(loser.v)}</span></div>`
    : `<div class="card"><b>${rows.length < 2 ? "Invite tes potes" : "Personne n'a encore bougé"}</b><span class="note">${rows.length < 2 ? "Il faut au moins deux joueurs dans la banque pour désigner un perdant. Partage le code de ta banque." : "Le classement apparaît après le premier relevé des cours qui suit vos ordres."}</span></div>`;
  const list = rows.map((r, i) => `<div class="row rank ${loser && r.pid === loser.pid ? "last" : ""}"><span class="pos ${i === 0 && played.length ? "g" : ""}">${i + 1}</span><span class="t"><b>${esc(pseudo(r.pid))}${r.pid === S.uid ? " (toi)" : ""}</b><small>${r.v >= START ? "En positif" : "En négatif"}</small></span><span class="r"><b class="num">${money(r.v)}</b><small class="num ${r.g >= 0 ? "up" : "down"}">${pct(r.g)}</small></span></div>`).join("");
  return `<h2>Classement <small>${esc(bank.name)}</small></h2>
    <div class="weeks">${ws.map(w => `<button data-week="${w}" aria-pressed="${w === wk}">${w === nowWeek() ? "Cette semaine" : weekLabel(w)}</button>`).join("")}</div>
    ${shame}
    <p class="note" style="margin-top:10px">${live ? "Semaine en cours. Résultat final au relevé de dimanche soir." : "Semaine terminée, résultats définitifs."}</p>
    <div class="list">${list}</div>`;
}

function viewBanks(bank) {
  const mb = myBanks();
  const list = mb.map(b => `<button class="row" data-bank="${esc(b.id)}"><span class="logo" style="background:${colorOf(b.id)}">${esc(b.name.slice(0, 2).toUpperCase())}</span><span class="t"><b>${esc(b.name)}</b><small>${Object.keys(b.members || {}).length} membre(s) · code ${esc(b.code)}</small></span><span class="r">${b.id === bank?.id ? `<span class="pill ok">Active</span>` : ""}</span></button>`).join("");
  return `<h2>Mes banques</h2>
    ${list ? `<div class="list">${list}</div>` : `<p class="note">Tu n'es dans aucune banque. Crée la tienne ou rejoins celle d'un pote avec son code.</p>`}
    ${bank ? `<div class="card" style="margin-top:12px"><span class="note">Code d'invitation de ${esc(bank.name)}</span><span class="code" id="bcode">${esc(bank.code)}</span><button class="btn ghost" id="copyCode">Copier le code</button>
      <span class="note">Membres : ${Object.keys(bank.members || {}).map(pid => esc(pseudo(pid))).join(", ")}</span></div>` : ""}
    <h2>Rejoindre une banque</h2>
    <div class="stack"><label class="field" for="jcode">Code à 6 caractères<input id="jcode" maxlength="6" autocapitalize="characters" placeholder="ex : K7Q2PX"></label><button class="btn dark" id="join">Rejoindre</button><span class="err" id="jerr"></span></div>
    <h2>Créer une banque d'investissement</h2>
    <div class="stack"><label class="field" for="bname">Nom de la banque<input id="bname" maxlength="40" placeholder="ex : LMS BANKING INVESTMENT"></label><button class="btn dark" id="create">Créer</button><span class="err" id="cerr"></span></div>
    <h2>Mon profil</h2>
    <div class="stack"><label class="field" for="mypseudo">Pseudo<input id="mypseudo" maxlength="20" value="${esc(S.players[S.uid]?.pseudo || "")}"></label><button class="btn ghost" id="savemy">Enregistrer</button>
      <button class="btn ghost" id="logout">Se déconnecter</button></div>
    <p class="note" style="margin-top:18px">Règles : 1 000 $ fictifs par banque et par semaine (lundi → dimanche, heure de Paris). Les ordres sont exécutés au relevé des cours du soir, après la clôture de Wall Street. Le dimanche soir, la semaine est figée et le dernier du classement est désigné.</p>`;
}

/* ---------- interactions ---------- */
function bindView() {
  document.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openSheet(b.dataset.open));
  document.querySelectorAll("[data-tabgo]").forEach(b => b.onclick = () => { S.tab = b.dataset.tabgo; render(); });
  if (S.tab === "pf") { const c = $("#pfChart"), bank = curBank(); if (c && bank) drawLine(c, portfolio(S.uid, bank.id, nowWeek()).series, { base: START }); }
  if (S.tab === "mk") {
    paintSparks();
    const q = $("#q");
    q.oninput = () => { S.q = q.value; clearTimeout(S.qt); S.qt = setTimeout(() => { const pos = q.selectionStart; render(); const n = $("#q"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }, 250); };
    document.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => { S.cat = b.dataset.cat; render(); });
  }
  if (S.tab === "rk") document.querySelectorAll("[data-week]").forEach(b => b.onclick = () => { S.week = b.dataset.week; render(); });
  if (S.tab === "bk") {
    document.querySelectorAll("[data-bank]").forEach(b => b.onclick = () => { S.bank = b.dataset.bank; try { localStorage.setItem("kc-bank", S.bank); } catch (e) {} S.tab = "pf"; render(); });
    const cc = $("#copyCode");
    if (cc) cc.onclick = async () => { try { await navigator.clipboard.writeText($("#bcode").textContent); toast("Code copié"); } catch (e) { const r = document.createRange(); r.selectNodeContents($("#bcode")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Code sélectionné, copie-le"); } };
    $("#create").onclick = createBank; $("#join").onclick = joinBank;
    $("#savemy").onclick = async () => { const v = $("#mypseudo").value.trim(); if (!v) return; try { await updateDoc(doc(db, "players", S.uid), { pseudo: v }); toast("Pseudo enregistré"); } catch (e) { toast("Échec de l'enregistrement"); } };
    $("#logout").onclick = () => signOut(auth);
  }
}
document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); });

async function createBank() {
  const name = $("#bname").value.trim(); if (!name) { $("#cerr").textContent = "Donne un nom à ta banque."; return; }
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let code = ""; for (let i = 0; i < 6; i++) code += abc[Math.floor(Math.random() * abc.length)];
  const id = "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try { await setDoc(doc(db, "banks", id), { name, code, createdBy: S.uid, createdAt: serverTimestamp(), members: { [S.uid]: true } }); S.bank = id; try { localStorage.setItem("kc-bank", id); } catch (e) {} toast("Banque créée"); render(); }
  catch (e) { $("#cerr").textContent = "Impossible de créer la banque."; }
}
async function joinBank() {
  const code = $("#jcode").value.trim().toUpperCase();
  const hit = Object.entries(S.banks).find(([, b]) => b.code === code);
  if (!hit) { $("#jerr").textContent = "Aucune banque avec ce code."; return; }
  if (hit[1].members?.[S.uid]) { $("#jerr").textContent = "Tu es déjà dans cette banque."; return; }
  try { await updateDoc(doc(db, "banks", hit[0]), { ["members." + S.uid]: true }); S.bank = hit[0]; try { localStorage.setItem("kc-bank", hit[0]); } catch (e) {} toast("Bienvenue dans " + hit[1].name); S.tab = "pf"; render(); }
  catch (e) { $("#jerr").textContent = "Impossible de rejoindre cette banque."; }
}

function openSheet(sym) {
  const bank = curBank(); if (!bank) return;
  const p = portfolio(S.uid, bank.id, nowWeek()), lq = lastQuote(sym), held = p.pos[sym] || 0;
  const name = nameOf(sym);
  let side = "buy";
  const L = $("#layer");
  L.innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="shT">
    <div class="grab"></div>
    <header><div style="min-width:0"><b id="shT">${esc(name)}</b><small>${esc(sym)}</small></div><button class="x" id="shX" aria-label="Fermer">×</button></header>
    <div><div style="font-size:30px;font-weight:800" class="num">${lq ? money(lq.usd) : "Cours au prochain relevé"}</div>
      ${lq ? `<div class="num ${(lq.chg || 0) >= 0 ? "up" : "down"}" style="font-weight:700">${pct((lq.chg || 0) / 100)} sur la journée${lq.cur && lq.cur !== "USD" ? ` · ${esc(Number(lq.px).toLocaleString("fr-FR"))} ${esc(lq.cur)}` : ""}</div>` : ""}</div>
    <div class="chart"><canvas id="shChart" style="height:140px" height="140"></canvas>${history(sym).length < 2 ? `<div class="empty">Historique disponible après quelques relevés.</div>` : ""}</div>
    ${held ? `<div class="kv"><span>Tu détiens</span><span class="num">${qtyFmt(held)} · ${money(held * (lq?.usd || 0))}</span></div>` : ""}
    <div class="seg"><button id="sBuy" aria-pressed="true">Acheter</button><button id="sSell" aria-pressed="false" ${held ? "" : "disabled"}>Vendre</button></div>
    <div id="pane"></div>
    <p class="note">L'ordre part au marché et s'exécute au prix du prochain relevé (chaque soir après la clôture de Wall Street). Ordres non exécutés avant dimanche soir : annulés.</p>
  </div></div>`;
  const close = () => { L.innerHTML = ""; render(); };
  $("#shX").onclick = close; $("#scrim").onclick = e => { if (e.target.id === "scrim") close(); };
  drawLine($("#shChart"), history(sym).slice(-30), { height: 140 });
  const pane = () => {
    $("#sBuy").setAttribute("aria-pressed", side === "buy"); $("#sSell").setAttribute("aria-pressed", side === "sell");
    if (side === "buy") {
      $("#pane").innerHTML = `<div class="stack"><label class="field" for="amt">Montant (disponible : ${money(p.available)})<input id="amt" type="number" inputmode="decimal" min="1" step="1" placeholder="0"></label>
        <div class="chips">${[50, 100, 250, 500].map(v => `<button data-amt="${v}">${v} $</button>`).join("")}<button data-amt="max">Max</button></div>
        <button class="btn green" id="go">Acheter</button><span class="err" id="oerr"></span></div>`;
      document.querySelectorAll("[data-amt]").forEach(b => b.onclick = () => { $("#amt").value = b.dataset.amt === "max" ? Math.floor(p.available * 100) / 100 : b.dataset.amt; });
      $("#go").onclick = () => {
        const a = Math.round(parseFloat($("#amt").value) * 100) / 100;
        if (!(a > 0)) { $("#oerr").textContent = "Entre un montant."; return; }
        if (a > p.available + 1e-9) { $("#oerr").textContent = "Pas assez d'espèces : " + money(p.available) + " disponibles."; return; }
        place({ side: "buy", amount: a });
      };
    } else {
      $("#pane").innerHTML = `<div class="stack"><div class="chips">${[25, 50, 75, 100].map(v => `<button data-frac="${v}">${v === 100 ? "Tout vendre" : v + " %"}</button>`).join("")}</div><span class="err" id="oerr"></span></div>`;
      document.querySelectorAll("[data-frac]").forEach(b => b.onclick = () => place({ side: "sell", frac: +b.dataset.frac / 100 }));
    }
  };
  $("#sBuy").onclick = () => { side = "buy"; pane(); }; $("#sSell").onclick = () => { if (held) { side = "sell"; pane(); } };
  pane();
  async function place(o) {
    const order = { uid: S.uid, bank: bank.id, sym, name: String(name).slice(0, 60), side: o.side, ts: serverTimestamp() };
    if (o.side === "buy") order.amount = o.amount; else order.frac = o.frac;
    document.querySelectorAll("#pane button").forEach(b => b.disabled = true);
    try { await addDoc(collection(db, "orders"), order); close(); toast(o.side === "buy" ? "Ordre d'achat envoyé" : "Ordre de vente envoyé"); }
    catch (e) { $("#oerr").textContent = "Ordre non envoyé. Réessaie."; document.querySelectorAll("#pane button").forEach(b => b.disabled = false); }
  }
}

window.addEventListener("resize", () => { clearTimeout(S.rt); S.rt = setTimeout(() => { if (S.tab === "pf" || S.tab === "mk") refresh(); }, 200); });

/* ---------- démarrage ---------- */
function stopAll() { S.unsubs.forEach(u => u()); S.unsubs = []; if (S.unsubOrders) S.unsubOrders(); S.unsubOrders = null; S.ordersBank = null; S.ready = { p: false, b: false, r: false, o: false }; }

onAuthStateChanged(auth, async user => {
  stopAll();
  S.uid = user ? user.uid : null;
  if (!user) { render(); return; }
  if (S.pendingPseudo) {
    try { await setDoc(doc(db, "players", user.uid), { pseudo: S.pendingPseudo, createdAt: serverTimestamp() }); } catch (e) {}
    S.pendingPseudo = null;
  }
  $("#app").innerHTML = `<div class="center"><div class="brand">Krach<br>Club</div><p class="note">Chargement…</p></div>`;
  const fail = err => { console.error(err); $("#app").innerHTML = `<div class="center"><div class="brand">Krach<br>Club</div><p class="err">Impossible de charger les données. Vérifie ta connexion puis recharge l'appli.</p></div>`; };
  S.unsubs.push(onSnapshot(collection(db, "players"), s => { S.players = {}; s.docs.forEach(d => S.players[d.id] = d.data()); S.ready.p = true; refresh(); }, fail));
  S.unsubs.push(onSnapshot(collection(db, "banks"), s => { S.banks = {}; s.docs.forEach(d => S.banks[d.id] = d.data()); S.ready.b = true; refresh(); }, fail));
  S.unsubs.push(onSnapshot(query(collection(db, "runs"), orderBy("at", "asc"), limit(400)), s => {
    S.runs = s.docs.map(d => { const r = d.data(); return { ...r, atMs: tsMs(r.at) }; }); S.ready.r = true; refresh();
  }, fail));
});

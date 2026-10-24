# Krach Club

Ligue de bourse fictive entre potes. Chaque semaine (lundi → dimanche, heure de Paris), chaque joueur repart avec 1 000 $ fictifs par banque, investit sur de vrais cours, et le dernier du classement est affiché en grand le dimanche soir.

Tout tourne sur des offres gratuites :
- **GitHub Pages** héberge l'appli (une PWA qui s'installe sur l'écran d'accueil).
- **Firebase** (offre Spark, gratuite) gère les comptes et la base de données.
- **GitHub Actions** relève les cours chaque soir sur Yahoo Finance.

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html`, `app.js` | L'appli |
| `firebase-config.js` | Les identifiants de ton projet Firebase (à remplir) |
| `manifest.webmanifest`, `sw.js`, `icons/` | Ce qui rend l'appli installable |
| `firestore.rules` | Les règles de sécurité de la base (à coller dans Firebase) |
| `scripts/update-prices.mjs` | Le robot qui relève les cours |
| `.github/workflows/prices.yml` | Le déclenchement du robot chaque soir |
| `package.json`, `package-lock.json` | Les dépendances du robot |

## Mise en ligne, pas à pas (≈ 30 minutes)

### 1. Créer le projet Firebase
1. Va sur https://console.firebase.google.com et connecte-toi avec un compte Google.
2. « Créer un projet » → nom : `krach-club` → désactive Google Analytics → Créer.

### 2. Activer les comptes joueurs
1. Menu de gauche : **Authentication** → Commencer.
2. Onglet « Mode de connexion » → **Adresse e-mail/Mot de passe** → Activer → Enregistrer.

### 3. Créer la base de données
1. Menu : **Firestore Database** → Créer une base de données.
2. Emplacement : `eur3 (europe-west)` → mode **production** → Créer.
3. Onglet **Règles** : efface tout, colle le contenu de `firestore.rules` → **Publier**.

### 4. Récupérer la configuration de l'appli
1. Roue crantée → **Paramètres du projet** → onglet Général → « Vos applications » → icône **</>** (Web).
2. Nom : `Krach Club` → Enregistrer (ne coche pas Firebase Hosting).
3. Firebase affiche un bloc `const firebaseConfig = { ... }`. Copie les six valeurs dans `firebase-config.js` à la place des `COLLE-ICI`.

### 5. Créer la clé du robot
1. Paramètres du projet → onglet **Comptes de service** → **Générer une nouvelle clé privée** → Générer.
2. Un fichier `.json` se télécharge. **C'est un secret** : ne le mets jamais dans le dépôt GitHub, ne l'envoie à personne. Tu en auras besoin à l'étape 7.

### 6. Mettre le code sur GitHub
1. Sur https://github.com → **New repository** → nom : `krach-club` → **Public** (obligatoire pour GitHub Pages gratuit) → Create repository.
2. Clique « uploading an existing file » et glisse tous les fichiers et dossiers du projet **sauf** le dossier `.github` (souvent invisible sur Mac et mal pris en charge par le glisser-déposer). → Commit changes.
3. Crée le robot à la main : **Add file → Create new file**, nom : `.github/workflows/prices.yml`, colle le contenu du fichier `prices.yml` → Commit changes.

### 7. Donner la clé au robot
1. Dans le dépôt : **Settings → Secrets and variables → Actions → New repository secret**.
2. Name : `FIREBASE_SERVICE_ACCOUNT`. Secret : ouvre le fichier `.json` de l'étape 5 avec un éditeur de texte, copie **tout** le contenu, colle-le. → Add secret.

### 8. Publier l'appli
1. **Settings → Pages** → Source : « Deploy from a branch » → Branch : `main`, dossier `/ (root)` → Save.
2. Après 1 à 2 minutes, l'appli est en ligne sur `https://TON-PSEUDO-GITHUB.github.io/krach-club/`.
3. Retourne dans Firebase → **Authentication → Paramètres → Domaines autorisés → Ajouter un domaine** : `TON-PSEUDO-GITHUB.github.io`.

### 9. Tester le robot
1. Onglet **Actions** du dépôt → « Relevé des cours » → **Run workflow**.
2. Au bout d'une minute, la coche doit être verte. Dans Firestore, une collection `runs` apparaît avec la date du jour.
3. Ensuite, le robot tourne tout seul chaque soir à 21:30 UTC (23:30 à Paris l'été, 22:30 l'hiver).

### 10. Installer l'appli sur le téléphone
- **iPhone** : ouvre le lien dans Safari → bouton Partager → « Sur l'écran d'accueil ».
- **Android** : ouvre le lien dans Chrome → menu ⋮ → « Installer l'application » ou « Ajouter à l'écran d'accueil ».

L'appli s'ouvre en plein écran avec son icône, sans barre de navigateur.

### 11. Faire venir tes potes
1. Crée ton compte dans l'appli, puis la banque **LMS BANKING INVESTMENT** (onglet Banques).
2. Envoie le lien de l'appli et le code à 6 caractères de la banque à tes potes.
3. Ils créent leur compte, rejoignent avec le code, et c'est parti.

## Règles du jeu
- 1 000 $ fictifs par banque et par semaine. Lundi, tout le monde repart à zéro.
- Les ordres sont des ordres « au marché » : ils s'exécutent au prix du relevé du soir qui suit.
- L'heure de chaque ordre est fixée par le serveur et un ordre ne peut plus être modifié : impossible de tricher en antidatant un achat.
- Ordres non exécutés au relevé du dimanche soir : annulés.
- Tous les prix sont convertis en dollars US.
- N'importe quel symbole Yahoo Finance est jouable (ex : `NVDA`, `AIR.PA`, `7203.T`, `VOD.L`, `BTC-USD`).

## Bon à savoir
- **Mettre à jour l'appli** : modifie un fichier directement sur GitHub (icône crayon) et valide. GitHub Pages republie en une minute, et l'appli prend la nouvelle version à la prochaine ouverture.
- **Robot en pause** : GitHub met en pause les tâches planifiées d'un dépôt public sans aucun commit pendant 60 jours, et t'envoie un e-mail. Il suffit de cliquer sur « Enable workflow » dans l'onglet Actions.
- **Cours manquants** : Yahoo Finance n'a pas d'API officielle. Si un soir un cours ne remonte pas, l'appli garde le dernier prix connu et le symbole est listé dans le champ `bad` du relevé.
- **Coût** : 0 €. Pour un groupe de potes, on reste très loin des limites gratuites de Firebase et de GitHub.

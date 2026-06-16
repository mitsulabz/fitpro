# FitNoob — Contexte projet & passation

> **À LIRE EN PREMIER (passation depuis Cowork)**
> Ce projet a été développé en plusieurs étapes dans Claude (Cowork). On bascule
> maintenant sur **Claude Code** pour pouvoir éditer **et déployer** (git push + Supabase) au
> même endroit. Le dossier sur disque est la source de vérité. Avant toute modif :
> 1. Lis ce fichier en entier.
> 2. Lis `index.html` (toute l'app y est : HTML + CSS + JS inline).
> 3. Respecte les conventions ci-dessous, en particulier **`const BUILD`** (à incrémenter à CHAQUE déploiement)
>    et la vérification JS avant push.
> Routine de déploiement : éditer → vérifier (parse JS) → `git add -A && git commit && git push` → GitHub Pages republie.

---

## 1. C'est quoi

**FitNoob** = web app (mobile-first) de suivi nutrition & santé. Single-page,
**un seul fichier `index.html`** autonome (HTML + CSS + JS vanilla inline, aucun build).
Auth + synchro multi-appareils via Supabase. Hébergée sur GitHub Pages.

Utilisateur : homme, 43 ans, 180 cm, ~100 kg, objectif 30 % → 20 % de masse grasse.

## 2. Fichiers du dépôt

- `index.html` — **toute l'application** (source de vérité). ~63 Ko.
- `manifest.webmanifest` — manifeste PWA.
- `images/` — icônes (apple-touch-icon.png 180, icon-192/512.png, favicon-32.png). Icône = design perso de l'utilisateur.
- `favicon.ico` — favicon racine.
- `supabase/functions/coach/index.ts` — Edge Function du coach IA (Deno).
- `supabase_setup.sql` — création table `app_state` + RLS (à exécuter une fois dans Supabase).
- `COACH_IA_deploiement.md` — guide de déploiement de la fonction coach.
- `fitnoob-historique-exemple.json` — exemple/historique importable (format = état complet de l'app).
- `build_site.py`, `index_v0_backup.html` — ANCÊTRE/sauvegarde de la toute première version (générateur Python). **Non utilisés**, gardés pour archive.
- `deploy.command` — script de push en double-clic (fallback hors Claude Code).

## 3. Architecture & état (l'objet `S`)

Tout l'état tient dans un objet JS `S`, persisté :
- en **local** : `localStorage["fitnoob_v1"]` (cache, mode hors-ligne) ;
- en **cloud** : Supabase, table `app_state` (1 ligne par utilisateur, colonne `data` JSONB).

Schéma de `S` :
```js
{
  profile: { age, sex:'h'|'f', height, weight, bf, bft, act, sportHours },
  days: { "JJ/MM/AAAA": { weight, act, sport:{name,kcal}|null, foods:[{n,k,p,g,l}] } },
  favorites: [ { name, per:'100'|'unit', kcal, p, g, l, img } ],
  sports: [ { name, kcal } ],
  theme: 'light'|'dark',
  _ts: <epoch ms, mis à jour à chaque save()>,
  _uid: <id supabase du propriétaire du cache, garde anti-fuite multi-comptes>
}
```
- `save()` = stamp `_ts` + `saveLocalOnly()` + `scheduleCloudSync()` (push différé 1,5 s).
- Réconciliation au login : la version au `_ts` le plus récent gagne (cloud vs local).

## 4. Décisions de calcul (NE PAS casser sans raison)

- **Métabolisme de base (BMR)** : Katch-McArdle si % masse grasse connu (`370 + 21.6*masse_maigre`), sinon Mifflin-St-Jeor.
- **8 niveaux d'activité** (`ACT_LEVELS`), clé = facteur multiplicateur (`'1.10'`…`'2.00'`). Migration des anciennes clés `sed/act/sup` via `migrateAct()` au chargement.
- **Dépense estimée (projection)** = `BMR × facteur_activité + sport_estimé`, où `sport_estimé = heures/sem × 6 MET × poids / 7`.
- **Déficit optimal = −20 % du TDEE** (`DEFICIT_PCT=0.20`), avec plancher d'apport de sécurité (1500 H / 1200 F). Voir `deficitFor()`, `recDeficit()`.
- **Suivi quotidien** : chaque carte de jour utilise la **dépense réelle du jour** (activité + sport saisis) ; cible du jour = manger 80 % de cette dépense (`targetRow`).
- **Panneau objectif** : 2 phrases courtes ("Je serai bogoss le …" / "En tryhardant au max …") côte à côte, chacune avec une pastille `(i)` qui déplie l'explication détaillée (`.proj-detail`).

## 5. Auth & synchro (Supabase)

- Projet : `arydsxswhbgpfayjgtak` — URL `https://arydsxswhbgpfayjgtak.supabase.co`.
- `SUPABASE_URL` et `SUPABASE_ANON_KEY` sont en haut du `<script>` dans `index.html` (la clé anon est **publique par conception**, OK en clair).
- **Compte obligatoire** : un écran de connexion (`#authGate`) bloque l'app tant qu'on n'est pas connecté (email + mot de passe). Plus d'usage local sans compte.
- Table `app_state` + Row Level Security : voir `supabase_setup.sql` (à exécuter dans Supabase → SQL Editor si pas déjà fait).

## 6. Coach IA (V3, en cours)

- Bouton "🤖 Demander un bilan" dans l'onglet Suivi → `sb.functions.invoke('coach', {body:{summary:buildCoachSummary()}})`.
- La fonction `supabase/functions/coach/index.ts` appelle Claude **ou** OpenAI selon les secrets `AI_PROVIDER` / `AI_API_KEY` (`AI_MODEL` optionnel). Clé IA gardée côté serveur.
- **À FAIRE pour l'activer** : `supabase login` → `supabase link --project-ref arydsxswhbgpfayjgtak` → `supabase secrets set AI_PROVIDER=anthropic AI_API_KEY=...` → `supabase functions deploy coach`. (Détails dans `COACH_IA_deploiement.md`.)

## 7. Versionnage & mise à jour auto

- En haut du script : `const BUILD='Vx.y · date'`. **À INCRÉMENTER À CHAQUE DÉPLOIEMENT.**
- Le badge de version s'affiche à côté de "FitNoob" et en bas des Réglages.
- Mécanisme de **mise à jour auto invisible** : au retour sur l'app (visibilitychange/pageshow/focus), elle compare le `BUILD` déployé au `BUILD` courant et **recharge seule si différent**. Donc si tu déploies sans changer `BUILD`, l'app installée ne se mettra pas à jour. **Toujours bumper `BUILD`.**
- Version actuelle : **V3.1**.

## 8. Hébergement & déploiement

- Dépôt : **github.com/mitsulabz/fitnoob** (public), branche `main`.
- Hébergeur cible : **GitHub Pages** (gratuit, dépôt public). À activer une fois : Settings → Pages → Source = branche `main`, dossier `/ (root)` → URL `https://mitsulabz.github.io/fitnoob/`.
- ⚠️ L'utilisateur testait avant sur **Netlify** (passé en payant à crédits — abandonné). Comme les données sont sur Supabase + compte, changer d'URL ne fait rien perdre (se reconnecter suffit).
- iOS : l'app s'ajoute à l'écran d'accueil (PWA). L'icône est figée à l'ajout → re-ajouter le raccourci pour changer d'icône.

## 9. Vérification AVANT chaque push (obligatoire)

`index.html` contient tout le JS inline. Avant de pousser, vérifier que le JS parse :
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("index.html","utf8");
const js=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).pop();
new Function(js);console.log("JS parse OK");'
```
Pour des tests plus poussés (calculs, rendu), exécuter le JS dans un DOM stubbé en Node (pattern utilisé pendant le dev : Proxy comme faux `document`, on expose les fonctions via `globalThis`).

## 10. Reste à faire / idées

- [ ] Activer GitHub Pages sur le dépôt (ou Cloudflare Pages) et donner l'URL au testeur.
- [ ] Exécuter `supabase_setup.sql` si pas déjà fait, et **déployer la fonction `coach`** (clé IA requise).
- [ ] **2e brique IA** : "décrire un aliment → macros estimées par IA" (même mécanisme que le coach : un onglet de plus dans la fenêtre d'ajout d'aliment + une route dans la fonction Edge).
- [ ] Option : champ "dépense mesurée par la montre" par jour (l'ancien prototype l'avait ; l'app recalcule actuellement la dépense).
- [ ] Tester en conditions réelles : recherche/scan Open Food Facts (CORS OK, nécessite HTTPS), caméra iOS.

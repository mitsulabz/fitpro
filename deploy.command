#!/bin/bash
# FitNoob — déploiement en un double-clic
# Pousse les modifications vers GitHub. GitHub Pages (ou Cloudflare Pages) republie tout seul.
cd "$(dirname "$0")" || exit 1
echo "📦 Déploiement de FitNoob…"
git add -A
if git diff --cached --quiet; then
  echo "ℹ️  Rien de nouveau à déployer."
else
  git commit -m "maj $(date '+%Y-%m-%d %H:%M')"
  if git push; then
    echo "✅ Poussé sur GitHub. Le site sera à jour dans ~30 secondes."
  else
    echo "❌ Échec du push (connexion ou authentification). Voir SETUP_GITHUB.md."
  fi
fi
echo ""
read -n 1 -s -r -p "Appuie sur une touche pour fermer cette fenêtre."

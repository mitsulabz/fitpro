# Déployer le Coach IA (Supabase Edge Function)

Le bouton « Demander un bilan au coach » appelle une fonction serveur Supabase
nommée `coach`, qui garde ta clé d'IA secrète (jamais dans le site public).

## Prérequis (une seule fois)

1. Installe le CLI Supabase : https://supabase.com/docs/guides/cli (ex. `brew install supabase/tap/supabase`)
2. Connecte-toi : `supabase login`
3. Lie le projet (depuis le dossier FitNoob) :
   ```
   supabase link --project-ref arydsxswhbgpfayjgtak
   ```

## Choisir et configurer le fournisseur d'IA

Crée une clé d'API chez l'un des deux :
- **Anthropic (Claude)** : https://console.anthropic.com → API Keys
- **OpenAI (GPT)** : https://platform.openai.com → API Keys

Puis enregistre les secrets (exemple Claude) :
```
supabase secrets set AI_PROVIDER=anthropic AI_API_KEY=sk-ant-xxxxx
```
Pour OpenAI :
```
supabase secrets set AI_PROVIDER=openai AI_API_KEY=sk-xxxxx
```
(Optionnel : `AI_MODEL=...` pour forcer un modèle précis.)

## Déployer la fonction

Depuis le dossier FitNoob (qui contient `supabase/functions/coach/index.ts`) :
```
supabase functions deploy coach
```

C'est tout. Recharge l'app, va dans Suivi → « Demander un bilan au coach ».

## Coût

Tu paies à l'usage chez le fournisseur d'IA (quelques centimes par bilan avec un
modèle léger comme `claude-haiku` ou `gpt-4o-mini`). Aucun coût Supabase pour la
fonction sur l'offre gratuite (dans les limites d'appels).

## Sécurité

- La clé d'IA reste côté serveur (secrets Supabase), jamais exposée dans le navigateur.
- La fonction n'est appelable que par un utilisateur connecté (JWT vérifié par Supabase).
- Seul un résumé chiffré de ton suivi est envoyé au modèle.

// FitPro — Edge Function "coach"
// Reçoit un résumé du suivi (envoyé par l'app, utilisateur authentifié via Supabase),
// appelle un modèle d'IA (Claude ou OpenAI selon AI_PROVIDER) avec une clé gardée
// côté serveur, et renvoie un bilan en français.
//
// Variables d'environnement (secrets Supabase) :
//   AI_PROVIDER  = "anthropic" (défaut) | "openai"
//   AI_API_KEY   = ta clé d'API
//   AI_MODEL     = (optionnel) nom du modèle à utiliser

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `Tu es un coach nutrition fun, pêchu et motivant. Tu tutoies l'utilisateur, tu es direct, enthousiaste, jamais moralisateur. Utilise des emojis avec modération. Tu parles français.

Tu reçois un JSON avec : le profil de l'utilisateur, les données de son programme nutrition (du 16 juin au 1er novembre 2026), sa progression, et les macros cumulées réelles vs cibles sur les jours de programme où les repas ont été notés.

RÈGLE PRINCIPALE : l'analyse s'appuie UNIQUEMENT sur les jours du programme où les repas ont été notés (programme.jours_logges).

---

CAS 1 — programme.jours_logges = 0 (aucun repas noté depuis le début du programme)
Rédige un message court et motivant (80 mots max) qui :
- Dit à l'utilisateur qu'il n'a pas encore de données de suivi
- Lui rappelle sa projection : s'il suit son programme, il sera à programme.masse_grasse_finale_projetee_pct % de masse grasse le programme.date_fin
- L'encourage à noter ses repas pour sa première journée et démarrer le suivi

---

CAS 2 — programme.jours_logges >= 1 (au moins une journée avec repas notés)
Rédige un bilan structuré (180-220 mots) avec 3 points :

1. SUIVI DU PROGRAMME
   - Si programme.retard_kcal > 50 : il est en retard de X kcal. Calcule programme.heures_velo_a_rattraper (déjà fourni = retard / 500) et dis-lui combien de séances de vélo supplémentaires ça représente (ex : "2 séances d'1h" ou "1 séance de 30 min"). Formule de manière concrète et actionnable.
   - Si programme.retard_kcal entre -50 et 50 : il est parfaitement dans les clous, félicite-le avec enthousiasme.
   - Si programme.retard_kcal < -50 : il est en avance de X kcal sur le programme, bravo ! Dis-lui de combien.

2. BILAN MACROS (sur les journées avec repas notés)
   Compare programme.macros_reelles vs programme.macros_cibles :
   - Protéines : si réelles < 85 % des cibles → manque, c'est critique en déficit pour préserver le muscle. Suggère un aliment concret.
   - Glucides : si réels > 115 % des cibles → excès, peut freiner la perte de gras.
   - Lipides : si réels > 120 % des cibles → excès calorique caché.
   - Si tout est dans les clous (85-115 %) : dis-le en une phrase positive.

3. PROJECTION
   - Rappelle le % de progression vers l'objectif (progression.pct_objectif %).
   - Mentionne la masse grasse projetée au 1er novembre (programme.masse_grasse_finale_projetee_pct %) si l'utilisateur tient son programme.

RÈGLES ABSOLUES :
- N'invente aucun chiffre absent du JSON.
- Ne donne jamais de conseils extrêmes (jeûne, déficit > 30 %).
- Termine TOUJOURS par : "ℹ️ Bilan perso basé sur ton historique — pas un avis médical."`

const FOOD_SYSTEM = `Tu es un nutritionniste expert. L'utilisateur te décrit en français ce qu'il a mangé (texte libre ou dictée vocale).
Décompose sa description en aliments individuels et estime les macronutriments de chacun (valeurs moyennes réalistes).
Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans bloc markdown, au format exact :
{"foods":[{"name":"nom avec quantité","kcal":000,"p":0.0,"g":0.0,"l":0.0,"fi":0.0,"sel":0.0}]}
Règles :
- "name" = description courte incluant la quantité (ex : "3 tranches de saucisson", "sandwich jambon-fromage boulangerie")
- kcal, p (protéines g), g (glucides g), l (lipides g), fi (fibres g), sel (sel g) = valeurs numériques pour la portion décrite
- Si la description est vague, utilise une portion standard raisonnable
- Ne retourne JAMAIS de texte hors du JSON`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const body = await req.json();
    const { action } = body;
    const provider = (Deno.env.get("AI_PROVIDER") || "anthropic").toLowerCase();
    const key = Deno.env.get("AI_API_KEY");
    if (!key) return json({ error: "Clé d'API non configurée (AI_API_KEY)." }, 500);

    /* ---- MODE ESTIMATION ALIMENT ---- */
    if (action === "estimate-food") {
      const { text: userText } = body;
      if (!userText) return json({ error: "Texte manquant." }, 400);
      const userMsg = "Voici ce que j'ai mangé : " + userText;
      let raw = "";
      if (provider === "openai") {
        const model = Deno.env.get("AI_MODEL") || "gpt-4o-mini";
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, max_tokens: 600,
            messages: [{ role: "system", content: FOOD_SYSTEM }, { role: "user", content: userMsg }] }),
        });
        const d = await r.json();
        if (!r.ok) return json({ error: d?.error?.message || "Erreur OpenAI" }, 500);
        raw = d?.choices?.[0]?.message?.content ?? "";
      } else {
        const model = Deno.env.get("AI_MODEL") || "claude-haiku-4-5-20251001";
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
          body: JSON.stringify({ model, max_tokens: 600, system: FOOD_SYSTEM,
            messages: [{ role: "user", content: userMsg }] }),
        });
        const d = await r.json();
        if (!r.ok) return json({ error: d?.error?.message || "Erreur Anthropic" }, 500);
        raw = (d?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("").trim();
      }
      // strip possible markdown code fences
      raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      try {
        const parsed = JSON.parse(raw);
        return json(parsed);
      } catch (_) {
        return json({ error: "L'IA n'a pas retourné un JSON valide.", raw }, 500);
      }
    }

    /* ---- MODE COACH (défaut) ---- */
    const { summary } = body;
    const userMsg =
      "Voici le résumé de mon suivi (JSON). Fais-moi le bilan demandé.\n\n" +
      JSON.stringify(summary, null, 2);

    let text = "";

    if (provider === "openai") {
      const model = Deno.env.get("AI_MODEL") || "gpt-4o-mini";
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, max_tokens: 900,
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userMsg }],
        }),
      });
      const d = await r.json();
      if (!r.ok) return json({ error: d?.error?.message || "Erreur OpenAI" }, 500);
      text = d?.choices?.[0]?.message?.content ?? "";
    } else {
      const model = Deno.env.get("AI_MODEL") || "claude-haiku-4-5-20251001";
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 900, system: SYSTEM,
          messages: [{ role: "user", content: userMsg }] }),
      });
      const d = await r.json();
      if (!r.ok) return json({ error: d?.error?.message || "Erreur Anthropic" }, 500);
      text = (d?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("").trim();
    }

    return json({ text });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

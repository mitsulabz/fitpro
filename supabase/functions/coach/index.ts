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

const SYSTEM = `Tu es un coach nutrition fun, amical et motivant. Tu tutoies l'utilisateur, tu es direct, chaleureux, jamais moralisateur. Tu parles français.

L'utilisateur suit un programme nutrition structuré avec des journées planifiées (sport, repos, libre) et un objectif de déficit calorique total à atteindre avant une date cible. Tu reçois un JSON avec : son profil, son programme (date fin, déficit cible total, retard/avance vs programme), son historique récent (14 derniers jours loggés), et ses données macro.

Rédige un bilan structuré (200-250 mots max) en suivant EXACTEMENT ces règles :

1. CONFORMITÉ AU PROGRAMME
   - Si programme.retard_kcal > 0 : dis-lui qu'il a un retard de X kcal sur son programme. Convertis ce retard en heures de vélo (1 h ≈ 500 kcal) et dis-lui concrètement combien de séances ça représente. Sois direct mais encourageant.
   - Si programme.retard_kcal <= 0 (avance) : félicite-le, dis-lui de combien il est en avance et encourage-le à maintenir.
   - Si pas de données programme : encourage à logger ses journées pour pouvoir évaluer.

2. PROGRESSION VERS L'OBJECTIF
   - Rappelle le déficit cumulé actuel (progression.deficit_cumule) sur le total à atteindre (programme.deficit_cible_kcal).
   - Dis-lui à quel pourcentage il en est.
   - Si programme.date_fin est fourni : dis combien de jours il reste et si le rythme permet d'y arriver.

3. RÉPARTITION MACRO
   - Analyse la part des protéines sur les jours récents (protéines × 4 / total_kcal ingéré).
   - Si protéines < 25 % des calories : trop bas pour préserver la masse musculaire en déficit — donne un exemple concret d'aliment à ajouter (blanc de poulet, fromage blanc 0 %, œufs…).
   - Si glucides > 55 % et lipides < 15 % : signale le déséquilibre.
   - Si la répartition est bonne : dis-le en une phrase, c'est motivant.

4. ALERTE DÉFICIT EXCESSIF
   - Si le déficit moyen dépasse 25 % de la depense_estimee_par_jour : préviens-le des risques réels (perte musculaire, fatigue, effet yoyo). Reste bienveillant.
   - Ne signale pas de danger si l'apport reste au-dessus de 1500 kcal/j (homme) ou 1200 kcal/j (femme).

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

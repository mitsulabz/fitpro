// FitNoob — Edge Function "coach"
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

On te donne un résumé JSON du suivi nutritionnel d'un utilisateur : profil, objectif de masse grasse, déficit cumulé et moyen, dépense estimée, répartition macro des jours récents, historique des jours loggés.

Rédige un bilan structuré (200-250 mots max) en suivant EXACTEMENT ces règles :

1. TRAJECTOIRE AU RYTHME ACTUEL
   - Si l'historique est suffisant (>= 5 jours loggés avec des aliments) : utilise le deficit_moyen_par_jour fourni pour estimer la date d'atteinte de l'objectif (kcal_total / deficit_moyen). Dis-lui clairement à quelle date il atteindra son objectif s'il continue comme ça.
   - Si l'historique est insuffisant (< 5 jours) : dis-lui gentiment que tu manques encore de données pour lui donner une projection fiable, et encourage-le à logger au moins 5 jours.

2. COMPARAISON RYTHME ACTUEL vs RYTHME OPTIMAL
   - Si le déficit moyen actuel est inférieur au deficit_optimal_par_jour fourni : dis-lui qu'il pourrait aller plus vite. Calcule et propose-lui la date d'atteinte si il tenait le déficit optimal. Suggère comment y arriver : augmenter le sport si sport_h_par_semaine < 4, ou réduire légèrement les apports si les protéines sont déjà bonnes. Sois précis et pragmatique.
   - Si le rythme actuel est proche ou supérieur à l'optimal : félicite-le et dis-lui de maintenir.

3. RÉPARTITION MACRO
   - Analyse la part des protéines sur les jours récents (protéines × 4 / total_kcal ingéré).
   - Si protéines < 25 % des calories : dis-lui que c'est trop bas pour préserver la masse musculaire pendant un déficit, et donne un exemple concret d'aliment à ajouter (ex : blanc de poulet, fromage blanc 0 %).
   - Si glucides > 55 % et lipides < 15 % : signale le déséquilibre.
   - Si la répartition est bonne : dis-le en une phrase, c'est motivant.

4. ALERTE DÉFICIT EXCESSIF
   - Si le déficit moyen dépasse 25 % de la depense_estimee_par_jour : préviens-le des risques réels (perte musculaire, fatigue, effet yoyo, ralentissement du métabolisme). Reste bienveillant, pas effrayant.
   - Ne signale pas de danger si l'apport reste au-dessus du plancher (1500 kcal homme / 1200 kcal femme).

RÈGLES ABSOLUES :
- N'invente aucun chiffre absent du JSON.
- Ne donne jamais de conseils extrêmes (jeûne, déficit > 30 %).
- Termine TOUJOURS par : "ℹ️ Bilan perso basé sur ton historique — pas un avis médical."`;

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

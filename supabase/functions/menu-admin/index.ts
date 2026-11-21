// Bugsy's secret menu updater — Supabase Edge Function
// Secrets to set in Supabase (Edge Functions → Secrets):
//   ADMIN_PIN      the PIN you and the owner type in
//   GEMINI_API_KEY from aistudio.google.com → Get API key
//   GITHUB_TOKEN   fine-grained token with Contents: Read & write on mwillard0927-ctrl/Bugsy-Menu
//   GEMINI_MODEL   optional, defaults to gemini-3.8-flash
const REPO = "mwillard0927-ctrl/Bugsy-Menu";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";

async function gh(path: string, init: RequestInit = {}) {
  return fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env("GITHUB_TOKEN")}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "bugsy-menu-admin",
      ...(init.headers || {}),
    },
  });
}
const b64dec = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
const b64enc = (s: string) => {
  const bytes = new TextEncoder().encode(s); let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

async function currentMenu() {
  const r = await gh("contents/menu.json");
  if (!r.ok) throw new Error("Couldn't read menu.json from GitHub (" + r.status + ")");
  const j = await r.json();
  return { sha: j.sha as string, menu: JSON.parse(b64dec(j.content)) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    if (!env("ADMIN_PIN") || body.pin !== env("ADMIN_PIN")) {
      await new Promise((r) => setTimeout(r, 1200)); // slow down guessing
      return json({ error: "Wrong PIN" }, 401);
    }
    if (body.action === "check") return json({ ok: true });

    if (body.action === "scan") {
      const { menu } = await currentMenu();
      const prompt = `You update a restaurant's menu data. Below is the CURRENT menu as JSON, and a PHOTO.
The photo may be a printed/handwritten menu page, price list, or note describing changes.
Return the FULL updated menu JSON with exactly the same structure and field names.
Rules:
- Change ONLY what the photo clearly shows (prices, item names, descriptions, new items, removed items).
- Match items by name; keep everything the photo does not mention exactly as it is.
- Keep prices formatted like the current data (e.g. "$12", "$8 / $14").
- Add new items to the section they belong in. Only remove an item if the photo clearly says so.
- Never invent prices. If something is unreadable, leave it unchanged.
Also include a top-level "notes" string (one or two sentences) describing anything unclear.
CURRENT MENU:
${JSON.stringify(menu)}`;
      const model = env("GEMINI_MODEL") || "gemini-3.8-flash";
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env("GEMINI_API_KEY")}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: body.mime || "image/jpeg", data: body.image } }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0 },
          }),
        },
      );
      const g = await r.json();
      if (!r.ok) return json({ error: "Scanner error: " + (g?.error?.message || r.status) }, 502);
      const text = g?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
      let proposed;
      try { proposed = JSON.parse(text); } catch { return json({ error: "Scanner returned something unreadable. Try a clearer photo." }, 502); }
      const notes = proposed.notes || ""; delete proposed.notes;
      if (!Array.isArray(proposed.sections)) return json({ error: "Scanner result was missing the menu sections." }, 502);
      return json({ current: menu, proposed, notes });
    }

    if (body.action === "publish") {
      const m = body.menu;
      if (!m || !Array.isArray(m.sections) || m.sections.length < 3) return json({ error: "Menu looks incomplete; not published." }, 400);
      const { sha } = await currentMenu();
      const r = await gh("contents/menu.json", {
        method: "PUT",
        body: JSON.stringify({
          message: "Menu update from Bugsy's secret updater",
          content: b64enc(JSON.stringify(m, null, 1) + "\n"),
          sha,
        }),
      });
      if (!r.ok) return json({ error: "GitHub didn't accept the update (" + r.status + ")" }, 502);
      return json({ ok: true });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

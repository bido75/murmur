// End-to-end test of the features that failed with the "kong" download error, plus
// the LLM features that share the pipeline. Run from the project root.
const { readFileSync } = require("node:fs");

const API = process.env.API_URL || "http://127.0.0.1:54321";
const ANON = process.env.ANON_KEY;
const WAV = process.env.WAV_PATH;

if (!ANON) { console.error("ANON_KEY is not set"); process.exit(1); }
if (!WAV) { console.error("WAV_PATH is not set"); process.exit(1); }

async function json(method, path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token || ANON}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

const ok = (label, cond, extra) => console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);

async function main() {
  const email = `features-${Date.now()}@example.com`;
  const password = "a-long-password-for-local-testing";

  const signUp = await json("POST", "/auth/v1/signup", { email, password });
  const token = signUp.body.access_token;
  const userId = signUp.body.user.id;
  console.log("signed up:", userId);

  // A recording with real audio, processed to completion.
  const recId = crypto.randomUUID();
  await json("POST", "/rest/v1/recordings", {
    id: recId, user_id: userId, title: "Feature test", template: "meeting",
    source: "mic", status: "recording", consent_method: "solo", created_at: new Date().toISOString(),
  }, token);
  const audio = readFileSync(WAV);
  await fetch(`${API}/storage/v1/object/audio/${userId}/${recId}/seg-0001.wav`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "audio/wav", "x-upsert": "true" },
    body: audio,
  });
  await json("POST", "/rest/v1/recording_segments", {
    recording_id: recId, user_id: userId, idx: 1, storage_path: `${userId}/${recId}/seg-0001.wav`, duration_ms: 6000,
  }, token);
  console.log("recording uploaded; processing...");
  await fetch(`${API}/functions/v1/process-recording`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recording_id: recId }),
  });

  // Wait for the notes.
  let status = "";
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await json("GET", `/rest/v1/recordings?id=eq.${recId}&select=status,error`, null, token);
    status = st.body?.[0]?.status ?? "";
    if (status === "ready" || status === "failed") break;
  }
  console.log("recording status:", status, "\n");

  // The download features that used to fail with "kong".
  const deck = await json("POST", "/functions/v1/make-deck", { kind: "client_update", recording_id: recId }, token);
  ok("Make a Deck", deck.status === 200 && typeof deck.body?.url === "string", `url host: ${deck.body?.url?.split("/")[2] ?? "none"}`);
  ok("  deck URL is reachable (not kong)", !String(deck.body?.url ?? "").includes("kong"));

  const docx = await json("POST", "/functions/v1/share/docx", { recording_id: recId, include_transcript: true }, token);
  ok("Export DOCX", docx.status === 200 && typeof docx.body?.url === "string", `url host: ${docx.body?.url?.split("/")[2] ?? "none"}`);
  ok("  docx URL is reachable (not kong)", !String(docx.body?.url ?? "").includes("kong"));

  const exportData = await json("POST", "/functions/v1/export-data", {}, token);
  ok("Export my data (ZIP)", exportData.status === 200 && typeof exportData.body?.url === "string", `url host: ${exportData.body?.url?.split("/")[2] ?? "none"}`);
  ok("  export URL is reachable (not kong)", !String(exportData.body?.url ?? "").includes("kong"));

  // The LLM features behind the rest of the list.
  const followup = await json("POST", "/functions/v1/share/followup", { recording_id: recId, tone: "formal" }, token);
  ok("Draft a follow-up email", followup.status === 200 && followup.body?.subject && followup.body?.body, followup.body?.subject ? `subject: "${followup.body.subject.slice(0, 50)}"` : "");

  const translate = await json("POST", "/functions/v1/translate", { recording_id: recId, lang: "fr" }, token);
  ok("Translate notes", translate.status === 200 && (translate.body?.summary || translate.body?.tasks), translate.body?.summary ? `overview: "${String(translate.body.summary).slice(0, 60)}"` : "");

  const sw = await json("POST", "/functions/v1/translate", { recording_id: recId, lang: "sw" }, token);
  ok("Translate to Swahili", sw.status === 200 && (sw.body?.summary || sw.body?.tasks), sw.body?.summary ? `overview: "${String(sw.body.summary).slice(0, 60)}"` : `status ${sw.status}`);

  const yo = await json("POST", "/functions/v1/translate", { recording_id: recId, lang: "yo" }, token);
  ok("Translate to Yoruba", yo.status === 200 && (yo.body?.summary || yo.body?.tasks), yo.body?.summary ? `overview: "${String(yo.body.summary).slice(0, 60)}"` : `status ${yo.status}`);
}

main().catch((e) => { console.error("FAILED", e); process.exit(1); });

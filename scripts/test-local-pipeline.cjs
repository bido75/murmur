// The whole local pipeline, with the real keys: sign up, upload audio, transcribe it
// and write the notes. Run from the project root.
//
//   $env:ANON_KEY = (the anon key from .env)
//   $env:WAV_PATH = "C:\path\to\speech.wav"
//   node scripts\test-local-pipeline.cjs
const { readFileSync } = require("node:fs");

const API = process.env.API_URL || "http://127.0.0.1:54321";
const ANON = process.env.ANON_KEY;
const WAV = process.env.WAV_PATH;

if (!ANON) {
  console.error("ANON_KEY is not set. It is the anon key from .env.");
  process.exit(1);
}
if (!WAV) {
  console.error("WAV_PATH is not set. It is the audio file to transcribe.");
  process.exit(1);
}

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
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function main() {
  const email = `test-${Date.now()}@example.com`;
  const password = "a-long-password-for-local-testing";

  const signUp = await json("POST", "/auth/v1/signup", { email, password });
  console.log("sign up:", signUp.status);
  if (signUp.status >= 400) {
    console.log(JSON.stringify(signUp.body).slice(0, 300));
    process.exit(1);
  }
  const token = signUp.body.access_token;
  const userId = signUp.body.user.id;
  console.log("user:", userId);

  // A recording to hang the audio on.
  const recId = crypto.randomUUID();
  const created = await json(
    "POST",
    "/rest/v1/recordings",
    {
      id: recId,
      user_id: userId,
      title: "Local pipeline test",
      template: "meeting",
      source: "mic",
      status: "recording",
      consent_method: "solo",
      created_at: new Date().toISOString(),
    },
    token,
  );
  console.log("recording:", created.status);

  // The audio.
  const audio = readFileSync(WAV);
  const up = await fetch(`${API}/storage/v1/object/audio/${userId}/${recId}/seg-0001.wav`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "audio/wav",
      "x-upsert": "true",
    },
    body: audio,
  });
  console.log("audio uploaded:", up.status);

  await json(
    "POST",
    "/rest/v1/recording_segments",
    {
      recording_id: recId,
      user_id: userId,
      idx: 1,
      storage_path: `${userId}/${recId}/seg-0001.wav`,
      duration_ms: 6000,
    },
    token,
  );

  // Now the real test: the server transcribes the audio and writes the notes.
  console.log("running the pipeline (this takes a minute)...");
  const t0 = Date.now();
  const res = await fetch(`${API}/functions/v1/process-recording`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recording_id: recId }),
  });
  console.log("process-recording:", res.status, `in ${Math.round((Date.now() - t0) / 1000)}s`);
  const text = await res.text();
  if (!res.ok) console.log("body:", text.slice(0, 400));

  // What came out. The pipeline runs in the background, so wait for it.
  let utts = [];
  let status = "";
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await json(
      "GET",
      `/rest/v1/recordings?id=eq.${recId}&select=status,error`,
      null,
      token,
    );
    status = st.body?.[0]?.status ?? "";
    if (status === "failed") {
      console.log("the pipeline failed:", st.body?.[0]?.error);
      break;
    }
    if (status === "done" || status === "ready" || status === "complete") break;
    const t = await json(
      "GET",
      `/rest/v1/transcripts?recording_id=eq.${recId}&select=utterances`,
      null,
      token,
    );
    utts = t.body?.[0]?.utterances ?? [];
  }
  console.log("final status:", status);
  console.log("\nTRANSCRIPT:");
  for (const u of utts) console.log(`  ${u.start_ms}ms ${u.text}`);

  const summary = await json(
    "GET",
    `/rest/v1/summaries?recording_id=eq.${recId}&select=overview,key_points,decisions,open_questions`,
    null,
    token,
  );
  const s = summary.body?.[0];
  console.log("\nNOTES:");
  console.log("  overview:", s?.overview);
  console.log("  key points:", JSON.stringify(s?.key_points));
  console.log("  decisions:", JSON.stringify(s?.decisions));

  const rec = await json(
    "GET",
    `/rest/v1/recordings?id=eq.${recId}&select=status,error,transcribed_on_device`,
    null,
    token,
  );
  console.log("\nrecording:", JSON.stringify(rec.body?.[0]));
}

main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});

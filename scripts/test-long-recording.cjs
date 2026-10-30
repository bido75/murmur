// Long-recording pipeline test: feeds a synthetic recording of a given length
// through the real local pipeline — upload in 5-minute segments (the same shape
// the app produces; a shorter final segment when needed), finalize, process,
// wait for notes — and reports timings.
//
//   node scripts/test-long-recording.cjs <minutes>   (1..60)
//
// Env: API_URL, ANON_KEY, WAV_PATH (a short real-speech WAV used as the source
// material; it is repeated to fill each segment).
const fs = require("fs");
const API = process.env.API_URL || "http://127.0.0.1:54321";
const ANON = process.env.ANON_KEY;
const WAV = process.env.WAV_PATH;
const MINUTES = parseInt(process.argv[2] || "15", 10);

if (!ANON) { console.error("ANON_KEY is not set"); process.exit(1); }
if (!WAV || !fs.existsSync(WAV)) { console.error("WAV_PATH is not set or missing"); process.exit(1); }
if (!(MINUTES >= 1 && MINUTES <= 60)) { console.error("minutes must be 1..60"); process.exit(1); }

const SEGMENT_MS = 5 * 60 * 1000;
// All segments are 5 minutes except a shorter final one when needed.
const whole = Math.floor((MINUTES * 60_000) / SEGMENT_MS);
const remainderMs = MINUTES * 60_000 - whole * SEGMENT_MS;
const segmentPlan = remainderMs > 0 ? [...Array(whole).fill(SEGMENT_MS), remainderMs] : Array(whole).fill(SEGMENT_MS);

function wavHeader(dataLen, byteRate) {
  const b = Buffer.alloc(44);
  b.write("RIFF", 0); b.writeUInt32LE(36 + dataLen, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(byteRate, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(dataLen, 40);
  return b;
}

/** Build one WAV of the given duration (16 kHz mono 16-bit) from real speech:
 * WAV_PATH may be a directory of seg-NN.wav files (distinct content per
 * segment) or a single WAV repeated to fill the segment. */
const SPEECH_DIR = fs.existsSync(WAV) && fs.statSync(WAV).isDirectory() ? WAV : null;
const SPEECH_FILES = SPEECH_DIR
  ? fs.readdirSync(SPEECH_DIR).filter((f) => f.endsWith(".wav")).sort()
  : null;

function buildSegment(durationMs, idx) {
  const srcPath = SPEECH_FILES
    ? `${SPEECH_DIR}/${SPEECH_FILES[(idx - 1) % SPEECH_FILES.length]}`
    : WAV;
  const src = fs.readFileSync(srcPath);
  const dataOff = src.indexOf("data") + 8;
  const data = src.subarray(dataOff);
  const byteRate = 16000 * 2;
  const need = byteRate * (durationMs / 1000);
  if (data.length >= need) return Buffer.concat([wavHeader(need, byteRate), data.subarray(0, need)]);
  const parts = [];
  let filled = 0;
  while (filled + data.length <= need) { parts.push(data); filled += data.length; }
  parts.push(data.subarray(0, need - filled));
  return Buffer.concat([wavHeader(need, byteRate), ...parts]);
}

async function j(method, path, token, body, isBodyJson = true) {
  const t0 = Date.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "content-type": isBodyJson ? "application/json" : "audio/wav",
      ...(isBodyJson ? {} : { "x-upsert": "true" }),
    },
    body: method === "GET" || method === "HEAD" ? undefined : isBodyJson ? JSON.stringify(body ?? {}) : body,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, ms: Date.now() - t0 };
}

(async () => {
  const t0 = Date.now();
  console.log(`building ${segmentPlan.length} segment(s) (${MINUTES} min total)...`);
  const segs = segmentPlan.map((d, i) => buildSegment(d, i + 1));
  console.log(`  sizes: ${segs.map((s) => `${(s.length / 1e6).toFixed(1)}MB`).join(", ")}`);

  const email = `long-${Date.now()}@rehearsal.test`;
  const signUp = await j("POST", "/auth/v1/signup", ANON, { email, password: "Passw0rd!123" });
  if (signUp.status !== 200) { console.error("sign up failed", signUp.status, signUp.text.slice(0, 200)); process.exit(1); }
  const token = signUp.json.access_token;
  const userId = signUp.json.user.id;
  console.log(`signed up ${userId} (+${Date.now() - t0}ms)`);

  const recId = crypto.randomUUID();
  const create = await j("POST", "/rest/v1/recordings", token, {
    id: recId, user_id: userId, title: `Long ${MINUTES}min`, template: "meeting", source: "mic", status: "recording",
  }, true);
  if (create.status !== 201) { console.error("create failed", create.status, create.text.slice(0, 200)); process.exit(1); }

  let uploadMs = 0;
  for (let i = 1; i <= segs.length; i++) {
    const path = `/storage/v1/object/audio/${userId}/${recId}/seg-${String(i).padStart(4, "0")}.wav`;
    const up = await j("POST", path, token, segs[i - 1], false);
    if (up.status !== 200 && up.status !== 201) { console.error(`segment ${i} upload failed`, up.status, up.text.slice(0, 200)); process.exit(1); }
    const segRow = await j("POST", "/rest/v1/recording_segments", token, {
      recording_id: recId, user_id: userId, idx: i, storage_path: `${userId}/${recId}/seg-${String(i).padStart(4, "0")}.wav`,
      duration_ms: segmentPlan[i - 1],
    });
    if (segRow.status !== 201) { console.error(`segment ${i} row failed`, segRow.status, segRow.text.slice(0, 200)); process.exit(1); }
    uploadMs += up.ms;
    console.log(`  segment ${i}/${segs.length} (${(segmentPlan[i - 1] / 60000).toFixed(1)} min) uploaded (+${up.ms}ms)`);
  }
  console.log(`upload phase: ${(uploadMs / 1000).toFixed(1)}s total`);

  const fin = await j("PATCH", `/rest/v1/recordings?id=eq.${recId}`, token, {
    status: "uploading", duration_ms: MINUTES * 60_000,
  });
  if (fin.status !== 204) { console.error("finalize failed", fin.status, fin.text.slice(0, 200)); process.exit(1); }

  const proc = await j("POST", "/functions/v1/process-recording", token, { recording_id: recId });
  if (proc.status !== 200 && proc.status !== 202) { console.error("process failed", proc.status, proc.text.slice(0, 300)); process.exit(1); }
  console.log(`processing accepted (HTTP ${proc.status}) (+${((Date.now() - t0) / 1000).toFixed(1)}s from start)`);

  const deadline = Date.now() + 45 * 60_000;
  let status = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await j("GET", `/rest/v1/recordings?id=eq.${recId}&select=status,error`, token);
    status = s.json?.[0];
    if (status && (status.status === "ready" || status.status === "failed")) break;
  }
  if (!status) { console.error("no status row"); process.exit(1); }
  if (status.status === "failed") { console.error("pipeline FAILED:", status.error); process.exit(1); }
  if (status.status !== "ready") { console.error("timed out at", status.status); process.exit(1); }

  const notes = await j("GET", `/rest/v1/summaries?recording_id=eq.${recId}&select=overview,key_points`, token);
  const segCount = await j("GET", `/rest/v1/recording_segments?recording_id=eq.${recId}&select=idx`, token);
  const totalMs = Date.now() - t0;
  console.log("");
  console.log(`PASS  ${MINUTES}-minute recording reached 'ready'`);
  console.log(`  upload: ${(uploadMs / 1000).toFixed(1)}s for ${segs.length} segments`);
  console.log(`  processing (STT + notes): ${((totalMs - uploadMs) / 1000).toFixed(1)}s`);
  console.log(`  total: ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`  segments stored: ${segCount.json?.length}; notes present: ${Boolean(notes.json?.[0]?.overview)}`);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });

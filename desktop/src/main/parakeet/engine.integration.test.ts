// The local engine, end to end.
//
// This needs the speech model and a spoken WAV. When they are not there the test is
// skipped rather than failed, and the way to get them is printed.
//
//   MURMUR_TEST_MODEL_ZIP   the model release archive
//   MURMUR_TEST_SPEECH_WAV  a 16 kHz mono WAV of someone speaking
//
// To make the WAV on Windows:
//   powershell -File scripts/speak.ps1 -Text "..." -Out speech.wav
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installModel, installedFiles, modelInstalled } from "../speechModelManager.ts";
import { ParakeetEngine } from "./engine.ts";
import { readWav } from "../../shared/wav.ts";
import { DEFAULT_SPEECH_MODEL } from "../../shared/speechModels.ts";

const ZIP = process.env.MURMUR_TEST_MODEL_ZIP ?? "";
const WAV = process.env.MURMUR_TEST_SPEECH_WAV ?? "";
const skip = ZIP && WAV && existsSync(ZIP) && existsSync(WAV) ? false : "set MURMUR_TEST_MODEL_ZIP and MURMUR_TEST_SPEECH_WAV";

test("the model installs from the archive and every file is checked", { skip }, async () => {
  const base = mkdtempSync(join(tmpdir(), "murmur-model-"));
  try {
    // Serve the archive over HTTP so the download path is the real one.
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Length": String(statSync(ZIP).size) });
      createReadStream(ZIP).pipe(res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const bundle = {
      ...DEFAULT_SPEECH_MODEL,
      archive: { ...DEFAULT_SPEECH_MODEL.archive, url: `http://127.0.0.1:${port}/model.zip` },
    };

    const result = await installModel(bundle, base);
    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    // The connection is kept alive by the client, so it has to be closed outright or
    // the test process never ends.
    server.closeAllConnections();
    server.close();

    // Every file is there, at the right size.
    const files = installedFiles(bundle, base);
    for (const spec of bundle.files) {
      const found = files.find((f) => f.name === spec.name);
      assert.ok(found, `${spec.name} was not installed`);
      assert.equal(found.present, true, `${spec.name} is not there`);
      assert.equal(found.sizeBytes, spec.sizeBytes, `${spec.name} is the wrong size`);
      assert.equal(
        found.verifiedVersion,
        bundle.version,
        `${spec.name} was not checked`,
      );
    }
    assert.equal(modelInstalled(bundle, base), true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the engine reads the speech and says what was said", { skip }, async () => {
  const base = mkdtempSync(join(tmpdir(), "murmur-engine-"));
  try {
    // Put the model in place by installing it from the archive.
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Length": String(statSync(ZIP).size) });
      createReadStream(ZIP).pipe(res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const bundle = {
      ...DEFAULT_SPEECH_MODEL,
      archive: { ...DEFAULT_SPEECH_MODEL.archive, url: `http://127.0.0.1:${port}/model.zip` },
    };
    const installed = await installModel(bundle, base);
    server.closeAllConnections();
    server.close();
    assert.equal(installed.ok, true, installed.ok ? "" : installed.reason);

    const wav = readWav(new Uint8Array(readFileSync(WAV)));
    assert.equal(wav.sampleRate, 16000, "the fixture is at the model's rate");

    const engine = await ParakeetEngine.create(join(base, "speech-models", `${bundle.id}-${bundle.version}`));
    const result = await engine.transcribe(wav.samples);

    assert.ok(result.utterances.length > 0, "something was transcribed");
    const text = result.utterances.map((u) => u.text).join(" ").toLowerCase();
    // The words the fixture contains. The model is not perfect, so this checks that
    // most of the sentence came through rather than that it is exact.
    const expected = ["fox", "jumps", "lazy", "dog"];
    const found = expected.filter((w) => text.includes(w));
    assert.ok(
      found.length >= 3,
      `expected most of ${expected.join(", ")} in "${text}"`,
    );
    // And the times are in order and inside the audio.
    let last = -1;
    for (const u of result.utterances) {
      assert.ok(u.start_ms >= last, "the sentences are in order");
      assert.ok(u.start_ms < wav.durationMs, "the sentences are inside the audio");
      assert.ok(u.end_ms > u.start_ms, "each sentence has a length");
      last = u.start_ms;
    }
    await engine.close();
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import type {
  AudioSource,
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from "./interfaces.ts";
import { isCloudProvider, pickProvider } from "./select.ts";

function fakeProvider(
  type: TranscriptionProvider["type"],
  available: boolean,
  willing = true,
): TranscriptionProvider {
  return {
    type,
    isAvailable: async () => available,
    canTranscribe: () => willing,
    transcribe: async (): Promise<TranscriptionResult> => ({
      utterances: [],
      durationMs: 0,
      language: null,
      provider: type,
    }),
  };
}

const AUDIO: AudioSource = { kind: "samples", samples: new Float32Array(0), sampleRate: 16000 };

test("a cloud provider is refused under local-only, even when alone", async () => {
  const only = [fakeProvider("deepgram", true)];
  const r = await pickProvider(only, { privacy: "local-only" });
  assert.deepEqual(r, { ok: false, reason: "local-only-refused", providerType: "deepgram" });
});

test("local-only is enforced even when the provider itself says yes", async () => {
  // A buggy cloud provider that ignores privacy must still be stopped here.
  const buggy = fakeProvider("deepgram", true, true);
  assert.equal(isCloudProvider(buggy), true);
  const r = await pickProvider([buggy], { privacy: "local-only" });
  assert.equal(r.ok, false);
});

test("without local-only, the available provider is chosen", async () => {
  const r = await pickProvider([fakeProvider("parakeet", true)]);
  assert.ok(r.ok);
  assert.equal((r as { provider: { type: string } }).provider.type, "parakeet");
});

test("an unavailable local engine is reported, not fallen back to the cloud", async () => {
  const r = await pickProvider(
    [fakeProvider("parakeet", false), fakeProvider("deepgram", true)],
    { privacy: "local-only" },
  );
  // The cloud one is refused first, which is the whole point of the mode.
  assert.deepEqual(r, { ok: false, reason: "local-only-refused", providerType: "deepgram" });
});

test("nothing available is a typed refusal", async () => {
  const r = await pickProvider([fakeProvider("parakeet", false)]);
  assert.deepEqual(r, { ok: false, reason: "none-available", wanted: "any" });
});

test("a provider unwilling to take the job is skipped", async () => {
  const r = await pickProvider([fakeProvider("parakeet", true, false)]);
  assert.deepEqual(r, { ok: false, reason: "none-available", wanted: "any" });
});

test("options flow through canTranscribe", async () => {
  let seen: TranscriptionOptions | null = null;
  const spy: TranscriptionProvider = {
    type: "parakeet",
    isAvailable: async () => true,
    canTranscribe: (o) => {
      seen = o ?? null;
      return true;
    },
    transcribe: async () => ({
      utterances: [],
      durationMs: 0,
      language: null,
      provider: "parakeet",
    }),
  };
  await pickProvider([spy], { privacy: "local-only", language: "en" });
  const seenOptions = seen as TranscriptionOptions | null;
  assert.equal(seenOptions?.language, "en");
  assert.equal(seenOptions?.privacy, "local-only");
});

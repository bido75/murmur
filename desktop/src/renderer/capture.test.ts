// End-to-end contract tests for Capture.start(): device enumeration is diagnostic, not
// a gate, so a blank enumerateDevices() must not prevent getUserMedia; and a failed
// acquisition surfaces the right message. Browser globals (navigator, AudioContext,
// MediaRecorder, the murmur bridge) are mocked with the smallest surface start() uses.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// config.ts reads esbuild-injected globals at module load; provide them before the
// dynamic import so the type-stripped module can load under plain Node (static imports
// hoist above this assignment, hence the dynamic import below).
const g = globalThis as unknown as Record<string, unknown>;
g.__SUPABASE_URL__ = "";
g.__SUPABASE_ANON_KEY__ = "";
g.__APP_URL__ = "";

const { Capture } = await import("./capture.ts");

type AudioTrack = { readyState: string; stop?: () => void };
type FakeStream = {
  getAudioTracks: () => AudioTrack[];
  getTracks?: () => AudioTrack[];
};

const events = {
  onSegment: () => Promise.resolve(),
  onWarning: () => {},
  onLevel: () => {},
};

function bridgeMock() {
  return {
    micPermission: async () => true,
    info: async () => ({ platform: "win32", version: "1.0.0" }),
    segmentOpen: async () => {},
    activeSet: async () => {},
    segmentAppend: async () => {},
    fileDelete: async () => {},
    macAudioStart: async () => ({ ok: true }),
    macAudioStop: async () => {},
    on: () => () => {},
  };
}

// Minimal Web Audio / MediaRecorder doubles for the start(false, false) path.
class FakeAudioContext {
  createMediaStreamDestination() {
    return { channelCount: 1, stream: {} };
  }
  createChannelMerger(_n: number) {
    return { connect: () => {} };
  }
  createMediaStreamSource(_stream: FakeStream) {
    return { connect: () => {} };
  }
  createAnalyser() {
    return { fftSize: 2048, connect: () => {}, getFloatTimeDomainData: () => {} };
  }
  async close() {}
}

class FakeMediaRecorder {
  state = "inactive";
  ondataavailable: ((e: unknown) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, _opts: unknown) {}
  start(_ms: number) {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
}

function installGlobals(opts: {
  enumerate: () => Promise<unknown[]>;
  getUserMedia: () => Promise<FakeStream>;
}) {
  g.window = {
    murmur: bridgeMock(),
    // start() schedules a tick interval; a no-op keeps the test from leaking a timer.
    setInterval: () => 0,
  };
  g.navigator = {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    mediaDevices: {
      enumerateDevices: opts.enumerate,
      getUserMedia: opts.getUserMedia,
    },
  };
  g.AudioContext = FakeAudioContext;
  g.MediaRecorder = FakeMediaRecorder;
}

beforeEach(() => {
  delete g.window;
  delete g.navigator;
  delete g.AudioContext;
  delete g.MediaRecorder;
});

test("a blank device list does not prevent acquisition — getUserMedia is still tried", async () => {
  let acquired = false;
  installGlobals({
    enumerate: async () => [],
    getUserMedia: async () => {
      acquired = true;
      return { getAudioTracks: () => [{ readyState: "live" }] };
    },
  });
  const cap = new Capture("rec-1", events);
  await cap.start(false, false);
  assert.ok(acquired, "getUserMedia must run even when enumerateDevices is empty");
});

test("NotFoundError reports no microphone (with OS guidance)", async () => {
  installGlobals({
    enumerate: async () => [],
    getUserMedia: async () => {
      throw Object.assign(new Error("no device"), { name: "NotFoundError" });
    },
  });
  const cap = new Capture("rec-2", events);
  await assert.rejects(() => cap.start(false, false), /No microphone was found/);
});

test("NotAllowedError is a permission, not a missing-device problem", async () => {
  installGlobals({
    enumerate: async () => [],
    getUserMedia: async () => {
      throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    },
  });
  const cap = new Capture("rec-3", events);
  await assert.rejects(() => cap.start(false, false), /Microphone access is off/);
});

test("NotReadableError is a busy device", async () => {
  installGlobals({
    enumerate: async () => [],
    getUserMedia: async () => {
      throw Object.assign(new Error("busy"), { name: "NotReadableError" });
    },
  });
  const cap = new Capture("rec-4", events);
  await assert.rejects(() => cap.start(false, false), /busy|another app/i);
});

test("a stream with no audio track fails cleanly", async () => {
  installGlobals({
    enumerate: async () => [{ kind: "audioinput", label: "Mic" }],
    getUserMedia: async () => ({ getAudioTracks: () => [] }),
  });
  const cap = new Capture("rec-5", events);
  await assert.rejects(() => cap.start(false, false), /no audio track/);
});

test("a track that already ended is stopped and reported", async () => {
  let stopped = 0;
  installGlobals({
    enumerate: async () => [],
    getUserMedia: async () => ({
      getAudioTracks: () => [{ readyState: "ended" }],
      getTracks: () => [
        {
          readyState: "ended",
          stop: () => {
            stopped += 1;
          },
        },
      ],
    }),
  });
  const cap = new Capture("rec-6", events);
  await assert.rejects(() => cap.start(false, false), /ended before recording/);
  assert.equal(stopped, 1, "the ended mic track is released");
});
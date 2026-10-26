// Recording that is hard to lose:
// - audio is split into 5-minute files; each finished file is moved to permanent
//   storage and queued for upload immediately, while recording continues
// - the active session is saved to disk, so after a crash the finished parts (and the
//   part in progress, if the OS left it readable) are recovered on next launch
// - the mic level is watched; silence or a stalled recorder shows a warning
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingInput,
  type RecordingOptions,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useRef, useState } from "react";
import { SEGMENT_MS, SILENCE_DB, SILENCE_WARN_MS } from "./config";
import { isWeb } from "./dialog";
import { requestMic } from "./mic";
import { AppState, Platform } from "react-native";
import { LOCAL_RECORDING } from "./localStt";
import { PcmWavRecorder, repairWav } from "./pcmRecorder";
import { enqueue, keepFile, keepRecording } from "./sync";

const OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64000,
  isMeteringEnabled: true,
};
// Browsers record WebM/Opus via MediaRecorder; phones record AAC in .m4a.
const EXT = isWeb ? "webm" : "m4a";
const ACTIVE_KEY = "recorder.active.v1";
// Browsers only hand over audio when a part ends, so parts are shorter there: closing the tab
// loses at most the part in progress (the finished ones wait in IndexedDB).
const WEB_SEGMENT_MS = 2 * 60 * 1000;
const INPUT_KEY = "recorder.input.v1"; // the mic the user picked last (e.g. a Bluetooth lapel mic)
const KEEP_AWAKE_TAG = "recording";

// local: transcribed on this phone (WAV parts, never uploaded).
type Active = {
  recordingId: string;
  segIdx: number;
  doneMs: number;
  currentUri: string | null;
  local?: boolean;
};

async function saveActive(a: Active | null) {
  if (a) await AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(a));
  else await AsyncStorage.removeItem(ACTIVE_KEY);
}

/**
 * Call once at startup. If the app died mid-recording, queue what was captured.
 * Returns the recovered recording id, or null.
 */
export async function recoverInterruptedRecording(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(ACTIVE_KEY);
  if (!raw) return null;
  const a = JSON.parse(raw) as Active;
  try {
    if (a.currentUri && !isWeb) {
      const f = new File(a.currentUri);
      if (f.exists && f.size > 4096) {
        const ext = a.local ? "wav" : EXT;
        if (a.local && Platform.OS === "android") repairWav(a.currentUri); // header sizes weren't written
        const uri = keepFile(a.currentUri, a.recordingId, a.segIdx, ext);
        // Duration unknown; the server measures it during transcription.
        if (a.local)
          await enqueue({
            kind: "local_segment",
            recordingId: a.recordingId,
            idx: a.segIdx,
            localUri: uri,
            offsetMs: a.doneMs,
            durationMs: 0,
          });
        else
          await enqueue({
            kind: "segment",
            recordingId: a.recordingId,
            idx: a.segIdx,
            localUri: uri,
            ext,
            durationMs: 0,
          });
      }
    }
  } catch {
    // The partial file was unreadable; earlier segments are still safe.
  }
  await enqueue(
    a.local
      ? {
          kind: "local_finalize",
          recordingId: a.recordingId,
          durationMs: a.doneMs,
        }
      : { kind: "finalize", recordingId: a.recordingId, durationMs: a.doneMs },
  );
  await saveActive(null);
  return a.recordingId;
}

export type Phase = "idle" | "recording" | "paused" | "stopping";

export function useSegmentedRecorder() {
  const recorder = useAudioRecorder(OPTIONS);
  const state = useAudioRecorderState(recorder, 500);
  const [phase, setPhase] = useState<Phase>("idle");
  const [warning, setWarning] = useState<string | null>(null);
  const [segmentsSaved, setSegmentsSaved] = useState(0);
  const session = useRef<Active | null>(null);
  const busy = useRef(false);
  // The work in flight (a part being rotated), so stopping can wait for it.
  const busyWork = useRef<Promise<void> | null>(null);
  const silenceSince = useRef<number | null>(null);
  const lastProgress = useRef({ ms: 0, at: 0 });
  const [doneMs, setDoneMs] = useState(0);
  const [inputs, setInputs] = useState<RecordingInput[]>([]);
  const [inputUid, setInputUid] = useState<string | null>(null);
  const preferredInput = useRef<string | null>(null);
  // Android + on-device transcription: raw PCM written to WAV by us instead of expo-audio.
  const pcm = useRef<PcmWavRecorder | null>(null);
  const [pcmMs, setPcmMs] = useState(0);
  const [pcmLevel, setPcmLevel] = useState<number | null>(null);
  const [usingPcm, setUsingPcm] = useState(false);
  const status = useCallback(() => {
    const p = pcm.current;
    return p
      ? {
          durationMillis: p.durationMs,
          metering: p.level,
          mediaServicesDidReset: false,
        }
      : recorder.getStatus();
  }, [recorder]);

  /** Each new file re-prepares the recorder, so re-apply the chosen mic every time. */
  const applyInput = useCallback(async () => {
    if (isWeb) return;
    try {
      const list = recorder.getAvailableInputs();
      setInputs(list);
      preferredInput.current ??= await AsyncStorage.getItem(INPUT_KEY);
      const want = list.find((i) => i.uid === preferredInput.current);
      if (want) recorder.setInput(want.uid);
      const current = await recorder.getCurrentInput().catch(() => null);
      setInputUid(current?.uid ?? want?.uid ?? null);
    } catch {
      // Input listing isn't available on every device; the default mic is used.
    }
  }, [recorder]);

  const beginSegment = useCallback(async () => {
    if (pcm.current && session.current) {
      const uri = new File(
        Paths.cache,
        `rec-${session.current.recordingId}-${session.current.segIdx}.wav`,
      ).uri;
      pcm.current.start(uri);
      lastProgress.current = { ms: 0, at: Date.now() };
      session.current.currentUri = uri;
      await saveActive(session.current);
      return;
    }
    await recorder.prepareToRecordAsync(
      session.current?.local
        ? (LOCAL_RECORDING as Partial<RecordingOptions>)
        : undefined,
    );
    await applyInput();
    recorder.record();
    lastProgress.current = { ms: 0, at: Date.now() };
    if (session.current) {
      session.current.currentUri = recorder.uri;
      await saveActive(session.current);
    }
  }, [recorder, applyInput]);

  const finishSegment = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    let durationMs: number;
    let uri: string | null;
    if (pcm.current) {
      durationMs = pcm.current.finishFile();
      uri = s.currentUri;
    } else {
      durationMs = recorder.getStatus().durationMillis;
      await recorder.stop();
      uri = recorder.uri ?? s.currentUri;
    }
    if (uri && durationMs > 500) {
      const ext = s.local ? "wav" : EXT;
      const kept = await keepRecording(uri, s.recordingId, s.segIdx, ext);
      if (s.local)
        await enqueue({
          kind: "local_segment",
          recordingId: s.recordingId,
          idx: s.segIdx,
          localUri: kept,
          offsetMs: s.doneMs,
          durationMs,
        });
      else
        await enqueue({
          kind: "segment",
          recordingId: s.recordingId,
          idx: s.segIdx,
          localUri: kept,
          ext,
          durationMs,
        });
      s.doneMs += durationMs;
      s.segIdx += 1;
      setSegmentsSaved((n) => n + 1);
      setDoneMs(s.doneMs);
    }
    s.currentUri = null;
    await saveActive(s);
  }, [recorder]);

  /** Close the current file and open a new one without stopping the session. */
  const rotate = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    busyWork.current = (async () => {
      try {
        await finishSegment();
        await beginSegment();
        setWarning(null);
      } catch (e) {
        setWarning(`Couldn't restart the microphone: ${(e as Error).message}`);
      }
    })();
    try {
      await busyWork.current;
    } finally {
      busy.current = false;
      busyWork.current = null;
    }
  }, [beginSegment, finishSegment]);

  const start = useCallback(
    async (recordingId: string, opts: { local?: boolean } = {}) => {
      await requestMic();
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        // Recording stays in the foreground (the screen is kept on), so background
        // recording is off. On Android in SDK 58, asking for it here makes
        // prepareToRecordAsync reject unless the config plugin and the notification
        // permission are set up for it.
        allowsBackgroundRecording: false,
        interruptionMode: "doNotMix",
      });
      session.current = {
        recordingId,
        segIdx: 1,
        doneMs: 0,
        currentUri: null,
        local: Boolean(opts.local) && !isWeb,
      };
      pcm.current =
        session.current.local && Platform.OS === "android"
          ? new PcmWavRecorder()
          : null;
      setUsingPcm(pcm.current !== null);
      setPcmMs(0);
      setSegmentsSaved(0);
      setDoneMs(0);
      setWarning(null);
      silenceSince.current = null;
      await beginSegment();
      // Keeping the screen on is a nice-to-have; browsers may refuse it (hidden tab, no permission).
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
      setPhase("recording");
    },
    [beginSegment],
  );

  const pause = useCallback(() => {
    if (pcm.current) pcm.current.pause();
    else recorder.pause();
    setPhase("paused");
  }, [recorder]);

  const resume = useCallback(() => {
    if (pcm.current) pcm.current.resume();
    else recorder.record();
    lastProgress.current = { ms: status().durationMillis, at: Date.now() };
    setWarning(null);
    setPhase("recording");
  }, [recorder, status]);

  /** Stop, save the last segment and hand the recording to the upload queue. */
  const stop = useCallback(async () => {
    // A part may be being rotated right now. Wait for it, so pressing Stop is never a no-op.
    if (busyWork.current) {
      setPhase("stopping");
      await busyWork.current.catch(() => undefined);
    }
    const s = session.current;
    if (!s) {
      setPhase("idle");
      return;
    }
    busy.current = true;
    setPhase("stopping");
    try {
      await finishSegment();
      await enqueue(
        s.local
          ? {
              kind: "local_finalize",
              recordingId: s.recordingId,
              durationMs: s.doneMs,
            }
          : {
              kind: "finalize",
              recordingId: s.recordingId,
              durationMs: s.doneMs,
            },
      );
      await saveActive(null);
    } finally {
      await pcm.current?.release();
      pcm.current = null;
      setUsingPcm(false);
      session.current = null;
      busy.current = false;
      void Promise.resolve()
        .then(() => deactivateKeepAwake(KEEP_AWAKE_TAG))
        .catch(() => {});
      await setAudioModeAsync({
        allowsRecording: false,
        allowsBackgroundRecording: false,
      });
      setPhase("idle");
    }
  }, [finishSegment]);

  // Health checks and segment rotation, polled twice a second while recording.
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => {
      if (busy.current) return;
      const st = status();
      const now = Date.now();
      if (pcm.current) {
        setPcmMs(st.durationMillis);
        setPcmLevel(st.metering ?? null);
      }

      if (
        st.mediaServicesDidReset ||
        st.durationMillis >= (isWeb ? WEB_SEGMENT_MS : SEGMENT_MS)
      ) {
        void rotate();
        return;
      }

      if (st.durationMillis > lastProgress.current.ms) {
        lastProgress.current = { ms: st.durationMillis, at: now };
      } else if (
        lastProgress.current.at &&
        now - lastProgress.current.at > 4000
      ) {
        setWarning(
          'Recording stopped by the system (a call or another app may have the mic). Tap "Restart mic".',
        );
        return;
      }

      if (typeof st.metering === "number" && st.metering < SILENCE_DB) {
        silenceSince.current ??= now;
        if (now - silenceSince.current > SILENCE_WARN_MS) {
          setWarning(
            "Not hearing anything yet — tap to make sure the mic is picking you up.",
          );
        }
      } else {
        silenceSince.current = null;
        setWarning((w) => (w?.startsWith("Not hearing anything") ? null : w));
      }
    }, 500);
    return () => clearInterval(timer);
  }, [phase, status, rotate]);

  // If the system paused our timers in the background, split an overlong part as soon as we're back.
  useEffect(() => {
    if (phase !== "recording" || isWeb) return;
    const sub = AppState.addEventListener("change", (st) => {
      if (
        st === "active" &&
        !busy.current &&
        status().durationMillis >= SEGMENT_MS
      )
        void rotate();
    });
    return () => sub.remove();
  }, [phase, status, rotate]);

  // Browser: warn before closing the tab mid-recording (the part in progress would be lost).
  useEffect(() => {
    if (!isWeb || phase === "idle") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  // Never leave the mic open if the screen goes away (runs on unmount only).
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);
  useEffect(() => {
    return () => {
      if (session.current) void stopRef.current();
    };
  }, []);

  /** Switch microphones mid-recording (e.g. to a Bluetooth lapel mic). Remembered for next time. */
  const chooseInput = useCallback(
    async (uid: string) => {
      preferredInput.current = uid;
      await AsyncStorage.setItem(INPUT_KEY, uid);
      try {
        recorder.setInput(uid);
        setInputUid(uid);
      } catch (e) {
        setWarning(`Couldn't switch microphone: ${(e as Error).message}`);
      }
    },
    [recorder],
  );

  const elapsedMs =
    phase === "idle" ? 0 : doneMs + (usingPcm ? pcmMs : state.durationMillis);

  return {
    phase,
    warning,
    segmentsSaved,
    elapsedMs,
    level: usingPcm ? pcmLevel : (state.metering ?? null),
    start,
    pause,
    resume,
    stop,
    restartMic: rotate,
    inputs,
    inputUid,
    chooseInput,
  };
}

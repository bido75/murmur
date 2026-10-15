// Recording that is hard to lose:
// - audio is split into 5-minute files; each finished file is moved to permanent
//   storage and queued for upload immediately, while recording continues
// - the active session is saved to disk, so after a crash the finished parts (and the
//   part in progress, if the OS left it readable) are recovered on next launch
// - the mic level is watched; silence or a stalled recorder shows a warning
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SEGMENT_MS, SILENCE_DB, SILENCE_WARN_MS } from './config';
import { isWeb } from './dialog';
import { enqueue, keepFile } from './sync';

const OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64000,
  isMeteringEnabled: true,
};
// Browsers record WebM/Opus via MediaRecorder; phones record AAC in .m4a.
const EXT = isWeb ? 'webm' : 'm4a';
const ACTIVE_KEY = 'recorder.active.v1';
const KEEP_AWAKE_TAG = 'recording';

type Active = { recordingId: string; segIdx: number; doneMs: number; currentUri: string | null };

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
        const uri = keepFile(a.currentUri, a.recordingId, a.segIdx, EXT);
        // Duration unknown; the server measures it during transcription.
        await enqueue({ kind: 'segment', recordingId: a.recordingId, idx: a.segIdx, localUri: uri, ext: EXT, durationMs: 0 });
      }
    }
  } catch {
    // The partial file was unreadable; earlier segments are still safe.
  }
  await enqueue({ kind: 'finalize', recordingId: a.recordingId, durationMs: a.doneMs });
  await saveActive(null);
  return a.recordingId;
}

export type Phase = 'idle' | 'recording' | 'paused' | 'stopping';

export function useSegmentedRecorder() {
  const recorder = useAudioRecorder(OPTIONS);
  const state = useAudioRecorderState(recorder, 500);
  const [phase, setPhase] = useState<Phase>('idle');
  const [warning, setWarning] = useState<string | null>(null);
  const [segmentsSaved, setSegmentsSaved] = useState(0);
  const session = useRef<Active | null>(null);
  const busy = useRef(false);
  const silenceSince = useRef<number | null>(null);
  const lastProgress = useRef({ ms: 0, at: 0 });
  const [doneMs, setDoneMs] = useState(0);

  const beginSegment = useCallback(async () => {
    await recorder.prepareToRecordAsync();
    recorder.record();
    lastProgress.current = { ms: 0, at: Date.now() };
    if (session.current) {
      session.current.currentUri = recorder.uri;
      await saveActive(session.current);
    }
  }, [recorder]);

  const finishSegment = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    const durationMs = recorder.getStatus().durationMillis;
    await recorder.stop();
    const uri = recorder.uri ?? s.currentUri;
    if (uri && durationMs > 500) {
      const kept = keepFile(uri, s.recordingId, s.segIdx, EXT);
      await enqueue({ kind: 'segment', recordingId: s.recordingId, idx: s.segIdx, localUri: kept, ext: EXT, durationMs });
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
    try {
      await finishSegment();
      await beginSegment();
      setWarning(null);
    } catch (e) {
      setWarning(`Couldn't restart the microphone: ${(e as Error).message}`);
    } finally {
      busy.current = false;
    }
  }, [beginSegment, finishSegment]);

  const start = useCallback(
    async (recordingId: string) => {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) throw new Error('Microphone permission is off. Turn it on in Settings to record.');
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        allowsBackgroundRecording: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
      });
      session.current = { recordingId, segIdx: 1, doneMs: 0, currentUri: null };
      setSegmentsSaved(0);
      setDoneMs(0);
      setWarning(null);
      silenceSince.current = null;
      await beginSegment();
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      setPhase('recording');
    },
    [beginSegment],
  );

  const pause = useCallback(() => {
    recorder.pause();
    setPhase('paused');
  }, [recorder]);

  const resume = useCallback(() => {
    recorder.record();
    lastProgress.current = { ms: recorder.getStatus().durationMillis, at: Date.now() };
    setWarning(null);
    setPhase('recording');
  }, [recorder]);

  /** Stop, save the last segment and hand the recording to the upload queue. */
  const stop = useCallback(async () => {
    const s = session.current;
    if (!s || busy.current) return;
    busy.current = true;
    setPhase('stopping');
    try {
      await finishSegment();
      await enqueue({ kind: 'finalize', recordingId: s.recordingId, durationMs: s.doneMs });
      await saveActive(null);
    } finally {
      session.current = null;
      busy.current = false;
      deactivateKeepAwake(KEEP_AWAKE_TAG);
      await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false });
      setPhase('idle');
    }
  }, [finishSegment]);

  // Health checks and segment rotation, polled twice a second while recording.
  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => {
      if (busy.current) return;
      const st = recorder.getStatus();
      const now = Date.now();

      if (st.mediaServicesDidReset || st.durationMillis >= SEGMENT_MS) {
        void rotate();
        return;
      }

      if (st.durationMillis > lastProgress.current.ms) {
        lastProgress.current = { ms: st.durationMillis, at: now };
      } else if (lastProgress.current.at && now - lastProgress.current.at > 4000) {
        setWarning('Recording stopped by the system (a call or another app may have the mic). Tap "Restart mic".');
        return;
      }

      if (typeof st.metering === 'number' && st.metering < SILENCE_DB) {
        silenceSince.current ??= now;
        if (now - silenceSince.current > SILENCE_WARN_MS) {
          setWarning("Not hearing anything for a while. Check the mic isn't covered.");
        }
      } else {
        silenceSince.current = null;
        setWarning((w) => (w?.startsWith('Not hearing') ? null : w));
      }
    }, 500);
    return () => clearInterval(timer);
  }, [phase, recorder, rotate]);

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

  const elapsedMs = phase === 'idle' ? 0 : doneMs + state.durationMillis;

  return {
    phase,
    warning,
    segmentsSaved,
    elapsedMs,
    level: state.metering ?? null,
    start,
    pause,
    resume,
    stop,
    restartMic: rotate,
  };
}

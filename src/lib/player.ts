// Playing a recording that is split into part files. One player, one global position:
// the position is the part's offset plus the position inside the part, so the scrubber,
// the timestamp chips and the transcript all talk about the same moment.
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audioUrl } from './api';
import type { Utterance } from './types';

export type PlaySegment = { idx: number; storage_path: string | null; source_url: string | null; duration_ms: number | null };

/** The speeds on the player bar. */
export const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

/** Where each part starts and ends on the recording's timeline. */
export function partSpans(segments: PlaySegment[], totalMs: number): { start: number; end: number }[] {
  let offset = 0;
  return segments.map((s) => {
    // A part with an unknown length (recovered or imported) runs to the end of the recording.
    const d = s.duration_ms && s.duration_ms > 0 ? s.duration_ms : Math.max(0, (totalMs || 0) - offset);
    offset += d;
    return { start: offset - d, end: offset };
  });
}

/** The part that holds a moment on the recording's timeline. */
export function partAt(spans: { start: number; end: number }[], ms: number): number {
  for (let i = 0; i < spans.length; i++) {
    if (ms < spans[i].end || i === spans.length - 1) return i;
  }
  return 0;
}

export function useRecordingPlayer(segments: PlaySegment[], totalMs: number, utterances: Utterance[]) {
  const player = useAudioPlayer(null, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);
  const [part, setPart] = useState<number | null>(null);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const segmentsRef = useRef(segments);
  const partRef = useRef<number | null>(null);
  const speedRef = useRef(speed);
  const statusRef = useRef(status);
  // The part we last rolled over from, so a stale "finished" flag cannot skip a part.
  const advancedRef = useRef<number | null>(null);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);
  useEffect(() => {
    partRef.current = part;
  }, [part]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const spans = useMemo(() => partSpans(segments, totalMs), [segments, totalMs]);
  const durationMs = totalMs > 0 ? totalMs : spans.length ? spans[spans.length - 1].end : 0;
  const partStart = part != null ? spans[part]?.start ?? 0 : 0;
  const positionMs = Math.max(0, Math.min(durationMs || Number.MAX_SAFE_INTEGER, partStart + Math.round((status.currentTime || 0) * 1000)));

  /** Wait for the audio to be ready, so a seek after a part change lands. */
  const waitForLoaded = useCallback(async (timeoutMs = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (statusRef.current.isLoaded) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }, []);

  /** Load a part into the player and start playing it. */
  const loadPart = useCallback(
    async (index: number, seekMs = 0, autoplay = true) => {
      const seg = segmentsRef.current[index];
      if (!seg) return;
      setError(null);
      try {
        // Link imports play straight from the link.
        const url = seg.storage_path ? await audioUrl(seg.storage_path) : seg.source_url;
        if (!url) throw new Error('The audio for this part is not available.');
        player.replace({ uri: url });
        partRef.current = index;
        setPart(index);
        if (speedRef.current !== 1) player.setPlaybackRate(speedRef.current);
        if (seekMs > 0) {
          await waitForLoaded();
          await player.seekTo(seekMs / 1000).catch(() => undefined);
        }
        if (autoplay) player.play();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [player, waitForLoaded],
  );

  /** Move to a moment on the recording, playing from there. */
  const seekToMs = useCallback(
    async (ms: number, autoplay = true) => {
      const target = Math.max(0, Math.min(durationMs || ms, ms));
      const index = partAt(spans, target);
      const start = spans[index]?.start ?? 0;
      const within = Math.max(0, target - start);
      if (partRef.current === index) {
        await player.seekTo(within / 1000).catch(() => undefined);
        if (autoplay) player.play();
      } else {
        // A new part: a fresh part can be rolled over from again.
        advancedRef.current = null;
        await loadPart(index, within, autoplay);
      }
    },
    [spans, durationMs, player, loadPart],
  );

  const toggle = useCallback(() => {
    if (statusRef.current.playing) {
      player.pause();
      return;
    }
    if (partRef.current == null) {
      advancedRef.current = null;
      void loadPart(0, 0, true);
      return;
    }
    player.play();
  }, [player, loadPart]);

  const skip = useCallback(
    (deltaMs: number) => {
      void seekToMs(positionMs + deltaMs, true);
    },
    [positionMs, seekToMs],
  );

  const changeSpeed = useCallback(() => {
    const next = SPEEDS[(SPEEDS.indexOf(speedRef.current) + 1) % SPEEDS.length];
    speedRef.current = next;
    setSpeed(next);
    player.setPlaybackRate(next);
  }, [player]);

  // When a part ends, move on to the next one so a recording plays straight through.
  useEffect(() => {
    if (!status.didJustFinish) return;
    const current = partRef.current;
    if (current == null || advancedRef.current === current) return;
    // Only roll over when the part really did reach its end.
    const partLength = segmentsRef.current[current]?.duration_ms;
    if (partLength && status.currentTime * 1000 < partLength - 2000) return;
    const next = current + 1;
    if (next >= segmentsRef.current.length) return;
    advancedRef.current = current;
    void loadPart(next, 0, true);
  }, [status.didJustFinish, status.currentTime, loadPart]);

  /** Who is speaking at the current moment. */
  const speaker = useMemo(() => {
    let found: number | null = null;
    for (const u of utterances) {
      if (u.start_ms <= positionMs) found = u.speaker;
      else break;
    }
    return found;
  }, [utterances, positionMs]);

  return {
    playing: status.playing,
    positionMs,
    durationMs,
    part,
    speed,
    speaker,
    error,
    seekToMs,
    toggle,
    skip,
    changeSpeed,
    loadPart,
  };
}

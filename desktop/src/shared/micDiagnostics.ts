// Shared microphone diagnostics snapshot: what a diagnostics panel needs to display and
// what a sanitized support export can include. Pure — the caller supplies already-
// sanitized device entries (no raw device ids) and the current track/permission state.

export type SanitizedDevice = { kind: string; label: string };

export type MicDiagnostics = {
  /** Sanitized audio-input devices (kind + label only; never a device id). */
  audioInputs: SanitizedDevice[];
  selectedInput: string | null;
  permission: 'granted' | 'denied' | 'unknown';
  trackState: 'live' | 'ended' | 'none';
  /** Live input level in dBFS, or null when not measuring. */
  level: number | null;
  error: { name: string; message: string } | null;
  hasCamera: boolean;
  /** True when every audio output is named like a Remote-Desktop playback device. */
  remoteOnly: boolean;
};

export function buildMicDiagnostics(opts: {
  devices: SanitizedDevice[];
  selectedInput?: string | null;
  permission?: MicDiagnostics['permission'];
  trackState?: MicDiagnostics['trackState'];
  level?: number | null;
  error?: MicDiagnostics['error'];
}): MicDiagnostics {
  const outputs = opts.devices.filter((d) => d.kind === 'audiooutput');
  return {
    audioInputs: opts.devices.filter((d) => d.kind === 'audioinput'),
    selectedInput: opts.selectedInput ?? null,
    permission: opts.permission ?? 'unknown',
    trackState: opts.trackState ?? 'none',
    level: opts.level ?? null,
    error: opts.error ?? null,
    hasCamera: opts.devices.some((d) => d.kind === 'videoinput'),
    remoteOnly: outputs.length > 0 && outputs.every((d) => /remote/i.test(d.label || '')),
  };
}

/** Strip a raw enumerateDevices() result down to a sanitized (kind, label) shape. */
export function sanitizeDevices(devices: { kind: string; label: string }[]): SanitizedDevice[] {
  return devices.map((d) => ({ kind: d.kind, label: d.label ?? '' }));
}

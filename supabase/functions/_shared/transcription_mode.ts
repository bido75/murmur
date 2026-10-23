// Which speech-to-text engine runs, and what is allowed to leave the device.
//
// The rules live here, away from the phone, the server and the desktop app, so all three
// make the same decision and the decision can be tested on its own.
//
// The one rule that must never bend: when the user has asked for local-only privacy,
// nothing is uploaded. Not in Auto mode, not because the model is missing, not because
// the network looked fine.

export type TranscriptionMode = 'cloud' | 'local' | 'auto';

export type ProviderChoice = 'cloud' | 'local';

/** What we know when we have to choose. */
export type ModeContext = {
  /** What the user picked. */
  mode: TranscriptionMode;
  /** The local model is installed, checked and ready to run. */
  localReady: boolean;
  /** The cloud provider is configured and reachable. */
  cloudReady: boolean;
  /** The user asked for local-only privacy: nothing may be uploaded. */
  localOnly: boolean;
  /** The user prefers local when both work (battery, data, cost). */
  preferLocal: boolean;
};

/**
 * Choose the engine.
 *
 * Local-only privacy comes first and wins over everything, including an explicit
 * "Cloud" setting. If the two contradict each other the safe reading is kept: the
 * audio stays on the device and the app says the model is missing.
 */
export function chooseProvider(ctx: ModeContext): ProviderChoice {
  if (ctx.localOnly) return 'local';
  if (ctx.mode === 'local') return 'local';
  if (ctx.mode === 'cloud') return 'cloud';
  // Auto: local when it is ready and the cloud is not, or when the user prefers local.
  if (ctx.localReady && (!ctx.cloudReady || ctx.preferLocal)) return 'local';
  return 'cloud';
}

/** Whether the chosen engine can actually run right now. */
export function providerUsable(
  choice: ProviderChoice,
  ctx: ModeContext,
): boolean {
  return choice === 'local' ? ctx.localReady : ctx.cloudReady;
}

/** What leaves the device, in the words we show the user. */
export type DataLeaving = 'nothing' | 'text' | 'audio';

export type ChoiceDescription = {
  /** Which engine runs. */
  choice: ProviderChoice;
  /** What leaves the device. */
  leaves: DataLeaving;
  /** One line for the user. */
  summary: string;
  /** The longer explanation. */
  detail: string;
};

/**
 * Describe the choice for the user, and say plainly what leaves the device.
 *
 * A local transcription sends only the words, so the notes can be written; the audio
 * itself stays put. A cloud transcription sends the audio to the speech service.
 */
export function describeChoice(
  choice: ProviderChoice,
  ctx: ModeContext,
): ChoiceDescription {
  if (choice === 'local') {
    if (!ctx.localReady)
      return {
        choice,
        leaves: 'nothing',
        summary: 'On this device — the speech model is not installed yet',
        detail:
          'Download the speech model to transcribe on this device. Until then no recording can be transcribed locally.',
      };
    return {
      choice,
      leaves: 'text',
      summary: 'On this device — only the words are sent, never the audio',
      detail:
        'The audio is transcribed here and never leaves the device. Only the words are sent, so the notes can be written.',
    };
  }
  if (!ctx.cloudReady)
    return {
      choice,
      leaves: 'nothing',
      summary: 'Not available right now — no network',
      detail:
        'There is no connection and no speech model on this device, so this recording cannot be transcribed yet.',
    };
  return {
    choice,
    leaves: 'audio',
    summary: 'In the cloud — the audio is sent to the speech service',
    detail:
      'The audio is sent to our speech service to be transcribed, and the words come back to your device.',
  };
}

/** The three modes, in the order they are shown, with their names and explanations. */
export const TRANSCRIPTION_MODES: {
  mode: TranscriptionMode;
  label: string;
  detail: string;
}[] = [
  {
    mode: 'cloud',
    label: 'Cloud',
    detail: 'The audio is sent to our speech service. Fastest and most accurate.',
  },
  {
    mode: 'local',
    label: 'On this device',
    detail: 'The audio is transcribed here and never leaves the device.',
  },
  {
    mode: 'auto',
    label: 'Automatic',
    detail:
      'Uses the device when it can, and the cloud when it cannot. Local-only privacy is always respected.',
  },
];

/**
 * Whether a recording may be sent to the cloud at all.
 *
 * The rule is checked here as well as in the choice, so that a caller who picks the
 * cloud provider directly cannot slip past the user's privacy choice.
 */
export function cloudAllowed(ctx: ModeContext): boolean {
  if (ctx.localOnly) return false;
  return ctx.mode !== 'local';
}

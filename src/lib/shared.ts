// Pure logic shared with the server (one source of truth, tested in supabase/functions/_shared).
export {
  consentAdvice,
  STATES,
  stateByCode,
  type Advice,
  type Kind,
  type StateLaw,
} from "../../supabase/functions/_shared/consent";
export {
  normalizeMediaLink,
  titleFromLink,
} from "../../supabase/functions/_shared/links";
export { LANGUAGES, TRANSLATION_LANGUAGES, LANGUAGE_REGISTRY, findLanguage } from "../../supabase/functions/_shared/translate";
export {
  exifTakenAt,
  pcmLevelDb,
  photoMoment,
  wavHeader,
  whisperToUtterances,
} from "../../supabase/functions/_shared/ingest";
export {
  scheduledInTime,
  SCHEDULED_LEAD_MS,
} from "../../supabase/functions/_shared/bot_timing";
export {
  micMessage,
  micProblem,
  insecurePageMessage,
  noBrowserSupportMessage,
  type MicProblem,
} from "../../supabase/functions/_shared/mic_permission";
export {
  Sha256,
  sha256Hex,
  sha256HexOfText,
} from "../../supabase/functions/_shared/sha256";
export {
  DEFAULT_MODEL,
  SPEECH_MODELS,
  modelById,
  modelFileName,
  modelState,
  modelStateMessage,
  modelUsable,
  progressPercent,
  verifyModel,
  verifyModelDigest,
  type ModelSpec,
  type ModelState,
  type ModelStatus,
} from "../../supabase/functions/_shared/transcription_model";
export {
  TRANSCRIPTION_MODES,
  canRecordNow,
  chooseProvider,
  cloudAllowed,
  describeChoice,
  providerUsable,
  type ChoiceDescription,
  type DataLeaving,
  type ModeContext,
  type ProviderChoice,
  type TranscriptionMode,
} from "../../supabase/functions/_shared/transcription_mode";
export type {
  AudioSource,
  ProviderType,
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from "../../supabase/functions/_shared/transcription_provider";

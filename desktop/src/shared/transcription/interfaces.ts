// The desktop app speaks the same transcription interface as the phone and the server.
//
// The interface itself lives in the shared folder so there is one definition, not one
// per app. This file only says where the desktop's own bridge comes from.

export type {
  ProviderType,
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from "../../../../supabase/functions/_shared/transcription_provider";

export type { Utterance } from "../../../../supabase/functions/_shared/verify";

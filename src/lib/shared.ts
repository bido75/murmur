// Pure logic shared with the server (one source of truth, tested in supabase/functions/_shared).
export { consentAdvice, STATES, stateByCode, type Advice, type Kind, type StateLaw } from '../../supabase/functions/_shared/consent';
export { normalizeMediaLink, titleFromLink } from '../../supabase/functions/_shared/links';
export { LANGUAGES } from '../../supabase/functions/_shared/translate';
export { exifTakenAt, pcmLevelDb, photoMoment, wavHeader, whisperToUtterances } from '../../supabase/functions/_shared/ingest';

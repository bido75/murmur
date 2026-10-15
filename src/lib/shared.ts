// Pure logic shared with the server (one source of truth, tested in supabase/functions/_shared).
export { consentAdvice, STATES, stateByCode, type Advice, type Kind, type StateLaw } from '../../supabase/functions/_shared/consent';
export { normalizeMediaLink, titleFromLink } from '../../supabase/functions/_shared/links';

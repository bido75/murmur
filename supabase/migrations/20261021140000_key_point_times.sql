-- Key points carry the transcript quote they were written from, so the app can show
-- where a point starts. key_points stays a plain list of strings for sharing, search
-- and export; key_point_details holds [{ text, quote, quote_ms, verified }].
-- quote_ms is only set when the quote was found in the transcript.
alter table public.summaries
  add column if not exists key_point_details jsonb not null default '[]'::jsonb;

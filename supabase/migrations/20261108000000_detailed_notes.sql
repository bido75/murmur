-- Comprehensive detailed notes (topic-by-topic sections) for the summaries table.
-- Additive only: existing summaries, exports and readers keep working.
-- A null detailed_sections or conclusions simply means "no detailed notes yet".

ALTER TABLE public.summaries
  ADD COLUMN IF NOT EXISTS detailed_sections jsonb;      -- [{heading, paragraphs, quote, quote_ms, verified}]

ALTER TABLE public.summaries
  ADD COLUMN IF NOT EXISTS conclusions jsonb;            -- string[] of concluding points

ALTER TABLE public.summaries
  ADD COLUMN IF NOT EXISTS detail_level text NOT NULL DEFAULT 'brief';  -- 'brief' | 'standard' | 'detailed'

ALTER TABLE public.summaries
  ADD COLUMN IF NOT EXISTS notes_schema_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.summaries
  ADD COLUMN IF NOT EXISTS coverage_metadata jsonb;      -- {segment_count, processed_count, coverage_complete, uncovered_ranges}

ALTER TABLE public.summaries
  ADD COLUMN IF NOT EXISTS detailed_generated_at timestamptz;

-- Rollback:
--   ALTER TABLE public.summaries
--     DROP COLUMN IF EXISTS detailed_sections,
--     DROP COLUMN IF EXISTS conclusions,
--     DROP COLUMN IF EXISTS detail_level,
--     DROP COLUMN IF EXISTS notes_schema_version,
--     DROP COLUMN IF EXISTS coverage_metadata,
--     DROP COLUMN IF EXISTS detailed_generated_at;
-- Detail-level preference: how much substance the notes engine should keep.
-- 'detailed' (default) is the comprehensive topic-by-topic treatment; 'standard' is
-- concise sections; 'brief' is key points only. Applies to new recordings unless a
-- per-recording regenerate passes its own level.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS notes_detail_level text NOT NULL DEFAULT 'detailed';  -- 'brief' | 'standard' | 'detailed'

-- Rollback:
--   ALTER TABLE public.user_settings DROP COLUMN IF EXISTS notes_detail_level;
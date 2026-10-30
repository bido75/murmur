-- Onboarding analytics: completion rate and where people stop.
-- Events are private per user; this query is for the operator running SQL
-- against the database directly (no dashboard needed).

-- Tour outcomes per version: how many started, completed, skipped.
select
  e.step,
  count(*) filter (where e.event = 'tour_started') as started,
  count(*) filter (where e.event = 'tour_completed') as completed,
  count(*) filter (where e.event = 'tour_skipped') as skipped
from onboarding_events e
where e.event in ('tour_started', 'tour_completed', 'tour_skipped')
group by e.step
order by e.step nulls first;

-- Completion rate overall (completed / started), latest tour version only.
with started as (
  select user_id, min(at) as at from onboarding_events where event = 'tour_started' group by user_id
),
ended as (
  select user_id,
    max(at) filter (where event = 'tour_completed') as completed_at,
    max(at) filter (where event = 'tour_skipped') as skipped_at
  from onboarding_events
  where event in ('tour_completed', 'tour_skipped')
  group by user_id
)
select
  count(*) as users_started,
  count(*) filter (where ended.completed_at is not null) as completed,
  count(*) filter (where ended.completed_at is null and ended.skipped_at is not null) as skipped,
  round(100.0 * count(*) filter (where ended.completed_at is not null) / greatest(count(*), 1), 1) as completion_pct
from started left join ended using (user_id);

-- The step where the most people skip (the weakest stop).
select
  coalesce(step, 0) as step,
  count(*) as skipped_here
from onboarding_events
where event = 'tour_skipped'
group by step
order by skipped_here desc
limit 5;

-- Tip reach: how many users saw each tip (dismissed one).
select event, count(distinct user_id) as users
from onboarding_events
where event = 'tip_dismissed'
group by event;

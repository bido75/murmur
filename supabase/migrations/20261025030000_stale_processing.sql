-- A crashed or lost processing job must not leave a recording in a transient
-- state forever: the client would wait forever (and the operator would never
-- see the failure). The daily sweep (retention function) calls this to fail any
-- recording that has been in a transient state for over two hours. Legitimate
-- long recordings keep touching updated_at as their pipeline advances, so a
-- two-hour threshold is safe even for a 60-minute recording on slow providers.

create or replace function public.fail_stale_processing(max_rows integer default 200)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  moved integer;
begin
  with stale as (
    select id
      from public.recordings
     where status in ('uploading', 'transcribing', 'summarizing')
       and updated_at < now() - interval '2 hours'
     order by updated_at
     limit greatest(max_rows, 1)
     for update skip locked
  )
  update public.recordings r
     set status = 'failed',
         error = 'Processing did not finish (it timed out or the server restarted). Try uploading the audio again.'
    from stale
   where r.id = stale.id;
  get diagnostics moved = row_count;
  return moved;
end $$;

revoke execute on function public.fail_stale_processing(integer) from anon, authenticated;
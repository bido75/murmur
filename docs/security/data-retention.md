# Data retention, deletion and export

## What is stored

| Data | Where | Default retention |
|---|---|---|
| Audio parts | Storage `audio/` (private) | Until deleted, or the user's / team's audio retention |
| Transcripts, notes, tasks, comments | Postgres | Until deleted, or recording retention |
| Photos taken during recordings | Storage `photos/` | With the recording |
| Exports (decks, data exports) | Storage `exports/` | Signed links expire (24 h); files can be cleaned by a bucket lifecycle rule |
| Phone-call audio | Copied from Twilio, then **deleted from Twilio** | As audio above |
| Meeting-bot audio | Copied from Recall.ai | As audio above (delete from Recall per their retention settings) |
| Audit events | Postgres | Kept with the team; removed when the team is deleted |

## Retention controls

- **Personal:** Privacy & data → keep audio for N days; keep recordings for N days.
- **Team:** Admin console → Policies, for recordings in team projects. The shortest applicable
  period wins. A daily job (`retention`, scheduled with pg_cron) deletes what is due: audio-only
  deletion keeps transcripts and notes; recording deletion removes everything.

## Deletion

- Deleting a recording removes its audio, photos, transcript, notes, tasks, comments and links.
- **Account deletion** (Privacy & data): deletes the user's recordings and files and the auth user.
  Team projects pass to another team member; teams where the user is the only member are deleted.
- Backups: Supabase point-in-time backups roll off on the plan's schedule (7 days on Pro); deleted
  data persists in backups until then. State this in customer agreements.

## Export

Privacy & data → **Export my data**: a ZIP with, per recording, `notes.md`, `transcript.txt` and
`data.json`, plus `tasks.csv` and 7-day download links for audio. Recordings that teammates made
in team projects are not included in a person's export.

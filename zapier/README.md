# Murmur for Zapier

A Zapier integration (Zapier Platform CLI) so Murmur shows up as an app in Zapier's directory:

- **New Notes** (instant): fires when a recording's notes are ready — title, summary, decisions,
  next steps, link. Subscribes through `POST /api/v1/webhooks` and unsubscribes on Zap off.
- **New Task**: new confirmed open tasks (optionally from one project).
- **Find Recording**: search transcripts, titles and notes.
- **Complete Task**: mark a task done or reopen it.

Users connect with a personal API token (Murmur → Settings → Claude, ChatGPT and other AI tools).

## Publish

```bash
cd zapier
npm install
npm test                         # schema validation + mapping tests
npm install -g zapier-platform-cli
zapier login
zapier register "Murmur"         # once
MURMUR_API_BASE=https://YOUR-PROJECT.supabase.co/functions/v1/api/v1 zapier push
```

Set `MURMUR_API_BASE` as an environment variable on the Zapier app too
(`zapier env:set 1.0.0 MURMUR_API_BASE=…`). To list it publicly, submit it in Zapier's developer
platform (they review it); until then share an invite link with your users.

Until it's published, the same flows work today with Zapier's "Webhooks by Zapier" trigger
pointed at a webhook made in Murmur → Settings → Webhooks & REST API.

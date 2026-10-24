# Subprocessors

Verify each vendor's current terms, regions and certifications before publishing this list.

| Service | Purpose | Data it receives | Used when |
|---|---|---|---|
| Supabase (on AWS) | Database, auth, file storage, server functions | All customer data | Always |
| Deepgram | Speech-to-text, redaction, live captions | Audio (via short-lived signed URLs), vocabulary hints | Always (unless on-device transcription) |
| Anthropic | Notes, tasks, answers, translation, decks, follow-ups | Transcripts, notes, typed notes | When Claude writes the notes |
| OpenRouter | Notes, tasks, answers, translation, decks, follow-ups | Transcripts, notes, typed notes | When OpenRouter writes the notes instead of Claude |
| Ollama (on the customer's own device) | Notes, tasks, answers, translation, decks, follow-ups | Transcripts, notes, typed notes | When a local model writes the notes. Nothing leaves the device. |
| Expo (push service) | Push notifications | Device push token, notification title/body | If push is enabled |
| Resend | Email (recaps, alerts, digests) | Recipient addresses, email content | If email is configured |
| Recall.ai | Meeting notetaker bot | Meeting audio/video, meeting link | Only when a user sends a notetaker |
| Twilio | Phone-call recording | Call audio, phone numbers | Only for calls through the Murmur number |
| Aircall | Call import | — (Murmur pulls recordings the customer's Aircall account provides) | Only if connected |
| Google, Microsoft | Calendar, Google Docs, OneNote | Calendar events (read), exported notes | Only if the user connects them |
| Slack, Notion, HubSpot, Salesforce, Asana, Linear, Jira, monday.com, ClickUp, Trello, Procore | Destinations | Notes and tasks the user or an automation sends | Only if connected |
| Hugging Face (download only) | On-device speech model file | None (anonymous file download) | Only if on-device transcription is turned on |

Customer-connected destinations act on the customer's behalf under the customer's own agreements
with those vendors.

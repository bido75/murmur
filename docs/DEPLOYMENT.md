# Deployment

What has to be deployed, in what order, and how to get back if it goes wrong.

## What this branch changes

**The app and the desktop app only.** No database change, no Edge Function change, no
migration. `supabase/migrations/` is untouched.

That means:

- **Nothing to push to the database.**
- **Nothing to redeploy on the server.** The Edge Functions are exactly as they were.
- The new behaviour is a setting the user turns on, so it is off until they choose it.

## The app (phone, tablet, web)

```bash
git checkout feature/transcription-local
npx tsc --noEmit && npx expo lint && npm test
npx eas build --profile development --platform ios
```

The **whisper** model on the phone is a native module, so the first release of this has
to be a development or production build, not an update over an Expo Go build.

For the web:

```bash
npx expo export --platform web
```

## The desktop app

```bash
git checkout feature/transcription-local
cd desktop
npm install
npm test && npx tsc --noEmit -p . && node build.mjs
npm run dist:mac     # or dist:win
```

`onnxruntime-node` is a native module and must be packaged. It is in
`dependencies`, not `devDependencies`, so `electron-builder` includes it. It is listed
as `external` in `build.mjs`, so it is loaded at run time from `node_modules` rather
than being bundled.

## Turning the feature on

Nothing is on by default.

| What | Where | Default |
|---|---|---|
| Transcribe on this phone | Settings → Privacy & data | Off |
| Transcribe on this computer | Settings → Privacy & data (desktop) | Off |
| Never upload audio | Settings → Privacy & data | Off |

"Never upload audio" is a promise the code keeps: it wins over the mode, and a
recording is refused rather than uploaded when the device was chosen and cannot run.

## Rolling back

The change is contained and reversible in one step:

```bash
git checkout main
git branch -D feature/transcription-local
```

Three things to know:

1. **The new settings live in the app's own storage**, not the database. An older
   build reading them ignores the extra keys, so nothing breaks.
2. **The speech model stays on the disk.** An older build does not look for the
   versioned name, so it will say "download the speech model" once. Nothing else
   breaks.
3. **The server is untouched**, so there is nothing to roll back there.

### If the desktop app misbehaves

The model is a folder and can be deleted:

| Windows | `%APPDATA%\Murmur\speech-models\` |
|---|---|
| macOS | `~/Library/Application Support/Murmur/speech-models/` |
| Linux | `~/.config/Murmur/speech-models/` |

The recordings that have not been uploaded are in the `pending` folder beside it.
**Do not delete that folder** — it holds the recordings.

## If the server needs rolling back

It does not, because nothing on the server changed. But if a change is made later,
the order is:

```bash
cd supabase/functions
supabase functions deploy process-recording
supabase functions deploy ingest
```

The `ingest` function is deployed with `--no-verify-jwt`; it checks the caller itself.

## Checking it worked

1. Open Settings → Privacy & data on the desktop.
2. Download the speech model. It should take about 35 seconds and say it is installed
   and checked.
3. Turn on "Make new recordings on this computer".
4. Record ten seconds and stop.
5. The recording should show on the app with its notes a little later.

If the notes do not come, the recording is still in the app and still safe: the words
are sent to the server, and the server writes the notes from them. Nothing is lost if
the transcription fails.

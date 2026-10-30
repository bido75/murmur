# Deployment

What has to be deployed, in what order, and how to get back if it goes wrong.

## Opening the app on another computer on the network

Three things have to be right. The first is now handled by the app itself; the other
two are the machine's settings.

### 1. The app finds the server — done

The address of the server is set when the app is built, so it says `127.0.0.1` for a
server on the same computer. On another computer that means *that* computer, where
there is no server, and the sign-in failed with "fetch failed".

The app now works it out: when the address points at this computer, the name of the
computer the app was served from is used instead. A server that is genuinely somewhere
else is left exactly as it was configured, and so is the app on a phone, which has no
such name. `src/lib/serverAddress.ts` has the rule and the tests for it.

### 2. The server's ports have to be open — this needs an administrator

The Supabase stack runs in Docker, and Docker's ports have **no rule in the Windows
Firewall**, so another computer cannot reach it. The dev server is fine, because Node
has a rule.

**The easy way:** run `scripts\open-lan-ports.cmd`. It asks for administrator rights
by itself and opens the four ports it needs. It is safe to run more than once.

**Or, in an elevated PowerShell** (right-click → "Run as administrator"):

```powershell
New-NetFirewallRule -DisplayName "Murmur local Supabase" -Direction Inbound `
  -Action Allow -Protocol TCP -LocalPort 54321,54322,54323,54324 -Profile Any
```

| Port | What it is |
|---|---|
| 54321 | The Supabase API — the app needs this |
| 54322 | The database |
| 54323 | The Supabase Studio |
| 54324 | The mail catcher, where the sign-in codes go |

To close the ports again:

```powershell
Remove-NetFirewallRule -DisplayName "Murmur local Supabase"
```

**How to tell it worked.** Before the rule, the browser on the other computer said
`net::ERR_CONNECTION_TIMED_OUT` — the packets were being dropped. After it, the same
request goes through. `ERR_CONNECTION_REFUSED` means something different: nothing is
listening on that port at all.

### 3. The server has to be reachable on the network address too

Docker Desktop publishes the local Supabase stack on `127.0.0.1` **only** on some
machines, even though `docker port` says `0.0.0.0`. The result is that another
computer times out when it reaches for the server, even with the firewall open.

`scripts\lan-server-proxy.cjs` is the answer: it listens on the computer's network
address and forwards to the server on the loopback address. It can only forward there,
so it cannot be used to reach anything else.

```powershell
# The computer's address, a free port for the proxy, and the server's own port.
node scripts\lan-server-proxy.cjs 10.0.0.180 54325 54321
```

Then point the app at the proxy's port, in `.env.local`:

```
EXPO_PUBLIC_SUPABASE_URL = http://10.0.0.180:54325
```

And restart the dev server — the address is baked into the bundle when it is built, so
a stale bundle keeps using the old one. `npx expo start --host lan --port 8090 --clear`
forces a fresh one.

**`scripts\start-lan-dev.cmd` does both**, and takes the address as its first
argument.

### 4. The app has to be served on the network

```bash
npm run lan
```

The manifest then points at the computer's address rather than at `localhost`, which is
what the phone or the other computer needs.

### A note on the address

The computer's address on the network is not always the same. It is shown by:

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" } |
  Select-Object IPAddress, InterfaceAlias
```

If it changes — a different network, a new router — the address in `.env.local` has to
change with it, and the firewall rule stays as it is.

### A note on plain HTTP

**Served over `http://10.0.0.180:8090`, the page is not a secure context.** A browser
only gives a page a microphone, and only a few other things, on a secure page: `https`,
or `localhost`. On a plain address on the network the browser withholds them, and there
is nothing the app can do about it.

### A note on plain HTTP

**Served over `http://10.0.0.180:8090`, the page is not a secure context.** A browser
only gives a page a microphone, and only a few other things, on a secure page: `https`,
or `localhost`. On a plain address on the network the browser withholds them, and there
is nothing the app can do about it.

What is affected, and what it looks like:

| Missing | What the user sees |
|---|---|
| `navigator.mediaDevices` | "This browser cannot record audio" — but the browser is fine; the page is not secure |
| `crypto.subtle` | The single sign-on falls back from PKCE to plain |
| `crypto.randomUUID` | Browser extensions that use it report an error |

**So a phone recording over the local network needs a secure origin.** Two ways to get
one:

1. **Open it in the Expo Go app.** Expo Go's own window is a secure context, so the
   microphone works. This is the quickest way to try it.
2. **Serve the app over https.** `npx expo start --tunnel` gives a public `https://`
   address with a real certificate (it needs `npm i -g @expo/ngrok` first).
   `npx expo start --https` uses a certificate the phone will ask you to accept; a
   certificate the browser does not trust may not count as secure, so the tunnel is the
   dependable one.

The app now says which of these it is, rather than blaming the browser:
"This page is not secure, so the browser will not give it a microphone."

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

## The speech provider

The server reads the audio with Deepgram by default, or Mistral's Voxtral when
`STT_PROVIDER=mistral`:

| Variable | Meaning |
|---|---|
| `STT_PROVIDER` | `deepgram` or `mistral`. Deepgram by default. |
| `DEEPGRAM_API_KEY` | The Deepgram key. |
| `MISTRAL_API_KEY` | The Mistral key, when Mistral is used. |
| `MISTRAL_STT_MODEL` | `voxtral-mini-transcribe-3` by default. |

A redaction always goes to Deepgram, because it is the engine that redacts.
See `SPEECH_PROVIDERS.md`.

## The notes provider

The server decides who writes the notes, from its own settings, and the app asks
the server rather than guessing. Set the provider before the first recording:

| Variable | Meaning |
|---|---|
| `LLM_PROVIDER` | `anthropic`, `openrouter` or `ollama`. Leave it unset to choose by what is configured. |
| `ANTHROPIC_API_KEY` | The Claude key. A key that belongs to a workspace also needs `ANTHROPIC_WORKSPACE_ID`. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | The OpenRouter key and the model to use. |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Where the local model is, and which one. |

These are set as secrets on the project:

```bash
supabase secrets set LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=...
```

The provider can be checked afterwards:

```
GET /functions/v1/notes-provider
```

It answers `{"provider":"anthropic","local":false,"label":"Claude (Anthropic)"}`.
`local` is true only for a model running on the user's own device.

**A local model needs the server to be able to reach it.** On a normal deployment
that means a host the functions can open, and `OLLAMA_BASE_URL` pointing at it.

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

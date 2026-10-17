# Murmur browser extension (Chrome, Edge, Brave, Arc)

Records the audio of the current tab (a Meet/Zoom/Teams web call, a webinar, a video) mixed with
your microphone, uploads it in 5-minute parts as it goes, and Murmur makes notes and tasks as usual.
No bot joins the call.

- **Upload-only access.** The extension is linked with a one-time code from the app
  (Settings → Devices). It gets a device token that can create and upload recordings, nothing else:
  it can't read your notes. Unlink it from the app any time.
- **Consent.** The popup asks how people were told before it records, same as the app.

## Build and try it

```bash
cd extension
node build.mjs            # reads EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY from ../.env
```

Then chrome://extensions → Developer mode → **Load unpacked** → choose `extension/dist`.
Click **Allow microphone** once (Chrome only asks on a normal page), then **Record this tab**.

For the Chrome Web Store, zip the contents of `dist/` and upload it. The listing needs a privacy
policy URL and a justification for `tabCapture` and `offscreen` ("records the tab the user chooses
for meeting notes").

## Status

Tested: the popup, linking with a code, and the build (headless Chromium, mocked server).
Not yet tested: the capture itself (Chrome only allows tab capture after a real click on the
toolbar button), uploads to a live project, and long recordings.

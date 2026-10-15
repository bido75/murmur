// Electron main process: window + tray, a local file store for audio segments and the
// upload queue (so recordings survive crashes and restarts), system audio capture, and
// meeting detection.
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  app, BrowserWindow, desktopCapturer, ipcMain, Menu, nativeImage, Notification, session, shell, systemPreferences, Tray,
} from 'electron';
import { detectMeeting, parsePs, parseTasklist, shouldPrompt, type MeetingApp } from '../shared/meetings';

const APP_NAME = 'Murmur';
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let recording = false;
let lastMeeting: MeetingApp | null = null;
let macCapture: ChildProcessWithoutNullStreams | null = null;

// ---------- Local store (everything under userData/pending) ----------

const dataDir = () => join(app.getPath('userData'), 'pending');
const queueFile = () => join(app.getPath('userData'), 'queue.json');
const activeFile = () => join(app.getPath('userData'), 'active.json');

/** Only ever touch files inside our own pending folder. */
function safePath(p: string): string {
  const full = resolve(p);
  if (!full.startsWith(resolve(dataDir()) + sep)) throw new Error('Path outside the app data folder');
  return full;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Write atomically so a crash mid-write can't corrupt the queue. */
function writeJson(file: string, value: unknown) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, file);
}

function registerIpc() {
  ipcMain.handle('segment:open', (_e, recordingId: string, idx: number, ext: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(recordingId) || !Number.isInteger(idx) || !/^[a-z0-9]{2,5}$/.test(ext)) throw new Error('Bad segment');
    mkdirSync(dataDir(), { recursive: true });
    const path = join(dataDir(), `${recordingId}-${String(idx).padStart(4, '0')}.${ext}`);
    writeFileSync(path, Buffer.alloc(0));
    return path;
  });
  ipcMain.handle('segment:append', (_e, path: string, bytes: Uint8Array) => {
    appendFileSync(safePath(path), Buffer.from(bytes));
  });
  ipcMain.handle('file:read', (_e, path: string) => new Uint8Array(readFileSync(safePath(path))));
  ipcMain.handle('file:size', (_e, path: string) => {
    const p = safePath(path);
    return existsSync(p) ? statSync(p).size : -1;
  });
  ipcMain.handle('file:delete', (_e, path: string) => {
    const p = safePath(path);
    if (existsSync(p)) rmSync(p);
  });
  ipcMain.handle('queue:get', () => readJson(queueFile(), []));
  ipcMain.handle('queue:set', (_e, ops: unknown[]) => writeJson(queueFile(), ops));
  ipcMain.handle('active:get', () => readJson(activeFile(), null));
  ipcMain.handle('active:set', (_e, value: unknown) => {
    if (value === null) {
      if (existsSync(activeFile())) rmSync(activeFile());
    } else writeJson(activeFile(), value);
  });
  ipcMain.handle('recording:state', (_e, isRecording: boolean) => {
    recording = isRecording;
    updateTray();
  });
  ipcMain.handle('app:info', () => ({ platform: process.platform, version: app.getVersion() }));
  ipcMain.handle('app:open-external', (_e, url: string) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
  });
  ipcMain.handle('mic:permission', async () => {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.askForMediaAccess('microphone');
  });

  // macOS system audio comes from a small ScreenCaptureKit helper that streams raw PCM.
  ipcMain.handle('macaudio:start', () => startMacCapture());
  ipcMain.handle('macaudio:stop', () => stopMacCapture());
}

// ---------- System audio ----------

/** Windows: Chromium can capture system audio ("loopback") alongside a screen source. */
function registerDisplayMedia() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      // We only keep the audio; the renderer stops the video track immediately.
      callback({ video: sources[0], audio: 'loopback' });
    } catch {
      callback({});
    }
  });
}

function helperPath(): string {
  // Packaged: Contents/Resources/SystemAudioCapture. Dev: desktop/native/macos/build/SystemAudioCapture.
  const packaged = join(process.resourcesPath, 'SystemAudioCapture');
  return existsSync(packaged) ? packaged : join(app.getAppPath(), 'native', 'macos', 'build', 'SystemAudioCapture');
}

function startMacCapture(): { ok: boolean; error?: string; sampleRate?: number } {
  if (process.platform !== 'darwin') return { ok: false, error: 'Only on macOS' };
  stopMacCapture();
  const bin = helperPath();
  if (!existsSync(bin)) return { ok: false, error: 'System audio helper is missing. Run `npm run mac-helper`.' };
  macCapture = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  // stdout: raw little-endian float32 mono at 48 kHz, streamed to the renderer.
  macCapture.stdout.on('data', (chunk: Buffer) => win?.webContents.send('macaudio:data', new Uint8Array(chunk)));
  // stderr: one JSON status line per event (started, error).
  macCapture.stderr.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      try {
        win?.webContents.send('macaudio:status', JSON.parse(line));
      } catch {
        /* ignore non-JSON logs */
      }
    }
  });
  macCapture.on('exit', (code) => {
    win?.webContents.send('macaudio:status', { event: 'exit', code });
    macCapture = null;
  });
  return { ok: true, sampleRate: 48000 };
}

function stopMacCapture() {
  if (macCapture) {
    macCapture.stdin.end(); // the helper exits when stdin closes
    macCapture.kill('SIGTERM');
    macCapture = null;
  }
}

// ---------- Meeting detection ----------

function listProcesses(): Promise<string> {
  return new Promise((res) => {
    const [cmd, args] = process.platform === 'win32' ? ['tasklist', ['/v', '/fo', 'csv', '/nh']] : ['ps', ['-axo', 'comm=']];
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => res(err ? '' : stdout));
  });
}

async function checkForMeeting() {
  const out = await listProcesses();
  const now = detectMeeting(process.platform === 'win32' ? parseTasklist(out) : parsePs(out));
  if (shouldPrompt(lastMeeting, now, recording) && Notification.isSupported()) {
    const label = now === 'zoom' ? 'Zoom' : now === 'teams' ? 'Teams' : 'Webex';
    const n = new Notification({ title: `${label} meeting detected`, body: `Record it with ${APP_NAME}? No bot joins the call.` });
    n.on('click', () => {
      showWindow();
      win?.webContents.send('meeting:detected', now);
    });
    n.show();
  }
  if (now !== lastMeeting) win?.webContents.send('meeting:state', now);
  lastMeeting = now;
}

// ---------- Window and tray ----------

function showWindow() {
  if (!win) createWindow();
  win!.show();
  win!.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 440,
    height: 720,
    minWidth: 380,
    minHeight: 560,
    title: APP_NAME,
    backgroundColor: '#F7F5F0',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadFile(join(__dirname, 'renderer', 'index.html'), process.env.MURMUR_SELFTEST ? { hash: 'selftest' } : undefined);
  if (process.env.MURMUR_SELFTEST) {
    win.webContents.on('console-message', (_e, _level, message) => {
      if (message.startsWith('SELFTEST')) {
        console.log(message);
        app.exit(0);
      }
    });
  }
  // Test hook (CI smoke test): screenshot the first screen, report page errors, then quit.
  const shot = process.env.MURMUR_SMOKE_SHOT;
  if (shot) {
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.log('[renderer]', message);
    });
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win!.webContents.capturePage();
        writeFileSync(shot, img.toPNG());
        const bridgeOk = await win!.webContents.executeJavaScript('typeof window.murmur === "object" && typeof require === "undefined"');
        console.log('SMOKE bridge-isolated', bridgeOk);
        app.exit(0);
      }, 2500);
    });
  }
  // Links open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Closing the window keeps recording in the tray; quitting is explicit.
  win.on('close', (e) => {
    if (!(app as unknown as { quitting?: boolean }).quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
}

function trayIcon() {
  // A small filled circle; red while recording.
  const color = recording ? '#D9472F' : '#1F6F5C';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="9" fill="${color}"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 16, height: 16 });
}

function updateTray() {
  if (!tray) return;
  tray.setImage(trayIcon());
  tray.setToolTip(recording ? `${APP_NAME} — recording` : APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${APP_NAME}`, click: showWindow },
      {
        label: recording ? 'Stop recording' : 'Start recording',
        click: () => {
          showWindow();
          win?.webContents.send(recording ? 'tray:stop' : 'tray:start');
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          (app as unknown as { quitting?: boolean }).quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// ---------- Lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    // Microphone (and screen capture for system audio) only for our own pages.
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(wc.getURL().startsWith('file://') && (permission === 'media' || permission === 'display-capture'));
    });
    registerIpc();
    registerDisplayMedia();
    createWindow();
    tray = new Tray(trayIcon());
    tray.on('click', showWindow);
    updateTray();
    setInterval(() => void checkForMeeting(), 15_000);
    void checkForMeeting();
  });
  app.on('activate', showWindow);
  app.on('before-quit', () => {
    (app as unknown as { quitting?: boolean }).quitting = true;
    stopMacCapture();
  });
}

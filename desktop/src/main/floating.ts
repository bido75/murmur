// A small always-on-top controller while a recording is running, so the user can
// stop without hunting for the main window. It owns no logic: the main window
// remains the source of truth, and the controller only forwards a stop press.
import { join } from "node:path";
import { BrowserWindow } from "electron";

let floating: BrowserWindow | null = null;

export function showFloating(parent: BrowserWindow): void {
  if (floating && !floating.isDestroyed()) {
    floating.show();
    return;
  }
  floating = new BrowserWindow({
    width: 220,
    height: 96,
    parent,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    title: "Murmur",
    webPreferences: {
      preload: join(__dirname, "floatingPreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  floating.setAlwaysOnTop(true, "screen-saver");
  void floating.loadFile(join(__dirname, "renderer", "floating.html"));
  floating.once("ready-to-show", () => floating?.show());
  floating.on("closed", () => (floating = null));
}

export function hideFloating(): void {
  if (floating && !floating.isDestroyed()) floating.close();
  floating = null;
}

export function updateFloating(payload: { elapsedMs: number; level: number }): void {
  if (floating && !floating.isDestroyed())
    floating.webContents.send("floating:state", payload);
}

export function onFloatingStop(fn: () => void): void {
  // Rebound every session by the caller; the window forwards its one message here.
  stopHandler = fn;
}
let stopHandler: () => void = () => {};

export function floatingStop(): void {
  stopHandler();
}

export function floatingVisible(): boolean {
  return Boolean(floating && !floating.isDestroyed());
}

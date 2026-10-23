import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { Bridge } from "../shared/bridge";

const CHANNELS = new Set([
  "macaudio:data",
  "macaudio:status",
  "meeting:detected",
  "meeting:state",
  "speech:progress",
  "tray:start",
  "tray:stop",
]);

const bridge: Bridge = {
  segmentOpen: (r, i, e) => ipcRenderer.invoke("segment:open", r, i, e),
  segmentAppend: (r, i, e, b) => ipcRenderer.invoke("segment:append", r, i, e, b),
  fileRead: (r, i, e) => ipcRenderer.invoke("file:read", r, i, e),
  fileSize: (r, i, e) => ipcRenderer.invoke("file:size", r, i, e),
  fileDelete: (r, i, e) => ipcRenderer.invoke("file:delete", r, i, e),
  queueGet: () => ipcRenderer.invoke("queue:get"),
  queueSet: (ops) => ipcRenderer.invoke("queue:set", ops),
  textGet: (k) => ipcRenderer.invoke("text:get", k),
  textSet: (k, v) => ipcRenderer.invoke("text:set", k, v),
  textKeys: (p) => ipcRenderer.invoke("text:keys", p),
  textRemove: (k) => ipcRenderer.invoke("text:remove", k),
  activeGet: () => ipcRenderer.invoke("active:get"),
  activeSet: (v) => ipcRenderer.invoke("active:set", v),
  setRecording: (r) => ipcRenderer.invoke("recording:state", r),
  info: () => ipcRenderer.invoke("app:info"),
  openExternal: (u) => ipcRenderer.invoke("app:open-external", u),
  micPermission: () => ipcRenderer.invoke("mic:permission"),
  macAudioStart: () => ipcRenderer.invoke("macaudio:start"),
  macAudioStop: () => ipcRenderer.invoke("macaudio:stop"),
  speechModel: () => ipcRenderer.invoke("speech:model"),
  speechModelInstall: () => ipcRenderer.invoke("speech:install"),
  speechModelCancel: () => ipcRenderer.invoke("speech:cancel"),
  speechModelRemove: () => ipcRenderer.invoke("speech:remove"),
  transcribeLocal: (s, o) => ipcRenderer.invoke("transcribe:local", s, o),
  resources: () => ipcRenderer.invoke("app:resources"),
  on: (channel, fn) => {
    if (!CHANNELS.has(channel)) throw new Error("Unknown channel");
    const listener = (_e: IpcRendererEvent, payload: unknown) => fn(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld("murmur", bridge);

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { Bridge } from '../shared/bridge';

const CHANNELS = new Set(['macaudio:data', 'macaudio:status', 'meeting:detected', 'meeting:state', 'tray:start', 'tray:stop']);

const bridge: Bridge = {
  segmentOpen: (r, i, e) => ipcRenderer.invoke('segment:open', r, i, e),
  segmentAppend: (p, b) => ipcRenderer.invoke('segment:append', p, b),
  fileRead: (p) => ipcRenderer.invoke('file:read', p),
  fileSize: (p) => ipcRenderer.invoke('file:size', p),
  fileDelete: (p) => ipcRenderer.invoke('file:delete', p),
  queueGet: () => ipcRenderer.invoke('queue:get'),
  queueSet: (ops) => ipcRenderer.invoke('queue:set', ops),
  activeGet: () => ipcRenderer.invoke('active:get'),
  activeSet: (v) => ipcRenderer.invoke('active:set', v),
  setRecording: (r) => ipcRenderer.invoke('recording:state', r),
  info: () => ipcRenderer.invoke('app:info'),
  openExternal: (u) => ipcRenderer.invoke('app:open-external', u),
  micPermission: () => ipcRenderer.invoke('mic:permission'),
  macAudioStart: () => ipcRenderer.invoke('macaudio:start'),
  macAudioStop: () => ipcRenderer.invoke('macaudio:stop'),
  on: (channel, fn) => {
    if (!CHANNELS.has(channel)) throw new Error('Unknown channel');
    const listener = (_e: IpcRendererEvent, payload: unknown) => fn(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld('murmur', bridge);

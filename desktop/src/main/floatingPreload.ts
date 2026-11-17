// The floating controller's only way in and out: it is told what to show and it can
// say the user pressed stop. It cannot read a file, run a program or reach the network.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("floating", {
  onState: (fn: (state: unknown) => void) => {
    const listener = (_e: unknown, state: unknown) => fn(state);
    ipcRenderer.on("floating:state", listener);
    return () => ipcRenderer.removeListener("floating:state", listener);
  },
  stop: () => ipcRenderer.send("floating:stop"),
  open: () => ipcRenderer.send("floating:open"),
});

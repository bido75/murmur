// The overlay's only way in and out.
//
// The overlay is a sandboxed page, so it gets these three things and nothing else: it
// is told what to show, it can say the user pressed cancel, and it can say where its
// cancel button is. It cannot read a file, run a program or reach the network.
import { contextBridge, ipcRenderer } from "electron";

export type OverlayRect = { x: number; y: number; w: number; h: number };

contextBridge.exposeInMainWorld("overlay", {
  /** Called when there is something new to show. */
  onState: (fn: (state: unknown) => void) => {
    const listener = (_e: unknown, state: unknown) => fn(state);
    ipcRenderer.on("overlay:state", listener);
    return () => ipcRenderer.removeListener("overlay:state", listener);
  },
  /** The user pressed cancel. */
  cancel: () => ipcRenderer.send("overlay:cancel"),
  /** Where the cancel button is, so the main process knows when it is under the pointer. */
  hover: (rect: OverlayRect) => ipcRenderer.send("overlay:hover", rect),
});

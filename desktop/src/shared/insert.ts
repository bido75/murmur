// Putting the words where the user is typing.
//
// The app cannot press keys itself in a way every computer agrees on, so the
// dependable way is the clipboard: the words go on the clipboard and the paste is
// asked for. What is left to the operating system is the paste, and each system has
// its own way of doing it.
//
// The commands are here, and are pure, so they can be checked without pressing
// anything. Nothing is ever run through a shell: the command and its arguments are
// passed straight to the operating system.

/** How the words get to where the user is typing. */
export type InsertMethod = "clipboard" | "paste" | "type";

export type Platform = "win32" | "darwin" | "linux";

/** One command to run, with its arguments kept apart from it. */
export type Command = {
  /** The program to run. */
  program: string;
  /** The arguments, each one separate so nothing is ever read as a shell command. */
  args: string[];
};

/**
 * The command that asks the operating system to paste.
 *
 * Each one uses a tool that comes with the system:
 *
 * - Windows: a small piece of PowerShell that sends the paste key.
 * - macOS: AppleScript, which asks the system to press the keys.
 * - Linux: xdotool, which does the same thing under X11.
 *
 * If the tool is not there, the words are still on the clipboard and the user is
 * told to press paste.
 */
export function pasteCommand(
  platform: Platform,
  method: InsertMethod,
): Command | null {
  if (method === "clipboard") return null;
  if (method === "type") {
    // Typing the words out is the slowest but works where pasting does not.
    if (platform === "darwin")
      return { program: "osascript", args: ["-e", "tell application \"System Events\" to keystroke \"v\" using {command down}"] };
    if (platform === "win32")
      return {
        program: "powershell",
        args: ["-NoProfile", "-NonInteractive", "-Command", "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^v')"],
      };
    return { program: "xdotool", args: ["key", "ctrl+v"] };
  }
  // The plain paste.
  if (platform === "darwin")
    return { program: "osascript", args: ["-e", "tell application \"System Events\" to keystroke \"v\" using {command down}"] };
  if (platform === "win32")
    return {
      program: "powershell",
      args: ["-NoProfile", "-NonInteractive", "-Command", "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^v')"],
    };
  return { program: "xdotool", args: ["key", "ctrl+v"] };
}

/**
 * The command that copies the selection, so it can be read.
 *
 * The clipboard is cleared first: if the copy did not happen, an unchanged
 * clipboard cannot be told apart from "nothing was selected".
 */
export function copySelectionCommand(platform: Platform): Command {
  if (platform === "darwin")
    return { program: "osascript", args: ["-e", "tell application \"System Events\" to keystroke \"c\" using {command down}"] };
  if (platform === "win32")
    return {
      program: "powershell",
      args: ["-NoProfile", "-NonInteractive", "-Command", "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^c')"],
    };
  return { program: "xdotool", args: ["key", "ctrl+c"] };
}

/** How long to wait for the clipboard to settle, in milliseconds. */
export function clipboardSettleMs(platform: Platform): number {
  if (platform === "win32") return 50;
  if (platform === "darwin") return 100;
  // Under X11 the clipboard owner has to reply, which takes a moment.
  return 150;
}

/** What to tell the user when the paste could not be done for them. */
export function insertFallbackMessage(method: InsertMethod): string {
  if (method === "clipboard")
    return "The words are on the clipboard. Press Ctrl+V (or Cmd+V on a Mac) to paste them.";
  return "The words are on the clipboard, but the paste could not be done for you. Press Ctrl+V (or Cmd+V on a Mac).";
}

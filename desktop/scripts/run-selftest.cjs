// Diagnostic harness: run the desktop selftest once, capture stdout/stderr,
// and report whether it exits or hangs. Used for P0 silent-record investigation.
const { spawn } = require("node:child_process");
const path = require("node:path");

const desktop = __dirname.includes("scripts")
  ? path.resolve(__dirname, "..")
  : process.cwd();

const electronBin = path.join(desktop, "node_modules", "electron", "dist", "electron.exe");
const timeoutMs = Number(process.argv[2] || 40000);

const child = spawn(electronBin, ["."], {
  cwd: desktop,
  env: { ...process.env, MURMUR_SELFTEST: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let out = "";
let err = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (err += d));

const timer = setTimeout(() => {
  console.log("=== HUNG (no exit within " + timeoutMs + " ms) ===");
  child.kill("SIGKILL");
}, timeoutMs);

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  console.log("=== exited code=" + code + " signal=" + signal + " ===");
  console.log("--- stdout ---");
  console.log(out || "(empty)");
  console.log("--- stderr ---");
  console.log(err || "(empty)");
});

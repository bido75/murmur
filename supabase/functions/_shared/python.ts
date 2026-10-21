/**
 * Test-only helper (not part of any edge function bundle).
 *
 * Two of our tests prove that the files we write can be opened by a standard
 * reader (zipfile, wave), so they need a real Python interpreter. On Windows
 * `python3` frequently resolves to the Microsoft Store alias stub, which
 * prints "Python was not found" and exits 9009 without running anything, so a
 * candidate is only accepted once it has actually executed code.
 */
import { execFileSync } from 'node:child_process';

export type PythonCommand = { command: string; args: string[] };

const CANDIDATES: PythonCommand[] = [
  { command: 'python3', args: [] },
  { command: 'python', args: [] },
  { command: 'py', args: ['-3'] },
];

const PROBE = 'print(1)';

let cached: { command: PythonCommand | null; reason: string } | null = null;

function probe(candidate: PythonCommand): string | null {
  try {
    execFileSync(candidate.command, [...candidate.args, '-I', '-c', PROBE], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20_000,
    });
    return null;
  } catch (err) {
    const e = err as { status?: number | null; stdout?: Buffer; stderr?: Buffer };
    const output = `${e.stderr?.toString() ?? ''}${e.stdout?.toString() ?? ''}`.trim();
    const first = output.split('\n').find((line) => line.trim().length > 0) ?? '';
    const status = e.status === undefined || e.status === null ? 'unknown' : String(e.status);
    return `exit ${status}${first ? ` (${first.trim()})` : ''}`;
  }
}

/** The first interpreter that can actually run code, or null when there is none. */
export function pythonCommand(): PythonCommand | null {
  if (cached) return cached.command;
  const failures: string[] = [];
  for (const candidate of CANDIDATES) {
    const failure = probe(candidate);
    if (failure === null) {
      cached = { command: candidate, reason: '' };
      return candidate;
    }
    failures.push(`${[candidate.command, ...candidate.args].join(' ')}: ${failure}`);
  }
  cached = { command: null, reason: `no working Python interpreter (tried ${failures.join('; ')})` };
  return null;
}

/** Why no interpreter is available, in words, for a skip message. */
export function pythonUnavailableReason(): string {
  pythonCommand();
  return cached?.reason ?? 'no working Python interpreter';
}

/** node:test/Deno.test skip value: false when Python works, the reason otherwise. */
export function pythonSkip(): false | string {
  return pythonCommand() ? false : pythonUnavailableReason();
}

/**
 * Runs a snippet with the working interpreter and returns its stdout as UTF-8.
 * The child is forced into UTF-8 mode: on Windows the console code page would
 * otherwise re-encode em dashes and smart quotes and corrupt the output. The
 * reconfigure is done inside the snippet because `python -I` ignores PYTHON*
 * environment variables.
 */
export function pythonRun(script: string, args: string[] = []): string {
  const py = pythonCommand();
  if (!py) throw new Error(pythonUnavailableReason());
  const utf8 = 'import sys;sys.stdout.reconfigure(encoding="utf-8");';
  return execFileSync(py.command, [...py.args, '-I', '-c', `${utf8}${script}`, ...args], {
    encoding: 'utf8',
  });
}

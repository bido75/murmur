// Reads the app's environment files, in the same order Expo does.
//
//   .env.local   the machine's own overrides. It wins, because it is read first.
//   .env         the settings that are shared and committed.
//
// A value already in the environment is never replaced, so a real environment
// variable always wins over a file.

import { existsSync, readFileSync } from "node:fs";

/**
 * The environment, with the files read in.
 *
 * `root` is the folder the `.env` files are in.
 */
export function loadEnv(root, environment = {}) {
  const env = { ...environment };
  for (const name of [".env.local", ".env"]) {
    const file = new URL(name, root);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && env[m[1]] === undefined)
        env[m[1]] = m[2].replace(/^["']|["']$/, "");
    }
  }
  return env;
}

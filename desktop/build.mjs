// Bundles main, preload and renderer with esbuild. Server settings come from ../.env
// (the same EXPO_PUBLIC_* values the phone/web app uses) or the environment.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';

function loadEnv() {
  const env = { ...process.env };
  const file = new URL('../.env', import.meta.url);
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}
const env = loadEnv();
const define = {
  __SUPABASE_URL__: JSON.stringify(env.EXPO_PUBLIC_SUPABASE_URL ?? ''),
  __SUPABASE_ANON_KEY__: JSON.stringify(env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''),
  __APP_URL__: JSON.stringify((env.EXPO_PUBLIC_APP_URL ?? '').replace(/\/$/, '')),
};

mkdirSync('dist/renderer', { recursive: true });
// The ONNX runtime is a native module: it is loaded at run time from node_modules, not
// bundled, so its binaries are packaged as they are.
const external = ['electron', 'onnxruntime-node'];
await build({ entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external });
await build({ entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.js', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external });
await build({ entryPoints: ['src/main/overlayPreload.ts'], outfile: 'dist/overlayPreload.js', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external });
await build({ entryPoints: ['src/renderer/app.ts'], outfile: 'dist/renderer/app.js', bundle: true, platform: 'browser', format: 'iife', target: 'chrome140', define });
for (const f of ['index.html', 'styles.css', 'pcm-worklet.js', 'overlay.html']) cpSync(`src/renderer/${f}`, `dist/renderer/${f}`);
console.log('Built desktop app', define.__SUPABASE_URL__ === '""' ? '(no server settings — set them in ../.env)' : '');

// Bundles main, preload and renderer with esbuild. Server settings come from ../.env
// (the same EXPO_PUBLIC_* values the phone/web app uses) or the environment.
//
// ../.env.local is read first, so a machine that overrides the server address for the
// local network gets the same address here. Only the EXPO_PUBLIC_* names are used.
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { loadEnv } from '../scripts/loadEnv.mjs';

const env = loadEnv(new URL('../', import.meta.url), process.env);
const define = {
  __SUPABASE_URL__: JSON.stringify(env.EXPO_PUBLIC_SUPABASE_URL ?? ''),
  __SUPABASE_ANON_KEY__: JSON.stringify(env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''),
  __APP_URL__: JSON.stringify((env.EXPO_PUBLIC_APP_URL ?? '').replace(/\/$/, '')),
  // Shared modules under src/lib read the same EXPO_PUBLIC_* names the phone and web
  // builds inline. Define them for the browser bundle so importing shared code does
  // not crash on a missing `process`.
  'process.env.EXPO_PUBLIC_SUPABASE_URL': JSON.stringify(env.EXPO_PUBLIC_SUPABASE_URL ?? ''),
  'process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''),
  'process.env.EXPO_PUBLIC_APP_URL': JSON.stringify((env.EXPO_PUBLIC_APP_URL ?? '').replace(/\/$/, '')),
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

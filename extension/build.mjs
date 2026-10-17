// Builds the extension into dist/ with the server address from ../.env. Load dist/ via
// chrome://extensions → Developer mode → Load unpacked; zip dist/ for the Chrome Web Store.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const env = Object.fromEntries(
  (existsSync('../.env') ? readFileSync('../.env', 'utf8') : '')
    .split('\n')
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]),
);
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
if (!url) console.warn('No EXPO_PUBLIC_SUPABASE_URL found — the extension will not reach a server.');

mkdirSync('dist', { recursive: true });
for (const f of readdirSync('src')) {
  let text = readFileSync(`src/${f}`, 'utf8');
  text = text.replaceAll('__SUPABASE_URL__', url).replaceAll('__SUPABASE_ANON_KEY__', key).replaceAll('__SUPABASE_ORIGIN__', url ? new URL(url).origin : 'https://*.supabase.co');
  writeFileSync(`dist/${f}`, text);
}

// Simple round icons (accent circle with a white bar), generated so there are no binary files to keep.
function png(size) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
      const inside = d <= r - 0.5;
      const bar = Math.abs(x + 0.5 - r) < size * 0.09 && Math.abs(y + 0.5 - r) < size * 0.26;
      const [cr, cg, cb] = bar ? [255, 255, 255] : [31, 111, 92];
      raw[i] = cr; raw[i + 1] = cg; raw[i + 2] = cb; raw[i + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [16, 48, 128]) writeFileSync(`dist/icon${s}.png`, png(s));
console.log(`Built extension → dist/ (server: ${url || 'not set'})`);

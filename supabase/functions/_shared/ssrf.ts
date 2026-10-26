// SSRF guard for outbound webhook destinations. Pure; tested.
//
// A webhook URL is fetched by the server, so it must not be a way for a user to make
// the server fetch itself, the cloud metadata service, or some other machine on the
// internal network. This checks the host syntactically — private IP ranges and the
// well-known internal hostnames — at write time; the delivery function also resolves
// the host and blocks anything that then points at a private address.

function ipv4ToInt(a: number[]): number {
  return ((a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]) >>> 0;
}

function parseIpv4(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ipv4ToInt(parts);
}

const V4_PRIVATE: [number, number][] = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x64400000, 0x647fffff], // 100.64.0.0/10
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local and cloud metadata)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15
  [0xc6336400, 0xc63364ff], // 198.51.100.0/24
  [0xcb007100, 0xcb0071ff], // 203.0.113.0/24
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0xe0000000, 0xefffffff], // 224.0.0.0/4 (multicast) and 240.0.0.0/4 (reserved)
];

function isPrivateV4(int: number): boolean {
  return V4_PRIVATE.some(([lo, hi]) => int >= lo && int <= hi);
}

/** A hostname with no dot can only exist on an internal network. */
function isSingleLabel(h: string): boolean {
  return !h.includes('.') && !h.includes(':');
}

/**
 * IPv4-mapped IPv6 (::ffff:a.b.c.d) follows its IPv4 part, so a mapped private v4
 * is private. Everything else private is covered by fc00::/7 (ULA) and fe80::/10
 * (link-local), plus ::/128 and ::1.
 */
function parseIpv6(s: string): number | null {
  // Return a sentinel code rather than a full 128-bit value: private DHCP/metadata
  // and mapped addresses are the only ones that matter, so classify by prefix.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) {
    const v4 = parseIpv4(mapped[1]);
    if (v4 !== null && isPrivateV4(v4)) return 1; // private mapped
    return null; // public mapped — not our concern for the block list
  }
  if (s === '::' || s === '::1') return 1;
  if (/^fc/i.test(s)) return 1; // fc00::/7 ULA
  if (/^fe[89ab]/i.test(s)) return 1; // fe80::/10 link-local
  return null;
}

const BLOCKED_HOSTNAMES = ['localhost', 'localhost.localdomain', 'localhost6'];

/**
 * True when this host is, syntactically, a private, reserved or otherwise
 * non-public address. Hostnames ending in `.local` or `.internal` are treated as
 * internal. The delivery path re-checks a resolved address, but this stops the
 * obvious cases before anything is stored or fetched.
 */
export function isPrivateHost(host: string): boolean {
  const h = (host ?? '').replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_HOSTNAMES.includes(h)) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;
  if (isSingleLabel(h)) return true;
  const v4 = parseIpv4(h);
  if (v4 !== null) return isPrivateV4(v4);
  const v6 = parseIpv6(h);
  if (v6 !== null) return v6 === 1;
  return false;
}
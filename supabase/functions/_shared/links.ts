// Importing audio/video from a link. Pure, unit-tested; the app imports this file too.

export type LinkCheck = { ok: true; url: string; label: string } | { ok: false; reason: string };

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[.*\])$/i;
const MEDIA_EXT = /\.(mp3|m4a|mp4|wav|aac|ogg|opus|webm|mov|flac|wma|mkv|m4v)$/i;

/**
 * Turn a pasted link into one the transcriber can download, or explain why we can't.
 * - Dropbox, Google Drive and OneDrive share links become direct downloads.
 * - Direct links to audio/video files pass through.
 * - YouTube, Vimeo, Zoom and Teams pages are refused with a reason (they need sign-in or
 *   their terms forbid downloading).
 */
export function normalizeMediaLink(input: string): LinkCheck {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return { ok: false, reason: 'That doesn’t look like a link.' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'Only https:// links can be imported.' };
  if (u.username || u.password) return { ok: false, reason: 'Links with a username or password can’t be imported.' };
  const host = u.hostname.toLowerCase();
  if (PRIVATE_HOST.test(host) || !host.includes('.')) return { ok: false, reason: 'That address isn’t reachable from the internet.' };

  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host)) {
    return { ok: false, reason: 'YouTube doesn’t allow downloading videos. Download your own video from YouTube Studio and import the file instead.' };
  }
  if (/(^|\.)vimeo\.com$/.test(host)) return { ok: false, reason: 'Vimeo pages can’t be imported. Use the video’s download link (Vimeo → Download) instead.' };
  if (/(^|\.)zoom\.us$/.test(host)) {
    return { ok: false, reason: 'Zoom recording links need a Zoom sign-in. Download the recording from Zoom and import the file instead.' };
  }
  if (/(^|\.)teams\.microsoft\.com$|sharepoint\.com$/.test(host) && !/download=1/.test(u.search)) {
    return { ok: false, reason: 'Teams and SharePoint recordings need a sign-in. Download the file and import it instead.' };
  }

  // Dropbox: ?dl=0 page → direct download.
  if (/(^|\.)dropbox\.com$/.test(host)) {
    u.searchParams.delete('dl');
    u.searchParams.set('dl', '1');
    return { ok: true, url: u.toString(), label: 'Dropbox' };
  }
  // Google Drive: /file/d/<id>/view → uc?export=download&id=<id>
  if (host === 'drive.google.com') {
    const id = u.pathname.match(/\/file\/d\/([\w-]{10,})/)?.[1] ?? u.searchParams.get('id');
    if (!id) return { ok: false, reason: 'Use the share link of a single Google Drive file (anyone with the link can view).' };
    // drive.usercontent with confirm=t skips the "can't scan this file for viruses" page large files get.
    return { ok: true, url: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`, label: 'Google Drive' };
  }
  // OneDrive personal share links: 1drv.ms or onedrive.live.com → add download=1
  if (host === '1drv.ms' || host === 'onedrive.live.com') {
    u.searchParams.set('download', '1');
    return { ok: true, url: u.toString(), label: 'OneDrive' };
  }
  if (MEDIA_EXT.test(u.pathname)) return { ok: true, url: u.toString(), label: host };
  // Unknown page: allow, but the transcriber will reject it if it isn't audio or video.
  return { ok: true, url: u.toString(), label: host };
}

/** A title from the link's file name, e.g. ".../Site%20Walk%2010-14.mp3" → "Site Walk 10-14". */
export function titleFromLink(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    const base = last.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_+]+/g, ' ').trim();
    return base && base.length > 2 && !/^(view|uc|download|s)$/i.test(base) ? base.slice(0, 80) : 'Imported from link';
  } catch {
    return 'Imported from link';
  }
}

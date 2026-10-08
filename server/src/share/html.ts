// The app shell (web/dist/index.html) with what the server knows and the SPA
// can't add in time: the Umami tag on a public site, and Open Graph tags on a
// shared review so a pasted /r/:slug link unfurls with its PNG card. Link
// previewers don't run JavaScript, so these have to be in the HTML itself.

import { readFileSync } from 'node:fs';
import type { Context } from 'hono';
import { config } from '../config.js';
import { publicBaseUrl } from '../publicUrl.js';
import { getShared } from './store.js';

let shell: { path: string; html: string } | null = null;

function readShell(path: string): string {
  if (shell?.path !== path || process.env.NODE_ENV !== 'production') shell = { path, html: readFileSync(path, 'utf8') };
  return shell.html;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function umamiTag(id: string | null): string {
  return id ? `<script defer src="https://cloud.umami.is/script.js" data-website-id="${esc(id)}"></script>` : '';
}

export function ogTags(tags: Record<string, string>): string {
  return Object.entries(tags)
    .map(([k, v]) => k.startsWith('twitter:')
      ? `<meta name="${esc(k)}" content="${esc(v)}" />`
      : `<meta property="${esc(k)}" content="${esc(v)}" />`)
    .join('\n    ');
}

export function injectHead(html: string, extra: string, title?: string): string {
  let out = html;
  if (title) out = out.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  return extra ? out.replace('</head>', `    ${extra}\n  </head>`) : out;
}

export function renderIndexHtml(path: string, c: Context): string {
  const html = readShell(path);
  const parts: string[] = [];
  const umami = umamiTag(config.umamiWebsiteId);
  if (umami) parts.push(umami);

  const url = new URL(c.req.url);
  const m = /^\/r\/([a-zA-Z0-9]{6,20})\/?$/.exec(url.pathname);
  let title: string | undefined;
  if (m) {
    const r = getShared(m[1]!);
    if (r) {
      const base = publicBaseUrl(c);
      const h = r.highlights;
      const name = h.focus === 'white' ? r.white : r.black;
      title = `${r.white} vs ${r.black} — Chesspirit Game Review`;
      const bits = [`${name}: ${h.accuracy.toFixed(1)}% accuracy`];
      if (h.star) bits.push(`${h.star.classification === 'brilliant' ? '!! moment' : 'great move'} ${h.star.label}`);
      if (h.miss?.best_san) bits.push(`missed ${h.miss.best_san}`);
      parts.push(ogTags({
        'og:type': 'article',
        'og:site_name': 'Chesspirit',
        'og:title': title,
        'og:description': `${bits.join(' · ')}. Free, unlimited game reviews.`,
        'og:url': `${base}/r/${r.slug}`,
        'og:image': `${base}/api/share/${r.slug}/card.png`,
        'og:image:width': '1200',
        'og:image:height': '630',
        'twitter:card': 'summary_large_image',
        'twitter:title': title,
        'twitter:image': `${base}/api/share/${r.slug}/card.png`,
      }));
    }
  } else if (config.publicSite && (url.pathname === '/' || url.pathname === '/try')) {
    parts.push(ogTags({
      'og:type': 'website',
      'og:site_name': 'Chesspirit',
      'og:title': 'Chesspirit — free, unlimited chess game reviews',
      'og:description': 'Review your Chess.com and Lichess games with Stockfish: every move graded, accuracy, key moments and your blunders as puzzles. Free, open source, self-hostable.',
      'og:url': `${publicBaseUrl(c)}${url.pathname}`,
    }));
  }
  return injectHead(html, parts.join('\n    '), title);
}

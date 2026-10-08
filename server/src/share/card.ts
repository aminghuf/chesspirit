// The share card: a 1200×630 PNG (the Open Graph size) for a shared review —
// the board at the game's best moment, the accuracy, the move the engine
// wanted at the worst one, and a small chesspirit.app mark. Built as SVG and
// rasterized with resvg. Fonts are the bundled Inter files, so the card looks
// the same on every host (and needs no system fonts in the slim image).

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { PIECES } from './pieces.js';
import type { ShareHighlights } from './highlights.js';
import type { Classification, Color } from '../types.js';

export interface CardInput {
  white: string;
  black: string;
  white_rating: number | null;
  black_rating: number | null;
  /** '1-0' | '0-1' | '1/2-1/2' | null */
  result: string | null;
  time_class: string | null;
  opening_name: string | null;
  highlights: ShareHighlights;
}

const W = 1200;
const H = 630;

const CLASS_HEX: Partial<Record<Classification, string>> = {
  brilliant: '#1baca6', great: '#5b8baf', best: '#81b64c', excellent: '#95b776',
  good: '#95a370', book: '#a88865', inaccuracy: '#f7c045', mistake: '#ffa459',
  blunder: '#fa412d', miss: '#ee6b55', forced: '#6b6964',
};
const CLASS_GLYPH: Partial<Record<Classification, string>> = {
  brilliant: '!!', great: '!', mistake: '?', blunder: '??', inaccuracy: '?!',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function squareXY(sq: string, orientation: Color, size: number): { x: number; y: number } {
  const file = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return { x: col * size, y: row * size };
}

/** The board as SVG, with the move from→to tinted and a badge on `to`. */
export function boardSvg(fen: string, orientation: Color, px: number, move?: { from: string; to: string; classification: Classification }): string {
  const sq = px / 8;
  const parts: string[] = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const light = (r + f) % 2 === 0;
      parts.push(`<rect x="${f * sq}" y="${r * sq}" width="${sq}" height="${sq}" fill="${light ? '#ebecd0' : '#779556'}"/>`);
    }
  }
  if (move) {
    for (const s of [move.from, move.to]) {
      const { x, y } = squareXY(s, orientation, sq);
      parts.push(`<rect x="${x}" y="${y}" width="${sq}" height="${sq}" fill="#f6f669" fill-opacity="0.5"/>`);
    }
  }
  const rows = (fen.split(' ')[0] ?? '').split('/');
  rows.forEach((row, ri) => {
    let fi = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { fi += Number(ch); continue; }
      const key = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
      const file = String.fromCharCode(97 + fi);
      const rank = 8 - ri;
      const { x, y } = squareXY(`${file}${rank}`, orientation, sq);
      const inner = PIECES[key];
      if (inner) parts.push(`<svg x="${x}" y="${y}" width="${sq}" height="${sq}" viewBox="0 0 45 45">${inner}</svg>`);
      fi++;
    }
  });
  if (move) {
    const hex = CLASS_HEX[move.classification];
    const glyph = CLASS_GLYPH[move.classification];
    if (hex && glyph) {
      const { x, y } = squareXY(move.to, orientation, sq);
      const r = sq * 0.24;
      const cx = Math.min(px - r - 2, x + sq - r * 0.35);
      const cy = Math.max(r + 2, y + r * 0.35);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${hex}" stroke="#fff" stroke-width="3"/>`);
      parts.push(`<text x="${cx}" y="${cy + r * 0.38}" font-family="Inter" font-weight="700" font-size="${r * 1.05}" fill="#fff" text-anchor="middle">${esc(glyph)}</text>`);
    }
  }
  return parts.join('');
}

function resultText(result: string | null): string {
  if (result === '1-0') return '1–0';
  if (result === '0-1') return '0–1';
  if (result === '1/2-1/2') return '½–½';
  return '';
}

export function cardSvg(input: CardInput): string {
  const h = input.highlights;
  const focusName = h.focus === 'white' ? input.white : input.black;
  const star = h.star;
  const miss = h.miss;
  // Board: the !! moment, else the costly move's position, else the start.
  const boardFen = star?.fen_after ?? miss?.fen_before ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const boardMove = star
    ? { from: star.uci.slice(0, 2), to: star.uci.slice(2, 4), classification: star.classification }
    : undefined;
  const boardPx = 520;
  const bx = 55;
  const by = 55;

  const player = (name: string, rating: number | null) => esc(clip(name, 22)) + (rating ? ` <tspan fill="#a09a93">(${Math.round(rating)})</tspan>` : '');
  const meta = [resultText(input.result), input.time_class ? input.time_class[0]!.toUpperCase() + input.time_class.slice(1) : '', input.opening_name ? clip(input.opening_name, 34) : '']
    .filter(Boolean).join('  ·  ');

  const x0 = 630;
  const lines: string[] = [];
  lines.push(`<text x="${x0}" y="92" font-family="Inter" font-weight="700" font-size="22" letter-spacing="3" fill="#81b64c">CHESSPIRIT GAME REVIEW</text>`);
  lines.push(`<text x="${x0}" y="140" font-family="Inter" font-weight="700" font-size="30" fill="#f7f6f5">${player(input.white, input.white_rating)}</text>`);
  lines.push(`<text x="${x0}" y="178" font-family="Inter" font-weight="400" font-size="24" fill="#a09a93">vs  <tspan font-weight="700" fill="#f7f6f5">${player(input.black, input.black_rating)}</tspan></text>`);
  if (meta) lines.push(`<text x="${x0}" y="214" font-family="Inter" font-size="20" fill="#a09a93">${esc(meta)}</text>`);

  // Accuracy block
  lines.push(`<text x="${x0}" y="300" font-family="Inter" font-weight="700" font-size="76" fill="#f7f6f5">${h.accuracy.toFixed(1)}</text>`);
  lines.push(`<text x="${x0 + 210}" y="262" font-family="Inter" font-size="20" fill="#a09a93">accuracy</text>`);
  lines.push(`<text x="${x0 + 210}" y="292" font-family="Inter" font-weight="700" font-size="22" fill="#f7f6f5">${esc(clip(focusName, 14))}</text>`);
  lines.push(`<text x="${x0 + 400}" y="262" font-family="Inter" font-size="20" fill="#a09a93">opponent</text>`);
  lines.push(`<text x="${x0 + 400}" y="292" font-family="Inter" font-weight="700" font-size="22" fill="#a09a93">${h.opponent_accuracy.toFixed(1)}</text>`);

  // Star moment / best move
  let y = 360;
  if (star) {
    const hex = CLASS_HEX[star.classification] ?? '#1baca6';
    const title = star.classification === 'brilliant' ? '!! moment' : 'Great move';
    lines.push(`<text x="${x0}" y="${y}" font-family="Inter" font-size="20" fill="#a09a93">${title}</text>`);
    lines.push(`<text x="${x0}" y="${y + 36}" font-family="Inter" font-weight="700" font-size="32" fill="${hex}">${esc(star.label)}${star.classification === 'brilliant' ? '!!' : '!'}</text>`);
    y += 80;
  }
  if (miss && miss.best_san) {
    lines.push(`<text x="${x0}" y="${y}" font-family="Inter" font-size="20" fill="#a09a93">Best move you missed</text>`);
    lines.push(`<text x="${x0}" y="${y + 36}" font-family="Inter" font-weight="700" font-size="30" fill="#81b64c">${esc(miss.best_san)}<tspan dx="12" font-weight="400" font-size="22" fill="#a09a93">instead of ${esc(miss.label)}</tspan></text>`);
    y += 80;
  } else if (!star) {
    lines.push(`<text x="${x0}" y="${y + 20}" font-family="Inter" font-weight="700" font-size="30" fill="#81b64c">No blunders.</text>`);
    y += 80;
  }

  // Counts
  const chips: [string, number, string][] = [
    ['!!', h.counts.brilliant, CLASS_HEX.brilliant!],
    ['!', h.counts.great, CLASS_HEX.great!],
    ['check', h.counts.best, CLASS_HEX.best!],
    ['?', h.counts.mistake, CLASS_HEX.mistake!],
    ['??', h.counts.blunder + h.counts.miss, CLASS_HEX.blunder!],
  ];
  const cy = Math.max(y + 10, 520);
  chips.forEach(([g, n, hex], i) => {
    const cx = x0 + i * 100;
    lines.push(`<circle cx="${cx + 18}" cy="${cy}" r="18" fill="${hex}"/>`);
    if (g === 'check') lines.push(`<path d="M${cx + 10} ${cy + 1} l6 6 l11 -12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`);
    else lines.push(`<text x="${cx + 18}" y="${cy + 7}" font-family="Inter" font-weight="700" font-size="18" fill="#fff" text-anchor="middle">${esc(g)}</text>`);
    lines.push(`<text x="${cx + 44}" y="${cy + 9}" font-family="Inter" font-weight="700" font-size="26" fill="#f7f6f5">${n}</text>`);
  });

  // Watermark
  lines.push(`<text x="${W - 40}" y="${H - 28}" font-family="Inter" font-weight="700" font-size="20" fill="#f7f6f5" fill-opacity="0.55" text-anchor="end">chesspirit.app</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#312e2b"/><stop offset="1" stop-color="#1c1a18"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect x="${bx - 6}" y="${by - 6}" width="${boardPx + 12}" height="${boardPx + 12}" rx="10" fill="#1c1a18"/>
<g transform="translate(${bx} ${by})">${boardSvg(boardFen, h.focus, boardPx, boardMove)}</g>
${lines.join('\n')}
</svg>`;
}

const FONT_DIR_CANDIDATES = [
  resolve(config.projectRoot, 'server', 'assets', 'fonts'),
  resolve(import.meta.dirname, '..', '..', 'assets', 'fonts'),
];

function fontFiles(): string[] {
  for (const dir of FONT_DIR_CANDIDATES) {
    const files = ['Inter_400Regular.ttf', 'Inter_700Bold.ttf'].map((f) => resolve(dir, f));
    if (files.every((f) => existsSync(f))) return files;
  }
  return [];
}

type ResvgCtor = new (svg: string, opts: unknown) => { render(): { asPng(): Buffer } };
let resvgCtor: ResvgCtor | null | undefined;

async function loadResvg(): Promise<ResvgCtor | null> {
  if (resvgCtor !== undefined) return resvgCtor;
  try {
    const mod = (await import('@resvg/resvg-js')) as unknown as { Resvg: ResvgCtor };
    resvgCtor = mod.Resvg;
  } catch (err) {
    // No prebuilt binary for this platform: callers fall back to the SVG.
    console.warn('[share] PNG cards unavailable:', err instanceof Error ? err.message : err);
    resvgCtor = null;
  }
  return resvgCtor;
}

/** PNG bytes, or null when resvg can't load on this platform. */
export async function renderCardPng(input: CardInput): Promise<Buffer | null> {
  const Resvg = await loadResvg();
  if (!Resvg) return null;
  const svg = cardSvg(input);
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: 'Inter' },
  });
  return r.render().asPng();
}

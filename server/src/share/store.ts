// Shared reviews: a frozen copy of one game and its engine analysis behind an
// unguessable slug, readable by anyone with the link. Two kinds of rows:
//   - 'game': a signed-in user shared one of their own analysed games
//     (deleted with the game, or when they stop sharing);
//   - 'try':  a visitor analysed a public Chess.com / Lichess game without an
//     account (routes/try.ts). One row per external game, reused by everyone.
// A copy rather than a live join, so re-analysing or editing a game never
// changes what a link already showed someone.

import { randomBytes } from 'node:crypto';
import { Chess } from 'chess.js';
import { db } from '../db.js';
import type { AnalysisResult, Color } from '../types.js';
import { computeHighlights, type ShareHighlights } from './highlights.js';

db.exec(`CREATE TABLE IF NOT EXISTS shared_reviews (
  slug TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('game','try')),
  game_id INTEGER UNIQUE REFERENCES games(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  site TEXT CHECK(site IN ('chesscom','lichess')),
  external_id TEXT,
  focus_color TEXT NOT NULL CHECK(focus_color IN ('white','black')),
  white TEXT NOT NULL,
  black TEXT NOT NULL,
  white_rating INTEGER,
  black_rating INTEGER,
  result TEXT,
  time_class TEXT,
  end_time TEXT,
  source_url TEXT,
  pgn TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_try ON shared_reviews(site, external_id) WHERE kind = 'try'`);
// Try-it reviews are anonymous and cheap to redo; three months keeps any link
// someone posted alive for a good while without the table growing forever.
db.prepare(`DELETE FROM shared_reviews WHERE kind = 'try' AND created_at < datetime('now','-90 days')`).run();

export interface SharedReview {
  slug: string;
  kind: 'game' | 'try';
  site: 'chesscom' | 'lichess' | null;
  focus_color: Color;
  white: string;
  black: string;
  white_rating: number | null;
  black_rating: number | null;
  result: string | null;
  time_class: string | null;
  end_time: string | null;
  source_url: string | null;
  pgn: string;
  analysis: AnalysisResult;
  highlights: ShareHighlights;
  created_at: string;
}

interface Row {
  slug: string; kind: 'game' | 'try'; site: 'chesscom' | 'lichess' | null; focus_color: Color;
  white: string; black: string; white_rating: number | null; black_rating: number | null;
  result: string | null; time_class: string | null; end_time: string | null; source_url: string | null;
  pgn: string; analysis_json: string; created_at: string;
}

const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** 10 characters from a 56-letter alphabet: ~58 bits, not guessable. */
export function newSlug(): string {
  const bytes = randomBytes(10);
  let s = '';
  for (const b of bytes) s += SLUG_ALPHABET[b % SLUG_ALPHABET.length];
  return s;
}

export const SLUG_RE = /^[a-zA-Z0-9]{6,20}$/;

function fromRow(r: Row): SharedReview {
  const analysis = JSON.parse(r.analysis_json) as AnalysisResult;
  return {
    slug: r.slug, kind: r.kind, site: r.site, focus_color: r.focus_color,
    white: r.white, black: r.black, white_rating: r.white_rating, black_rating: r.black_rating,
    result: r.result, time_class: r.time_class, end_time: r.end_time, source_url: r.source_url,
    pgn: r.pgn, analysis, highlights: computeHighlights(analysis, r.focus_color), created_at: r.created_at,
  };
}

const COLS = `slug, kind, site, focus_color, white, black, white_rating, black_rating, result,
  time_class, end_time, source_url, pgn, analysis_json, created_at`;

export function getShared(slug: string): SharedReview | null {
  if (!SLUG_RE.test(slug)) return null;
  const r = db.prepare(`SELECT ${COLS} FROM shared_reviews WHERE slug = ?`).get(slug) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function countView(slug: string): void {
  db.prepare('UPDATE shared_reviews SET views = views + 1 WHERE slug = ?').run(slug);
}

export function findTry(site: 'chesscom' | 'lichess', externalId: string): string | null {
  const r = db.prepare(`SELECT slug FROM shared_reviews WHERE kind = 'try' AND site = ? AND external_id = ?`).get(site, externalId) as { slug: string } | undefined;
  return r?.slug ?? null;
}

export function slugForGame(gameId: number): string | null {
  const r = db.prepare(`SELECT slug FROM shared_reviews WHERE game_id = ?`).get(gameId) as { slug: string } | undefined;
  return r?.slug ?? null;
}

export function unshareGame(gameId: number, userId: number): boolean {
  return db.prepare(`DELETE FROM shared_reviews WHERE game_id = ? AND user_id = ?`).run(gameId, userId).changes > 0;
}

export interface NewShared {
  kind: 'game' | 'try';
  game_id?: number | null;
  user_id?: number | null;
  site?: 'chesscom' | 'lichess' | null;
  external_id?: string | null;
  focus_color: Color;
  white: string;
  black: string;
  white_rating?: number | null;
  black_rating?: number | null;
  result?: string | null;
  time_class?: string | null;
  end_time?: string | null;
  source_url?: string | null;
  pgn: string;
  analysis: AnalysisResult;
}

export function insertShared(n: NewShared): string {
  const slug = newSlug();
  db.prepare(`INSERT INTO shared_reviews (slug, kind, game_id, user_id, site, external_id, focus_color,
      white, black, white_rating, black_rating, result, time_class, end_time, source_url, pgn, analysis_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    slug, n.kind, n.game_id ?? null, n.user_id ?? null, n.site ?? null, n.external_id ?? null, n.focus_color,
    n.white, n.black, n.white_rating ?? null, n.black_rating ?? null, n.result ?? null,
    n.time_class ?? null, n.end_time ?? null, n.source_url ?? null, n.pgn, JSON.stringify(n.analysis),
  );
  return slug;
}

/** PGN result tag ('1-0' / '0-1' / '1/2-1/2'), or null. */
export function pgnResult(pgn: string): string | null {
  const m = /\[Result\s+"(1-0|0-1|1\/2-1\/2)"\]/.exec(pgn);
  return m ? m[1]! : null;
}

export function pgnHeader(pgn: string, tag: string): string | null {
  const m = new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`).exec(pgn);
  return m && m[1] && m[1] !== '?' ? m[1] : null;
}

/** Same result from the player's side ('win' / 'loss' / 'draw') to the PGN form. */
export function resultFromUserSide(result: string | null, userColor: Color | null): string | null {
  if (result === '1-0' || result === '0-1' || result === '1/2-1/2') return result;
  if (result === 'draw') return '1/2-1/2';
  if (result !== 'win' && result !== 'loss') return null;
  const side = userColor ?? 'white';
  const whiteWon = (result === 'win') === (side === 'white');
  return whiteWon ? '1-0' : '0-1';
}

/** Strip clock and eval comments so the stored PGN is just the game. */
export function cleanPgn(pgn: string): string {
  try {
    const c = new Chess();
    c.loadPgn(pgn, { strict: false });
    const headers = c.getHeaders();
    const keep = ['Event', 'Site', 'Date', 'White', 'Black', 'Result', 'WhiteElo', 'BlackElo', 'TimeControl', 'ECO', 'Opening'];
    const out = new Chess();
    for (const m of c.history()) out.move(m);
    for (const k of keep) if (headers[k]) out.setHeader(k, headers[k]!);
    return out.pgn();
  } catch {
    return pgn;
  }
}

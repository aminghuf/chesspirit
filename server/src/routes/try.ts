// "Try it with any username" — a Game Review before sign-up, on a public
// instance only (PUBLIC_SITE). A visitor types a Chess.com or Lichess
// username, picks one of the last games, and gets the same engine review a
// member gets, as a shareable /r/:slug page. Nothing is stored about the
// visitor; the result is one shared_reviews row per external game, reused by
// whoever asks for the same game next.
//
// Strangers share this machine's CPU, so: one analysis at a time, a short
// queue, a lower depth (TRY_DEPTH), and per-address limits.

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { getMonth, listArchives, type ChessComGame } from '../chess/chesscom.js';
import { fetchRecentGames as fetchLichess, isValidLichessUsername, toImportRow } from '../chess/lichess.js';
import { analyzePgnFull, scoreFromResultForUser } from './analyze.js';
import { publicBaseUrl } from '../publicUrl.js';
import { cleanPgn, findTry, insertShared, pgnHeader } from '../share/store.js';
import { shareUrl } from './share.js';
import type { Color } from '../types.js';

const router = new Hono();

router.use('*', async (c, next) => {
  if (!config.publicSite) return c.json({ error: 'not_enabled' }, 404);
  await next();
});

type Site = 'chesscom' | 'lichess';

export interface TryGame {
  id: string;
  white: string;
  black: string;
  white_rating: number | null;
  black_rating: number | null;
  result: string | null;
  time_class: string | null;
  end_time: string;
  user_color: Color | null;
  opening: string | null;
  plies: number;
  url: string | null;
  /** Already reviewed by someone: opening it costs nothing. */
  slug: string | null;
}

interface CachedList { at: number; games: (TryGame & { pgn: string })[] }

const LIST_TTL_MS = 10 * 60_000;
const LIST_CACHE_MAX = 500;
const MAX_GAMES = 10;
const MAX_PLIES = 240;
const QUEUE_MAX = 5;

const listCache = new Map<string, CachedList>();

// ---- per-address limits ----

const hits = new Map<string, number[]>();

export function clientIp(c: Context): string {
  const cf = c.req.header('cf-connecting-ip');
  if (cf) return cf.trim();
  const real = c.req.header('x-real-ip');
  if (real) return real.trim();
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

/** Sliding-window limiter: true if this address may do `bucket` once more. */
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) { hits.set(key, list); return false; }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 10_000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  }
  return true;
}

// ---- fetching a username's last games ----

function countPlies(pgn: string): number {
  const body = pgn.replace(/\[[^\]]*\]/g, '').replace(/\{[^}]*\}/g, '').replace(/\([^)]*\)/g, '');
  return body.split(/\s+/).filter((t) => t && !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)).length;
}

const DRAWN = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

export function chessComRow(g: ChessComGame, username: string): (TryGame & { pgn: string }) | null {
  if (g.rules !== 'chess' || !g.pgn) return null;
  const id = g.url.replace(/^https:\/\/www\.chess\.com\/game\//, '').replace(/[^a-z0-9/]/gi, '');
  if (!id) return null;
  const result = g.white.result === 'win' ? '1-0' : g.black.result === 'win' ? '0-1'
    : DRAWN.has(g.white.result) || DRAWN.has(g.black.result) ? '1/2-1/2' : null;
  const u = username.toLowerCase();
  const userColor: Color | null = g.white.username.toLowerCase() === u ? 'white' : g.black.username.toLowerCase() === u ? 'black' : null;
  return {
    id, white: g.white.username, black: g.black.username,
    white_rating: g.white.rating ?? null, black_rating: g.black.rating ?? null,
    result, time_class: g.time_class ?? null, end_time: new Date(g.end_time * 1000).toISOString(),
    user_color: userColor, opening: openingFromPgn(g.pgn), plies: countPlies(g.pgn),
    url: g.url, pgn: g.pgn, slug: null,
  };
}

function openingFromPgn(pgn: string): string | null {
  const url = pgnHeader(pgn, 'ECOUrl');
  if (url) {
    const tail = url.split('/').pop() ?? '';
    const name = decodeURIComponent(tail).replace(/-/g, ' ').replace(/\s+\d.*$/, '').trim();
    if (name) return name;
  }
  return pgnHeader(pgn, 'Opening');
}

async function fetchChessCom(username: string): Promise<(TryGame & { pgn: string })[]> {
  const archives = await listArchives(username);
  const out: (TryGame & { pgn: string })[] = [];
  // At most the three latest months: an inactive account must not cost a
  // request per month of its whole history.
  for (let i = archives.length - 1; i >= Math.max(0, archives.length - 3) && out.length < MAX_GAMES; i--) {
    const games = await getMonth(archives[i]!);
    games.sort((a, b) => b.end_time - a.end_time);
    for (const g of games) {
      const row = chessComRow(g, username);
      if (row) out.push(row);
      if (out.length >= MAX_GAMES) break;
    }
  }
  return out;
}

async function fetchLichessRows(username: string): Promise<(TryGame & { pgn: string })[]> {
  const games = await fetchLichess(username, { max: MAX_GAMES + 5 });
  const out: (TryGame & { pgn: string })[] = [];
  for (const g of games) {
    const row = toImportRow(g, username);
    if (!row) continue;
    const winner = g.winner;
    out.push({
      id: row.external_id, white: row.white, black: row.black,
      white_rating: g.players.white.rating ?? null, black_rating: g.players.black.rating ?? null,
      result: winner === 'white' ? '1-0' : winner === 'black' ? '0-1' : '1/2-1/2',
      time_class: row.time_class, end_time: row.end_time, user_color: row.user_color,
      opening: pgnHeader(row.pgn, 'Opening'), plies: countPlies(row.pgn),
      url: `https://lichess.org/${row.external_id}`, pgn: row.pgn, slug: null,
    });
    if (out.length >= MAX_GAMES) break;
  }
  return out;
}

async function recentGames(site: Site, username: string): Promise<CachedList['games']> {
  const key = `${site}:${username.toLowerCase()}`;
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.games;
  const games = site === 'chesscom' ? await fetchChessCom(username) : await fetchLichessRows(username);
  listCache.set(key, { at: Date.now(), games });
  if (listCache.size > LIST_CACHE_MAX) listCache.delete(listCache.keys().next().value!);
  return games;
}

const USERNAME_RE = /^[A-Za-z0-9_-]{2,40}$/;
const listSchema = z.object({
  site: z.enum(['chesscom', 'lichess']),
  username: z.string().trim().regex(USERNAME_RE),
});

router.get('/games', async (c) => {
  const parsed = listSchema.safeParse({ site: c.req.query('site'), username: c.req.query('username') });
  if (!parsed.success) return c.json({ error: 'invalid_username' }, 400);
  const { site, username } = parsed.data;
  if (site === 'lichess' && !isValidLichessUsername(username)) return c.json({ error: 'invalid_username' }, 400);
  if (!allow(`list:${clientIp(c)}`, 20, 10 * 60_000)) return c.json({ error: 'rate_limited' }, 429);
  try {
    const games = await recentGames(site, username);
    return c.json({
      games: games.map(({ pgn: _pgn, ...g }) => ({ ...g, slug: findTry(site, g.id) })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'not_found') return c.json({ error: 'user_not_found' }, 404);
    if (msg === 'rate_limited') return c.json({ error: 'upstream_busy' }, 503);
    return c.json({ error: 'upstream_error' }, 502);
  }
});

// ---- the analysis queue ----

interface Job {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  site: Site;
  game: TryGame & { pgn: string };
  done: number;
  total: number;
  slug: string | null;
  error: string | null;
  at: number;
}

const jobs = new Map<string, Job>();
const queue: Job[] = [];
let running = false;

function sweepJobs() {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.at > 60 * 60_000 && j.status !== 'running' && j.status !== 'queued') jobs.delete(id);
}

async function pump(): Promise<void> {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  job.status = 'running';
  try {
    // Someone else may have finished the same game while this one waited.
    const already = findTry(job.site, job.game.id);
    if (already) {
      job.slug = already;
    } else {
      const g = job.game;
      const focus: Color = g.user_color ?? 'white';
      const userResult = g.result === '1/2-1/2' ? 'draw'
        : g.result === null ? null
        : (g.result === '1-0') === (focus === 'white') ? 'win' : 'loss';
      const analysis = await analyzePgnFull(g.pgn, config.tryDepth, {
        score: scoreFromResultForUser(userResult, focus),
        userColor: focus,
        opponentRating: focus === 'white' ? g.black_rating : g.white_rating,
        opponentRd: null,
      }, (done, total) => { job.done = done; job.total = total; });
      job.slug = insertShared({
        kind: 'try', site: job.site, external_id: g.id, focus_color: focus,
        white: g.white, black: g.black, white_rating: g.white_rating, black_rating: g.black_rating,
        result: g.result, time_class: g.time_class, end_time: g.end_time, source_url: g.url,
        pgn: cleanPgn(g.pgn), analysis,
      });
    }
    job.status = 'done';
  } catch (err) {
    job.status = 'error';
    job.error = err instanceof Error ? err.message : String(err);
    console.warn('[try] analysis failed:', job.error);
  } finally {
    job.at = Date.now();
    running = false;
    void pump();
  }
}

const analyzeSchema = z.object({
  site: z.enum(['chesscom', 'lichess']),
  username: z.string().trim().regex(USERNAME_RE),
  id: z.string().min(1).max(80),
});

function jobView(j: Job, c: Context) {
  return {
    id: j.id, status: j.status, done: j.done, total: j.total,
    position: j.status === 'queued' ? queue.indexOf(j) + 1 : 0,
    slug: j.slug, url: j.slug ? shareUrl(publicBaseUrl(c), j.slug) : null, error: j.error,
  };
}

router.post('/analyze', async (c) => {
  const parsed = analyzeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const { site, username, id } = parsed.data;

  const cachedSlug = findTry(site, id);
  if (cachedSlug) return c.json({ job: null, slug: cachedSlug, url: shareUrl(publicBaseUrl(c), cachedSlug) });

  let games: CachedList['games'];
  try {
    games = await recentGames(site, username);
  } catch {
    return c.json({ error: 'upstream_error' }, 502);
  }
  const game = games.find((g) => g.id === id);
  if (!game) return c.json({ error: 'not_found' }, 404);
  if (game.plies > MAX_PLIES) return c.json({ error: 'game_too_long' }, 400);
  if (game.plies < 2) return c.json({ error: 'game_too_short' }, 400);

  // The same game already waiting or running: join it instead of queueing twice.
  for (const j of jobs.values()) {
    if (j.site === site && j.game.id === id && (j.status === 'queued' || j.status === 'running')) {
      return c.json({ job: jobView(j, c) });
    }
  }
  if (!allow(`analyze:${clientIp(c)}`, 5, 60 * 60_000)) return c.json({ error: 'rate_limited' }, 429);
  if (queue.length >= QUEUE_MAX) return c.json({ error: 'busy' }, 503);

  sweepJobs();
  const job: Job = {
    id: randomBytes(8).toString('hex'), status: 'queued', site, game,
    done: 0, total: game.plies, slug: null, error: null, at: Date.now(),
  };
  jobs.set(job.id, job);
  queue.push(job);
  void pump();
  return c.json({ job: jobView(job, c) });
});

router.get('/jobs/:id', (c) => {
  const j = jobs.get(c.req.param('id'));
  if (!j) return c.json({ error: 'not_found' }, 404);
  return c.json({ job: jobView(j, c) });
});

export default router;

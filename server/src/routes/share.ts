// Shared reviews: public read by slug (JSON + PNG card), and the owner's
// share / unshare of one of their own analysed games.

import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { publicBaseUrl } from '../publicUrl.js';
import { rowToAnalysis, type AnalysisRow } from './analyze.js';
import { cardSvg, renderCardPng, type CardInput } from '../share/card.js';
import {
  cleanPgn, countView, getShared, insertShared, pgnHeader, resultFromUserSide,
  slugForGame, unshareGame, type SharedReview,
} from '../share/store.js';
import type { Color } from '../types.js';

const router = new Hono();

export function shareUrl(base: string, slug: string): string {
  return `${base}/r/${slug}?utm_source=share`;
}

export function cardInput(r: SharedReview): CardInput {
  return {
    white: r.white, black: r.black, white_rating: r.white_rating, black_rating: r.black_rating,
    result: r.result, time_class: r.time_class, opening_name: r.analysis.opening_name,
    highlights: r.highlights,
  };
}

// The public shape: everything the review page draws, nothing about the
// account that shared it.
export function publicReview(r: SharedReview) {
  return {
    slug: r.slug, kind: r.kind, site: r.site, focus_color: r.focus_color,
    white: r.white, black: r.black, white_rating: r.white_rating, black_rating: r.black_rating,
    result: r.result, time_class: r.time_class, end_time: r.end_time, source_url: r.source_url,
    pgn: r.pgn, analysis: r.analysis, highlights: r.highlights, created_at: r.created_at,
  };
}

// Rendered cards, newest last. A card never changes for a slug, so caching
// it costs nothing in correctness; the cap keeps memory flat.
const pngCache = new Map<string, Buffer>();
const PNG_CACHE_MAX = 200;

router.get('/:slug', (c) => {
  const r = getShared(c.req.param('slug'));
  if (!r) return c.json({ error: 'not_found' }, 404);
  countView(r.slug);
  return c.json({ review: publicReview(r), url: shareUrl(publicBaseUrl(c), r.slug) });
});

router.get('/:slug/card.png', async (c) => {
  const slug = c.req.param('slug');
  const r = getShared(slug);
  if (!r) return c.json({ error: 'not_found' }, 404);
  let png = pngCache.get(slug) ?? null;
  if (!png) {
    png = await renderCardPng(cardInput(r));
    if (!png) {
      return c.body(cardSvg(cardInput(r)), 200, {
        'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400',
      });
    }
    pngCache.set(slug, png);
    if (pngCache.size > PNG_CACHE_MAX) pngCache.delete(pngCache.keys().next().value!);
  }
  return c.body(new Uint8Array(png), 200, {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=86400',
    ...(c.req.query('download') ? { 'Content-Disposition': `attachment; filename="chesspirit-${slug}.png"` } : {}),
  });
});

// ---- owner: share / unshare one of my games ----

interface GameRow {
  id: number; pgn: string; white: string | null; black: string | null; result: string | null;
  user_color: Color | null; time_class: string | null; end_time: string | null; source: string;
  user_rating_before: number | null; opponent_rating_before: number | null;
}

function ownGame(gameId: number, userId: number): GameRow | undefined {
  return db.prepare(`SELECT id, pgn, white, black, result, user_color, time_class, end_time, source,
      user_rating_before, opponent_rating_before FROM games WHERE id = ? AND user_id = ?`).get(gameId, userId) as GameRow | undefined;
}

function sourceUrl(pgn: string): string | null {
  for (const tag of ['Link', 'Site']) {
    const v = pgnHeader(pgn, tag);
    if (v && /^https:\/\/(www\.)?(chess\.com|lichess\.org)\//.test(v)) return v;
  }
  return null;
}

router.get('/game/:id', requireAuth, (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || !ownGame(id, user.id)) return c.json({ error: 'not_found' }, 404);
  const slug = slugForGame(id);
  return c.json({ slug, url: slug ? shareUrl(publicBaseUrl(c), slug) : null });
});

router.post('/game/:id', requireAuth, (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const game = Number.isInteger(id) ? ownGame(id, user.id) : undefined;
  if (!game) return c.json({ error: 'not_found' }, 404);
  const existing = slugForGame(id);
  if (existing) return c.json({ slug: existing, url: shareUrl(publicBaseUrl(c), existing) });

  const row = db.prepare(`SELECT depth, accuracy_white, accuracy_black, estimated_elo_white, estimated_elo_black,
      performance_white, performance_black, opening_eco, opening_name, key_moments_json, phase_split_json, moves_json
      FROM analyses WHERE game_id = ?`).get(id) as AnalysisRow | undefined;
  if (!row) return c.json({ error: 'not_analyzed' }, 409);

  const focus: Color = game.user_color ?? 'white';
  const userRating = game.user_rating_before ?? null;
  const oppRating = game.opponent_rating_before ?? null;
  const pgnWhiteElo = Number(pgnHeader(game.pgn, 'WhiteElo')) || null;
  const pgnBlackElo = Number(pgnHeader(game.pgn, 'BlackElo')) || null;
  const slug = insertShared({
    kind: 'game', game_id: id, user_id: user.id, focus_color: focus,
    white: game.white || pgnHeader(game.pgn, 'White') || 'White',
    black: game.black || pgnHeader(game.pgn, 'Black') || 'Black',
    white_rating: pgnWhiteElo ?? (focus === 'white' ? userRating : oppRating),
    black_rating: pgnBlackElo ?? (focus === 'black' ? userRating : oppRating),
    result: resultFromUserSide(game.result, game.user_color) ?? pgnHeader(game.pgn, 'Result'),
    time_class: game.time_class, end_time: game.end_time, source_url: sourceUrl(game.pgn),
    pgn: cleanPgn(game.pgn), analysis: rowToAnalysis(row),
  });
  return c.json({ slug, url: shareUrl(publicBaseUrl(c), slug) });
});

router.delete('/game/:id', requireAuth, (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'not_found' }, 404);
  const slug = slugForGame(id);
  const removed = unshareGame(id, user.id);
  if (slug) pngCache.delete(slug);
  return c.json({ ok: removed });
});

export default router;

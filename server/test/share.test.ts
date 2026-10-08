import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AnalysisResult, AnalyzedMove, Classification } from '../src/types.js';

const dir = mkdtempSync(join(tmpdir(), 'chesspirit-share-'));
process.env.DB_PATH = join(dir, 'share.db');

type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

function mv(ply: number, san: string, classification: Classification, extra: Partial<AnalyzedMove> = {}): AnalyzedMove {
  return {
    ply, san, uci: 'e2e4', fen_before: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    fen_after: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    eval_before_cp: 0, eval_after_cp: 0, mate_before: null, mate_after: null,
    best_move_uci: 'd2d4', best_move_san: 'd4', best_pv: [], centipawn_loss: 0, classification, ...extra,
  };
}

const analysis: AnalysisResult = {
  depth: 12, accuracy_white: 88.4, accuracy_black: 61.2,
  estimated_elo_white: null, estimated_elo_black: null, performance_white: null, performance_black: null,
  opening_eco: null, opening_name: 'King Pawn', key_moments: [], phase_split: null,
  moves: [
    mv(1, 'e4', 'book'),
    mv(2, 'e5', 'book'),
    mv(3, 'Nf3', 'great'),
    mv(4, 'Qh4', 'mistake', { centipawn_loss: 150 }),
    mv(5, 'Bc4', 'brilliant'),
    mv(6, 'Qxf2', 'blunder', { centipawn_loss: 900, best_move_san: 'Nc6', best_move_uci: 'b8c6' }),
    mv(7, 'Kd1', 'mistake', { centipawn_loss: 120 }),
  ],
};

describe('share highlights', () => {
  it('leads with the brilliant move and the costliest mistake, per side', async () => {
    const { computeHighlights, moveLabel } = await import('../src/share/highlights.js');
    const w = computeHighlights(analysis, 'white');
    expect(w.accuracy).toBe(88.4);
    expect(w.star?.label).toBe('3. Bc4');
    expect(w.star?.classification).toBe('brilliant');
    expect(w.miss?.label).toBe('4. Kd1');
    expect(w.counts).toMatchObject({ brilliant: 1, great: 1, mistake: 1 });

    const b = computeHighlights(analysis, 'black');
    expect(b.star).toBeNull();
    // A blunder outranks a mistake even when the mistake came first.
    expect(b.miss?.label).toBe('3… Qxf2');
    expect(b.miss?.best_san).toBe('Nc6');
    expect(moveLabel(10, 'Rd8')).toBe('5… Rd8');
  });

  it('turns a player-side result into the PGN form', async () => {
    const { resultFromUserSide } = await import('../src/share/store.js');
    expect(resultFromUserSide('win', 'black')).toBe('0-1');
    expect(resultFromUserSide('loss', 'black')).toBe('1-0');
    expect(resultFromUserSide('draw', 'white')).toBe('1/2-1/2');
    expect(resultFromUserSide('1-0', null)).toBe('1-0');
    expect(resultFromUserSide(null, 'white')).toBeNull();
  });
});

describe('share card', () => {
  it('draws an SVG with the names escaped and the watermark', async () => {
    const { cardSvg } = await import('../src/share/card.js');
    const { computeHighlights } = await import('../src/share/highlights.js');
    const svg = cardSvg({
      white: 'A<script>', black: 'B & co', white_rating: 1500, black_rating: null,
      result: '1-0', time_class: 'blitz', opening_name: null, highlights: computeHighlights(analysis, 'white'),
    });
    expect(svg).toContain('A&lt;script&gt;');
    expect(svg).toContain('B &amp; co');
    expect(svg).toContain('chesspirit.app');
    expect(svg).toContain('3. Bc4!!');
  });

  it('renders a PNG', async () => {
    const { renderCardPng } = await import('../src/share/card.js');
    const { computeHighlights } = await import('../src/share/highlights.js');
    const png = await renderCardPng({
      white: 'W', black: 'B', white_rating: null, black_rating: null, result: null,
      time_class: null, opening_name: null, highlights: computeHighlights(analysis, 'black'),
    });
    // resvg may be missing on an exotic platform; then the route serves SVG.
    if (png) expect(png.subarray(1, 4).toString()).toBe('PNG');
  }, 30_000);
});

describe('index.html injection', () => {
  it('adds the analytics tag and OG tags in <head>', async () => {
    const { injectHead, umamiTag, ogTags } = await import('../src/share/html.js');
    expect(umamiTag(null)).toBe('');
    const tag = umamiTag('be82493e-30f2-4af2-b594-977464ad7d34');
    expect(tag).toBe('<script defer src="https://cloud.umami.is/script.js" data-website-id="be82493e-30f2-4af2-b594-977464ad7d34"></script>');
    const html = injectHead('<html><head><title>Chesspirit</title></head><body></body></html>',
      [tag, ogTags({ 'og:title': 'A "quoted" title', 'twitter:card': 'summary' })].join('\n'), 'New <title>');
    expect(html).toContain('<title>New &lt;title&gt;</title>');
    expect(html).toContain('property="og:title" content="A &quot;quoted&quot; title"');
    expect(html).toContain('name="twitter:card"');
    expect(html.indexOf('umami')).toBeLessThan(html.indexOf('</head>'));
  });
});

describe('share routes', () => {
  let share: Router;
  let cookie: string;
  let otherCookie: string;
  let db: typeof import('../src/db.js')['db'];

  beforeAll(async () => {
    ({ db } = await import('../src/db.js'));
    share = (await import('../src/routes/share.js')).default;
    const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
    db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'me', 'x', 'admin'), (2, 'you', 'x', 'user')`).run();
    db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (1, 'Me'), (2, 'You')`).run();
    db.prepare(`INSERT INTO games (id, user_id, source, pgn, white, black, result, user_color)
                VALUES (10, 1, 'imported', '[White "me"]\n[Black "rival"]\n[Result "0-1"]\n\n1. e4 e5 0-1', 'me', 'rival', 'loss', 'white'),
                       (11, 1, 'imported', '1. d4 d5 *', 'me', 'x', NULL, 'white')`).run();
    db.prepare(`INSERT INTO analyses (game_id, depth, accuracy_white, accuracy_black, moves_json) VALUES (10, 12, 88.4, 61.2, ?)`)
      .run(JSON.stringify(analysis.moves));
    cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;
    otherCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(2))}`;
  });

  afterAll(() => {
    try { db.close(); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  });

  it('shares, reads publicly, renders the card and unshares', async () => {
    expect((await share.request('/game/10', { method: 'POST' })).status).toBe(401);
    expect((await share.request('/game/10', { method: 'POST', headers: { Cookie: otherCookie } })).status).toBe(404);
    expect((await share.request('/game/11', { method: 'POST', headers: { Cookie: cookie } })).status).toBe(409);

    const res = await share.request('/game/10', { method: 'POST', headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const { slug, url } = (await res.json()) as { slug: string; url: string };
    expect(url).toMatch(new RegExp(`/r/${slug}\\?utm_source=share$`));

    // Sharing twice keeps one link.
    const again = (await (await share.request('/game/10', { method: 'POST', headers: { Cookie: cookie } })).json()) as { slug: string };
    expect(again.slug).toBe(slug);

    const pub = await share.request(`/${slug}`);
    expect(pub.status).toBe(200);
    const body = (await pub.json()) as { review: Record<string, unknown> };
    expect(body.review.white).toBe('me');
    expect(body.review.result).toBe('0-1');
    expect(body.review).not.toHaveProperty('user_id');
    expect(body.review).not.toHaveProperty('game_id');

    const card = await share.request(`/${slug}/card.png`);
    expect(card.status).toBe(200);
    expect(card.headers.get('content-type')).toMatch(/image\/(png|svg\+xml)/);

    const del = await share.request('/game/10', { method: 'DELETE', headers: { Cookie: cookie } });
    expect(((await del.json()) as { ok: boolean }).ok).toBe(true);
    expect((await share.request(`/${slug}`)).status).toBe(404);
  }, 30_000);

  it('rejects malformed slugs', async () => {
    expect((await share.request('/x')).status).toBe(404);
    expect((await share.request('/aaaaaaa%2F..')).status).toBe(404);
  });
});

describe('try-it helpers', () => {
  it('maps a Chess.com game and limits per address', async () => {
    const { chessComRow, allow } = await import('../src/routes/try.js');
    const row = chessComRow({
      url: 'https://www.chess.com/game/live/123456', pgn: '[ECOUrl "https://www.chess.com/openings/Italian-Game-3...Bc5"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 *',
      time_control: '180', end_time: 1700000000, rated: true, time_class: 'blitz', rules: 'chess',
      white: { username: 'Alice', rating: 1500, result: 'win' },
      black: { username: 'bob', rating: 1480, result: 'resigned' },
    }, 'BOB');
    expect(row?.id).toBe('live/123456');
    expect(row?.user_color).toBe('black');
    expect(row?.result).toBe('1-0');
    expect(row?.plies).toBe(6);
    expect(row?.opening).toBe('Italian Game');

    expect(chessComRow({ ...row!, url: 'x', pgn: '1. e4', time_control: '', end_time: 0, rated: false, time_class: 'blitz', rules: 'chess960',
      white: { username: 'a', rating: 1, result: 'win' }, black: { username: 'b', rating: 1, result: 'lose' } } as never, 'a')).toBeNull();

    const t = 1_000_000;
    expect(allow('k', 2, 1000, t)).toBe(true);
    expect(allow('k', 2, 1000, t + 1)).toBe(true);
    expect(allow('k', 2, 1000, t + 2)).toBe(false);
    expect(allow('k', 2, 1000, t + 1500)).toBe(true);
  });
});

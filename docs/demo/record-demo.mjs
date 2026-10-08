#!/usr/bin/env node
// Records the Chesspirit demo: username → import → graded moves → blunder
// puzzle → share card. Produces
//   demo.gif  — ≤15 s, for the README
//   demo.mp4  — 60–90 s with on-screen captions, for the launch post
//
// Needs Node 20+, ffmpeg, and Playwright with Chromium:
//   npm i -D playwright && npx playwright install chromium
//
// Usage:
//   node docs/demo/record-demo.mjs --mode gif   --base https://chesspirit.app --user hikaru --opponent "SomeOpponent"
//   node docs/demo/record-demo.mjs --mode video --base https://chesspirit.app --user hikaru --opponent "SomeOpponent"
//
// --opponent picks the game row whose text contains it (default: the first
// game not reviewed yet). Use a game with a blunder by --user, so the puzzle
// step has something to show. The long engine wait is sped up in the edit.

import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const MODE = args.mode === 'video' ? 'video' : 'gif';
const BASE = (args.base ?? 'https://chesspirit.app').replace(/\/+$/, '');
const USER = args.user ?? 'hikaru';
const SITE = args.site === 'lichess' ? 'Lichess' : 'Chess.com';
const OPPONENT = args.opponent ?? null;
const OUT = resolve(args.out ?? 'docs/demo');
const W = 1280, H = 720;
const slow = MODE === 'video';
const pause = (ms) => new Promise((r) => setTimeout(r, slow ? ms * 2.2 : ms));

const tmp = join(OUT, `.rec-${MODE}`);
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: W, height: H } }, locale: 'en-US', colorScheme: 'light' });
await ctx.addInitScript(() => { try { localStorage.setItem('lang', 'en'); localStorage.setItem('github.starred', '1'); } catch {} });
const page = await ctx.newPage();
const t0 = Date.now();
const marks = {};
const mark = (k) => { marks[k] = (Date.now() - t0) / 1000; };

async function caption(text) {
  if (!slow) return;
  await page.evaluate((t) => {
    let el = document.getElementById('__demo_caption');
    if (!el) {
      el = document.createElement('div');
      el.id = '__demo_caption';
      el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;background:rgba(38,36,33,.92);color:#fff;font:600 22px/1.3 Inter,system-ui,sans-serif;padding:12px 22px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:80%;text-align:center;pointer-events:none';
      document.body.appendChild(el);
    }
    el.textContent = t;
    el.style.display = t ? 'block' : 'none';
  }, text);
}

async function clickSquare(sq, orientation) {
  const box = await page.locator('cg-board').first().boundingBox();
  const file = sq.charCodeAt(0) - 97, rank = Number(sq[1]) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  const s = box.width / 8;
  await page.mouse.move(box.x + (col + 0.5) * s, box.y + (row + 0.5) * s, { steps: 8 });
  await page.mouse.down();
  await page.mouse.up();
}

// 1. Landing
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await caption('Free chess game reviews, no daily limit');
await pause(2600);

// 2. Username
await caption(`Type any ${SITE} username. No account needed.`);
await page.getByRole('radio', { name: SITE }).click();
await page.getByPlaceholder('Your username').click();
await page.keyboard.type(USER, { delay: slow ? 140 : 70 });
await pause(400);
await page.getByRole('button', { name: 'Find my games' }).click();
await page.getByRole('heading', { name: 'Pick a game' }).waitFor({ timeout: 60_000 });
await caption('Your last ten games, straight from the public API');
await pause(1400);

// 3. Pick a game and wait for the engine
const rows = page.locator('li', { has: page.getByRole('button', { name: /^(Review|Open review)$/ }) });
const row = OPPONENT ? rows.filter({ hasText: OPPONENT }).first() : rows.filter({ has: page.getByRole('button', { name: 'Review', exact: true }) }).first();
await row.getByRole('button', { name: /^(Review|Open review)$/ }).click();
mark('analyzeStart');
await caption('Stockfish grades every move…');
await page.waitForURL(/\/r\/[A-Za-z0-9]+/, { timeout: 300_000 });
mark('analyzeEnd');
await page.locator('cg-board').waitFor();
await pause(300);

// 4. Graded moves
const slug = page.url().split('/r/')[1].split(/[?#]/)[0];
const review = await page.evaluate(async (s) => (await (await fetch(`/api/share/${s}`)).json()).review, slug);
await caption('Every move graded, with accuracy for both players');
await pause(1800);
const steps = slow ? 8 : 4;
for (let i = 0; i < steps; i++) { await page.keyboard.press('ArrowRight'); await pause(650); }
if (slow) {
  await caption('The eval graph shows where the game turned');
  await page.locator('svg').filter({ has: page.locator('path') }).last().hover();
  await pause(1600);
}

// 5. Blunder puzzle
const miss = review.highlights.miss;
if (miss?.best_uci) {
  await caption('Your worst mistake comes back as a puzzle');
  await page.getByRole('button', { name: 'Find the better move' }).click();
  await pause(1300);
  await clickSquare(miss.best_uci.slice(0, 2), review.focus_color);
  await pause(250);
  await clickSquare(miss.best_uci.slice(2, 4), review.focus_color);
  await caption(`Found it: ${miss.best_san}`);
  await pause(1800);
}

// 6. Share card
if (slow) {
  await caption('Share the review: a link and an image card');
  await pause(1200);
  await page.goto(`${BASE}/api/share/${slug}/card.png`);
  await page.evaluate(() => { document.body.style.cssText = 'margin:0;background:#1c1a18;display:grid;place-items:center;height:100vh'; const img = document.querySelector('img'); if (img) img.style.cssText = 'max-width:96vw;max-height:92vh'; });
  await pause(3200);
  await page.goto(BASE + '/');
  await caption('Chesspirit — free, open source, self-hostable. chesspirit.app');
  await pause(3000);
}
mark('end');

await ctx.close();
await browser.close();

const webm = readdirSync(tmp).find((f) => f.endsWith('.webm'));
const raw = join(tmp, webm);
writeFileSync(join(tmp, 'marks.json'), JSON.stringify(marks, null, 2));

// Edit: keep everything, but squeeze the engine wait to ~2.5 s.
const a = marks.analyzeStart + 1.2;
const b = Math.max(a + 0.1, marks.analyzeEnd - 0.4);
const squeeze = Math.max(1, (b - a) / 2.5);
const speed = MODE === 'gif' ? 1.5 : 1;
const filter = [
  `[0:v]trim=0:${a},setpts=(PTS-STARTPTS)/${speed}[v0]`,
  `[0:v]trim=${a}:${b},setpts=(PTS-STARTPTS)/${squeeze * speed}[v1]`,
  `[0:v]trim=${b},setpts=(PTS-STARTPTS)/${speed}[v2]`,
  `[v0][v1][v2]concat=n=3:v=1:a=0[cut]`,
];
function ffmpeg(argv) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...argv], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed');
}
if (MODE === 'video') {
  ffmpeg(['-i', raw, '-filter_complex', filter.join(';'), '-map', '[cut]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', join(tmp, 'demo.mp4')]);
  renameSync(join(tmp, 'demo.mp4'), join(OUT, 'demo.mp4'));
} else {
  const gifFilter = [...filter.slice(0, 3), `[v0][v1][v2]concat=n=3:v=1:a=0,trim=0:15,fps=12,scale=960:-1:flags=lanczos,split[s0][s1]`, '[s0]palettegen=max_colors=128:stats_mode=diff[p]', '[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle'];
  ffmpeg(['-i', raw, '-filter_complex', gifFilter.join(';'), join(tmp, 'demo.gif')]);
  renameSync(join(tmp, 'demo.gif'), join(OUT, 'demo.gif'));
}
rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${join(OUT, MODE === 'video' ? 'demo.mp4' : 'demo.gif')}`, marks);

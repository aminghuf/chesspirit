// The puzzles that ship inside the app: the same set the server bundles
// (server/src/chess/tacticsSet.json — a few thousand Lichess puzzles spread
// over the rating range, CC0), so they are on the phone with nothing to
// download. Progress lives in localStorage; there is no server to sync with.

import raw from '../../../server/src/chess/tacticsSet.json';
import type { LichessPuzzle } from '../lib/puzzle';

// One line per puzzle: id|FEN|moves (UCI, the opponent's move first)|rating|themes
function parse(line: string): LichessPuzzle {
  const [id, fen, moves, rating, themes] = line.split('|');
  return {
    id: id!, fen: fen!, moves: moves!.split(' '), rating: Number(rating),
    popularity: 0, plays: 0, themes: (themes ?? '').split(' ').filter(Boolean),
    game_url: null, opening: null,
  };
}

let cache: LichessPuzzle[] | null = null;
export function allPuzzles(): LichessPuzzle[] {
  if (!cache) cache = (raw as { puzzles: string[] }).puzzles.map(parse);
  return cache;
}

export interface PuzzleProgress { rating: number; solved: number; played: number; seen: string[] }

const KEY = 'offline.puzzles';
const START: PuzzleProgress = { rating: 1200, solved: 0, played: 0, seen: [] };

export function loadProgress(): PuzzleProgress {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PuzzleProgress> | null;
    if (v && typeof v.rating === 'number' && Array.isArray(v.seen)) return { ...START, ...v } as PuzzleProgress;
  } catch { /* fall through */ }
  return { ...START };
}

export function saveProgress(p: PuzzleProgress) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** Plain Elo against the puzzle's rating; the first try at a puzzle counts. */
export function rate(p: PuzzleProgress, puzzle: LichessPuzzle, solved: boolean): PuzzleProgress {
  const expected = 1 / (1 + 10 ** ((puzzle.rating - p.rating) / 400));
  const k = p.played < 20 ? 48 : 24; // settle quickly, then steady
  return {
    rating: Math.max(400, Math.round(p.rating + k * ((solved ? 1 : 0) - expected))),
    solved: p.solved + (solved ? 1 : 0),
    played: p.played + 1,
    seen: [...p.seen, puzzle.id],
  };
}

/** A puzzle not seen yet, as close to the player's rating as the set allows:
 *  the window widens until something is left. Null once every one is done. */
export function nextPuzzle(p: PuzzleProgress, rnd: () => number = Math.random): LichessPuzzle | null {
  const seen = new Set(p.seen);
  const fresh = allPuzzles().filter((x) => !seen.has(x.id));
  if (fresh.length === 0) return null;
  for (let window = 100; ; window *= 2) {
    const near = fresh.filter((x) => Math.abs(x.rating - p.rating) <= window);
    if (near.length > 0) return near[Math.floor(rnd() * near.length)]!;
    if (window > 4000) return fresh[Math.floor(rnd() * fresh.length)]!;
  }
}

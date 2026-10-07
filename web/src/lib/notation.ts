// Pure helpers for Train → Coordinates and Train → Notation.

import { Chess, type Move } from 'chess.js';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

/** The 64 square names in display order (top-left first) for a board seen
 *  from `side`. */
export function squaresFor(side: 'white' | 'black'): string[] {
  const out: string[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const file = side === 'white' ? col : 7 - col;
      const rank = side === 'white' ? 8 - row : row + 1;
      out.push(FILES[file]! + rank);
    }
  }
  return out;
}

/** A random square, never the one just asked. */
export function randomSquare(not?: string, rnd: () => number = Math.random): string {
  for (;;) {
    const sq = FILES[Math.floor(rnd() * 8)]! + (Math.floor(rnd() * 8) + 1);
    if (sq !== not) return sq;
  }
}

/** A written move reduced to what has to be right: no spaces, no check, mate
 *  or annotation marks, castling with zeros or small o's spelled O-O, and a
 *  promotion with or without the "=". Case is kept — "Bc4" and "bc4" differ. */
export function normalizeSan(input: string): string {
  const s = input.trim().replace(/\s+/g, '').replace(/[+#!?]+$/g, '');
  if (/^[0oO]-[0oO]-[0oO]$/.test(s)) return 'O-O-O';
  if (/^[0oO]-[0oO]$/.test(s)) return 'O-O';
  return s.replace('=', '');
}

export type SanVerdict = 'right' | 'case' | 'wrong';

/** 'case' = right letters, wrong capitals (e.g. "nf3" for Nf3) — worth its
 *  own hint rather than a bare "wrong". */
export function checkSan(input: string, san: string): SanVerdict {
  const a = normalizeSan(input), b = normalizeSan(san);
  if (a === '') return 'wrong';
  if (a === b) return 'right';
  return a.toLowerCase() === b.toLowerCase() ? 'case' : 'wrong';
}

/** A random legal move, leaning towards the ones that are harder to write:
 *  captures, checks, castling and promotions. Null when the game is over. */
export function pickMove(chess: Chess, rnd: () => number = Math.random): Move | null {
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return null;
  const weight = (m: Move) =>
    1 + (m.captured ? 2 : 0) + (/[+#]/.test(m.san) ? 2 : 0) + (m.san.startsWith('O-O') ? 6 : 0) + (m.promotion ? 4 : 0);
  let roll = rnd() * moves.reduce((sum, m) => sum + weight(m), 0);
  for (const m of moves) {
    roll -= weight(m);
    if (roll <= 0) return m;
  }
  return moves[moves.length - 1]!;
}

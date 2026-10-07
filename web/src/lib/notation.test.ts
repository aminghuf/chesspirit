import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { checkSan, normalizeSan, pickMove, randomSquare, squaresFor } from './notation';

describe('squaresFor', () => {
  it('starts at a8 for White and h1 for Black', () => {
    const w = squaresFor('white'), b = squaresFor('black');
    expect([w[0], w[7], w[56], w[63]]).toEqual(['a8', 'h8', 'a1', 'h1']);
    expect([b[0], b[7], b[56], b[63]]).toEqual(['h1', 'a1', 'h8', 'a8']);
    expect(new Set(w).size).toBe(64);
  });
});

describe('randomSquare', () => {
  it('never repeats the square it was told to avoid', () => {
    for (let i = 0; i < 200; i++) expect(randomSquare('e4')).not.toBe('e4');
  });
});

describe('checkSan', () => {
  it('accepts a move with or without its check and mate marks', () => {
    expect(checkSan('Qxe4', 'Qxe4+')).toBe('right');
    expect(checkSan(' Rd8# ', 'Rd8#')).toBe('right');
    expect(checkSan('c4', 'c4')).toBe('right');
  });

  it('accepts castling written with zeros or small letters', () => {
    expect(checkSan('0-0', 'O-O')).toBe('right');
    expect(checkSan('o-o-o', 'O-O-O+')).toBe('right');
    expect(normalizeSan('0-0-0')).toBe('O-O-O');
  });

  it('accepts a promotion without the equals sign', () => {
    expect(checkSan('e8Q', 'e8=Q+')).toBe('right');
  });

  it('tells wrong capitals apart from a wrong move', () => {
    expect(checkSan('nf3', 'Nf3')).toBe('case');
    expect(checkSan('E4', 'e4')).toBe('case');
    expect(checkSan('Nf6', 'Nf3')).toBe('wrong');
    expect(checkSan('', 'Nf3')).toBe('wrong');
  });
});

describe('pickMove', () => {
  it('returns a legal move, and null when the game is over', () => {
    const chess = new Chess();
    const m = pickMove(chess)!;
    expect(chess.moves()).toContain(m.san);
    expect(pickMove(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))).toBeNull();
  });
});

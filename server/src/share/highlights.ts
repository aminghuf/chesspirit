// What a shared review leads with: the moments a share card and the public
// review page put up front. Pure functions over an analysis, so the card, the
// page and the tests all agree on which move is "the !! moment".

import type { AnalysisResult, AnalyzedMove, Classification, Color } from '../types.js';

export interface Highlight {
  ply: number;
  /** "23. Nxf7" / "23… Nxf7" — move number plus SAN. */
  label: string;
  san: string;
  uci: string;
  classification: Classification;
  fen_before: string;
  fen_after: string;
}

export interface Miss {
  ply: number;
  label: string;
  san: string;
  classification: Classification;
  /** The engine's move in the same position. */
  best_san: string | null;
  best_uci: string | null;
  fen_before: string;
}

export interface ShareHighlights {
  focus: Color;
  accuracy: number;
  opponent_accuracy: number;
  /** Brilliant if there is one, else a Great move, else null. */
  star: Highlight | null;
  /** The focus side's costliest mistake, with the move the engine wanted. */
  miss: Miss | null;
  counts: Record<'brilliant' | 'great' | 'best' | 'mistake' | 'miss' | 'blunder', number>;
}

export function sideOfPly(ply: number): Color {
  return ply % 2 === 1 ? 'white' : 'black';
}

export function moveLabel(ply: number, san: string): string {
  const n = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${n}. ${san}` : `${n}… ${san}`;
}

const BAD: Classification[] = ['blunder', 'miss', 'mistake'];

function toHighlight(m: AnalyzedMove): Highlight {
  return {
    ply: m.ply, label: moveLabel(m.ply, m.san), san: m.san, uci: m.uci,
    classification: m.classification, fen_before: m.fen_before, fen_after: m.fen_after,
  };
}

export function computeHighlights(analysis: Pick<AnalysisResult, 'moves' | 'accuracy_white' | 'accuracy_black'>, focus: Color): ShareHighlights {
  const mine = analysis.moves.filter((m) => sideOfPly(m.ply) === focus);
  const counts = { brilliant: 0, great: 0, best: 0, mistake: 0, miss: 0, blunder: 0 };
  for (const m of mine) {
    if (m.classification in counts) counts[m.classification as keyof typeof counts]++;
  }

  const star = mine.find((m) => m.classification === 'brilliant')
    ?? mine.find((m) => m.classification === 'great')
    ?? null;

  // Costliest = worst class first (blunder/miss over mistake), then the
  // biggest centipawn loss. A puzzle needs the engine's move, so skip any
  // ply that has none.
  const rank = (c: Classification) => (c === 'blunder' || c === 'miss' ? 2 : c === 'mistake' ? 1 : 0);
  const miss = mine
    .filter((m) => BAD.includes(m.classification) && m.best_move_uci)
    .sort((a, b) => rank(b.classification) - rank(a.classification) || b.centipawn_loss - a.centipawn_loss)[0] ?? null;

  return {
    focus,
    accuracy: focus === 'white' ? analysis.accuracy_white : analysis.accuracy_black,
    opponent_accuracy: focus === 'white' ? analysis.accuracy_black : analysis.accuracy_white,
    star: star ? toHighlight(star) : null,
    miss: miss
      ? {
          ply: miss.ply, label: moveLabel(miss.ply, miss.san), san: miss.san,
          classification: miss.classification, best_san: miss.best_move_san,
          best_uci: miss.best_move_uci, fen_before: miss.fen_before,
        }
      : null,
    counts,
  };
}

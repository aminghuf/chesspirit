// Shapes of the public share / try-it API (server/src/routes/share.ts, try.ts).
import type { AnalysisResult, Classification } from '../types';

export interface ShareHighlight {
  ply: number;
  label: string;
  san: string;
  uci: string;
  classification: Classification;
  fen_before: string;
  fen_after: string;
}

export interface ShareMiss {
  ply: number;
  label: string;
  san: string;
  classification: Classification;
  best_san: string | null;
  best_uci: string | null;
  fen_before: string;
}

export interface ShareHighlights {
  focus: 'white' | 'black';
  accuracy: number;
  opponent_accuracy: number;
  star: ShareHighlight | null;
  miss: ShareMiss | null;
  counts: Record<'brilliant' | 'great' | 'best' | 'mistake' | 'miss' | 'blunder', number>;
}

export interface SharedReview {
  slug: string;
  kind: 'game' | 'try';
  site: 'chesscom' | 'lichess' | null;
  focus_color: 'white' | 'black';
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

export interface TryGame {
  id: string;
  white: string;
  black: string;
  white_rating: number | null;
  black_rating: number | null;
  result: string | null;
  time_class: string | null;
  end_time: string;
  user_color: 'white' | 'black' | null;
  opening: string | null;
  plies: number;
  url: string | null;
  slug: string | null;
}

export interface TryJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  done: number;
  total: number;
  position: number;
  slug: string | null;
  url: string | null;
  error: string | null;
}

export const cardUrl = (slug: string) => `/api/share/${slug}/card.png`;

/** '1-0' → '1–0', '1/2-1/2' → '½–½'. */
export function formatResult(r: string | null): string {
  if (r === '1-0') return '1–0';
  if (r === '0-1') return '0–1';
  if (r === '1/2-1/2') return '½–½';
  return '';
}

/** Does `uci` play the engine's move? Promotion letter optional when absent from the answer. */
export function sameMove(uci: string, best: string | null): boolean {
  if (!best) return false;
  return uci === best || (best.length === 4 && uci.slice(0, 4) === best);
}

export { copyText } from './clipboard';

// Train → Notation. A move is played on the board and you write it down the
// way a scoresheet has it: c4, Qe4, Nxf7+, O-O. The moves come from a random
// playout (lib/notation.ts leans it towards captures, checks, castling and
// promotions) — the positions make no chess sense, which is fine: the only
// thing being trained is reading a move off the board.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import { ArrowRight, Check, Eye, FlipVertical2, X } from 'lucide-react';
import ChessBoard from './ChessBoard';
import { checkSan, pickMove } from '../lib/notation';
import { useAuth } from '../state/auth';
import { cn } from '../lib/utils';

// A fresh game after this many half-moves, before the board gets too bare.
const MAX_PLIES = 60;
const BEST_KEY = 'train.notation.bestStreak';

interface Shown { fen: string; san: string; from: Key; to: Key; mover: 'white' | 'black' }

function readBest(): number {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}

export default function NotationTrainer() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const gameRef = useRef(new Chess());
  const [shown, setShown] = useState<Shown | null>(null);
  const [input, setInput] = useState('');
  // null while the move is still to be written.
  const [result, setResult] = useState<null | 'right' | 'case' | 'wrong' | 'shown'>(null);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [correct, setCorrect] = useState(0);
  const [total, setTotal] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(readBest);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function advance() {
    let chess = gameRef.current;
    if (chess.isGameOver() || chess.history().length >= MAX_PLIES) {
      chess = gameRef.current = new Chess();
    }
    const move = pickMove(chess)!;
    const mover = chess.turn() === 'w' ? 'white' : 'black';
    chess.move(move.san);
    setShown({ fen: chess.fen(), san: move.san, from: move.from as Key, to: move.to as Key, mover });
    setInput('');
    setResult(null);
  }

  useEffect(() => { advance(); }, []);
  useEffect(() => { if (result === null) inputRef.current?.focus(); }, [result, shown]);

  // A right answer moves on by itself; a wrong one waits to be read.
  useEffect(() => {
    if (result !== 'right') return;
    const id = setTimeout(advance, 700);
    return () => clearTimeout(id);
  }, [result]);

  function settle(verdict: 'right' | 'case' | 'wrong' | 'shown') {
    setResult(verdict);
    setTotal((n) => n + 1);
    if (verdict === 'right') {
      setCorrect((n) => n + 1);
      const next = streak + 1;
      setStreak(next);
      if (next > best) {
        setBest(next);
        try { localStorage.setItem(BEST_KEY, String(next)); } catch { /* ignore */ }
      }
    } else {
      setStreak(0);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!shown) return;
    if (result !== null) { if (result !== 'right') advance(); return; }
    if (input.trim() === '') return;
    settle(checkSan(input, shown.san));
  }

  // Stable identities, or the board would re-sync on every keystroke.
  const lastMove = useMemo<[Key, Key] | undefined>(() => (shown ? [shown.from, shown.to] : undefined), [shown]);
  const arrows = useMemo(() => (shown ? [{ orig: shown.from, dest: shown.to, brush: 'paleBlue' }] : []), [shown]);

  if (!shown) return null;
  const answered = result !== null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className={`mx-auto w-full lg:max-w-[640px] lg:flex-1 board-theme-${user?.profile.board_theme ?? 'green'}`}>
        <div className="mb-2 flex items-center justify-between rounded-md bg-white px-3 py-2 text-xs shadow-soft dark:bg-chesscom-800">
          <span className="font-medium text-chesscom-700 dark:text-chesscom-200">
            {shown.mover === 'white' ? t('train.notation.whitePlayed') : t('train.notation.blackPlayed')}
          </span>
          <button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} className="btn-ghost p-1" title={t('train.notation.flip')}>
            <FlipVertical2 className="h-4 w-4" />
          </button>
        </div>
        <ChessBoard
          fen={shown.fen}
          orientation={orientation}
          lastMove={lastMove}
          arrows={arrows}
        />
      </div>

      <aside className="space-y-3 lg:w-[340px]">
        <form onSubmit={submit} className="card p-4">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            readOnly={answered}
            dir="ltr"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('train.notation.placeholder')}
            className={cn('input font-mono text-2xl', result === 'right' && 'border-board-dark', answered && result !== 'right' && 'border-mistake')}
          />

          {result === 'right' && (
            <div className="mt-3 flex items-center gap-2 text-sm font-semibold">
              <Check className="h-4 w-4 text-board-dark" /> {t('train.notation.correct')} <span className="font-mono" dir="ltr">{shown.san}</span>
            </div>
          )}
          {answered && result !== 'right' && (
            <div className="mt-3 text-sm">
              <div className="flex items-center gap-2 font-semibold">
                <X className="h-4 w-4 shrink-0 text-mistake" />
                <span>{result === 'shown' ? t('train.notation.answer') : t('train.notation.wrong')} <span className="font-mono" dir="ltr">{shown.san}</span></span>
              </div>
              {result === 'case' && <p className="mt-1 text-xs text-chesscom-500">{t('train.notation.caseHint')}</p>}
            </div>
          )}

          <div className="mt-3 flex gap-2">
            {!answered ? (
              <>
                <button type="button" onClick={() => settle('shown')} className="btn-secondary flex-1 text-sm">
                  <Eye className="h-4 w-4" /> {t('train.notation.showAnswer')}
                </button>
                <button type="submit" className="btn-primary flex-1 text-sm">{t('train.notation.check')}</button>
              </>
            ) : result !== 'right' && (
              <button type="submit" className="btn-primary flex-1 text-sm">
                {t('train.notation.next')} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </button>
            )}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Stat label={t('train.notation.score')} value={`${correct}/${total}`} tone="text-board-dark" />
            <Stat label={t('train.notation.streak')} value={streak} />
            <Stat label={t('train.notation.bestStreak')} value={best} />
          </div>
        </form>

        <div className="card p-4">
          <div className="text-[11px] uppercase tracking-wider text-chesscom-500">{t('train.notation.legendTitle')}</div>
          <ul className="mt-2 space-y-1.5 text-xs text-chesscom-600 dark:text-chesscom-300">
            <li>{t('train.notation.legendPieces')}</li>
            <li>{t('train.notation.legendCapture')}</li>
            <li>{t('train.notation.legendCheck')}</li>
            <li>{t('train.notation.legendCastle')}</li>
            <li>{t('train.notation.legendPromo')}</li>
            <li>{t('train.notation.legendDisambig')}</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="leading-tight">
      <div className="text-[10px] uppercase tracking-wide text-chesscom-400">{label}</div>
      <div className={cn('font-mono text-lg font-semibold tabular-nums', tone ?? 'text-chesscom-700 dark:text-chesscom-200')}>{value}</div>
    </div>
  );
}

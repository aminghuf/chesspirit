// Puzzles from the set bundled with the app (puzzleSet.ts), picked near the
// player's own rating, which moves with the first try at each one — the same
// rules as the Puzzles page, minus the server.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, Eye, RotateCcw, SkipForward, Trophy, X } from 'lucide-react';
import ChessBoard from '../components/ChessBoard';
import { judgeMove, puzzleStart, solutionLine, solverColor, type LichessPuzzle, type PuzzlePosition } from '../lib/puzzle';
import { soundForMove } from '../lib/sounds';
import { loadProgress, nextPuzzle, rate, saveProgress, type PuzzleProgress } from './puzzleSet';

type Status = 'solving' | 'solved' | 'revealed';

export default function OfflinePuzzles() {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<PuzzleProgress>(loadProgress);
  const [puzzle, setPuzzle] = useState<LichessPuzzle | null>(() => nextPuzzle(loadProgress()));
  const [pos, setPos] = useState<PuzzlePosition | null>(() => (puzzle ? puzzleStart(puzzle) : null));
  const [status, setStatus] = useState<Status>('solving');
  // Whether this puzzle has been counted yet: the first try is what rates.
  const [rated, setRated] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const timers = useRef<number[]>([]);

  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  const clearTimers = () => { timers.current.forEach((h) => window.clearTimeout(h)); timers.current = []; };
  useEffect(() => clearTimers, []);

  function commit(next: PuzzleProgress) { setProgress(next); saveProgress(next); }

  function count(solved: boolean) {
    if (rated || !puzzle) return;
    setRated(true);
    commit(rate(progress, puzzle, solved));
  }

  function load(from: PuzzleProgress) {
    clearTimers();
    const p = nextPuzzle(from);
    setPuzzle(p);
    setPos(p ? puzzleStart(p) : null);
    setStatus('solving'); setRated(false); setWrong(false);
    setResetKey((k) => k + 1);
  }

  function next() {
    // A puzzle left unrated (skipped) is still marked as seen, so it doesn't
    // come straight back.
    const base = !rated && puzzle ? { ...progress, seen: [...progress.seen, puzzle.id] } : progress;
    if (base !== progress) commit(base);
    load(base);
  }

  function onMove(uci: string) {
    if (!puzzle || !pos || status !== 'solving') return;
    const verdict = judgeMove(puzzle, pos, uci);
    if (verdict.kind === 'wrong') {
      count(false);
      setWrong(true);
      setResetKey((k) => k + 1);
      return;
    }
    setWrong(false);
    soundForMove({});
    if (verdict.kind === 'solved') {
      setPos(verdict.position);
      setStatus('solved');
      count(true);
      return;
    }
    // Your move first, then the opponent's reply a moment later.
    setPos(verdict.afterMove);
    later(() => { setPos(verdict.position); soundForMove({}); }, 450);
  }

  function reveal() {
    if (!puzzle || !pos) return;
    count(false);
    setStatus('revealed'); setWrong(false);
    solutionLine(puzzle, pos).forEach((step, i) => later(() => { setPos(step); soundForMove({}); }, 600 * (i + 1)));
  }

  function resetAll() {
    const fresh: PuzzleProgress = { ...progress, seen: [] };
    commit(fresh);
    load(fresh);
  }

  const stats = (
    <div className="flex items-center gap-4 rounded-md bg-white px-3 py-2 text-sm shadow-soft dark:bg-chesscom-800">
      <span><span className="text-chesscom-500">{t('puzzles.rating')}</span> <span className="font-mono font-semibold tabular-nums">{progress.rating}</span></span>
      <span className="ms-auto"><span className="text-chesscom-500">{t('puzzles.solved')}</span> <span className="font-mono font-semibold tabular-nums">{progress.solved}/{progress.played}</span></span>
    </div>
  );

  if (!puzzle || !pos) {
    return (
      <div className="space-y-3">
        {stats}
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <Trophy className="h-8 w-8 text-gold-500" />
          <div className="font-semibold">{t('offline.puzzlesDone')}</div>
          <button onClick={resetAll} className="btn-secondary text-sm"><RotateCcw className="h-4 w-4" /> {t('offline.puzzlesAgain')}</button>
        </div>
      </div>
    );
  }

  const solver = solverColor(puzzle);
  const turn = pos.fen.split(' ')[1] === 'w' ? 'white' : 'black';

  return (
    <div className="space-y-3">
      {stats}

      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{solver === 'white' ? t('puzzles.findWhite') : t('puzzles.findBlack')}</span>
        <span className="text-xs text-chesscom-500">{t('puzzles.puzzleRating', { n: puzzle.rating })}</span>
      </div>

      <div className="relative aspect-square w-full board-theme-green">
        <ChessBoard fen={pos.fen} orientation={solver} turnColor={turn}
          movable={status === 'solving' && turn === solver} onMove={onMove}
          lastMove={(pos.lastMove ?? undefined) as never} resetKey={resetKey} />
      </div>

      <div className="flex min-h-[2.5rem] items-center gap-2 text-sm font-medium">
        {status === 'solved' && <><Check className="h-4 w-4 text-board-dark" /> {t('puzzles.solvedMsg')}</>}
        {status === 'revealed' && <><Eye className="h-4 w-4 text-chesscom-400" /> {t('puzzles.revealedMsg')}</>}
        {status === 'solving' && wrong && <><X className="h-4 w-4 text-mistake" /> {t('puzzles.wrongMsg')}</>}
        {status === 'solving' && !wrong && <span className="text-chesscom-500">{t('puzzles.yourTurn')}</span>}
      </div>

      <div className="flex gap-2">
        {status === 'solving' ? (
          <>
            <button onClick={reveal} className="btn-secondary flex-1 text-sm"><Eye className="h-4 w-4" /> {t('puzzles.viewSolution')}</button>
            <button onClick={next} className="btn-ghost flex-1 text-sm"><SkipForward className="h-4 w-4 rtl:rotate-180" /> {t('puzzles.skip')}</button>
          </>
        ) : (
          <button onClick={next} className="btn-primary flex-1 text-sm">{t('puzzles.next')} <ArrowRight className="h-4 w-4 rtl:rotate-180" /></button>
        )}
      </div>
    </div>
  );
}

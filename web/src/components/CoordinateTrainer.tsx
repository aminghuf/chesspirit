// Train → Coordinates. Thirty seconds of "where is e4?" in two directions:
// a square's name is shown and you click it, or a square lights up and you
// type its name. The board is a plain grid rather than chessground — there are
// no pieces, and every square (empty or not) has to be clickable.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, RotateCcw, Trophy } from 'lucide-react';
import { randomSquare, squaresFor } from '../lib/notation';
import { cn } from '../lib/utils';

type Mode = 'find' | 'name';
type Side = 'white' | 'black';

const ROUND_SECONDS = 30;
const bestKey = (mode: Mode) => `train.coords.best.${mode}`;

function readBest(mode: Mode): number {
  try { return Number(localStorage.getItem(bestKey(mode))) || 0; } catch { return 0; }
}

export default function CoordinateTrainer() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('find');
  const [side, setSide] = useState<Side>('white');
  const [showCoords, setShowCoords] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [target, setTarget] = useState('e4');
  const [score, setScore] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [best, setBest] = useState(() => readBest('find'));
  const [newBest, setNewBest] = useState(false);
  // The square just answered and whether it was right — a short flash.
  const [flash, setFlash] = useState<{ square: string; ok: boolean } | null>(null);
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { setBest(readBest(mode)); }, [mode]);

  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'running' || timeLeft > 0) return;
    setPhase('done');
    if (score > best) {
      setBest(score);
      setNewBest(true);
      try { localStorage.setItem(bestKey(mode), String(score)); } catch { /* ignore */ }
    }
  }, [phase, timeLeft, score, best, mode]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 350);
    return () => clearTimeout(id);
  }, [flash]);

  useEffect(() => {
    if (phase === 'running' && mode === 'name') inputRef.current?.focus();
  }, [phase, mode, target]);

  function start() {
    setScore(0);
    setMistakes(0);
    setNewBest(false);
    setTyped('');
    setFlash(null);
    setTimeLeft(ROUND_SECONDS);
    setTarget((prev) => randomSquare(prev));
    setPhase('running');
  }

  function answer(square: string) {
    if (phase !== 'running') return;
    const ok = square === target;
    // 'find' flashes the square you clicked; 'name' flashes the one asked.
    setFlash({ square: mode === 'find' ? square : target, ok });
    if (ok) {
      setScore((s) => s + 1);
      setTarget((prev) => randomSquare(prev));
    } else {
      setMistakes((m) => m + 1);
    }
  }

  function onType(value: string) {
    const v = value.trim().toLowerCase().slice(0, 2);
    if (v.length < 2) { setTyped(v); return; }
    setTyped('');
    answer(v);
  }

  function changeMode(next: Mode) {
    setMode(next);
    setPhase('idle');
    setTimeLeft(ROUND_SECONDS);
  }

  const squares = squaresFor(side);
  const running = phase === 'running';
  const pill = (active: boolean) => cn(
    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    active ? 'bg-chesscom-900 text-white dark:bg-chesscom-100 dark:text-chesscom-900' : 'text-chesscom-600 hover:bg-chesscom-100 dark:text-chesscom-300 dark:hover:bg-chesscom-800',
  );

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="mx-auto w-full lg:max-w-[560px] lg:flex-1">
        {/* Files a–h always run left to right, whatever the page's direction. */}
        <div className="relative grid aspect-square w-full grid-cols-8 overflow-hidden rounded-md shadow-board" dir="ltr">
          {squares.map((sq, i) => {
            const dark = ((i % 8) + Math.floor(i / 8)) % 2 === 1;
            const asked = running && mode === 'name' && sq === target;
            const flashed = flash?.square === sq;
            return (
              <button
                key={sq}
                type="button"
                disabled={!running || mode !== 'find'}
                onClick={() => answer(sq)}
                aria-label={mode === 'find' && !showCoords ? undefined : sq}
                className={cn(
                  'relative transition-colors duration-150',
                  dark ? 'bg-board-dark' : 'bg-board-light',
                  running && mode === 'find' && 'cursor-pointer hover:brightness-110',
                  asked && !flashed && 'bg-gold-500',
                  flashed && (flash.ok ? 'bg-green-400' : 'bg-mistake'),
                )}
              >
                {showCoords && i % 8 === 0 && (
                  <span className={cn('absolute start-1 top-0.5 text-[10px] font-semibold', dark ? 'text-board-light' : 'text-board-dark')}>{sq[1]}</span>
                )}
                {showCoords && i >= 56 && (
                  <span className={cn('absolute bottom-0.5 end-1 text-[10px] font-semibold', dark ? 'text-board-light' : 'text-board-dark')}>{sq[0]}</span>
                )}
              </button>
            );
          })}
          {running && mode === 'find' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="font-mono text-7xl font-bold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.65)] sm:text-8xl">{target}</span>
            </div>
          )}
          {!running && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-chesscom-900/55 p-4 text-center text-white">
              {phase === 'done' && (
                <>
                  <Trophy className="h-8 w-8 text-gold-500" />
                  <div className="text-lg font-semibold">{t('train.coords.done')}</div>
                  <div className="text-sm">{t('train.coords.doneScore', { score })}</div>
                  {newBest && <div className="text-sm font-semibold text-gold-500">{t('train.coords.newBest')}</div>}
                </>
              )}
              <button onClick={start} className="btn-primary">
                {phase === 'done' ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {phase === 'done' ? t('train.coords.again') : t('train.coords.start')}
              </button>
            </div>
          )}
        </div>
      </div>

      <aside className="space-y-3 lg:w-[340px]">
        <div className="card p-4">
          <div className="text-[11px] uppercase tracking-wider text-chesscom-500">
            {mode === 'find' ? t('train.coords.taskFind') : t('train.coords.taskName')}
          </div>
          {mode === 'find' ? (
            <div className="mt-1 font-mono text-4xl font-bold tabular-nums" dir="ltr">{running ? target : '–'}</div>
          ) : (
            <input
              ref={inputRef}
              value={typed}
              onChange={(e) => onType(e.target.value)}
              disabled={!running}
              maxLength={2}
              dir="ltr"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('train.coords.inputPlaceholder')}
              className="input mt-2 font-mono text-2xl"
            />
          )}
          <div className="mt-4 grid grid-cols-4 gap-2 text-center">
            <Stat label={t('train.coords.time')} value={`${Math.max(0, timeLeft)}s`} tone={running && timeLeft <= 5 ? 'text-mistake' : undefined} />
            <Stat label={t('train.coords.score')} value={score} tone="text-board-dark" />
            <Stat label={t('train.coords.mistakes')} value={mistakes} />
            <Stat label={t('train.coords.best')} value={best} />
          </div>
        </div>

        <div className="card space-y-3 p-4">
          <div className="flex flex-wrap gap-1">
            <button onClick={() => changeMode('find')} className={pill(mode === 'find')}>{t('train.coords.modeFind')}</button>
            <button onClick={() => changeMode('name')} className={pill(mode === 'name')}>{t('train.coords.modeName')}</button>
          </div>
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setSide('white')} className={pill(side === 'white')}>{t('train.coords.sideWhite')}</button>
            <button onClick={() => setSide('black')} className={pill(side === 'black')}>{t('train.coords.sideBlack')}</button>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-chesscom-600 dark:text-chesscom-300">
            <input type="checkbox" checked={showCoords} onChange={(e) => setShowCoords(e.target.checked)} />
            {t('train.coords.showCoords')}
          </label>
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

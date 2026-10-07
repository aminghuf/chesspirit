// A game against Stockfish running on the device. Eight levels (engine.ts),
// either colour, take-backs, and the game survives closing the app.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chess } from 'chess.js';
import { FlipVertical2, Loader2, Microscope, Play, RotateCcw, Undo2 } from 'lucide-react';
import ChessBoard from '../components/ChessBoard';
import { inferMoveFlagsFromSan, soundForMove, unlockAudio } from '../lib/sounds';
import { engine, LEVELS } from './engine';
import { go } from './OfflineApp';

type Side = 'white' | 'black';
interface Game { fens: string[]; sans: string[]; lastMoves: ([string, string] | null)[]; player: Side; level: number }

const KEY = 'offline.game';

function loadGame(): Game | null {
  try {
    const g = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Game | null;
    if (g && Array.isArray(g.fens) && g.fens.length > 0 && Array.isArray(g.sans) && Array.isArray(g.lastMoves)) return g;
  } catch { /* fall through */ }
  return null;
}

export default function OfflinePlay() {
  const { t } = useTranslation();
  const [game, setGame] = useState<Game | null>(loadGame);
  const [color, setColor] = useState<Side | 'random'>('white');
  const [level, setLevel] = useState(() => loadGame()?.level ?? 2);
  const [flipped, setFlipped] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    try {
      if (game) localStorage.setItem(KEY, JSON.stringify(game));
      else localStorage.removeItem(KEY);
    } catch { /* ignore */ }
  }, [game]);
  useEffect(() => () => engine.stop(), []);

  const fen = game ? game.fens[game.fens.length - 1]! : new Chess().fen();
  const chess = useMemo(() => new Chess(fen), [fen]);
  const turn: Side = chess.turn() === 'w' ? 'white' : 'black';
  const over = chess.isGameOver();
  const playersTurn = !!game && !over && turn === game.player;

  function push(g: Game, uci: string): Game | null {
    const c = new Chess(g.fens[g.fens.length - 1]!);
    try {
      const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
      soundForMove(inferMoveFlagsFromSan(m.san));
      return { ...g, fens: [...g.fens, c.fen()], sans: [...g.sans, m.san], lastMoves: [...g.lastMoves, [m.from, m.to]] };
    } catch { return null; }
  }

  // The engine's turn: ask for a move and play it — unless the position moved
  // on in the meantime (a take-back, a new game).
  const latest = useRef(fen);
  latest.current = fen;
  useEffect(() => {
    if (!game || over || turn === game.player) { setThinking(false); return; }
    setThinking(true); setFailed(false);
    let alive = true;
    // A beat before answering, so the reply doesn't land on top of your move.
    const handle = window.setTimeout(() => {
      engine.move(fen, LEVELS[game.level] ?? LEVELS[2]!)
        .then((r) => {
          if (!alive || r.cancelled || latest.current !== fen) return;
          setThinking(false);
          if (r.best) setGame((g) => (g && g.fens[g.fens.length - 1] === fen ? push(g, r.best!) ?? g : g));
        })
        .catch(() => { if (alive) { setFailed(true); setThinking(false); } });
    }, 350);
    return () => { alive = false; window.clearTimeout(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, game?.player, game?.level, over]);

  function start() {
    unlockAudio();
    const player: Side = color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color;
    setFlipped(false);
    setGame({ fens: [new Chess().fen()], sans: [], lastMoves: [null], player, level });
  }

  function onMove(uci: string) {
    if (!game || !playersTurn) return;
    const next = push(game, uci);
    if (next) setGame(next); else setResetKey((k) => k + 1);
  }

  // Back to the player's previous turn: their move and the engine's answer.
  function takeBack() {
    if (!game) return;
    engine.stop();
    let n = game.fens.length - 1;
    const sideAt = (i: number): Side => (game.fens[i]!.split(' ')[1] === 'w' ? 'white' : 'black');
    do { n--; } while (n > 0 && sideAt(n) !== game.player);
    if (n < 0 || sideAt(n) !== game.player) return;
    setGame({ ...game, fens: game.fens.slice(0, n + 1), sans: game.sans.slice(0, n), lastMoves: game.lastMoves.slice(0, n + 1) });
    setResetKey((k) => k + 1);
  }

  if (!game) {
    const pill = (active: boolean) => `flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${active
      ? 'border-chesscom-900 bg-chesscom-900 text-white dark:border-chesscom-100 dark:bg-chesscom-100 dark:text-chesscom-900'
      : 'border-chesscom-200 bg-white text-chesscom-700 dark:border-chesscom-700 dark:bg-chesscom-800 dark:text-chesscom-200'}`;
    return (
      <div className="space-y-5">
        <div>
          <div className="label mb-2">{t('offline.playAs')}</div>
          <div className="flex gap-2">
            {(['white', 'random', 'black'] as const).map((c) => (
              <button key={c} onClick={() => setColor(c)} className={pill(color === c)}>{t(`offline.color.${c}`)}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="label">{t('offline.level')}</span>
            <span className="font-mono text-sm font-semibold tabular-nums">{level + 1} / {LEVELS.length}</span>
          </div>
          <input type="range" min={0} max={LEVELS.length - 1} step={1} value={level}
            onChange={(e) => setLevel(Number(e.target.value))} className="w-full accent-board-dark" />
          <div className="mt-1 flex justify-between text-[11px] text-chesscom-400">
            <span>{t('offline.levelEasy')}</span><span>{t('offline.levelHard')}</span>
          </div>
        </div>
        <button onClick={start} className="btn-primary w-full"><Play className="h-4 w-4" /> {t('offline.start')}</button>
      </div>
    );
  }

  const orientation: Side = flipped ? (game.player === 'white' ? 'black' : 'white') : game.player;
  const lastMove = game.lastMoves[game.lastMoves.length - 1] ?? undefined;
  const status = failed ? t('offline.engineError')
    : chess.isCheckmate() ? (turn === game.player ? t('offline.youLose') : t('offline.youWin'))
    : over ? t('offline.draw')
    : thinking ? t('offline.thinking')
    : t('offline.yourTurn');

  const rows: { n: number; w?: string; b?: string }[] = [];
  for (let i = 0; i < game.sans.length; i += 2) rows.push({ n: i / 2 + 1, w: game.sans[i], b: game.sans[i + 1] });

  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium shadow-soft ${over ? 'bg-gold-500/20' : 'bg-white dark:bg-chesscom-800'}`}>
        {thinking && <Loader2 className="h-4 w-4 animate-spin text-chesscom-400" />}
        <span>{status}</span>
        <span className="ms-auto text-xs font-normal text-chesscom-500">{t('offline.level')} {game.level + 1}</span>
      </div>

      <div className="relative aspect-square w-full board-theme-green">
        <ChessBoard fen={fen} orientation={orientation} turnColor={turn} movable={playersTurn}
          onMove={onMove} lastMove={lastMove as never} resetKey={resetKey} />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <button onClick={takeBack} disabled={game.sans.length === 0} className="btn-ghost text-sm">
          <Undo2 className="h-4 w-4" /> {t('offline.undo')}
        </button>
        <button onClick={() => setFlipped((f) => !f)} className="btn-ghost text-sm">
          <FlipVertical2 className="h-4 w-4" /> {t('lab.flip')}
        </button>
        <button onClick={() => go('analysis', { fen })} className="btn-ghost text-sm">
          <Microscope className="h-4 w-4" /> {t('offline.analyse')}
        </button>
        <button onClick={() => { engine.stop(); setGame(null); }} className="btn-secondary ms-auto text-sm">
          <RotateCcw className="h-4 w-4" /> {t('offline.newGame')}
        </button>
      </div>

      {rows.length > 0 && (
        <div className="card max-h-40 overflow-y-auto p-2 font-mono text-sm" dir="ltr">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {rows.map((r) => (
              <span key={r.n} className="whitespace-nowrap">
                <span className="text-chesscom-400">{r.n}.</span> {r.w} {r.b ?? ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

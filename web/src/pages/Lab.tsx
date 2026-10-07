// Lab — a position sandbox with the engine always on. Drop a FEN or move the
// pieces and the top-N candidate lines follow every position, as they do in
// Game Review. Designed for the "what does the engine think about this?"
// moment after a game. Laid out like the analyzer: the board takes the height
// of the window and everything else sits in a rail beside it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chess } from 'chess.js';
import {
  Microscope, RotateCcw, FlipVertical2, Loader2,
} from 'lucide-react';
import ChessBoard from '../components/ChessBoard';
import EvalBar from '../components/EvalBar';
import ThreatPanel from '../components/ThreatPanel';
import ExplorerPanel from '../components/ExplorerPanel';
import { api } from '../api';
import { useAuth } from '../state/auth';

interface AnalyzeLine {
  uci: string;
  san: string;
  pv_san: string[];
  cp: number | null;
  mate: number | null;
  multipv: number;
}

interface AnalyzeResponse {
  fen: string;
  depth: number;
  lines: AnalyzeLine[];
  /** What answered — the hosted engine falls back to the local one. */
  engine?: Engine;
}

// 'local' = the server's own Stockfish; 'chessapi' = the hosted Stockfish at
// chess-api.com (the position is sent there).
type Engine = 'local' | 'chessapi';
const ENGINE_KEY = 'lab.engine';

interface HistoryEntry {
  fen: string;       // FEN AFTER this move
  san: string;       // the move played to reach this fen
}

export default function Lab() {
  const { t } = useTranslation();
  const { user } = useAuth();

  // Get the FEN from the hash location inside the current URI.
  // Hashes are client-only, therefore we're not scrambling anything up on the server side.
  const initialFen = decodeURI(window.location.hash.slice(1)) ?? '';

  // instantiate a proper chess object to be referenced later, we skip validation for preloaded FENs
  // as this often used to just manipulate a position, anarchy-chess style.
  const chess = initialFen ? new Chess(initialFen, {skipValidation: true}) : new Chess();

  // Authoritative game state lives in a ref to avoid stale closures.
  const chessRef = useRef<Chess>(chess);

  // Counter forces re-renders / ChessBoard re-sync since chess.js mutates.
  const [tick, setTick] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0); // 0 = start; N = after Nth move

  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [fenInput, setFenInput] = useState(initialFen);
  const [fenError, setFenError] = useState<string | null>(null);

  const [depth, setDepth] = useState(12);
  const [lines, setLines] = useState(5);
  const [engine, setEngineState] = useState<Engine>(() => {
    try { return localStorage.getItem(ENGINE_KEY) === 'chessapi' ? 'chessapi' : 'local'; } catch { return 'local'; }
  });
  const setEngine = (e: Engine) => {
    setEngineState(e);
    try { localStorage.setItem(ENGINE_KEY, e); } catch { /* ignore */ }
  };

  const fen = chessRef.current.fen();
  const turn = chessRef.current.turn() === 'w' ? 'white' : 'black';

  // The engine follows the board: every new position (and every change of
  // depth, line count or engine) is analysed after a short pause, so a quick
  // run of moves asks once, for the last one.
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let handle = 0;
    setAnalyzeError(false);
    setAnalyzing(true);
    const ask = (triesLeft: number) => {
      api.post<AnalyzeResponse>('/api/analyze/position', { fen, depth, lines, engine })
        .then((r) => { if (!cancelled) { setResult(r); setAnalyzing(false); } })
        .catch((e) => {
          if (cancelled) return;
          // 429: the engine is still on the previous position — wait for it
          // rather than giving up.
          if ((e as { status?: number }).status === 429 && triesLeft > 0) {
            handle = window.setTimeout(() => ask(triesLeft - 1), 800);
            return;
          }
          setAnalyzeError(true); setAnalyzing(false);
        });
    };
    handle = window.setTimeout(() => ask(20), 400);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [fen, depth, lines, engine]);
  // Lines for an earlier position say nothing about this one.
  const current = result && result.fen === fen ? result : null;
  const topLine = current?.lines[0];
  // White's point of view, for the eval bar and the threat probe.
  const evalCpWhite = (() => {
    if (!topLine) return 0;
    const cp = topLine.mate != null ? (topLine.mate > 0 ? 10000 : -10000) : (topLine.cp ?? 0);
    return turn === 'white' ? cp : -cp;
  })();

  function bump() { setTick((k) => k + 1); }

  function onMove(uci: string) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length === 5 ? uci[4] : undefined;
    try {
      const move = chessRef.current.move({ from, to, promotion } as never);
      if (!move) return;
      // If we're not at the tip, truncate forward history first.
      setHistory((prev) => {
        const trimmed = prev.slice(0, historyIndex);
        return [...trimmed, { fen: chessRef.current.fen(), san: move.san }];
      });
      setHistoryIndex((i) => i + 1);
      bump();
    } catch {
      // illegal — chessground will reject via legalDests; ignore
      bump();
    }
  }

  function resetBoard() {
    chessRef.current = new Chess();
    setHistory([]);
    setHistoryIndex(0);
    bump();
  }

  function flip() {
    setOrientation((o) => (o === 'white' ? 'black' : 'white'));
  }

  function setFromFen() {
    const trimmed = fenInput.trim();
    if (!trimmed) return;
    try {
      const test = new Chess(trimmed);
      chessRef.current = test;
      setHistory([]);
      setHistoryIndex(0);
        setFenError(null);
      bump();
    } catch (e) {
      setFenError(e instanceof Error ? e.message : t('lab.invalidFen', { defaultValue: 'Invalid FEN' }));
    }
  }

  function gotoPly(index: number) {
    // Reconstruct chess at the given history position by replaying.
    const replay = new Chess();
    for (let i = 0; i < index; i++) {
      const entry = history[i];
      if (!entry) break;
      // Use the FEN directly for simplicity & correctness with promotions.
      replay.load(entry.fen);
    }
    chessRef.current = replay;
    setHistoryIndex(index);
    bump();
  }

  function playLineMove(uci: string) {
    onMove(uci);
  }

  const arrows = useMemo(() => {
    if (!topLine) return [];
    return [{ orig: topLine.uci.slice(0, 2), dest: topLine.uci.slice(2, 4), brush: 'paleBlue' as const }];
  }, [topLine]);

  return (
    <div className="mx-auto max-w-7xl lg:max-w-none">
      {/* Workspace as in Game Review: on lg+ the row is as tall as the window
          minus the app chrome, the board fills that height, and the rail
          scrolls inside itself. */}
      <div className="flex flex-col gap-4 lg:h-[calc(100vh-7.5rem)] lg:min-h-[26rem] lg:flex-row lg:overflow-hidden">
        {/* Board pane */}
        <section className="mx-auto w-full min-w-0 lg:mx-0 lg:flex lg:flex-1 lg:items-start lg:justify-center">
          <div className="relative flex items-stretch justify-center gap-2 lg:w-full">
            <EvalBar cp={evalCpWhite} orientation={orientation} />
            <div className={`relative aspect-square w-full min-w-0 board-theme-${user?.profile.board_theme ?? 'green'} lg:max-w-[calc(100vh-7.5rem)]`}>
              <ChessBoard
                key={tick === 0 ? 'init' : 'live'}
                fen={fen}
                orientation={orientation}
                turnColor={turn}
                movable
                onMove={onMove}
                arrows={arrows as never}
                resetKey={tick}
              />
            </div>
          </div>
        </section>

        {/* Rail */}
        <aside className="min-w-0 space-y-3 lg:min-h-0 lg:w-[380px] lg:shrink-0 lg:overflow-y-auto lg:pe-1">
          <header className="flex items-end justify-between gap-2">
            <div>
              <h1 className="page-h1 flex items-center gap-2">
                <Microscope className="h-6 w-6 text-board-dark" />
                {t('lab.title', { defaultValue: 'Lab' })}
              </h1>
              <p className="page-sub">
                {t('lab.subtitle', { defaultValue: 'A sandbox board with Stockfish on tap.' })}
              </p>
            </div>
            <div className="shrink-0 text-xs text-chesscom-500">
              {turn === 'white'
                ? t('lab.whiteToMove', { defaultValue: 'White to move' })
                : t('lab.blackToMove', { defaultValue: 'Black to move' })}
            </div>
          </header>

        <div className="card space-y-2 p-3">
          <div className="flex items-center gap-2">
            <input
              value={fenInput}
              onChange={(e) => setFenInput(e.target.value)}
              placeholder={t('lab.fenPlaceholder', { defaultValue: 'Paste a FEN…' })}
              className="input flex-1 font-mono text-xs"
              spellCheck={false}
            />
            <button onClick={setFromFen} className="btn-secondary text-sm">
              {t('lab.setFen', { defaultValue: 'Set' })}
            </button>
          </div>
          {fenError && <div className="text-xs text-mistake">{fenError}</div>}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={resetBoard} className="btn-ghost text-sm">
              <RotateCcw className="h-4 w-4" />
              {t('lab.reset', { defaultValue: 'Reset' })}
            </button>
            <button onClick={flip} className="btn-ghost text-sm">
              <FlipVertical2 className="h-4 w-4" />
              {t('lab.flip', { defaultValue: 'Flip board' })}
            </button>
            <div className="ms-auto font-mono text-[11px] tabular-nums text-chesscom-400">
              {fen}
            </div>
          </div>
        </div>


          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">
                {t('lab.engine', { defaultValue: 'Engine analysis' })}
              </h2>
              {analyzing && (
                <span className="flex items-center gap-1.5 text-xs text-chesscom-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('lab.analyzing', { defaultValue: 'Analyzing…' })}
                </span>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-chesscom-100 p-1 text-sm dark:bg-chesscom-900">
                  {(['local', 'chessapi'] as const).map((e) => (
                    <button key={e} type="button" onClick={() => setEngine(e)}
                      className={`rounded-md px-2 py-1.5 font-medium transition-colors ${engine === e
                        ? 'bg-white text-chesscom-900 shadow-soft dark:bg-chesscom-700 dark:text-chesscom-100'
                        : 'text-chesscom-500 hover:text-chesscom-900 dark:hover:text-chesscom-100'}`}>
                      {t(`lab.engines.${e}`)}
                    </button>
                  ))}
                </div>
                {engine === 'chessapi' && <p className="mt-1 text-[11px] text-chesscom-400">{t('lab.chessapiNote')}</p>}
              </div>
              <Slider
                label={t('lab.depth', { defaultValue: 'Depth' })}
                value={depth}
                min={8}
                max={22}
                onChange={setDepth}
              />
              <Slider
                label={t('lab.lines', { defaultValue: 'Lines' })}
                value={lines}
                min={1}
                max={5}
                onChange={setLines}
              />
            </div>
          </div>

          {current && current.lines.length > 0 ? (
            <div className="card divide-y divide-chesscom-100 dark:divide-chesscom-700">
              {current.lines.map((line, i) => (
                <LineRow key={i} line={line} rank={i + 1} onPlay={playLineMove} />
              ))}
              <div className="px-3 py-1.5 text-end text-[11px] text-chesscom-400">
                {current.engine && <>{t(`lab.engines.${current.engine}`)} · </>}
                {t('lab.depthLabel', { defaultValue: 'depth' })} {current.depth}
                {engine === 'chessapi' && current.engine === 'local' && <> · {t('lab.chessapiFellBack')}</>}
              </div>
            </div>
          ) : analyzeError ? (
            <div className="card p-4 text-sm text-mistake">
              {t('lab.analyzeError', { defaultValue: 'Analysis failed. Is Stockfish configured?' })}
            </div>
          ) : (
            <div className="card flex items-center gap-2 p-4 text-sm text-chesscom-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('lab.crunching', { defaultValue: 'Crunching positions…' })}
            </div>
          )}

          <ThreatPanel
            fen={fen}
            currentCpWhite={evalCpWhite}
          />

          <ExplorerPanel fen={fen} />

          {history.length > 0 && (
            <div className="card overflow-hidden">
              <div className="flex items-center gap-2 border-b border-chesscom-200 px-3 py-2 dark:border-chesscom-700">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">
                  {t('lab.moves', { defaultValue: 'Moves' })}
                </h2>
                <span className="text-[11px] text-chesscom-400">{history.length}</span>
              </div>
              <div className="max-h-60 overflow-y-auto p-2">
                <button
                  onClick={() => gotoPly(0)}
                  className={`w-full rounded px-2 py-1 text-start text-xs font-mono tabular-nums ${
                    historyIndex === 0
                      ? 'bg-gold-500/15 text-chesscom-900 dark:text-chesscom-100'
                      : 'text-chesscom-500 hover:bg-chesscom-100/60 dark:hover:bg-chesscom-700/40'
                  }`}
                >
                  {t('lab.startPos', { defaultValue: 'Start' })}
                </button>
                {history.map((h, i) => {
                  const ply = i + 1;
                  const moveNum = Math.ceil(ply / 2);
                  const label = ply % 2 === 1 ? `${moveNum}. ${h.san}` : `${moveNum}… ${h.san}`;
                  const isActive = historyIndex === ply;
                  return (
                    <button
                      key={i}
                      onClick={() => gotoPly(ply)}
                      className={`w-full rounded px-2 py-1 text-start text-xs font-mono tabular-nums ${
                        isActive
                          ? 'bg-gold-500/15 text-chesscom-900 dark:text-chesscom-100'
                          : 'text-chesscom-600 hover:bg-chesscom-100/60 dark:text-chesscom-200 dark:hover:bg-chesscom-700/40'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function LineRow({ line, rank, onPlay }: { line: AnalyzeLine; rank: number; onPlay: (uci: string) => void }) {
  const evalLabel = formatEval(line.cp, line.mate);
  const evalTone =
    line.mate != null
      ? line.mate > 0
        ? 'text-board-dark'
        : 'text-mistake'
      : (line.cp ?? 0) >= 30
      ? 'text-board-dark'
      : (line.cp ?? 0) <= -30
      ? 'text-mistake'
      : 'text-chesscom-700 dark:text-chesscom-200';

  const tail = line.pv_san.slice(1);

  return (
    <div className="flex items-start gap-2 px-3 py-2 text-xs">
      <span className="mt-0.5 font-mono text-[11px] tabular-nums text-chesscom-400">{rank}.</span>
      <span className={`mt-0.5 w-12 shrink-0 font-mono text-xs tabular-nums ${evalTone}`}>
        {evalLabel}
      </span>
      <div className="min-w-0 flex-1">
        <button
          onClick={() => onPlay(line.uci)}
          className="rounded bg-chesscom-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-chesscom-900 hover:bg-gold-500/20 dark:bg-chesscom-700 dark:text-chesscom-100"
          title={line.uci}
        >
          {line.san}
        </button>
        {tail.length > 0 && (
          <span className="ms-2 font-mono text-xs tabular-nums text-chesscom-500">
            {tail.join(' ')}
          </span>
        )}
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-chesscom-500">{label}</span>
        <span className="font-mono tabular-nums text-chesscom-700 dark:text-chesscom-200">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-board-dark"
      />
    </div>
  );
}

function formatEval(cp: number | null, mate: number | null): string {
  if (mate != null) return mate > 0 ? `#${mate}` : `#${mate}`;
  if (cp == null) return '—';
  const pawns = cp / 100;
  const sign = pawns > 0 ? '+' : pawns < 0 ? '' : '';
  return `${sign}${pawns.toFixed(2)}`;
}

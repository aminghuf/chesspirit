// Offline analysis board: move the pieces (both sides) and the on-device
// engine follows every position, as the Lab does against a server.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chess } from 'chess.js';
import { FlipVertical2, Loader2, RotateCcw, Undo2 } from 'lucide-react';
import ChessBoard from '../components/ChessBoard';
import EvalBar from '../components/EvalBar';
import { engine, pvToSan, scoreText, whiteCp, type EngineLine } from './engine';

const DEPTH = 18;
const LINES = 3;

export default function OfflineAnalysis({ initialFen }: { initialFen: string | null }) {
  const { t } = useTranslation();
  // The position is a stack of FENs, so "take back" is a pop.
  const [stack, setStack] = useState<string[]>(() => {
    try { return [new Chess(initialFen ?? undefined).fen()]; } catch { return [new Chess().fen()]; }
  });
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [lines, setLines] = useState<{ fen: string; lines: EngineLine[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const fen = stack[stack.length - 1]!;
  const whiteToMove = fen.split(' ')[1] === 'w';
  const over = useMemo(() => new Chess(fen).isGameOver(), [fen]);

  const latest = useRef(fen);
  latest.current = fen;
  useEffect(() => {
    if (over) { setBusy(false); engine.stop(); return; }
    setBusy(true); setFailed(false);
    // A short pause, so a run of quick moves asks once.
    const handle = window.setTimeout(() => {
      engine.analyse(fen, { depth: DEPTH, multipv: LINES }, (l) => { if (latest.current === fen) setLines({ fen, lines: l }); })
        .then((r) => { if (!r.cancelled && latest.current === fen) { setLines({ fen, lines: r.lines }); setBusy(false); } })
        .catch(() => { setFailed(true); setBusy(false); });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [fen, over]);
  useEffect(() => () => engine.stop(), []);

  const current = lines && lines.fen === fen ? lines.lines : [];
  const top = current[0];
  const arrows = useMemo(
    () => (top?.pv[0] ? [{ orig: top.pv[0].slice(0, 2) as never, dest: top.pv[0].slice(2, 4) as never, brush: 'paleBlue' }] : []),
    [top?.pv[0]],
  );

  function play(uci: string) {
    const chess = new Chess(fen);
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
      setStack((s) => [...s, chess.fen()]);
    } catch { setResetKey((k) => k + 1); }
  }

  function setFromFen() {
    try {
      setStack([new Chess(fenInput.trim()).fen()]);
      setFenError(false); setFenInput('');
    } catch { setFenError(true); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-stretch gap-2">
        <EvalBar cp={whiteCp(top, whiteToMove)} orientation={orientation} />
        <div className="relative aspect-square w-full min-w-0 board-theme-green">
          <ChessBoard fen={fen} orientation={orientation} turnColor={whiteToMove ? 'white' : 'black'}
            movable onMove={play} arrows={arrows} resetKey={resetKey} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <button onClick={() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))} disabled={stack.length < 2} className="btn-ghost text-sm">
          <Undo2 className="h-4 w-4" /> {t('offline.undo')}
        </button>
        <button onClick={() => setStack([new Chess().fen()])} className="btn-ghost text-sm">
          <RotateCcw className="h-4 w-4" /> {t('lab.reset')}
        </button>
        <button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} className="btn-ghost text-sm">
          <FlipVertical2 className="h-4 w-4" /> {t('lab.flip')}
        </button>
        <span className="ms-auto text-xs text-chesscom-500">{whiteToMove ? t('lab.whiteToMove') : t('lab.blackToMove')}</span>
      </div>

      <div className="card divide-y divide-chesscom-100 dark:divide-chesscom-700">
        <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-chesscom-500">
          {t('lab.engine')}
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {top && <span className="ms-auto font-normal normal-case tracking-normal text-chesscom-400">{t('lab.depthLabel')} {top.depth}</span>}
        </div>
        {failed && <div className="px-3 py-3 text-sm text-mistake">{t('offline.engineError')}</div>}
        {!failed && over && <div className="px-3 py-3 text-sm text-chesscom-500">{t('offline.gameOver')}</div>}
        {!failed && !over && current.length === 0 && (
          <div className="px-3 py-3 text-sm text-chesscom-500">{t('lab.crunching')}</div>
        )}
        {!failed && !over && current.map((line) => {
          const san = pvToSan(fen, line.pv);
          return (
            <div key={line.multipv} className="flex items-baseline gap-2 px-3 py-2" dir="ltr">
              <span className="w-12 shrink-0 font-mono text-sm font-semibold tabular-nums">{scoreText(line, whiteToMove)}</span>
              <button onClick={() => line.pv[0] && play(line.pv[0])} className="rounded bg-chesscom-100 px-1.5 py-0.5 font-mono text-sm font-semibold dark:bg-chesscom-700">
                {san[0] ?? '…'}
              </button>
              <span className="min-w-0 truncate font-mono text-xs tabular-nums text-chesscom-500">{san.slice(1).join(' ')}</span>
            </div>
          );
        })}
      </div>

      <div className="card space-y-2 p-3">
        <div className="flex items-center gap-2">
          <input value={fenInput} onChange={(e) => { setFenInput(e.target.value); setFenError(false); }}
            placeholder={t('lab.fenPlaceholder')} className="input flex-1 font-mono text-xs" spellCheck={false} dir="ltr" />
          <button onClick={setFromFen} className="btn-secondary text-sm">{t('lab.setFen')}</button>
        </div>
        {fenError && <div className="text-xs text-mistake">{t('lab.invalidFen')}</div>}
        <div className="break-all font-mono text-[11px] text-chesscom-400" dir="ltr">{fen}</div>
      </div>
    </div>
  );
}

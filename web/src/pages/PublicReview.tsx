import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Copy, Check, Download, Share2, Puzzle, ExternalLink, Lightbulb } from 'lucide-react';
import type { Key } from 'chessground/types';
import { api } from '../api';
import PublicHeader from '../components/PublicHeader';
import ChessBoard from '../components/ChessBoard';
import EvalBar from '../components/EvalBar';
import EvalGraph from '../components/EvalGraph';
import MoveList from '../components/MoveList';
import AccuracyDonut from '../components/AccuracyDonut';
import ClassificationBadge from '../components/ClassificationBadge';
import Spinner from '../components/Spinner';
import { REPO_URL } from '../components/GitHubStar';
import { useAuth } from '../state/auth';
import { useAuthConfig } from '../lib/useAuthConfig';
import { styleFor } from '../lib/classification';
import { cardUrl, copyText, formatResult, sameMove, type SharedReview } from '../lib/share';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

type PuzzleState = 'off' | 'solving' | 'wrong' | 'solved' | 'revealed';

export default function PublicReview() {
  const { slug = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { config } = useAuthConfig();
  const [review, setReview] = useState<SharedReview | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  const [ply, setPly] = useState(0);
  const [copied, setCopied] = useState(false);
  const [puzzle, setPuzzle] = useState<PuzzleState>('off');
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    let alive = true;
    api.get<{ review: SharedReview; url: string }>(`/api/share/${encodeURIComponent(slug)}`)
      .then((r) => {
        if (!alive) return;
        setReview(r.review);
        setUrl(r.url);
        // Open on the moment worth seeing: the !! move, else the first ply.
        setPly(r.review.highlights.star?.ply ?? 0);
      })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [slug]);

  const moves = review?.analysis.moves ?? [];
  const orientation = review?.focus_color ?? 'white';
  const move = ply > 0 ? moves[ply - 1] : undefined;
  const fen = move?.fen_after ?? moves[0]?.fen_before ?? START_FEN;

  const jump = useCallback((p: number) => {
    setPuzzle('off');
    setPly(Math.max(0, Math.min(moves.length, p)));
  }, [moves.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); jump(ply - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); jump(ply + 1); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jump, ply]);

  const lastMove = useMemo<[Key, Key] | undefined>(() => (
    move ? [move.uci.slice(0, 2) as Key, move.uci.slice(2, 4) as Key] : undefined
  ), [move]);

  if (error) {
    return (
      <div className="min-h-screen bg-cream dark:bg-chesscom-900">
        <PublicHeader />
        <main className="mx-auto max-w-xl px-4 py-16 text-center">
          <h1 className="text-2xl font-bold">{t('share.notFoundTitle')}</h1>
          <p className="mt-2 text-chesscom-500">{t('share.notFoundBody')}</p>
          <a href="/" className="btn-primary mt-6">{t('share.goHome')}</a>
        </main>
      </div>
    );
  }
  if (!review) {
    return (
      <div className="min-h-screen bg-cream dark:bg-chesscom-900">
        <PublicHeader />
        <div className="flex justify-center py-24"><Spinner size="lg" /></div>
      </div>
    );
  }

  const h = review.highlights;
  const miss = h.miss;
  const inPuzzle = puzzle !== 'off' && miss;
  const boardFen = inPuzzle ? miss.fen_before : fen;
  const puzzleArrows = inPuzzle && (puzzle === 'solved' || puzzle === 'revealed') && miss.best_uci
    ? [{ orig: miss.best_uci.slice(0, 2) as Key, dest: miss.best_uci.slice(2, 4) as Key, brush: 'green' }]
    : undefined;
  const bestArrow = !inPuzzle && move?.best_move_uci && move.best_move_uci !== move.uci && ['inaccuracy', 'mistake', 'blunder', 'miss'].includes(move.classification)
    ? [{ orig: move.best_move_uci.slice(0, 2) as Key, dest: move.best_move_uci.slice(2, 4) as Key, brush: 'green' }]
    : undefined;
  const sideToMove = (inPuzzle ? miss.fen_before : fen).split(' ')[1] === 'b' ? 'black' : 'white';

  function onPuzzleMove(uci: string) {
    if (!miss) return;
    if (sameMove(uci, miss.best_uci)) setPuzzle('solved');
    else { setPuzzle('wrong'); setResetKey((k) => k + 1); }
  }

  async function copyLink() {
    if (await copyText(url)) { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
  }
  async function nativeShare() {
    try { await navigator.share({ title: `${review!.white} vs ${review!.black}`, url }); } catch { /* dismissed */ }
  }

  const focusName = h.focus === 'white' ? review.white : review.black;
  const oppName = h.focus === 'white' ? review.black : review.white;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const curStyle = move ? styleFor(move.classification) : null;

  return (
    <div className="min-h-screen bg-cream dark:bg-chesscom-900">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl" dir="ltr">
              {review.white}{review.white_rating ? <span className="font-normal text-chesscom-400"> ({review.white_rating})</span> : null}
              <span className="px-2 font-normal text-chesscom-400">{formatResult(review.result) || t('share.vs')}</span>
              {review.black}{review.black_rating ? <span className="font-normal text-chesscom-400"> ({review.black_rating})</span> : null}
            </h1>
            <p className="mt-0.5 text-sm text-chesscom-500 dark:text-chesscom-300">
              {[review.analysis.opening_name, review.time_class ? t(`try.tc.${review.time_class}`, { defaultValue: review.time_class }) : null].filter(Boolean).join(', ')}
              {review.source_url && (
                <a href={review.source_url} target="_blank" rel="noreferrer" className="ms-3 inline-flex items-center gap-1 underline-offset-2 hover:underline">{t('share.original')}<ExternalLink className="h-3 w-3" /></a>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => void copyLink()}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? t('share.copied') : t('share.copyLink')}
            </button>
            <a className="btn-secondary" href={`${cardUrl(review.slug)}?download=1`} download>
              <Download className="h-4 w-4" /> {t('share.downloadImage')}
            </a>
            {canShare && (
              <button type="button" className="btn-secondary" onClick={() => void nativeShare()}>
                <Share2 className="h-4 w-4" /> {t('share.share')}
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* Board column */}
          <div className="min-w-0">
            <div className="flex gap-2">
              <EvalBar cp={inPuzzle ? null : (move?.eval_after_cp ?? 0)} mate={inPuzzle ? null : move?.mate_after ?? null} orientation={orientation} />
              <div className="relative aspect-square w-full min-w-0 board-theme-green lg:max-w-[calc(100vh-11rem)]">
                <ChessBoard
                  fen={boardFen}
                  orientation={orientation}
                  movable={puzzle === 'solving' || puzzle === 'wrong'}
                  turnColor={sideToMove}
                  onMove={onPuzzleMove}
                  lastMove={inPuzzle ? undefined : lastMove}
                  arrows={puzzleArrows ?? bestArrow}
                  resetKey={resetKey}
                />
                {!inPuzzle && move && lastMove && (
                  <ClassificationBadge classification={move.classification} san={move.san} square={lastMove[1]} orientation={orientation} />
                )}
              </div>
            </div>

            {inPuzzle ? (
              <div className="mt-3 rounded-lg border border-chesscom-200 bg-white p-4 dark:border-chesscom-700 dark:bg-chesscom-800" aria-live="polite">
                <p className="font-medium">
                  {puzzle === 'solved' ? t('share.puzzleSolved', { move: miss.best_san })
                    : puzzle === 'revealed' ? t('share.puzzleRevealed', { move: miss.best_san })
                    : puzzle === 'wrong' ? t('share.puzzleWrong')
                    : t('share.puzzlePrompt', { side: t(sideToMove === 'white' ? 'share.white' : 'share.black') })}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(puzzle === 'solving' || puzzle === 'wrong') && (
                    <button type="button" className="btn-secondary" onClick={() => setPuzzle('revealed')}>
                      <Lightbulb className="h-4 w-4" /> {t('share.showAnswer')}
                    </button>
                  )}
                  <button type="button" className="btn-ghost" onClick={() => jump(miss.ply)}>{t('share.backToGame')}</button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2">
                <button type="button" className="btn-secondary px-3" onClick={() => jump(ply - 1)} disabled={ply === 0} aria-label={t('share.prev')}>
                  <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
                </button>
                <button type="button" className="btn-secondary px-3" onClick={() => jump(ply + 1)} disabled={ply >= moves.length} aria-label={t('share.next')}>
                  <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                </button>
                {move && (
                  <p className="min-w-0 truncate text-sm" dir="ltr">
                    <span className="font-semibold" style={{ color: curStyle?.hex }}>{Math.ceil(move.ply / 2)}{move.ply % 2 ? '.' : '…'} {move.san}</span>
                    {' '}<span className="text-chesscom-500">{t(`classification.${move.classification}`)}</span>
                    {bestArrow && move.best_move_san && <span className="text-chesscom-500"> · {t('share.bestWas', { move: move.best_move_san })}</span>}
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 rounded-lg border border-chesscom-200 bg-white p-2 dark:border-chesscom-700 dark:bg-chesscom-800">
              <EvalGraph
                evals={moves.map((m) => ({ ply: m.ply, cp: m.eval_after_cp }))}
                current={ply}
                onClick={jump}
                markers={moves.filter((m) => ['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(m.classification)).map((m) => ({ ply: m.ply, classification: m.classification }))}
              />
            </div>
          </div>

          {/* Side column */}
          <aside className="space-y-4">
            <section className="rounded-lg border border-chesscom-200 bg-white p-4 dark:border-chesscom-700 dark:bg-chesscom-800" aria-label={t('share.accuracy')}>
              <div className="flex items-center justify-around gap-4">
                <div className="flex flex-col items-center gap-1">
                  <AccuracyDonut value={h.accuracy} size={88} />
                  <span className="max-w-[9rem] truncate text-sm font-semibold" dir="ltr">{focusName}</span>
                </div>
                <div className="flex flex-col items-center gap-1 opacity-80">
                  <AccuracyDonut value={h.opponent_accuracy} size={64} strokeWidth={9} />
                  <span className="max-w-[9rem] truncate text-sm text-chesscom-500" dir="ltr">{oppName}</span>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-5 gap-1 text-center text-xs">
                {(['brilliant', 'great', 'best', 'mistake', 'blunder'] as const).map((k) => (
                  <div key={k}>
                    <dt className="truncate text-chesscom-500">{t(`classification.${k}`)}</dt>
                    <dd className="text-lg font-bold" style={{ color: styleFor(k)?.hex }}>{k === 'blunder' ? h.counts.blunder + h.counts.miss : h.counts[k]}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {(h.star || miss) && (
              <section className="space-y-2">
                {h.star && (
                  <button type="button" onClick={() => jump(h.star!.ply)} className="flex w-full items-center gap-3 rounded-lg border border-chesscom-200 bg-white p-3 text-start hover:border-chesscom-300 dark:border-chesscom-700 dark:bg-chesscom-800">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white" style={{ background: styleFor(h.star.classification)?.hex }}>
                      {h.star.classification === 'brilliant' ? '!!' : '!'}
                    </span>
                    <span>
                      <span className="block text-xs text-chesscom-500">{t(h.star.classification === 'brilliant' ? 'share.starBrilliant' : 'share.starGreat')}</span>
                      <span className="font-semibold" dir="ltr">{h.star.label}</span>
                    </span>
                  </button>
                )}
                {miss && miss.best_san && (
                  <div className="rounded-lg border border-chesscom-200 bg-white p-3 dark:border-chesscom-700 dark:bg-chesscom-800">
                    <p className="text-sm">
                      {t('share.missLine', { played: miss.label, best: miss.best_san })}
                    </p>
                    <button type="button" className="btn-primary mt-2 w-full" onClick={() => { setPuzzle('solving'); setResetKey((k) => k + 1); }}>
                      <Puzzle className="h-4 w-4" /> {t('share.tryPuzzle')}
                    </button>
                  </div>
                )}
              </section>
            )}

            <section className="rounded-lg border border-chesscom-200 bg-white dark:border-chesscom-700 dark:bg-chesscom-800">
              <MoveList
                moves={moves.map((m) => ({ ply: m.ply, san: m.san, classification: m.classification }))}
                current={ply}
                onSelect={jump}
                phaseSplit={review.analysis.phase_split}
                maxHeight={320}
              />
            </section>

            {!user && (
              <section className="rounded-lg bg-chesscom-800 p-4 text-chesscom-100 dark:bg-chesscom-950">
                <p className="font-semibold text-white">{t('share.ctaTitle')}</p>
                <p className="mt-1 text-sm text-chesscom-200">{t('share.ctaBody')}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {config.public_site && <Link to="/try" className="btn-primary">{t('share.ctaTry')}</Link>}
                  {config.public_site && config.signup_enabled && <Link to="/signup" className="btn bg-white/10 text-white hover:bg-white/20">{t('landing.register')}</Link>}
                  {!config.public_site && <a href={REPO_URL} className="btn-primary" target="_blank" rel="noreferrer">{t('share.ctaSelfHost')}</a>}
                </div>
              </section>
            )}
            <p className="text-xs text-chesscom-500">{t('share.engineNote', { depth: review.analysis.depth })}</p>
          </aside>
        </div>
      </main>
    </div>
  );
}

// The offline app inside the Android shell: three things that need no server
// — a game against Stockfish, an analysis board, and puzzles — all running on
// the device. The connect screen (mobile/www/index.html) links here, and the
// "Connect to a server" button goes back to it.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Cpu, Microscope, Puzzle, Server, WifiOff } from 'lucide-react';
import { LANGUAGES } from '../lib/languages';
import { allPuzzles } from './puzzleSet';
import OfflinePlay from './OfflinePlay';
import OfflineAnalysis from './OfflineAnalysis';
import OfflinePuzzles from './OfflinePuzzles';

type Route = 'home' | 'play' | 'analysis' | 'puzzles';
const ROUTES: readonly Route[] = ['home', 'play', 'analysis', 'puzzles'];

// "#analysis?fen=…" → ['analysis', URLSearchParams]. The hash, not the path:
// the shell serves this page as a plain file.
function readHash(): { route: Route; params: URLSearchParams } {
  const [name, query] = window.location.hash.replace(/^#/, '').split('?');
  const route = (ROUTES as readonly string[]).includes(name ?? '') ? (name as Route) : 'home';
  return { route, params: new URLSearchParams(query ?? '') };
}

export function go(route: Route, params?: Record<string, string>) {
  const q = params ? `?${new URLSearchParams(params).toString()}` : '';
  window.location.hash = route === 'home' ? '' : `${route}${q}`;
}

function toConnectScreen() {
  // Marks this run as already sent to a server, so the connect screen shows
  // its form instead of bouncing to the remembered one.
  try { sessionStorage.setItem('chesspirit.opened', '1'); } catch { /* ignore */ }
  window.location.href = '../index.html';
}

export default function OfflineApp() {
  const { t, i18n } = useTranslation();
  const [{ route, params }, setLoc] = useState(readHash);

  useEffect(() => {
    const onHash = () => setLoc(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const title = route === 'play' ? t('offline.play')
    : route === 'analysis' ? t('offline.analysis')
    : route === 'puzzles' ? t('offline.puzzles')
    : 'Chesspirit';

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col px-3 pb-6 pt-3">
      <header className="mb-3 flex items-center gap-2">
        {route !== 'home' && (
          <button onClick={() => go('home')} className="btn-ghost -ms-2 p-2" aria-label={t('common.back')}>
            <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
          </button>
        )}
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        <span className="ms-auto inline-flex items-center gap-1 rounded-full bg-chesscom-100 px-2 py-0.5 text-[11px] font-medium text-chesscom-600 dark:bg-chesscom-800 dark:text-chesscom-300">
          <WifiOff className="h-3 w-3" /> {t('offline.badge')}
        </span>
      </header>

      {route === 'home' && (
        <div className="space-y-3">
          <p className="text-sm text-chesscom-500">{t('offline.intro')}</p>
          <Tile icon={Cpu} title={t('offline.play')} desc={t('offline.playDesc')} onClick={() => go('play')} />
          <Tile icon={Microscope} title={t('offline.analysis')} desc={t('offline.analysisDesc')} onClick={() => go('analysis')} />
          <Tile icon={Puzzle} title={t('offline.puzzles')} desc={t('offline.puzzlesDesc', { n: allPuzzles().length.toLocaleString() })} onClick={() => go('puzzles')} />

          <div className="pt-3">
            <button onClick={toConnectScreen} className="btn-secondary w-full">
              <Server className="h-4 w-4" /> {t('offline.connect')}
            </button>
            <p className="mt-2 text-center text-xs text-chesscom-400">{t('offline.connectHint')}</p>
          </div>

          <div className="flex flex-wrap justify-center gap-1 pt-2" dir="ltr">
            {LANGUAGES.map((l) => (
              <button key={l.code} onClick={() => void i18n.changeLanguage(l.code)}
                className={`rounded-md px-2 py-1 text-xs ${i18n.resolvedLanguage === l.code
                  ? 'bg-chesscom-900 text-white dark:bg-chesscom-100 dark:text-chesscom-900'
                  : 'text-chesscom-500 hover:bg-chesscom-100 dark:hover:bg-chesscom-800'}`}>
                {l.native}
              </button>
            ))}
          </div>
        </div>
      )}
      {route === 'play' && <OfflinePlay />}
      {route === 'analysis' && <OfflineAnalysis initialFen={params.get('fen')} />}
      {route === 'puzzles' && <OfflinePuzzles />}
    </div>
  );
}

function Tile({ icon: Icon, title, desc, onClick }: { icon: React.ElementType; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card-hover flex w-full items-center gap-3 p-4 text-start">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-board-dark/15 text-board-dark">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-chesscom-500">{desc}</span>
      </span>
    </button>
  );
}

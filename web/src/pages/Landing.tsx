import { useEffect, useMemo, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Link, Navigate } from 'react-router-dom';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import { Check, Copy, Github, Server, Terminal, Code2, LogIn, UserPlus } from 'lucide-react';
import PublicHeader from '../components/PublicHeader';
import ChessBoard from '../components/ChessBoard';
import ClassificationBadge from '../components/ClassificationBadge';
import { REPO_URL } from '../components/GitHubStar';
import { useAuthConfig } from '../lib/useAuthConfig';
import { copyText } from '../lib/share';
import { styleFor } from '../lib/classification';
import { cn } from '../lib/utils';
import type { Classification } from '../types';
import { TryForm } from './Try';

// Morphy's Opera Game (Paris, 1858). The hero replays its finish with the
// grades Chesspirit gave it (local Stockfish 16, depth 12) — the review the
// product makes, shown instead of described.
const OPERA = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' ');
const GRADES: Record<number, Classification> = {
  19: 'best', 20: 'inaccuracy', 21: 'great', 22: 'best', 23: 'great', 24: 'best', 25: 'best',
  26: 'excellent', 27: 'great', 28: 'good', 29: 'mistake', 30: 'great', 31: 'great', 32: 'forced', 33: 'great',
};
const FIRST_PLY = 21;

interface Frame { fen: string; from: Key; to: Key; san: string; ply: number; cls: Classification }

function useOperaFrames(): Frame[] {
  return useMemo(() => {
    const c = new Chess();
    const out: Frame[] = [];
    OPERA.forEach((san, i) => {
      const m = c.move(san);
      const ply = i + 1;
      if (ply >= FIRST_PLY) out.push({ fen: c.fen(), from: m.from as Key, to: m.to as Key, san, ply, cls: GRADES[ply] ?? 'best' });
    });
    return out;
  }, []);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function HeroBoard() {
  const { t } = useTranslation();
  const frames = useOperaFrames();
  const [i, setI] = useState(() => (prefersReducedMotion() ? frames.length - 1 : 0));
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = window.setTimeout(() => setI((n) => (n + 1) % frames.length), i === frames.length - 1 ? 4000 : 1400);
    return () => window.clearTimeout(id);
  }, [i, frames.length]);
  const f = frames[i]!;
  const style = styleFor(f.cls);
  return (
    <figure className="w-full max-w-[440px]">
      <div className="relative aspect-square w-full overflow-hidden rounded-md shadow-board board-theme-green">
        <ChessBoard fen={f.fen} orientation="white" lastMove={[f.from, f.to]} />
        <ClassificationBadge classification={f.cls} san={f.san} square={f.to} orientation="white" />
      </div>
      <figcaption className="mt-3 flex items-baseline justify-between gap-3 text-sm text-chesscom-300" aria-live="off">
        <span dir="ltr">
          <span className="font-semibold" style={{ color: style?.hex }}>{Math.ceil(f.ply / 2)}{f.ply % 2 ? '.' : '…'} {f.san}</span>
          {' '}<span>{t(`classification.${f.cls}`)}</span>
        </span>
        <span className="truncate text-chesscom-400">{t('landing.heroCaption')}</span>
      </figcaption>
    </figure>
  );
}

function CodeBlock({ code }: { code: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative" dir="ltr">
      <pre className="overflow-x-auto rounded-md bg-chesscom-950 p-4 pe-14 font-mono text-[13px] leading-relaxed text-chesscom-100"><code>{code}</code></pre>
      <button
        type="button"
        onClick={async () => { if (await copyText(code)) { setCopied(true); window.setTimeout(() => setCopied(false), 1600); } }}
        className="absolute end-2 top-2 rounded p-2 text-chesscom-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/60"
        aria-label={copied ? t('share.copied') : t('landing.copyCommand')}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

const INSTALL = {
  docker: 'docker run -d -p 8800:8800 \\\n  -v chesspirit-data:/app/data \\\n  --name chesspirit \\\n  ghcr.io/aminghuf/chesspirit:latest',
  curl: 'curl -fsSL https://raw.githubusercontent.com/aminghuf/chesspirit/main/install.sh | sh',
  source: 'git clone https://github.com/aminghuf/chesspirit.git\ncd chesspirit\nnpm install\nnpm run setup      # downloads Stockfish\nnpm run build && npm start',
} as const;
type Method = keyof typeof INSTALL;

function InstallTabs() {
  const { t } = useTranslation();
  const [method, setMethod] = useState<Method>('docker');
  const tabs: { id: Method; icon: typeof Server; label: string }[] = [
    { id: 'docker', icon: Server, label: t('landing.installDocker') },
    { id: 'curl', icon: Terminal, label: t('landing.installCurl') },
    { id: 'source', icon: Code2, label: t('landing.installSource') },
  ];
  return (
    <div>
      <div role="tablist" aria-label={t('landing.selfHostTitle')} className="flex flex-wrap gap-1 border-b border-chesscom-200 dark:border-chesscom-700">
        {tabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            id={`install-tab-${id}`}
            role="tab"
            type="button"
            aria-selected={method === id}
            aria-controls={`install-panel-${id}`}
            onClick={() => setMethod(id)}
            className={cn(
              '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50',
              method === id ? 'border-green-500 text-chesscom-900 dark:text-white' : 'border-transparent text-chesscom-500 hover:text-chesscom-800 dark:hover:text-chesscom-100',
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      <div id={`install-panel-${method}`} role="tabpanel" aria-labelledby={`install-tab-${method}`} className="pt-4">
        <p className="mb-3 text-sm text-chesscom-600 dark:text-chesscom-300">{t(`landing.installHint_${method}`)}</p>
        <CodeBlock code={INSTALL[method]} />
        <p className="mt-3 text-sm text-chesscom-600 dark:text-chesscom-300">
          <Trans i18nKey="landing.installThen" components={{ code: <code className="rounded bg-chesscom-100 px-1 py-0.5 font-mono text-[13px] dark:bg-chesscom-700" dir="ltr" /> }} />
        </p>
      </div>
    </div>
  );
}

const SOURCE_URL = 'https://support.chess.com/en/articles/8562418-what-does-each-level-of-membership-get-me';

export default function Landing() {
  const { t } = useTranslation();
  const { config, loaded } = useAuthConfig();
  if (!loaded) return <div className="min-h-screen bg-cream dark:bg-chesscom-900" />;
  if (!config.public_site) return <Navigate to="/login" replace />;

  const rows: { label: string; ours: string; theirs: string; note?: boolean }[] = [
    { label: t('landing.cmpReviews'), ours: t('landing.cmpUnlimited'), theirs: t('landing.cmpOnePerDay'), note: true },
    { label: t('landing.cmpPrice'), ours: t('landing.cmpFree'), theirs: t('landing.cmpFreePremium') },
    { label: t('landing.cmpSource'), ours: t('landing.cmpOpen'), theirs: t('landing.cmpClosed') },
    { label: t('landing.cmpSelfHost'), ours: t('landing.cmpYes'), theirs: t('landing.cmpNo') },
  ];

  return (
    <div className="min-h-screen bg-cream text-chesscom-900 dark:bg-chesscom-900 dark:text-chesscom-100">
      <PublicHeader />

      {/* Hero */}
      <section className="bg-chesscom-900 text-white dark:bg-chesscom-950">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 md:grid-cols-[minmax(0,1fr)_minmax(0,440px)] md:py-16">
          <div className="min-w-0">
            <p className="mb-4 inline-flex rounded-full bg-green-500/20 px-3 py-1 text-sm font-semibold text-green-100">{t('landing.badge')}</p>
            <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">{t('landing.heroTitle')}</h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-chesscom-200">{t('landing.heroBody')}</p>
            <div className="mt-7 max-w-xl rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
              <TryForm />
              <p className="mt-2 px-1 text-sm text-chesscom-300">{t('landing.tryNote')}</p>
            </div>
            <p className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-chesscom-300">
              <Link to="/login" className="hover:text-white hover:underline">{t('landing.haveAccount')}</Link>
              <a href="#get" className="hover:text-white hover:underline">{t('landing.selfHostLink')}</a>
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-white hover:underline"><Github className="h-4 w-4" /> GitHub</a>
            </p>
          </div>
          <HeroBoard />
        </div>
      </section>

      {/* Comparison */}
      <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="cmp-title">
        <h2 id="cmp-title" className="text-2xl font-bold tracking-tight">{t('landing.cmpTitle')}</h2>
        <div className="mt-5">
          <table className="w-full border-collapse text-start">
            <thead>
              <tr className="border-b border-chesscom-300 text-sm dark:border-chesscom-600">
                <th scope="col" className="py-2 pe-4 text-start font-medium text-chesscom-500"><span className="sr-only">{t('landing.cmpFeature')}</span></th>
                <th scope="col" className="py-2 pe-4 text-start font-semibold">Chesspirit</th>
                <th scope="col" className="py-2 text-start font-semibold text-chesscom-500">{t('landing.cmpTheirs')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-chesscom-200 dark:border-chesscom-700">
                  <th scope="row" className="py-3 pe-4 text-start text-sm font-normal text-chesscom-600 dark:text-chesscom-300 sm:text-base">{r.label}</th>
                  <td className="py-3 pe-4 font-bold text-green-600 dark:text-green-400 sm:text-lg">{r.ours}</td>
                  <td className="py-3 text-sm text-chesscom-600 dark:text-chesscom-300 sm:text-base">{r.theirs}{r.note && <sup><a href="#cmp-source" className="ms-0.5 text-chesscom-500 hover:underline">1</a></sup>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p id="cmp-source" className="mt-3 max-w-3xl text-xs text-chesscom-500">
          1. <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="underline hover:text-chesscom-800 dark:hover:text-chesscom-200">{t('landing.cmpSourceTitle')}</a>{' '}
          {t('landing.cmpSourceNote')}
        </p>
      </section>

      {/* Ways in */}
      <section id="get" className="border-t border-chesscom-200 bg-white dark:border-chesscom-800 dark:bg-chesscom-800/40" aria-labelledby="get-title">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 id="get-title" className="text-2xl font-bold tracking-tight">{t('landing.getTitle')}</h2>
          <p className="mt-2 max-w-2xl text-chesscom-600 dark:text-chesscom-300">{t('landing.getBody')}</p>
          <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <div>
              <h3 className="text-lg font-semibold">{t('landing.useHereTitle')}</h3>
              <p className="mt-2 text-sm text-chesscom-600 dark:text-chesscom-300">{t('landing.useHereBody')}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {config.signup_enabled && (
                  <Link to="/signup" className="btn-primary"><UserPlus className="h-4 w-4" /> {t('landing.register')}</Link>
                )}
                <Link to="/login" className="btn-secondary"><LogIn className="h-4 w-4" /> {t('landing.login')}</Link>
              </div>
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold">{t('landing.selfHostTitle')}</h3>
              <p className="mt-2 text-sm text-chesscom-600 dark:text-chesscom-300">{t('landing.selfHostBody')}</p>
              <div className="mt-4"><InstallTabs /></div>
            </div>
          </div>
        </div>
      </section>

      {/* What a review gives you */}
      <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="what-title">
        <h2 id="what-title" className="text-2xl font-bold tracking-tight">{t('landing.whatTitle')}</h2>
        <dl className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2">
          {(['graded', 'moments', 'puzzles', 'coach'] as const).map((k) => (
            <div key={k} className="border-s-2 border-green-500 ps-4">
              <dt className="font-semibold">{t(`landing.what_${k}`)}</dt>
              <dd className="mt-1 text-sm text-chesscom-600 dark:text-chesscom-300">{t(`landing.what_${k}_body`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="border-t border-chesscom-200 dark:border-chesscom-800">
        <div className="mx-auto max-w-6xl space-y-2 px-4 py-8 text-sm text-chesscom-500">
          <p>
            <Trans
              i18nKey="landing.footerOrigins"
              components={{
                patzer: <a href="https://github.com/SikamikanikoBG/patzer" target="_blank" rel="noreferrer" className="underline hover:text-chesscom-800 dark:hover:text-chesscom-200" />,
                repo: <a href={REPO_URL} target="_blank" rel="noreferrer" className="underline hover:text-chesscom-800 dark:hover:text-chesscom-200" />,
              }}
            />
          </p>
          <p>{t('landing.footerPrivacy')}</p>
        </div>
      </footer>
    </div>
  );
}

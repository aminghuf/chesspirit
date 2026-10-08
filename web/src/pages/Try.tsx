import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, ExternalLink } from 'lucide-react';
import { api } from '../api';
import PublicHeader from '../components/PublicHeader';
import Spinner from '../components/Spinner';
import { useAuthConfig } from '../lib/useAuthConfig';
import { formatResult, type TryGame, type TryJob } from '../lib/share';
import { cn } from '../lib/utils';

type Site = 'chesscom' | 'lichess';

const ERROR_KEYS: Record<string, string> = {
  invalid_username: 'try.errInvalid',
  user_not_found: 'try.errNotFound',
  rate_limited: 'try.errRateLimited',
  busy: 'try.errBusy',
  upstream_busy: 'try.errUpstream',
  upstream_error: 'try.errUpstream',
  game_too_long: 'try.errTooLong',
  game_too_short: 'try.errTooShort',
};

function errorKey(e: unknown): string {
  const code = (e as { data?: { error?: string } })?.data?.error ?? '';
  return ERROR_KEYS[code] ?? 'try.errGeneric';
}

/** Site toggle + username box. Used in the landing hero and on /try. */
export function TryForm({ initialSite = 'chesscom', initialUser = '', compact = false }: { initialSite?: Site; initialUser?: string; compact?: boolean }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [site, setSite] = useState<Site>(initialSite);
  const [username, setUsername] = useState(initialUser);
  useEffect(() => { setSite(initialSite); setUsername(initialUser); }, [initialSite, initialUser]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const u = username.trim();
    if (!u) return;
    nav(`/try?site=${site}&u=${encodeURIComponent(u)}`);
  }

  return (
    <form onSubmit={submit} className={cn('flex flex-col gap-2', !compact && 'sm:flex-row')} aria-label={t('try.formLabel')}>
      <div role="radiogroup" aria-label={t('try.site')} className="inline-flex shrink-0 rounded-md border border-chesscom-200 bg-white p-0.5 dark:border-chesscom-700 dark:bg-chesscom-900">
        {(['chesscom', 'lichess'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={site === s}
            onClick={() => setSite(s)}
            className={cn(
              'rounded px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50',
              site === s ? 'bg-chesscom-800 text-white dark:bg-chesscom-100 dark:text-chesscom-900' : 'text-chesscom-600 hover:text-chesscom-900 dark:text-chesscom-300',
            )}
          >
            {s === 'chesscom' ? 'Chess.com' : 'Lichess'}
          </button>
        ))}
      </div>
      <input
        className="input min-w-0 flex-1"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder={t('try.usernamePlaceholder')}
        aria-label={t('try.username')}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={40}
      />
      <button type="submit" className="btn-primary shrink-0" disabled={!username.trim()}>
        <Search className="h-4 w-4" />
        {t('try.submit')}
      </button>
    </form>
  );
}

export default function Try() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const { config, loaded } = useAuthConfig();
  const [params] = useSearchParams();
  const site: Site = params.get('site') === 'lichess' ? 'lichess' : 'chesscom';
  const username = (params.get('u') ?? '').trim();

  const [games, setGames] = useState<TryGame[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState<TryJob | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!username || !config.public_site) return;
    let alive = true;
    setGames(null); setError(''); setLoading(true); setJob(null); setPickedId(null);
    api.get<{ games: TryGame[] }>(`/api/try/games?site=${site}&username=${encodeURIComponent(username)}`)
      .then((r) => { if (alive) setGames(r.games); })
      .catch((e) => { if (alive) setError(t(errorKey(e), { name: username })); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [site, username, config.public_site, t]);

  useEffect(() => () => { if (pollRef.current) window.clearTimeout(pollRef.current); }, []);

  function poll(id: string) {
    pollRef.current = window.setTimeout(async () => {
      try {
        const r = await api.get<{ job: TryJob }>(`/api/try/jobs/${id}`);
        setJob(r.job);
        if (r.job.status === 'done' && r.job.slug) { nav(`/r/${r.job.slug}`); return; }
        if (r.job.status === 'error') { setError(t('try.errGeneric')); setPickedId(null); return; }
        poll(id);
      } catch {
        setError(t('try.errGeneric'));
        setPickedId(null);
      }
    }, 1000);
  }

  async function review(g: TryGame) {
    if (g.slug) { nav(`/r/${g.slug}`); return; }
    setError(''); setPickedId(g.id);
    try {
      const r = await api.post<{ job: TryJob | null; slug?: string }>('/api/try/analyze', { site, username, id: g.id });
      if (r.slug) { nav(`/r/${r.slug}`); return; }
      if (r.job) { setJob(r.job); poll(r.job.id); }
    } catch (e) {
      setError(t(errorKey(e), { name: username }));
      setPickedId(null);
    }
  }

  if (loaded && !config.public_site) return <Navigate to="/login" replace />;

  const dateFmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  const busy = pickedId !== null;

  return (
    <div className="min-h-screen bg-cream dark:bg-chesscom-900">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('try.title')}</h1>
        <p className="mt-1 text-chesscom-500 dark:text-chesscom-300">{t('try.subtitle')}</p>
        <div className="mt-5">
          <TryForm initialSite={site} initialUser={username} />
        </div>

        {error && <div role="alert" className="mt-4 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}

        {loading && (
          <div className="mt-8 flex items-center gap-3 text-chesscom-500"><Spinner /> {t('try.loadingGames', { name: username })}</div>
        )}

        {games && games.length === 0 && (
          <p className="mt-8 text-chesscom-500">{t('try.noGames', { name: username })}</p>
        )}

        {games && games.length > 0 && (
          <section className="mt-8" aria-labelledby="try-games">
            <h2 id="try-games" className="text-lg font-semibold">{t('try.pickGame')}</h2>
            <ul className="mt-3 divide-y divide-chesscom-200 overflow-hidden rounded-lg border border-chesscom-200 bg-white dark:divide-chesscom-700 dark:border-chesscom-700 dark:bg-chesscom-800">
              {games.map((g) => {
                const running = pickedId === g.id && job;
                const pct = running && job.total ? Math.round((job.done / job.total) * 100) : 0;
                return (
                  <li key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium" dir="ltr">
                        <span className={g.user_color === 'white' ? 'underline decoration-green-500 decoration-2 underline-offset-4' : ''}>{g.white}</span>
                        {g.white_rating ? <span className="text-chesscom-400"> ({g.white_rating})</span> : null}
                        <span className="px-2 text-chesscom-400">{formatResult(g.result) || '–'}</span>
                        <span className={g.user_color === 'black' ? 'underline decoration-green-500 decoration-2 underline-offset-4' : ''}>{g.black}</span>
                        {g.black_rating ? <span className="text-chesscom-400"> ({g.black_rating})</span> : null}
                      </div>
                      <div className="mt-0.5 truncate text-sm text-chesscom-500 dark:text-chesscom-300">
                        {[g.time_class ? t(`try.tc.${g.time_class}`, { defaultValue: g.time_class }) : null, g.opening, dateFmt.format(new Date(g.end_time)), t('try.moves', { count: Math.ceil(g.plies / 2) })]
                          .filter(Boolean).join(', ')}
                      </div>
                      {running && (
                        <div className="mt-2" aria-live="polite">
                          <div className="h-1.5 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-700">
                            <div className="h-full bg-green-500 transition-[width] duration-500" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="mt-1 text-xs text-chesscom-500">
                            {job.status === 'queued'
                              ? t('try.queued', { position: job.position })
                              : t('try.analyzing', { done: job.done, total: job.total })}
                          </div>
                        </div>
                      )}
                    </div>
                    {g.url && (
                      <a href={g.url} target="_blank" rel="noreferrer" className="text-chesscom-400 hover:text-chesscom-700 dark:hover:text-chesscom-100" aria-label={t('try.openOriginal')}>
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    <button type="button" className={g.slug ? 'btn-secondary' : 'btn-primary'} disabled={busy} onClick={() => void review(g)}>
                      {pickedId === g.id ? <Spinner /> : null}
                      {g.slug ? t('try.openReview') : t('try.review')}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-chesscom-500">{t('try.privacy')}</p>
          </section>
        )}

        {!username && (
          <p className="mt-8 text-sm text-chesscom-500">
            {t('try.orSignup')} <Link to="/signup" className="font-medium text-green-600 hover:underline">{t('landing.register')}</Link>
          </p>
        )}
      </main>
    </div>
  );
}

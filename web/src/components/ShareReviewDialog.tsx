import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Download, Link2Off, X } from 'lucide-react';
import { api } from '../api';
import Spinner from './Spinner';
import { cardUrl, copyText } from '../lib/share';

// "Share review": turns one of my analysed games into a public link with a
// PNG card. Creating the link is the opt-in; "Stop sharing" deletes it.
export default function ShareReviewDialog({ gameId, onClose }: { gameId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const [slug, setSlug] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    api.post<{ slug: string; url: string }>(`/api/share/game/${gameId}`)
      .then((r) => { if (alive) { setSlug(r.slug); setUrl(r.url); } })
      .catch((e) => {
        if (!alive) return;
        const code = (e as { data?: { error?: string } })?.data?.error;
        setError(code === 'not_analyzed' ? t('share.needsAnalysis') : t('share.createFailed'));
      })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [gameId, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function stop() {
    setBusy(true);
    try { await api.del(`/api/share/game/${gameId}`); onClose(); } catch { setError(t('share.createFailed')); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={onClose}>
      <div className="card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="share-title" className="text-lg font-semibold">{t('share.dialogTitle')}</h2>
          <button type="button" className="btn-ghost p-1" onClick={onClose} aria-label={t('common.close', { defaultValue: 'Close' })}><X className="h-4 w-4" /></button>
        </div>
        {busy && !slug && <div className="flex justify-center py-10"><Spinner size="lg" /></div>}
        {error && <p role="alert" className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
        {slug && (
          <div className="mt-3 space-y-3">
            <img src={cardUrl(slug)} alt={t('share.cardAlt')} className="aspect-[1200/630] w-full rounded-md border border-chesscom-200 bg-chesscom-800 dark:border-chesscom-700" />
            <div className="flex gap-2">
              <input className="input min-w-0 flex-1 font-mono text-xs" value={url} readOnly onFocus={(e) => e.currentTarget.select()} aria-label={t('share.link')} dir="ltr" />
              <button type="button" className="btn-primary shrink-0" onClick={async () => { if (await copyText(url)) { setCopied(true); window.setTimeout(() => setCopied(false), 1600); } }}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? t('share.copied') : t('share.copyLink')}
              </button>
            </div>
            <p className="text-xs text-chesscom-500">{t('share.publicNote')}</p>
            <div className="flex flex-wrap justify-between gap-2">
              <a className="btn-secondary" href={`${cardUrl(slug)}?download=1`} download><Download className="h-4 w-4" /> {t('share.downloadImage')}</a>
              <button type="button" className="btn-ghost text-bad" onClick={() => void stop()} disabled={busy}><Link2Off className="h-4 w-4" /> {t('share.stopSharing')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

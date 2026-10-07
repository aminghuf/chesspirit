// Settings → Connections: the user's own LLM for the coach and their own
// Lichess API token for the opening explorer (GET/PATCH /api/settings/services).
// Saved on its own, apart from the profile form — a key is sent only when one
// was typed, and is never sent back.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Loader2, PlugZap } from 'lucide-react';
import { api } from '../api';

type Provider = 'ollama' | 'vllm' | 'deepseek';

interface Services {
  llm_provider: Provider | null;
  llm_url: string;
  llm_model: string;
  llm_key_set: boolean;
  llm_ready: boolean;
  llm_hosts_allowed: boolean;
  lichess_token_set: boolean;
}

export default function ConnectionsSettings() {
  const { t } = useTranslation();
  const [data, setData] = useState<Services | null>(null);
  const [provider, setProvider] = useState<Provider | ''>('');
  const [url, setUrl] = useState('');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);

  function hydrate(d: Services) {
    setData(d);
    setProvider(d.llm_provider ?? '');
    setUrl(d.llm_url);
    setModel(d.llm_model);
    setKey('');
    setToken('');
  }

  useEffect(() => { api.get<Services>('/api/settings/services').then(hydrate).catch(() => undefined); }, []);

  if (!data) return null;

  async function put(body: Record<string, unknown>) {
    setBusy(true); setError(null); setSaved(false); setTest(null);
    try {
      hydrate(await api.patch<Services>('/api/settings/services', body));
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      const code = (err as { error?: string; message?: string }).error ?? (err as Error).message ?? '';
      setError(t(`connections.error.${code}`, { defaultValue: t('connections.error.generic') }));
    } finally {
      setBusy(false);
    }
  }

  const save = () => put({
    llm_provider: provider || null,
    llm_url: url,
    llm_model: model,
    ...(key ? { llm_api_key: key } : {}),
    ...(token ? { lichess_token: token } : {}),
  });

  async function testLlm() {
    setTest(null); setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; models?: string[]; error?: string }>('/api/settings/services/test-llm', {});
      setTest(r.ok
        ? { ok: true, msg: t('connections.testOk', { n: r.models?.length ?? 0 }) }
        : { ok: false, msg: t(`connections.error.${r.error}`, { defaultValue: r.error ?? t('connections.error.generic') }) });
    } finally {
      setBusy(false);
    }
  }

  const hostProvider = provider === 'ollama' || provider === 'vllm';
  const status = data.llm_ready ? t('connections.sourceOwn') : t('connections.sourceNone');

  return (
    <section className="card overflow-hidden">
      <div className="section-header">
        <div className="section-icon bg-sky-500/15 text-sky-600"><PlugZap className="h-4 w-4" /></div>
        <div>
          <div className="section-title">{t('connections.title')}</div>
          <div className="section-desc">{t('connections.desc')}</div>
        </div>
      </div>
      <div className="space-y-5 p-5">
        <div>
          <label className="label mb-1 block">{t('connections.llm')}</label>
          <select className="input" value={provider} onChange={(e) => setProvider(e.target.value as Provider | '')}>
            <option value="">{t('connections.none')}</option>
            <option value="deepseek">DeepSeek</option>
            {(data.llm_hosts_allowed || provider === 'ollama') && <option value="ollama">Ollama</option>}
            {(data.llm_hosts_allowed || provider === 'vllm') && <option value="vllm">vLLM</option>}
          </select>
          <div className="mt-1 text-xs text-ink-400">{t('connections.llmHelp')} {status}</div>
        </div>

        {provider === 'deepseek' && (
          <div>
            <label className="label mb-1 block">{t('connections.apiKey')}</label>
            <input className="input" type="password" autoComplete="new-password" value={key} dir="ltr"
              onChange={(e) => setKey(e.target.value)} placeholder={data.llm_key_set ? '••••••••' : 'sk-…'} />
            <div className="mt-1 text-xs text-ink-400">
              {data.llm_key_set ? t('connections.keySaved') : t('connections.apiKeyHelp')}
            </div>
          </div>
        )}
        {hostProvider && (
          <div>
            <label className="label mb-1 block">{t('connections.url')}</label>
            <input className="input" value={url} dir="ltr" onChange={(e) => setUrl(e.target.value)}
              placeholder={provider === 'ollama' ? 'http://192.168.1.20:11434' : 'http://192.168.1.20:8000'} />
            {!data.llm_hosts_allowed && (
              <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><AlertCircle className="h-3.5 w-3.5" /> {t('connections.error.llm_hosts_not_allowed')}</p>
            )}
          </div>
        )}
        {provider !== '' && (
          <div>
            <label className="label mb-1 block">{t('connections.model')}</label>
            <input className="input" value={model} dir="ltr" onChange={(e) => setModel(e.target.value)}
              placeholder={provider === 'deepseek' ? 'deepseek-chat' : provider === 'ollama' ? 'gemma3:1b' : ''} />
          </div>
        )}

        <div className="border-t border-ink-100 pt-5 dark:border-ink-700">
          <label className="label mb-1 block">{t('connections.lichessToken')}</label>
          <input className="input" type="password" autoComplete="new-password" value={token} dir="ltr"
            onChange={(e) => setToken(e.target.value)} placeholder={data.lichess_token_set ? '••••••••' : 'lip_…'} />
          <div className="mt-1 text-xs text-ink-400">
            {data.lichess_token_set ? t('connections.tokenSaved') : t('connections.lichessTokenHelp')}{' '}
            <a href="https://lichess.org/account/oauth/token" target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">lichess.org/account/oauth/token</a>
          </div>
        </div>

        {error && <p className="flex items-center gap-1 text-sm text-mistake"><AlertCircle className="h-4 w-4" /> {error}</p>}
        {test && (
          <p className={`flex items-center gap-1 text-sm ${test.ok ? 'text-board-dark' : 'text-mistake'}`}>
            {test.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />} {test.msg}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={save} disabled={busy} className="btn-primary text-sm">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {saved ? t('connections.saved') : t('connections.save')}
          </button>
          {data.llm_provider && (
            <button onClick={testLlm} disabled={busy} className="btn-secondary text-sm">{t('connections.test')}</button>
          )}
          {data.llm_key_set && (
            <button onClick={() => put({ llm_api_key: null })} disabled={busy} className="btn-ghost text-sm">{t('connections.removeKey')}</button>
          )}
          {data.lichess_token_set && (
            <button onClick={() => put({ lichess_token: null })} disabled={busy} className="btn-ghost text-sm">{t('connections.removeToken')}</button>
          )}
        </div>
      </div>
    </section>
  );
}

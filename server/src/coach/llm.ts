import { AsyncLocalStorage } from 'node:async_hooks';
import { getSetting } from '../db.js';
import { getUserServices, isAdminUser } from '../userServices.js';

export type LlmProvider = 'ollama' | 'vllm' | 'deepseek';

// Reasoning models (Qwen3 and friends) emit a chain-of-thought that isn't
// part of `content` but does eat into `max_tokens`, so a tight budget leaves
// nothing for the actual answer — same failure mode as Ollama's `think`
// field, addressed the same way. `chat_template_kwargs` is vLLM's pass-through
// to the tokenizer's chat template; non-thinking models/templates ignore it.
const VLLM_NO_THINK = { chat_template_kwargs: { enable_thinking: false } };

// DeepSeek is a hosted OpenAI-compatible API — the "cloud LLM" option
// alongside local Ollama / self-hosted vLLM. Its host is fixed: a user only
// supplies a key. DEEPSEEK_URL lets the operator point every DeepSeek user at
// a proxy instead (and lets the tests point at a fake).
const DEEPSEEK_BASE = 'https://api.deepseek.com';
function deepseekBase(): string {
  return (process.env.DEEPSEEK_URL || DEEPSEEK_BASE).replace(/\/+$/, '');
}

export interface LlmModel { name: string; size: number; details?: { parameter_size?: string } }

// ---- Whose LLM? --------------------------------------------------------
//
// There is no server-wide LLM. Each user brings their own (Settings →
// Connections, stored in user_services): their key, their bill. A user who
// hasn't added one has no coach — the engine facts still show as plain text.

export interface LlmConfig {
  provider: LlmProvider;
  url: string;
  model: string;
  apiKey: string | null;
}

// A user-supplied Ollama/vLLM URL makes this server send requests to a host
// of that user's choosing — fine in a household, an SSRF door on an instance
// with strangers on it. Admins may always use one; everyone else only once an
// admin opts in. DeepSeek (a fixed host) is open to every user.
export function userLlmHostsAllowed(userId: number): boolean {
  return getSetting('llm_user_hosts') === '1' || isAdminUser(userId);
}

export function userLlm(userId: number): LlmConfig | null {
  const s = getUserServices(userId);
  if (s.llm_provider === 'deepseek') {
    if (!s.llm_api_key) return null;
    return { provider: 'deepseek', url: deepseekBase(), model: s.llm_model || 'deepseek-chat', apiKey: s.llm_api_key };
  }
  if (s.llm_provider === 'ollama' || s.llm_provider === 'vllm') {
    if (!s.llm_url || !userLlmHostsAllowed(userId)) return null;
    const model = s.llm_model || (s.llm_provider === 'ollama' ? 'gemma3:1b' : '');
    return { provider: s.llm_provider, url: s.llm_url.replace(/\/+$/, ''), model, apiKey: null };
  }
  return null;
}

// The user a coach call is being made for. Set once where a request or a
// background job knows its user (withLlmUser) so the prompt-building layers in
// between don't each have to pass an id down to chatStream/chatJson.
const llmUser = new AsyncLocalStorage<number>();
export function withLlmUser<T>(userId: number | null | undefined, fn: () => T): T {
  return userId ? llmUser.run(userId, fn) : fn();
}

/** The LLM to use for `userId` (default: the user of the current coach call).
 *  Null when that user has none — and always when there is no user. */
export function activeLlm(userId: number | null | undefined = llmUser.getStore()): LlmConfig | null {
  return userId ? userLlm(userId) : null;
}

/** Whether the coach can answer for `userId` (default: the current call's user). */
export function llmConfigured(userId?: number | null): boolean {
  return !!activeLlm(userId ?? undefined);
}

// OpenAI-compatible providers (vLLM, DeepSeek) speak the same dialect; these
// helpers centralize the two places they differ — where the API root is and
// the auth header (DeepSeek needs a Bearer key, vLLM is usually unauthenticated).
//
// The vLLM URL is the bare server (`http://host:8000`) and its routes live
// under `/v1` — for models *and* chat. 7.15.0 dropped the `/v1` from the model
// list, which broke "Test" on every existing vLLM setup, and adding `/v1` to
// the URL as a workaround then broke chat (`/v1/v1/…`). A vLLM URL that already
// ends in `/v1` is accepted, since that is how OpenAI base URLs are usually
// written. DeepSeek's URL is already the API root. server/test/llm-providers
// pins every route.
type OpenAiLike = 'vllm' | 'deepseek';
export function openAiRoot(url: string, provider: OpenAiLike): string {
  const base = url.replace(/\/+$/, '');
  return provider === 'vllm' ? `${base.replace(/\/v1$/, '')}/v1` : base;
}
function openAiEndpoint(base: string, provider: OpenAiLike, path: 'models' | 'chat/completions' = 'chat/completions'): string {
  return `${openAiRoot(base, provider)}/${path}`;
}
function openAiHeaders(provider: OpenAiLike, apiKey: string | null): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider === 'deepseek') h.Authorization = `Bearer ${apiKey ?? ''}`;
  return h;
}

/** List models available on a host, normalized across providers. Ollama
 *  exposes its native `/api/tags`; vLLM (`/v1/models`) and DeepSeek
 *  (`/models`) expose the OpenAI-compatible list (one entry per served model). */
export async function testConnection(url: string, provider: LlmProvider, apiKey: string | null = null): Promise<{ ok: true; models: LlmModel[] } | { ok: false; error: string }> {
  const base = url.replace(/\/$/, '');
  try {
    if (provider === 'vllm' || provider === 'deepseek') {
      if (provider === 'deepseek' && !apiKey) return { ok: false, error: 'deepseek_api_key_missing' };
      const res = await fetch(openAiEndpoint(base, provider, 'models'), {
        headers: provider === 'deepseek' ? { Authorization: `Bearer ${apiKey ?? ''}` } : undefined,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = (await res.json()) as { data?: { id: string }[] };
      return { ok: true, models: (data.data ?? []).map((m) => ({ name: m.id, size: 0 })) };
    }
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: LlmModel[] };
    return { ok: true, models: data.models ?? [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

interface ChatOpts {
  model?: string; temperature?: number; topP?: number; numPredict?: number;
  signal?: AbortSignal; hardTimeoutMs?: number; idleTimeoutMs?: number;
}

// Streams response chunks. Calls `onChunk` per token batch.
// Hard timeout (default 120s) and idle timeout (default 30s) ensure silent
// failures (model loading forever, network hung) become loud errors.
export async function chatStream(messages: ChatMessage[], onChunk: (text: string) => void, opts: ChatOpts = {}): Promise<void> {
  const cfg = activeLlm();
  if (!cfg) throw new Error('llm_not_configured');
  const { url, provider } = cfg;
  const model = opts.model ?? cfg.model;
  const hardMs = opts.hardTimeoutMs ?? 120_000;
  const idleMs = opts.idleTimeoutMs ?? 30_000;

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const hardTimer = setTimeout(() => ac.abort(new Error('llm_hard_timeout')), hardMs);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  function bumpIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ac.abort(new Error('llm_idle_timeout')), idleMs);
  }
  bumpIdle();

  try {
    if (provider === 'vllm' || provider === 'deepseek') {
      const body: Record<string, unknown> = {
        model, messages, stream: true,
        temperature: opts.temperature ?? 0.3,
        top_p: opts.topP ?? 0.9,
        max_tokens: opts.numPredict ?? 220,
      };
      if (provider === 'vllm') Object.assign(body, VLLM_NO_THINK);
      const res = await fetch(openAiEndpoint(url, provider), {
        method: 'POST',
        headers: openAiHeaders(provider, cfg.apiKey),
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`llm_http_${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bumpIdle();
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line || !line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
            if (obj.error) throw new Error(`llm_${obj.error.message ?? 'error'}`);
            const text = obj.choices?.[0]?.delta?.content;
            if (text) onChunk(text);
          } catch (err) {
            if ((err as Error).message?.startsWith('llm_')) throw err;
            // ignore malformed JSON lines
          }
        }
      }
    } else {
      const res = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, messages, stream: true,
          // Reasoning models (gemma4, gpt-oss, …) emit a chain-of-thought into
          // `message.thinking` and only put the final answer into
          // `message.content`. With a tight num_predict that CoT eats the whole
          // budget and the user sees an empty stream. The coach is a faithful
          // FACTS renderer, not an analyst — disable reasoning everywhere.
          // Non-reasoning models silently ignore this flag.
          think: false,
          options: {
            temperature: opts.temperature ?? 0.3,
            top_p: opts.topP ?? 0.9,
            num_predict: opts.numPredict ?? 220,
          },
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`llm_http_${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bumpIdle();
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
            if (obj.error) throw new Error(`llm_${obj.error}`);
            const text = obj.message?.content;
            if (text) onChunk(text);
          } catch (err) {
            if ((err as Error).message?.startsWith('llm_')) throw err;
            // ignore malformed JSON lines
          }
        }
      }
    }
  } finally {
    clearTimeout(hardTimer);
    if (idleTimer) clearTimeout(idleTimer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

// Non-streaming JSON-mode call. Used for batched game review where we need
// structured output (per-move comments + summary) in one response. Ollama's
// `format: "json"` and the OpenAI-compatible `response_format:
// {type:"json_object"}` both constrain the model to valid JSON; we still
// parse defensively.
export async function chatJson<T = unknown>(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number; numPredict?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const cfg = activeLlm();
  if (!cfg) throw new Error('llm_not_configured');
  const { url, provider } = cfg;
  const model = opts.model ?? cfg.model;
  const timeoutMs = opts.timeoutMs ?? 180_000;

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ac.abort(new Error('llm_hard_timeout')), timeoutMs);
  try {
    let raw: string;
    if (provider === 'vllm' || provider === 'deepseek') {
      const body: Record<string, unknown> = {
        model, messages, stream: false,
        response_format: { type: 'json_object' },
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.numPredict ?? 1500,
      };
      if (provider === 'vllm') Object.assign(body, VLLM_NO_THINK);
      const res = await fetch(openAiEndpoint(url, provider), {
        method: 'POST',
        headers: openAiHeaders(provider, cfg.apiKey),
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`llm_http_${res.status}`);
      const data = await res.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
      if (data.error) throw new Error(`llm_${data.error.message ?? 'error'}`);
      raw = data.choices?.[0]?.message?.content ?? '';
    } else {
      const res = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, messages, stream: false,
          format: 'json',
          think: false,
          options: {
            temperature: opts.temperature ?? 0.2,
            num_predict: opts.numPredict ?? 1500,
          },
        }),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`llm_http_${res.status}`);
      const data = await res.json() as { message?: { content?: string }; error?: string };
      if (data.error) throw new Error(`llm_${data.error}`);
      raw = data.message?.content ?? '';
    }
    // Some models still wrap JSON in fences despite the json-mode request. Strip them.
    const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch (err) {
      throw new Error(`llm_bad_json: ${(err as Error).message}: ${cleaned.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** chatJson with a single retry on bad-JSON. The retry adds a "your previous
 *  reply was not valid JSON" addendum, which small models respond to well. */
export async function chatJsonRetry<T = unknown>(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number; numPredict?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  try {
    return await chatJson<T>(messages, opts);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (!msg.startsWith('llm_bad_json')) throw err;
    const retried: ChatMessage[] = [
      ...messages,
      { role: 'user', content: 'Your previous reply was not valid JSON. Reply ONLY with the JSON object, no surrounding text.' },
    ];
    return chatJson<T>(retried, opts);
  }
}

// Quick smoke test of a single model — sends a tiny prompt and reports timing.
export async function testModel(url: string, model: string, timeoutMs: number, provider: LlmProvider, apiKey: string | null = null): Promise<{ ok: boolean; latencyMs: number; sample?: string; error?: string }> {
  const base = url.replace(/\/$/, '');
  const start = Date.now();
  try {
    if (provider === 'vllm' || provider === 'deepseek') {
      const body: Record<string, unknown> = {
        model,
        messages: [{ role: 'user', content: 'Reply with exactly the word OK and nothing else.' }],
        stream: false,
        temperature: 0.1,
      };
      if (provider === 'vllm') Object.assign(body, VLLM_NO_THINK);
      const res = await fetch(openAiEndpoint(base, provider), {
        method: 'POST',
        headers: openAiHeaders(provider, apiKey),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) return { ok: false, latencyMs, error: `HTTP ${res.status}` };
      const data = await res.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
      if (data.error) return { ok: false, latencyMs, error: data.error.message };
      const sample = (data.choices?.[0]?.message?.content ?? '').trim().slice(0, 80);
      return { ok: !!sample, latencyMs, sample };
    }
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly the word OK and nothing else.' }],
        stream: false,
        options: { temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    const data = await res.json() as { message?: { content?: string }; error?: string };
    if (data.error) return { ok: false, latencyMs, error: data.error };
    const sample = (data.message?.content ?? '').trim().slice(0, 80);
    return { ok: !!sample, latencyMs, sample };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
  }
}

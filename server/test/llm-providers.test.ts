import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Regression suite for the coach's LLM client, run against three fake servers
// over real HTTP. Each fake serves only the routes its real counterpart has,
// so a request to the wrong path fails the same way it would in production:
//
//   Ollama   — /api/tags, /api/chat
//   vLLM     — /v1/models, /v1/chat/completions  (bare server URL + /v1)
//   DeepSeek — /models, /chat/completions        (URL is the API root, Bearer key)
//
// Written after 7.15.0 sent vLLM's model list to /models: "Test" failed on
// every existing vLLM setup, and adding /v1 to the URL as a workaround broke
// chat instead (/v1/v1/chat/completions). No test covered the routes, so CI
// stayed green. Every provider × every entry point × every URL spelling a
// user might type is pinned here.

const dir = mkdtempSync(join(tmpdir(), 'patzer-llm-'));
process.env.DB_PATH = join(dir, 'llm.db');
const DEEPSEEK_KEY = 'sk-test-123';

type LlmModule = typeof import('../src/coach/llm.js');

interface Seen { method: string; path: string; auth?: string; body?: Record<string, unknown> }

interface Fake { url: string; seen: Seen[]; server: Server }

const MODEL = { ollama: 'gemma3:1b', vllm: 'Qwen3-8B', deepseek: 'deepseek-chat' } as const;

function readBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw) as Record<string, unknown>); } catch { resolve(undefined); }
    });
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// An OpenAI-compatible chat answer: SSE when streaming, a JSON body otherwise,
// JSON content in json_object mode.
function openAiChat(res: ServerResponse, body: Record<string, unknown> | undefined): void {
  const jsonMode = (body?.response_format as { type?: string } | undefined)?.type === 'json_object';
  if (body?.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const part of ['Develop ', 'your ', 'knight.']) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
    }
    res.end('data: [DONE]\n\n');
    return;
  }
  json(res, 200, { choices: [{ message: { content: jsonMode ? '{"summary":"ok"}' : 'OK' } }] });
}

async function startFake(kind: 'ollama' | 'vllm' | 'deepseek'): Promise<Fake> {
  const seen: Seen[] = [];
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    const path = (req.url ?? '').split('?')[0]!;
    seen.push({ method: req.method ?? '', path, auth: req.headers.authorization, body });

    if (kind === 'ollama') {
      if (req.method === 'GET' && path === '/api/tags') return json(res, 200, { models: [{ name: MODEL.ollama, size: 1 }] });
      if (req.method === 'POST' && path === '/api/chat') {
        if (body?.stream) {
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
          for (const part of ['Develop ', 'your ', 'knight.']) res.write(JSON.stringify({ message: { content: part }, done: false }) + '\n');
          res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
          return;
        }
        return json(res, 200, { message: { content: body?.format === 'json' ? '{"summary":"ok"}' : 'OK' } });
      }
    }

    if (kind === 'vllm') {
      if (req.method === 'GET' && path === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: MODEL.vllm }] });
      if (req.method === 'POST' && path === '/v1/chat/completions') return openAiChat(res, body);
    }

    if (kind === 'deepseek') {
      if (req.headers.authorization !== `Bearer ${DEEPSEEK_KEY}`) return json(res, 401, { error: { message: 'Authentication Fails' } });
      if (req.method === 'GET' && path === '/models') return json(res, 200, { object: 'list', data: [{ id: MODEL.deepseek }] });
      if (req.method === 'POST' && path === '/chat/completions') return openAiChat(res, body);
    }

    json(res, 404, { detail: 'Not Found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen, server };
}

let llm: LlmModule;
let setSetting: (k: string, v: string) => void;
let services: typeof import('../src/userServices.js');
const fakes = {} as Record<'ollama' | 'vllm' | 'deepseek', Fake>;

// Every spelling of the same server a user might paste into Admin → System.
function spellings(base: string): string[] {
  return [base, `${base}/`, `${base}/v1`, `${base}/v1/`];
}

// The LLM is per user: give user 1 (an admin, so Ollama/vLLM hosts are allowed)
// this provider. DeepSeek's host is fixed in production; DEEPSEEK_URL points
// it at the fake.
function useProvider(p: 'ollama' | 'vllm' | 'deepseek', url: string): void {
  if (p === 'deepseek') {
    process.env.DEEPSEEK_URL = url;
    services.setUserServices(1, { llm_provider: p, llm_url: null, llm_model: MODEL[p], llm_api_key: DEEPSEEK_KEY });
  } else {
    services.setUserServices(1, { llm_provider: p, llm_url: url || null, llm_model: MODEL[p], llm_api_key: null });
  }
}

// Coach calls are made for a user (withLlmUser); these run as user 1.
const chat = {
  chatStream: (...a: Parameters<LlmModule['chatStream']>) => llm.withLlmUser(1, () => llm.chatStream(...a)),
  chatJson: <T,>(...a: Parameters<LlmModule['chatJson']>) => llm.withLlmUser(1, () => llm.chatJson<T>(...a)),
};

beforeAll(async () => {
  fakes.ollama = await startFake('ollama');
  fakes.vllm = await startFake('vllm');
  fakes.deepseek = await startFake('deepseek');
  const dbm = await import('../src/db.js');
  setSetting = dbm.setSetting;
  llm = await import('../src/coach/llm.js');
  services = await import('../src/userServices.js');
  dbm.db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'boss', 'x', 'admin')`).run();
  dbm.db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (1, 'Boss')`).run();
});

afterAll(async () => {
  for (const f of Object.values(fakes)) await new Promise((r) => f.server.close(r));
  try { (await import('../src/db.js')).db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const f of Object.values(fakes)) f.seen.length = 0;
});

const paths = (f: Fake) => f.seen.map((s) => `${s.method} ${s.path}`);

describe('openAiRoot', () => {
  it('puts vLLM under /v1 however the URL is written, and never twice', () => {
    for (const u of spellings('http://gpu:8000')) expect(llm.openAiRoot(u, 'vllm'), u).toBe('http://gpu:8000/v1');
    expect(llm.openAiRoot('http://gpu:8000/v1//', 'vllm')).toBe('http://gpu:8000/v1');
  });

  it('keeps a path prefix in front of vLLM (reverse proxy)', () => {
    expect(llm.openAiRoot('https://box.lan/llm', 'vllm')).toBe('https://box.lan/llm/v1');
    expect(llm.openAiRoot('https://box.lan/llm/v1', 'vllm')).toBe('https://box.lan/llm/v1');
  });

  it('leaves the DeepSeek root as typed', () => {
    expect(llm.openAiRoot('https://api.deepseek.com', 'deepseek')).toBe('https://api.deepseek.com');
    expect(llm.openAiRoot('https://api.deepseek.com/', 'deepseek')).toBe('https://api.deepseek.com');
    expect(llm.openAiRoot('https://api.deepseek.com/v1', 'deepseek')).toBe('https://api.deepseek.com/v1');
  });
});

describe('vLLM', () => {
  for (const spell of ['', '/', '/v1', '/v1/']) {
    describe(`URL written as <server>${spell}`, () => {
      const url = () => fakes.vllm.url + spell;

      it('lists models from /v1/models', async () => {
        const r = await llm.testConnection(url(), 'vllm');
        expect(r).toEqual({ ok: true, models: [{ name: MODEL.vllm, size: 0 }] });
        expect(paths(fakes.vllm)).toEqual(['GET /v1/models']);
      });

      it('tests a model on /v1/chat/completions, thinking off, no auth header', async () => {
        const r = await llm.testModel(url(), MODEL.vllm, 5000, 'vllm');
        expect(r.ok).toBe(true);
        expect(r.sample).toBe('OK');
        expect(paths(fakes.vllm)).toEqual(['POST /v1/chat/completions']);
        const req = fakes.vllm.seen[0]!;
        expect(req.auth).toBeUndefined();
        expect(req.body?.model).toBe(MODEL.vllm);
        expect(req.body?.chat_template_kwargs).toEqual({ enable_thinking: false });
      });

      it('streams the coach from /v1/chat/completions', async () => {
        useProvider('vllm', url());
        let text = '';
        await chat.chatStream([{ role: 'user', content: 'hi' }], (t) => { text += t; });
        expect(text).toBe('Develop your knight.');
        expect(paths(fakes.vllm).filter((p) => p.startsWith('POST'))).toEqual(['POST /v1/chat/completions']);
        expect(fakes.vllm.seen.find((s) => s.method === 'POST')!.body?.stream).toBe(true);
      });

      it('writes JSON reviews through /v1/chat/completions', async () => {
        useProvider('vllm', url());
        const out = await chat.chatJson<{ summary: string }>([{ role: 'user', content: 'review' }]);
        expect(out).toEqual({ summary: 'ok' });
        const post = fakes.vllm.seen.find((s) => s.method === 'POST')!;
        expect(post.path).toBe('/v1/chat/completions');
        expect(post.body?.response_format).toEqual({ type: 'json_object' });
      });
    });
  }

  it('reports a wrong server instead of pretending', async () => {
    const r = await llm.testConnection(fakes.ollama.url, 'vllm');
    expect(r).toEqual({ ok: false, error: 'HTTP 404' });
  });
});

describe('DeepSeek', () => {
  it('lists models from /models with the Bearer key', async () => {
    const r = await llm.testConnection(fakes.deepseek.url, 'deepseek', DEEPSEEK_KEY);
    expect(r).toEqual({ ok: true, models: [{ name: MODEL.deepseek, size: 0 }] });
    expect(paths(fakes.deepseek)).toEqual(['GET /models']);
    expect(fakes.deepseek.seen[0]!.auth).toBe(`Bearer ${DEEPSEEK_KEY}`);
  });

  it('refuses to test without a key, and never calls out', async () => {
    const r = await llm.testConnection(fakes.deepseek.url, 'deepseek');
    expect(r).toEqual({ ok: false, error: 'deepseek_api_key_missing' });
    expect(fakes.deepseek.seen).toHaveLength(0);
  });

  it('tests a model on /chat/completions without vLLM-only fields', async () => {
    const r = await llm.testModel(`${fakes.deepseek.url}/`, MODEL.deepseek, 5000, 'deepseek', DEEPSEEK_KEY);
    expect(r).toMatchObject({ ok: true, sample: 'OK' });
    const req = fakes.deepseek.seen[0]!;
    expect(`${req.method} ${req.path}`).toBe('POST /chat/completions');
    expect(req.auth).toBe(`Bearer ${DEEPSEEK_KEY}`);
    expect(req.body).not.toHaveProperty('chat_template_kwargs');
  });

  it('streams the coach and writes JSON reviews', async () => {
    useProvider('deepseek', fakes.deepseek.url);
    let text = '';
    await chat.chatStream([{ role: 'user', content: 'hi' }], (t) => { text += t; });
    expect(text).toBe('Develop your knight.');
    expect(await chat.chatJson([{ role: 'user', content: 'review' }])).toEqual({ summary: 'ok' });
    expect(paths(fakes.deepseek).filter((p) => p.startsWith('POST'))).toEqual(['POST /chat/completions', 'POST /chat/completions']);
  });

  it('counts as configured only with a key', () => {
    useProvider('deepseek', fakes.deepseek.url);
    expect(llm.llmConfigured(1)).toBe(true);
    services.setUserServices(1, { llm_api_key: null });
    expect(llm.llmConfigured(1)).toBe(false);
  });
});

describe('Ollama', () => {
  for (const spell of ['', '/']) {
    it(`lists, tests, streams and reviews on its native routes (<server>${spell})`, async () => {
      const url = fakes.ollama.url + spell;
      expect(await llm.testConnection(url, 'ollama')).toEqual({ ok: true, models: [{ name: MODEL.ollama, size: 1 }] });
      expect(await llm.testModel(url, MODEL.ollama, 5000, 'ollama')).toMatchObject({ ok: true, sample: 'OK' });
      useProvider('ollama', url);
      let text = '';
      await chat.chatStream([{ role: 'user', content: 'hi' }], (t) => { text += t; });
      expect(text).toBe('Develop your knight.');
      expect(await chat.chatJson([{ role: 'user', content: 'review' }])).toEqual({ summary: 'ok' });
      expect(new Set(paths(fakes.ollama))).toEqual(new Set(['GET /api/tags', 'POST /api/chat']));
      expect(fakes.ollama.seen.every((s) => s.auth === undefined)).toBe(true);
    });
  }

  it('is not configured without a URL', () => {
    useProvider('ollama', '');
    expect(llm.llmConfigured(1)).toBe(false);
  });
});

// Each user brings their own LLM (Settings → Connections); there is no
// server-wide one to fall back on.
describe('whose LLM answers', () => {
  beforeAll(async () => {
    const { db } = await import('../src/db.js');
    db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (2, 'kid', 'x', 'user')`).run();
    db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (2, 'Kid')`).run();
  });

  afterAll(() => setSetting('llm_user_hosts', '0'));

  it('is nobody\'s by default: one user\'s model is not another\'s', async () => {
    useProvider('ollama', fakes.ollama.url);
    expect(llm.llmConfigured(1)).toBe(true);
    expect(llm.llmConfigured(2)).toBe(false);
    await expect(llm.withLlmUser(2, () => llm.chatStream([{ role: 'user', content: 'hi' }], () => {}))).rejects.toThrow('llm_not_configured');
    // And a call made for no user at all has no model either.
    await expect(llm.chatStream([{ role: 'user', content: 'hi' }], () => {})).rejects.toThrow('llm_not_configured');
    expect(fakes.ollama.seen).toHaveLength(0);
  });

  it('uses a user\'s own DeepSeek key, on DeepSeek\'s own host', () => {
    delete process.env.DEEPSEEK_URL;
    services.setUserServices(2, { llm_provider: 'deepseek', llm_api_key: 'sk-kid' });
    expect(llm.activeLlm(2)).toEqual({ provider: 'deepseek', url: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'sk-kid' });
    services.setUserServices(2, { llm_api_key: null });
    expect(llm.llmConfigured(2)).toBe(false);
  });

  it('takes a user\'s own Ollama host only when an admin allows it, and calls it for that user', async () => {
    services.setUserServices(2, { llm_provider: 'ollama', llm_url: `${fakes.ollama.url}/`, llm_model: MODEL.ollama });
    expect(llm.llmConfigured(2)).toBe(false);
    setSetting('llm_user_hosts', '1');
    expect(llm.activeLlm(2)).toMatchObject({ provider: 'ollama', url: fakes.ollama.url, model: MODEL.ollama });
    let text = '';
    await llm.withLlmUser(2, () => llm.chatStream([{ role: 'user', content: 'hi' }], (t) => { text += t; }));
    expect(text).toBe('Develop your knight.');
  });
});

// An install upgraded from the server-wide LLM keeps its coach — for admins.
describe('moving the old server-wide LLM to the admins', () => {
  it('copies it to admins without their own, skips other users, and clears the old settings', async () => {
    const { getSetting } = await import('../src/db.js');
    services.setUserServices(1, { llm_provider: null, llm_url: null, llm_model: null, llm_api_key: null });
    services.setUserServices(2, { llm_provider: null, llm_url: null, llm_model: null, llm_api_key: null });
    setSetting('llm_provider', 'deepseek');
    setSetting('deepseek_api_key', 'sk-old-shared');
    setSetting('deepseek_model', 'deepseek-reasoner');
    setSetting('llm_moved_to_users', '0');

    services.moveServerLlmToAdmins();
    expect(services.getUserServices(1)).toMatchObject({ llm_provider: 'deepseek', llm_api_key: 'sk-old-shared', llm_model: 'deepseek-reasoner' });
    expect(services.getUserServices(2).llm_provider).toBeNull();
    expect(getSetting('deepseek_api_key')).toBeNull();

    // Once only: a key the admin later removes does not come back.
    services.setUserServices(1, { llm_api_key: null });
    setSetting('deepseek_api_key', 'sk-again');
    services.moveServerLlmToAdmins();
    expect(services.getUserServices(1).llm_api_key).toBeNull();
  });
});

import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import type { Profile } from '../types.js';
import { testConnection, userLlm, userLlmHostsAllowed } from '../coach/llm.js';
import { getUserServices, setUserServices, type UserServices } from '../userServices.js';
import { connectionHint } from '../coach/connectionHint.js';

const router = new Hono();
router.use('*', requireAuth);

const profileSchema = z.object({
  display_name: z.string().trim().min(1).max(60).optional(),
  avatar_emoji: z.string().min(1).max(8).optional(),
  language: z.enum(['en', 'bg', 'es', 'de', 'ru', 'fa']).optional(),
  audience: z.enum(['kid', 'beginner', 'intermediate', 'advanced']).optional(),
  chesscom_username: z.string().trim().regex(/^[A-Za-z0-9_-]{2,40}$/).nullable().or(z.literal('')).optional(),
  lichess_username: z.string().trim().regex(/^[A-Za-z0-9_-]{2,30}$/).nullable().or(z.literal('')).optional(),
  coach_behavior: z.enum(['silent', 'on_demand', 'always_on_pedagogical']).optional(),
  tts_enabled: z.boolean().optional(),
  tts_voice: z.string().nullable().optional(),
  tts_rate: z.number().min(0.5).max(2).optional(),
  tts_pitch: z.number().min(0).max(2).optional(),
  board_theme: z.enum(['wood', 'green', 'blue']).optional(),
  piece_set: z.string().optional(),
  site_theme: z.enum(['light', 'dark', 'auto']).optional(),
  blunder_warning: z.boolean().optional(),
  sound_enabled: z.boolean().optional(),
  sound_set: z.enum(['classic', 'soft']).optional(),
  move_sound_set: z.enum(['classic', 'board']).optional(),
  kid_piece_emotions: z.boolean().optional(),
  auto_review: z.boolean().optional(),
  chesscom_sync_minutes: z.number().int().min(0).max(1440).optional(),
  lichess_sync_minutes: z.number().int().min(0).max(1440).optional(),
});

router.get('/profile', (c) => {
  const user = c.get('user');
  return c.json({ profile: user.profile });
});

router.patch('/profile', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input', details: parsed.error.flatten() }, 400);

  const updates = parsed.data;
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null));
  }
  if (fields.length === 0) return c.json({ profile: user.profile });

  values.push(user.id);
  db.prepare(`UPDATE profiles SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id) as Profile;
  return c.json({ profile });
});

// ---- Connections: the user's own LLM and Lichess token (userServices.ts) ----
//
// Secrets go in and never come back out: the response says only whether a key
// or token is set.

function servicesView(userId: number) {
  const s = getUserServices(userId);
  return {
    llm_provider: s.llm_provider,
    llm_url: s.llm_url ?? '',
    llm_model: s.llm_model ?? '',
    llm_key_set: !!s.llm_api_key,
    // Whether the coach has a usable model for this user right now.
    llm_ready: !!userLlm(userId),
    // Whether this user may point the coach at an Ollama/vLLM host (admins
    // always; everyone else when an admin allows it).
    llm_hosts_allowed: userLlmHostsAllowed(userId),
    lichess_token_set: !!s.lichess_token,
  };
}

router.get('/services', (c) => c.json(servicesView(c.get('user').id)));

// http(s) only, and never the link-local range cloud metadata services live on.
function isUsableHostUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  return !/^169\.254\./.test(u.hostname) && u.hostname !== '0.0.0.0';
}

const servicesSchema = z.object({
  // null = no LLM: the coach is off for me.
  llm_provider: z.enum(['ollama', 'vllm', 'deepseek']).nullable().optional(),
  llm_url: z.string().trim().max(300).optional(),
  llm_model: z.string().trim().max(120).optional(),
  // A non-empty string replaces the stored secret, null removes it, and
  // leaving it out keeps it — so saving the form again doesn't wipe it.
  llm_api_key: z.string().trim().min(1).max(255).nullable().optional(),
  lichess_token: z.string().trim().regex(/^[A-Za-z0-9_]{10,120}$/).nullable().optional(),
});

router.patch('/services', async (c) => {
  const user = c.get('user');
  const parsed = servicesSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_input', details: parsed.error.flatten() }, 400);
  const d = parsed.data;
  const current = getUserServices(user.id);
  const provider = d.llm_provider === undefined ? current.llm_provider : d.llm_provider;
  const url = d.llm_url ?? current.llm_url ?? '';

  if (provider === 'ollama' || provider === 'vllm') {
    if (!userLlmHostsAllowed(user.id)) return c.json({ error: 'llm_hosts_not_allowed' }, 403);
    if (!isUsableHostUrl(url)) return c.json({ error: 'invalid_llm_url' }, 400);
  }

  const patch: Partial<UserServices> = {};
  if (d.llm_provider !== undefined) patch.llm_provider = d.llm_provider;
  if (d.llm_url !== undefined) patch.llm_url = d.llm_url || null;
  if (d.llm_model !== undefined) patch.llm_model = d.llm_model || null;
  if (d.llm_api_key !== undefined) patch.llm_api_key = d.llm_api_key;
  if (d.lichess_token !== undefined) patch.lichess_token = d.lichess_token;
  setUserServices(user.id, patch);
  return c.json(servicesView(user.id));
});

// Lists the models on the user's own LLM, as saved — the "does it work" check.
router.post('/services/test-llm', async (c) => {
  const cfg = userLlm(c.get('user').id);
  if (!cfg) return c.json({ ok: false, error: 'llm_not_configured' });
  const result = await testConnection(cfg.url, cfg.provider, cfg.apiKey);
  if (result.ok) return c.json({ ok: true, models: result.models.map((m) => m.name) });
  return c.json({ ...result, ...(cfg.provider === 'ollama' ? { hint: connectionHint(cfg.url, result.error) } : {}) });
});

export default router;

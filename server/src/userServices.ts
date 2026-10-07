// Per-user connections to outside services: the user's own LLM for the coach
// and their own Lichess API token for the opening explorer.
//
// These live in their own table rather than on `profiles`, because the profile
// row is sent to the browser as-is and these are secrets. Nothing here is ever
// returned to a client — routes report only whether a key or token is set.

import { db, getSetting, setSetting } from './db.js';

export type UserLlmProvider = 'ollama' | 'vllm' | 'deepseek';

export interface UserServices {
  /** Null = no LLM: the coach is off for this user. */
  llm_provider: UserLlmProvider | null;
  llm_url: string | null;
  llm_model: string | null;
  llm_api_key: string | null;
  lichess_token: string | null;
}

const EMPTY: UserServices = { llm_provider: null, llm_url: null, llm_model: null, llm_api_key: null, lichess_token: null };

export function getUserServices(userId: number): UserServices {
  const row = db.prepare(
    'SELECT llm_provider, llm_url, llm_model, llm_api_key, lichess_token FROM user_services WHERE user_id = ?',
  ).get(userId) as UserServices | undefined;
  return row ?? EMPTY;
}

/** Writes only the fields that are present; `null` clears one. */
export function setUserServices(userId: number, patch: Partial<UserServices>): UserServices {
  const next = { ...getUserServices(userId), ...patch };
  db.prepare(`
    INSERT INTO user_services (user_id, llm_provider, llm_url, llm_model, llm_api_key, lichess_token, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      llm_provider = excluded.llm_provider, llm_url = excluded.llm_url, llm_model = excluded.llm_model,
      llm_api_key = excluded.llm_api_key, lichess_token = excluded.lichess_token, updated_at = excluded.updated_at
  `).run(userId, next.llm_provider, next.llm_url, next.llm_model, next.llm_api_key, next.lichess_token);
  return next;
}

/** The token to send to the Lichess opening explorer for this user: their
 *  own, or one the operator supplied for everyone (LICHESS_EXPLORER_TOKEN). */
export function lichessExplorerToken(userId: number): string | null {
  return getUserServices(userId).lichess_token || process.env.LICHESS_EXPLORER_TOKEN || null;
}

export function isAdminUser(userId: number): boolean {
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
  return row?.role === 'admin';
}

/**
 * One-time move of the old server-wide LLM (Admin → System, up to 7.0.0) to
 * the admins' own accounts. The LLM used to be one setting shared by every
 * user; it is now per user, so without this an upgraded install would lose
 * its coach. Only admins get it — they configured it and pay for it; other
 * users add their own. The old settings are cleared afterwards so a key
 * doesn't linger where nothing reads it. Runs once (`llm_moved_to_users`).
 */
export function moveServerLlmToAdmins(): void {
  if (getSetting('llm_moved_to_users') === '1') return;
  const provider = getSetting('llm_provider') === 'vllm' ? 'vllm'
    : getSetting('llm_provider') === 'deepseek' ? 'deepseek' : 'ollama';
  const key = process.env.DEEPSEEK_API_KEY || getSetting('deepseek_api_key') || null;
  const url = provider === 'deepseek' ? null : getSetting(`${provider}_url`) || null;
  const model = getSetting(`${provider}_model`) || null;
  const usable = provider === 'deepseek' ? !!key : !!url;
  if (usable) {
    const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all() as { id: number }[];
    for (const { id } of admins) {
      if (getUserServices(id).llm_provider) continue; // already has their own
      setUserServices(id, {
        llm_provider: provider, llm_url: url, llm_model: model,
        llm_api_key: provider === 'deepseek' ? key : null,
      });
    }
    console.log(`[llm] moved the server-wide ${provider} model to ${admins.length} admin account(s); other users add their own in Settings → Connections`);
  }
  for (const k of ['llm_provider', 'ollama_url', 'ollama_model', 'ollama_fallback_models', 'vllm_url', 'vllm_model', 'deepseek_url', 'deepseek_model', 'deepseek_api_key', 'llm_shared']) {
    if (getSetting(k) !== null) db.prepare('DELETE FROM settings WHERE key = ?').run(k);
  }
  setSetting('llm_moved_to_users', '1');
}

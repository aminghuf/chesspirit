import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The routes open the real database on import, so point it at a throwaway
// file first.
const dir = mkdtempSync(join(tmpdir(), 'chesspirit-signup-email-'));
process.env.DB_PATH = join(dir, 'signup.db');

type DbModule = typeof import('../src/db.js');
type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

let dbm: DbModule;
let auth: Router;

// Every signup runs a real bcrypt hash.
const SLOW = 30_000;

beforeAll(async () => {
  dbm = await import('../src/db.js');
  auth = (await import('../src/routes/auth.js')).default;
  dbm.db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'boss', 'x', 'admin')`).run();
  dbm.db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (1, 'Boss')`).run();
});

afterAll(() => {
  try { dbm.db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

// The signup limiter allows 10 attempts per IP, so each call gets its own.
let ipCounter = 0;
async function register(body: Record<string, unknown>) {
  const res = await auth.request('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.1.${++ipCounter}` },
    body: JSON.stringify({ password: 'long-enough-pw', display_name: 'New Player', ...body }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
const config = async () => (await (await auth.request('/config')).json()) as Record<string, unknown>;

describe('signup without an email', () => {
  it('is allowed while verification is off', async () => {
    expect((await config()).email_required).toBe(false);
    expect((await register({ username: 'noemail1' })).status).toBe(200);
  }, SLOW);

  it('is still allowed when verification is on but no mailer exists to send the link', async () => {
    dbm.setSetting('require_email_verification', '1');
    expect((await config()).email_required).toBe(false);
    expect((await register({ username: 'noemail2' })).status).toBe(200);
  }, SLOW);

  it('is refused once verification is on and email is configured', async () => {
    dbm.setSetting('require_email_verification', '1');
    dbm.setSetting('smtp_host', 'smtp.invalid');
    dbm.setSetting('smtp_from', 'Chesspirit <noreply@example.com>');
    expect((await config()).email_required).toBe(true);
    expect(await register({ username: 'noemail3' })).toMatchObject({ status: 400, json: { error: 'email_required' } });
    expect(await register({ username: 'noemail3', email: '' })).toMatchObject({ status: 400, json: { error: 'email_required' } });
    expect(dbm.db.prepare(`SELECT id FROM users WHERE username = 'noemail3'`).get()).toBeUndefined();
  }, SLOW);
});

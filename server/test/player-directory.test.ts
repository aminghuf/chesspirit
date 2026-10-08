import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The routes open the real database on import, so point it at a throwaway
// file first.
const dir = mkdtempSync(join(tmpdir(), 'chesspirit-directory-'));
process.env.DB_PATH = join(dir, 'directory.db');

type DbModule = typeof import('../src/db.js');
type DirectoryModule = typeof import('../src/directory.js');
type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

let db: DbModule['db'];
let directory: DirectoryModule;
let players: Router;
let lobby: Router;
let challenges: Router;
let admin: Router;
const cookies: Record<string, string> = {};

// 1 boss (admin), 2 ann, 3 bob, 4 cat. Ann and Bob have played; Cat is a stranger to both.
const BOSS = 1, ANN = 2, BOB = 3, CAT = 4;

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  directory = await import('../src/directory.js');
  players = (await import('../src/routes/players.js')).default;
  lobby = (await import('../src/routes/lobby.js')).default;
  challenges = (await import('../src/routes/challenges.js')).default;
  admin = (await import('../src/routes/admin.js')).default;
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES
    (1, 'boss', 'x', 'admin'), (2, 'ann', 'x', 'user'), (3, 'bob', 'x', 'user'), (4, 'cat', 'x', 'user')`).run();
  db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (1, 'Boss'), (2, 'Ann'), (3, 'Bob'), (4, 'Cat')`).run();
  db.prepare(`INSERT INTO games (user_id, source, external_id, pgn, result, user_color, opponent_user_id) VALUES
    (2, 'pvp', 'g1', '1. e4 e5', 'win', 'white', 3), (3, 'pvp', 'g1', '1. e4 e5', 'loss', 'black', 2)`).run();
  for (const [name, id] of [['boss', BOSS], ['ann', ANN], ['bob', BOB], ['cat', CAT]] as const) {
    cookies[name] = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(id))}`;
  }
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  db.prepare('DELETE FROM challenges').run();
  directory.setDirectoryMode('private');
});

async function call(router: Router, as: string, method: string, path: string, body?: unknown) {
  const res = await router.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookies[as]! },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}
const ids = (rows: { id: number }[]) => rows.map((r) => r.id).sort();

describe('open directory', () => {
  it('shows everyone to everyone, as before', async () => {
    directory.setDirectoryMode('open');
    const list = await call(players, 'cat', 'GET', '/');
    expect(list.json.directory).toBe('open');
    expect(ids(list.json.players)).toEqual([BOSS, ANN, BOB, CAT]);
    expect((await call(players, 'cat', 'GET', `/${ANN}`)).status).toBe(200);
    expect(ids((await call(lobby, 'cat', 'GET', '/users')).json.users)).toEqual([BOSS, ANN, BOB]);
    expect((await call(challenges, 'cat', 'POST', '/', { to_user_id: ANN })).status).toBe(200);
  });

  it('is the default', () => {
    db.prepare(`DELETE FROM settings WHERE key = 'player_directory'`).run();
    expect(directory.directoryMode()).toBe('open');
  });
});

describe('private directory', () => {
  it('lists only me and the people I have played', async () => {
    const ann = await call(players, 'ann', 'GET', '/');
    expect(ann.json.directory).toBe('private');
    expect(ids(ann.json.players)).toEqual([ANN, BOB]);
    expect(ids((await call(players, 'cat', 'GET', '/')).json.players)).toEqual([CAT]);
    expect(ids((await call(lobby, 'ann', 'GET', '/users')).json.users)).toEqual([BOB]);
    expect((await call(lobby, 'cat', 'GET', '/users')).json.users).toEqual([]);
  });

  it("hides a stranger's profile behind the same 404 as a missing id", async () => {
    expect((await call(players, 'ann', 'GET', `/${BOB}`)).status).toBe(200);
    expect((await call(players, 'ann', 'GET', `/${ANN}`)).status).toBe(200);
    const stranger = await call(players, 'cat', 'GET', `/${ANN}`);
    const missing = await call(players, 'cat', 'GET', '/999');
    expect(stranger.status).toBe(404);
    expect(stranger.json).toEqual(missing.json);
  });

  it('still shows everyone to an admin', async () => {
    expect(ids((await call(players, 'boss', 'GET', '/')).json.players)).toEqual([BOSS, ANN, BOB, CAT]);
    expect((await call(players, 'boss', 'GET', `/${CAT}`)).status).toBe(200);
  });

  it('refuses a challenge by id to someone I cannot see', async () => {
    expect((await call(challenges, 'cat', 'POST', '/', { to_user_id: ANN })).status).toBe(404);
    expect((await call(challenges, 'ann', 'POST', '/', { to_user_id: BOB })).status).toBe(200);
  });

  it('lets me challenge a stranger by exact username, and shows us to each other only once accepted', async () => {
    const sent = await call(challenges, 'cat', 'POST', '/', { to_username: 'ann' });
    expect(sent.status).toBe(200);
    expect(sent.json.challenge.to.id).toBe(ANN);
    // Still strangers while it is pending.
    expect((await call(players, 'cat', 'GET', `/${ANN}`)).status).toBe(404);
    expect((await call(players, 'ann', 'GET', `/${CAT}`)).status).toBe(404);

    db.prepare(`UPDATE challenges SET status = 'accepted' WHERE id = ?`).run(sent.json.challenge.id);
    expect((await call(players, 'cat', 'GET', `/${ANN}`)).status).toBe(200);
    expect((await call(players, 'ann', 'GET', `/${CAT}`)).status).toBe(200);
    expect(ids((await call(players, 'cat', 'GET', '/')).json.players)).toEqual([ANN, CAT]);
    // Knowing Ann does not reveal the people Ann knows.
    expect((await call(players, 'cat', 'GET', `/${BOB}`)).status).toBe(404);
  });

  it('a declined challenge reveals nobody', async () => {
    const sent = await call(challenges, 'cat', 'POST', '/', { to_username: 'ann' });
    db.prepare(`UPDATE challenges SET status = 'declined' WHERE id = ?`).run(sent.json.challenge.id);
    expect((await call(players, 'cat', 'GET', `/${ANN}`)).status).toBe(404);
  });

  it('validates the challenge target', async () => {
    expect((await call(challenges, 'cat', 'POST', '/', { to_username: 'nobody' })).status).toBe(404);
    expect((await call(challenges, 'cat', 'POST', '/', { to_username: 'cat' })).json.error).toBe('cannot_challenge_self');
    expect((await call(challenges, 'cat', 'POST', '/', {})).status).toBe(400);
    expect((await call(challenges, 'cat', 'POST', '/', { to_user_id: ANN, to_username: 'ann' })).status).toBe(400);
  });
});

describe('the admin setting', () => {
  it('is read and written through /system, by admins only', async () => {
    directory.setDirectoryMode('open');
    expect((await call(admin, 'boss', 'GET', '/system')).json.player_directory).toBe('open');
    expect((await call(admin, 'ann', 'PATCH', '/system', { player_directory: 'private' })).status).toBe(403);
    expect(directory.directoryMode()).toBe('open');
    expect((await call(admin, 'boss', 'PATCH', '/system', { player_directory: 'private' })).status).toBe(200);
    expect(directory.directoryMode()).toBe('private');
    expect((await call(admin, 'boss', 'PATCH', '/system', { player_directory: 'everyone' })).status).toBe(400);
  });
});

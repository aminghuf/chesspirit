import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function resolveDbPath(): string {
  const raw = process.env.DB_PATH ?? './data/chess.db';
  const abs = resolve(PROJECT_ROOT, raw);
  ensureDir(abs);
  return abs;
}

function loadOrCreateSessionSecret(dbPath: string): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretFile = resolve(dirname(dbPath), '.session-secret');
  if (existsSync(secretFile)) return readFileSync(secretFile, 'utf8').trim();
  const secret = randomBytes(32).toString('hex');
  writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

const dbPath = resolveDbPath();

// Cookie `Secure` flag. The default `false` matches the documented localhost /
// LAN deploy, where the server speaks plaintext HTTP. Operators terminating TLS
// (reverse proxy, Cloudflare tunnel, etc.) should set COOKIE_SECURE=true so
// session cookies aren't shipped in plaintext over the wire.
function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null) return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

export const config = {
  port: Number(process.env.PORT ?? 8800),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath,
  sessionSecret: loadOrCreateSessionSecret(dbPath),
  stockfishPathHint: process.env.STOCKFISH_PATH || undefined,
  projectRoot: PROJECT_ROOT,
  cookieSecure: parseBool(process.env.COOKIE_SECURE, false),
  // A public instance (chesspirit.app): logged-out visitors get the landing
  // page instead of the login form, and can try a Game Review on any public
  // Chess.com / Lichess username without an account (routes/try.ts). Off for
  // a household server, where neither makes sense.
  publicSite: parseBool(process.env.PUBLIC_SITE, false),
  // Engine depth for those anonymous reviews — lower than a member's, since
  // strangers share the CPU.
  tryDepth: Math.max(8, Math.min(22, Number(process.env.TRY_DEPTH) || 14)),
  // Umami (cookieless analytics) website id. Unset = no analytics script, and
  // the CSP stays closed to it. Only the operator of a public site sets this.
  umamiWebsiteId: /^[0-9a-f-]{36}$/i.test(process.env.UMAMI_WEBSITE_ID ?? '') ? process.env.UMAMI_WEBSITE_ID! : null,
};

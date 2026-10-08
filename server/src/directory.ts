// Who may see whom.
//
// A household instance shows everyone to everyone: the Players page is the
// family leaderboard. On an instance open to strangers that is a leak — any
// account could read every other account's name, record, ratings and recent
// games. An admin switches the directory to `private` there, and a user then
// sees only themselves and the people they have actually played: a shared PvP
// game, or a challenge one of them accepted. Reaching someone new takes their
// exact username (routes/challenges.ts), and they become visible only once
// they accept.
import { db, getSetting, setSetting } from './db.js';
import type { AuthedUser } from './types.js';

export type DirectoryMode = 'open' | 'private';

export function directoryMode(): DirectoryMode {
  return getSetting('player_directory') === 'private' ? 'private' : 'open';
}

export function setDirectoryMode(mode: DirectoryMode): void {
  setSetting('player_directory', mode);
}

/** The users this one has played, or agreed to play. Never includes `userId`. */
export function knownUserIds(userId: number): Set<number> {
  const rows = db.prepare(`
    SELECT opponent_user_id AS id FROM games WHERE user_id = ? AND opponent_user_id IS NOT NULL
    UNION
    SELECT to_user_id FROM challenges WHERE from_user_id = ? AND status = 'accepted'
    UNION
    SELECT from_user_id FROM challenges WHERE to_user_id = ? AND status = 'accepted'
  `).all(userId, userId, userId) as { id: number }[];
  const ids = new Set(rows.map((r) => r.id));
  ids.delete(userId);
  return ids;
}

/** The users `viewer` may see, or null for "everyone" (open directory, or an admin). */
export function visibleUserIds(viewer: Pick<AuthedUser, 'id' | 'role'>): Set<number> | null {
  if (directoryMode() === 'open' || viewer.role === 'admin') return null;
  const ids = knownUserIds(viewer.id);
  ids.add(viewer.id);
  return ids;
}

export function canSeeUser(viewer: Pick<AuthedUser, 'id' | 'role'>, targetId: number): boolean {
  const visible = visibleUserIds(viewer);
  return visible === null || visible.has(targetId);
}

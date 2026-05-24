import type { SessionRecord } from "./types";

// In-memory session store. Phase 1 has no Redis (see CLAUDE.md). Sessions are
// lost on bot restart; that's acceptable until Phase 2 brings Redis online.
// API mirrors the Redis-backed SessionStore in the reference trientes bot so
// swapping it later is a one-file change.

export const SESSION_TTL_MS = 30 * 60 * 1000;

export class SessionStore {
  private sessions = new Map<number, SessionRecord>();
  private verbose = new Set<number>();

  get(userId: number): SessionRecord | null {
    const rec = this.sessions.get(userId);
    if (!rec) return null;
    if (Date.now() - rec.lastActivity > SESSION_TTL_MS) {
      this.sessions.delete(userId);
      return null;
    }
    return rec;
  }

  set(userId: number, claudeSessionId: string): void {
    const now = Date.now();
    this.sessions.set(userId, {
      claudeSessionId,
      startedAt: now,
      lastActivity: now,
    });
  }

  touch(userId: number): void {
    const rec = this.sessions.get(userId);
    if (!rec) return;
    rec.lastActivity = Date.now();
  }

  reset(userId: number): void {
    this.sessions.delete(userId);
  }

  getVerbose(userId: number): boolean {
    return this.verbose.has(userId);
  }

  setVerbose(userId: number, on: boolean): void {
    if (on) this.verbose.add(userId);
    else this.verbose.delete(userId);
  }
}

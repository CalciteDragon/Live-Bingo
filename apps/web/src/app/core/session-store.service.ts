import { Injectable, signal } from '@angular/core';
import type { MatchState } from '@bingo/shared';

const ALIAS_KEY       = 'bingo_alias';
const SESSION_KEY     = 'bingo_session';
const SESSION_TTL     = 5 * 60 * 1000; // 5 minutes

interface PersistedSession {
  matchId: string;
  route: '/lobby' | '/match';
  savedAt: number;
  joinCode?: string;
}

@Injectable({ providedIn: 'root' })
export class SessionStoreService {
  readonly matchId    = signal<string | null>(null);
  readonly playerId   = signal<string | null>(null);
  readonly joinCode   = signal<string | null>(null);
  readonly matchState = signal<MatchState | null>(null);
  readonly alias      = signal<string | null>(this.loadAlias());

  saveAlias(alias: string): void {
    localStorage.setItem(ALIAS_KEY, alias);
    this.alias.set(alias);
  }

  saveSession(matchId: string, route: '/lobby' | '/match', joinCode?: string): void {
    const session: PersistedSession = { matchId, route, savedAt: Date.now(), joinCode };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  getPersistedSession(): { matchId: string; route: '/lobby' | '/match'; joinCode?: string } | null {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const session = JSON.parse(raw) as PersistedSession;
      if (Date.now() - session.savedAt > SESSION_TTL) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return { matchId: session.matchId, route: session.route, joinCode: session.joinCode };
    } catch {
      return null;
    }
  }

  clearSession(): void {
    localStorage.removeItem(SESSION_KEY);
  }

  clear(): void {
    this.matchId.set(null);
    this.playerId.set(null);
    this.joinCode.set(null);
    this.matchState.set(null);
    this.clearSession();
  }

  private loadAlias(): string | null {
    return localStorage.getItem(ALIAS_KEY);
  }
}

import { Injectable, signal } from '@angular/core';
import type { MatchState } from '@bingo/shared';

const ALIAS_KEY = 'bingo_alias';

@Injectable({ providedIn: 'root' })
export class SessionStoreService {
  readonly matchId   = signal<string | null>(null);
  readonly playerId  = signal<string | null>(null);
  readonly joinCode  = signal<string | null>(null);
  readonly matchState = signal<MatchState | null>(null);
  readonly alias     = signal<string | null>(this.loadAlias());

  saveAlias(alias: string): void {
    localStorage.setItem(ALIAS_KEY, alias);
    this.alias.set(alias);
  }

  clear(): void {
    this.matchId.set(null);
    this.playerId.set(null);
    this.joinCode.set(null);
    this.matchState.set(null);
  }

  private loadAlias(): string | null {
    return localStorage.getItem(ALIAS_KEY);
  }
}

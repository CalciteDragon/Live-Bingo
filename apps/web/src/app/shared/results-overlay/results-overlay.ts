import { Component, computed, inject } from '@angular/core';
import { SessionStoreService } from '../../core/session-store.service';
import { MatchSocketService } from '../../core/match-socket.service';
import { ClientIdService } from '../../core/client-id.service';
import { buildClientMessage, getPlayerRankings, isHost, ordinalLabel } from '../../core/match.helpers';

@Component({
  selector: 'app-results-overlay',
  standalone: true,
  template: `
    <div class="results-overlay">
      <div class="results-overlay__panel">

        <div class="results-overlay__headline">{{ headline() }}</div>

        @if (winReason() && winReason() !== 'draw') {
          <div class="results-overlay__reason">{{ reasonLabel() }}</div>
        }

        <div class="results-overlay__scores">
          @for (entry of scoreSummary(); track entry.playerId) {
            <div class="results-overlay__score-row">
              <span class="results-overlay__score-alias">{{ entry.alias }}</span>
              <span class="results-overlay__score-count">{{ entry.count }} cell{{ entry.count !== 1 ? 's' : '' }}</span>
            </div>
          }
        </div>

        @if (amHost()) {
          <div class="results-overlay__actions">
            <button class="btn-primary" (click)="rematch()">Rematch</button>
            <button class="btn-secondary" (click)="backToLobby()">Back to Lobby</button>
          </div>
        } @else {
          <p class="text-muted results-overlay__waiting">Waiting for host…</p>
        }

      </div>
    </div>
  `,
})
export class ResultsOverlayComponent {
  private readonly sessionStore = inject(SessionStoreService);
  private readonly socket       = inject(MatchSocketService);
  private readonly clientId     = inject(ClientIdService).clientId;

  private readonly state    = computed(() => this.sessionStore.matchState());
  private readonly playerId = computed(() => this.sessionStore.playerId());
  private readonly players  = computed(() => this.state()?.players ?? []);

  readonly result    = computed(() => this.state()?.result ?? null);
  readonly winReason = computed(() => this.result()?.reason ?? null);

  readonly headline = computed(() => {
    const result = this.result();
    if (!result) return '';
    if (result.winnerId === null) return "It's a draw!";
    if (result.winnerId === this.playerId()) return 'You won!';
    const s   = this.state();
    const pid = this.playerId()!;
    if (!s) return 'You lost.';
    const myRank = getPlayerRankings(s, pid).find(r => r.playerId === pid)?.rank ?? 2;
    return `You came ${ordinalLabel(myRank)}!`;
  });

  readonly reasonLabel = computed(() => {
    switch (this.winReason()) {
      case 'line':         return 'Line';
      case 'majority':     return 'Majority';
      case 'timer_expiry': return 'Time expired';
      default:             return '';
    }
  });

  readonly cellCounts = computed(() => {
    const cells = this.state()?.card.cells ?? [];
    const counts: Record<string, number> = {};
    for (const cell of cells) {
      if (cell.markedBy) {
        counts[cell.markedBy] = (counts[cell.markedBy] ?? 0) + 1;
      }
    }
    return counts;
  });

  readonly scoreSummary = computed(() =>
    this.players()
      .map(p => ({
        playerId: p.playerId,
        alias:    p.alias ?? 'Unknown',
        count:    this.cellCounts()[p.playerId] ?? 0,
      }))
      .sort((a, b) => b.count - a.count),
  );

  readonly amHost = computed(() => {
    const s   = this.state();
    const pid = this.playerId();
    return s != null && pid != null ? isHost(s, pid) : false;
  });

  rematch(): void {
    const matchId = this.sessionStore.matchId()!;
    this.socket.send(buildClientMessage('REMATCH', matchId, this.clientId, {}));
  }

  backToLobby(): void {
    const matchId = this.sessionStore.matchId()!;
    this.socket.send(buildClientMessage('BACK_TO_LOBBY', matchId, this.clientId, {}));
  }
}

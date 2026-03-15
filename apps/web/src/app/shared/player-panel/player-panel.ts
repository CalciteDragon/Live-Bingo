import { Component, computed, inject } from '@angular/core';
import { SessionStoreService } from '../../core/session-store.service';
import { getPlayerRankings, ordinalLabel } from '../../core/match.helpers';

@Component({
  selector: 'app-player-panel',
  standalone: true,
  template: `
    <div class="player-panel">
      @for (entry of rankings(); track entry.playerId) {
        <div class="player-panel__entry" [class.player-panel__entry--me]="entry.isMe">
          <span class="player-panel__rank">{{ ordinal(entry.rank) }}</span>
          <span class="player-panel__color-swatch" [style.background-color]="entry.color"></span>
          <span class="player-panel__alias">{{ entry.alias }}</span>
          <span class="player-panel__score">{{ entry.score }}</span>
        </div>
      }
    </div>
  `,
})
export class PlayerPanelComponent {
  private readonly sessionStore = inject(SessionStoreService);

  private readonly state    = computed(() => this.sessionStore.matchState());
  private readonly playerId = computed(() => this.sessionStore.playerId());

  readonly rankings = computed(() => {
    const s  = this.state();
    const id = this.playerId();
    return s && id ? getPlayerRankings(s, id) : [];
  });

  protected ordinal = ordinalLabel;
}

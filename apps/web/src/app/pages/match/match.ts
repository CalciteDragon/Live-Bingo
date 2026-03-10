import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { SessionStoreService } from '../../core/session-store.service';
import { MatchSocketService } from '../../core/match-socket.service';
import { ClientIdService } from '../../core/client-id.service';
import { TimerService } from '../../core/timer.service';
import { BingoCellComponent } from '../../shared/bingo-cell/bingo-cell';
import { ResultsOverlayComponent } from '../../shared/results-overlay/results-overlay';
import { buildClientMessage, isHost } from '../../core/match.helpers';

@Component({
  selector: 'app-match',
  standalone: true,
  imports: [AsyncPipe, BingoCellComponent, ResultsOverlayComponent],
  template: `
    @if (isReconnecting()) {
      <div class="banner banner--warning">
        <span>Reconnecting…</span>
      </div>
    }

    @if (errorMessage()) {
      <div class="banner banner--error">
        <span>{{ errorMessage() }}</span>
        <div class="banner__actions">
          <button class="btn-ghost" (click)="errorMessage.set(null)">Dismiss</button>
        </div>
      </div>
    }

    <div class="match-page">
      <div class="match-header">
        <div class="match-timer">{{ displayTimer$ | async }}</div>
      </div>

      <div class="bingo-board">
        @for (cell of cells(); track cell.index) {
          <app-bingo-cell
            [cell]="cell"
            [myPlayerId]="playerId() ?? ''"
            [isActive]="isActive()"
            (cellClick)="onCellClick($event)"
          />
        }
      </div>

      @if (isActive() && amHost()) {
        <div class="match-controls">
          <button class="btn-secondary" [disabled]="!noMarkedCells()" (click)="reshuffleBoard()">
            Reshuffle Board
          </button>
          <button class="btn-secondary" (click)="backToLobby()">Back to Lobby</button>
        </div>
      }

      @if (isCompleted()) {
        <app-results-overlay />
      }
    </div>
  `,
})
export class MatchComponent {
  private readonly sessionStore = inject(SessionStoreService);
  private readonly socket       = inject(MatchSocketService);
  private readonly clientId     = inject(ClientIdService).clientId;
  private readonly timerService = inject(TimerService);
  private readonly router       = inject(Router);
  private readonly destroyRef   = inject(DestroyRef);

  private readonly state = computed(() => this.sessionStore.matchState());

  readonly playerId      = computed(() => this.sessionStore.playerId());
  readonly isCompleted   = computed(() => this.state()?.status === 'Completed');
  readonly isActive      = computed(() => this.state()?.status === 'InProgress');
  readonly cells         = computed(() => this.state()?.card.cells ?? []);
  readonly noMarkedCells = computed(() => this.cells().every(c => c.markedBy === null));
  readonly amHost        = computed(() => {
    const s   = this.state();
    const pid = this.playerId();
    return s != null && pid != null ? isHost(s, pid) : false;
  });

  readonly isReconnecting = computed(() => this.socket.isReconnecting());

  readonly errorMessage = signal<string | null>(null);

  readonly displayTimer$: Observable<string> = toObservable(
    computed(() => this.state()?.timer ?? null),
  ).pipe(
    switchMap(timer => timer ? this.timerService.getDisplayTimer$(timer) : of('00:00')),
  );

  constructor() {
    const matchId = this.sessionStore.matchId();
    if (matchId && this.sessionStore.matchState()?.status === 'InProgress') {
      this.sessionStore.saveSession(matchId, '/match');
    }

    this.socket.messages$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(msg => {
        if (msg.type === 'STATE_SYNC' || msg.type === 'STATE_UPDATE') {
          this.sessionStore.matchState.set(msg.payload.state);
        } else if (msg.type === 'ERROR') {
          this.errorMessage.set(msg.payload.message);
          setTimeout(() => this.errorMessage.set(null), 3000);
        }
      });

    effect(() => {
      const s = this.state();
      if (s?.status === 'Lobby')     void this.router.navigate(['/lobby', s.matchId]);
      if (s?.status === 'Abandoned') void this.router.navigate(['/'], { queryParams: { abandoned: true } });
      // Completed: no navigation — results overlay renders in-place
    });
  }

  onCellClick(index: number): void {
    const cell    = this.cells()[index];
    const pid     = this.playerId();
    const matchId = this.sessionStore.matchId()!;

    if (!cell) return;
    if (cell.markedBy !== null && cell.markedBy !== pid) return; // opponent's — no-op

    if (cell.markedBy === pid) {
      this.socket.send(buildClientMessage('UNMARK_CELL', matchId, this.clientId, { cellIndex: index }));
    } else {
      this.socket.send(buildClientMessage('MARK_CELL', matchId, this.clientId, { cellIndex: index }));
    }
  }

  reshuffleBoard(): void {
    const matchId = this.sessionStore.matchId()!;
    this.socket.send(buildClientMessage('RESHUFFLE_BOARD', matchId, this.clientId, {}));
  }

  backToLobby(): void {
    const matchId = this.sessionStore.matchId()!;
    this.socket.send(buildClientMessage('BACK_TO_LOBBY', matchId, this.clientId, {}));
  }
}

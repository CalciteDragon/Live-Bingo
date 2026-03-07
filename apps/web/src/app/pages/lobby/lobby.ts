import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SessionStoreService } from '../../core/session-store.service';
import { MatchSocketService } from '../../core/match-socket.service';
import { ClientIdService } from '../../core/client-id.service';
import { isHost, isAllPlayersReady, buildClientMessage } from '../../core/match.helpers';
import type { TimerMode, StateUpdatePayload } from '@bingo/shared';

@Component({
  selector: 'app-lobby',
  standalone: true,
  template: `
    @if (errorMessage()) {
      <div class="banner-error">
        {{ errorMessage() }}
        <button (click)="errorMessage.set(null)">Dismiss</button>
      </div>
    }

    <div class="lobby-container">
      <h1>Lobby</h1>

      <p class="seed-display">Board seed: {{ seed() }}</p>

      <div class="invite-row">
        <button (click)="copyInviteLink()">Copy Invite Link</button>
        @if (linkCopied()) {
          <span class="copied-hint">Copied!</span>
        }
      </div>

      <div class="players-list">
        @for (player of players(); track player.playerId) {
          <div class="player-row">
            <span class="alias">{{ player.alias ?? 'Unknown' }}</span>
            <span class="ready-state">{{ readyStates()[player.playerId] ? 'Ready' : 'Not Ready' }}</span>
            <span class="conn-state">{{ player.connected ? 'Online' : 'Offline' }}</span>
          </div>
        }
      </div>

      <button class="ready-btn" (click)="toggleReady()">
        {{ myReady() ? 'Unready' : 'Ready Up' }}
      </button>

      @if (amHost()) {
        <div class="host-settings">
          <label>
            Timer mode:
            <select [value]="timerMode()" (change)="onTimerModeChange($event)">
              <option value="stopwatch">Stopwatch</option>
              <option value="countdown">Countdown</option>
            </select>
          </label>

          @if (timerMode() === 'countdown') {
            <label>
              Duration (ms):
              <input
                type="number"
                min="60000"
                step="60000"
                [value]="countdownDurationMs()"
                (focus)="onCountdownFocus()"
                (blur)="onCountdownBlur()"
                (input)="onCountdownInput($event)"
              />
            </label>
          }

          <button class="start-btn" [disabled]="!canStart()" (click)="startMatch()">
            Start Match
          </button>
        </div>
      }
    </div>
  `,
})
export class LobbyComponent {
  private readonly sessionStore = inject(SessionStoreService);
  private readonly socket       = inject(MatchSocketService);
  private readonly clientId     = inject(ClientIdService).clientId;
  private readonly router       = inject(Router);
  private readonly destroyRef   = inject(DestroyRef);

  private readonly state = computed(() => this.sessionStore.matchState());

  readonly players     = computed(() => this.state()?.players ?? []);
  readonly readyStates = computed(() => this.state()?.readyStates ?? {});
  readonly myReady     = computed(() => {
    const pid = this.sessionStore.playerId();
    return pid != null ? (this.readyStates()[pid] ?? false) : false;
  });
  readonly amHost = computed(() => {
    const s   = this.state();
    const pid = this.sessionStore.playerId();
    return s != null && pid != null ? isHost(s, pid) : false;
  });
  readonly canStart = computed(() => {
    const s = this.state();
    return this.amHost() && s != null && isAllPlayersReady(s);
  });
  readonly timerMode = computed(() => this.state()?.lobbySettings.timerMode ?? 'stopwatch');
  readonly seed      = computed(() => this.state()?.card.seed ?? null);

  readonly errorMessage        = signal<string | null>(null);
  readonly linkCopied          = signal(false);
  readonly countdownDurationMs = signal<number>(300_000);
  readonly isEditingCountdown  = signal(false);

  private readonly pendingCountdownEventId = signal<string | null>(null);

  private readonly countdownSubject = new Subject<number>();

  constructor() {
    const matchId = this.sessionStore.matchId();
    if (matchId) this.sessionStore.saveSession(matchId, '/lobby');

    this.socket.messages$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(msg => {
        if (msg.type === 'STATE_SYNC' || msg.type === 'STATE_UPDATE') {
          this.sessionStore.matchState.set(msg.payload.state);

          if (msg.type === 'STATE_SYNC') {
            // A fresh sync is authoritative and clears any stale local pending intent.
            this.pendingCountdownEventId.set(null);
          }

          const cd = msg.payload.state.lobbySettings.countdownDurationMs;
          if (cd == null) return;

          if (
            msg.type === 'STATE_UPDATE' &&
            this.isPendingCountdownAck(msg.payload.lastAppliedEventId)
          ) {
            this.countdownDurationMs.set(cd);
            this.pendingCountdownEventId.set(null);
            return;
          }

          if (!this.isEditingCountdown() && this.pendingCountdownEventId() === null) {
            this.countdownDurationMs.set(cd);
          }
        } else if (msg.type === 'ERROR') {
          this.errorMessage.set(msg.payload.message);
        }
      });

    this.countdownSubject
      .pipe(debounceTime(500), takeUntilDestroyed(this.destroyRef))
      .subscribe(ms => {
        const matchId = this.sessionStore.matchId()!;
        const message = buildClientMessage('SET_LOBBY_SETTINGS', matchId, this.clientId, {
          timerMode: 'countdown',
          countdownDurationMs: ms,
        });
        this.pendingCountdownEventId.set(message.eventId);
        this.socket.send(message);
      });

    effect(() => {
      const s = this.sessionStore.matchState();
      if (s?.status === 'InProgress') this.router.navigate(['/match', s.matchId]);
      if (s?.status === 'Completed') {
        this.sessionStore.clearSession();
        this.router.navigate(['/match', s.matchId]);
      }
      if (s?.status === 'Abandoned') this.router.navigate(['/'], { queryParams: { abandoned: true } });
    });
  }

  toggleReady(): void {
    const matchId = this.sessionStore.matchId()!;
    this.socket.send(
      buildClientMessage('SET_READY', matchId, this.clientId, { ready: !this.myReady() }),
    );
  }

  onTimerModeChange(event: Event): void {
    const mode    = (event.target as HTMLSelectElement).value as TimerMode;
    const matchId = this.sessionStore.matchId()!;
    this.socket.send(
      buildClientMessage('SET_LOBBY_SETTINGS', matchId, this.clientId, {
        timerMode: mode,
        ...(mode === 'countdown' ? { countdownDurationMs: this.countdownDurationMs() } : {}),
      }),
    );
  }

  onCountdownInput(event: Event): void {
    const ms = Number((event.target as HTMLInputElement).value);
    if (ms > 0) {
      this.countdownDurationMs.set(ms);
      this.countdownSubject.next(ms);
    }
  }

  onCountdownFocus(): void {
    this.isEditingCountdown.set(true);
  }

  onCountdownBlur(): void {
    this.isEditingCountdown.set(false);
  }

  startMatch(): void {
    const matchId = this.sessionStore.matchId()!;
    this.socket.send(buildClientMessage('START_MATCH', matchId, this.clientId, {}));
  }

  copyInviteLink(): void {
    const code = this.sessionStore.joinCode();
    if (!code) return;
    const url = `${window.location.origin}/join/${code}`;
    navigator.clipboard.writeText(url).then(() => {
      this.linkCopied.set(true);
      setTimeout(() => this.linkCopied.set(false), 2000);
    });
  }

  private isPendingCountdownAck(lastAppliedEventId: StateUpdatePayload['lastAppliedEventId']): boolean {
    const pendingEventId = this.pendingCountdownEventId();
    return pendingEventId !== null && lastAppliedEventId === pendingEventId;
  }
}

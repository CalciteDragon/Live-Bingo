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
import type { TimerMode, StateUpdatePayload, WsErrorPayload } from '@bingo/shared';

@Component({
  selector: 'app-lobby',
  standalone: true,
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

    <div class="page">
      <div class="card">
        <h1>Lobby</h1>

        <div class="row" style="margin-bottom: 1rem">
          <span class="text-muted">Seed</span>
          <span class="mono">{{ seed() }}</span>
        </div>

        <div class="row" style="margin-bottom: 0.5rem; align-items: center; gap: 0.5rem">
          <span class="text-muted" style="white-space: nowrap">Join Code</span>
          <span class="mono" style="letter-spacing: 0.15em; font-size: 1.1rem">{{ joinCode() ?? '—' }}</span>
        </div>

        <div class="row" style="margin-bottom: 1.5rem">
          <button class="btn-secondary" (click)="copyInviteLink()" [disabled]="!joinCode()">Copy Invite Link</button>
          @if (linkCopied()) {
            <span class="text-muted">Copied!</span>
          }
        </div>

        <div style="margin-bottom: 1.25rem">
          @for (player of playersWithLocalStatus(); track player.playerId) {
            <div class="player-card">
              <span class="player-card__alias">{{ player.alias ?? 'Unknown' }}</span>
              @if (player.isMe) {
                <span class="badge badge--you">You</span>
              }
              <span class="badge"
                [class.badge--ready]="readyStates()[player.playerId]"
                [class.badge--not-ready]="!readyStates()[player.playerId]">
                {{ readyStates()[player.playerId] ? 'Ready' : 'Not Ready' }}
              </span>
              <span class="badge"
                [class.badge--connected]="player.connected"
                [class.badge--disconnected]="!player.connected">
                {{ player.connected ? 'Connected' : 'Disconnected' }}
              </span>
              @if (amHost() && !player.isMe) {
                <button class="btn-danger"
                  style="margin-left: auto; padding: 0.25rem 0.75rem; font-size: 0.8125rem"
                  (click)="openKickConfirm(player)">
                  Kick
                </button>
              }
            </div>
          }
        </div>

        <button class="btn-primary full-width" style="margin-bottom: 1rem" (click)="toggleReady()">
          {{ myReady() ? 'Unready' : 'Ready Up' }}
        </button>

        @if (amHost()) {
          <hr class="divider" />

          <div class="form-group">
            <label>Timer mode</label>
            <select [value]="timerMode()" (change)="onTimerModeChange($event)">
              <option value="stopwatch">Stopwatch</option>
              <option value="countdown">Countdown</option>
            </select>
          </div>

          @if (timerMode() === 'countdown') {
            <div class="form-group">
              <label>Duration (ms)</label>
              <input
                type="number"
                min="60000"
                step="60000"
                [value]="countdownDurationMs()"
                (focus)="onCountdownFocus()"
                (blur)="onCountdownBlur()"
                (input)="onCountdownInput($event)"
              />
            </div>
          }

          <button class="btn-primary full-width" [disabled]="!canStart()" (click)="startMatch()">
            Start Match
          </button>
        }
      </div>
    </div>

    @if (playerToKick(); as target) {
      <div class="modal-backdrop" (click)="cancelKick()">
        <div class="modal" (click)="$event.stopPropagation()">
          <h2>Kick player?</h2>
          <p>{{ target.alias }} will be removed from the lobby.</p>
          <div class="modal__actions">
            <button class="btn-ghost" (click)="cancelKick()">Cancel</button>
            <button class="btn-danger" (click)="confirmKick()">Kick {{ target.alias }}</button>
          </div>
        </div>
      </div>
    }
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

  /** Overlays the current player's `connected` field with the live WS status so
   *  the badge updates immediately on connect/disconnect without waiting for a
   *  server broadcast. */
  readonly playersWithLocalStatus = computed(() => {
    const myId        = this.sessionStore.playerId();
    const wsConnected = this.socket.connectionStatus() === 'connected';
    return this.players().map(p => ({
      ...p,
      connected: p.playerId === myId ? wsConnected : p.connected,
      isMe:      p.playerId === myId,
    }));
  });
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
  readonly joinCode  = computed(() => this.sessionStore.joinCode());

  readonly isReconnecting = computed(() => this.socket.isReconnecting());

  readonly errorMessage        = signal<string | null>(null);
  readonly linkCopied          = signal(false);
  readonly countdownDurationMs = signal<number>(300_000);
  readonly isEditingCountdown  = signal(false);
  readonly playerToKick        = signal<{ playerId: string; alias: string } | null>(null);

  private readonly pendingCountdownEventId = signal<string | null>(null);

  private readonly countdownSubject = new Subject<number>();

  constructor() {
    const matchId = this.sessionStore.matchId();
    if (matchId) this.sessionStore.saveSession(matchId, '/lobby', this.sessionStore.joinCode() ?? undefined);

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
        } else if (msg.type === 'PRESENCE_UPDATE') {
          const current = this.sessionStore.matchState();
          if (current) {
            this.sessionStore.matchState.set({ ...current, players: msg.payload.players, readyStates: msg.payload.readyStates });
          }
        } else if (msg.type === 'ERROR') {
          const payload = msg.payload as WsErrorPayload;
          if (payload.code !== 'KICKED') {
            this.errorMessage.set(payload.message);
          }
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
      if (s?.status === 'InProgress') void this.router.navigate(['/match', s.matchId]);
      if (s?.status === 'Completed') {
        this.sessionStore.clearSession();
        void this.router.navigate(['/match', s.matchId]);
      }
      if (s?.status === 'Abandoned') void this.router.navigate(['/'], { state: { abandoned: true } });
    });

    effect(() => {
      if (this.socket.sessionReplaced()) {
        this.sessionStore.clearSession();
        void this.router.navigate(['/'], { state: { replaced: true } });
      }
    });

    effect(() => {
      if (this.socket.wasKicked()) {
        this.sessionStore.clear();
        void this.router.navigate(['/'], { state: { kicked: true } });
      }
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

  openKickConfirm(player: { playerId: string; alias: string | null | undefined }): void {
    this.playerToKick.set({ playerId: player.playerId, alias: player.alias ?? 'Unknown' });
  }

  confirmKick(): void {
    const target = this.playerToKick();
    if (!target) return;
    const matchId = this.sessionStore.matchId()!;
    this.socket.send(buildClientMessage('KICK_PLAYER', matchId, this.clientId, { playerId: target.playerId }));
    this.playerToKick.set(null);
  }

  cancelKick(): void {
    this.playerToKick.set(null);
  }

  copyInviteLink(): void {
    const code = this.sessionStore.joinCode();
    if (!code) return;
    const url = `${window.location.origin}/join/${code}`;
    navigator.clipboard.writeText(url).then(
      () => {
        this.linkCopied.set(true);
        setTimeout(() => this.linkCopied.set(false), 2000);
      },
      () => this.errorMessage.set('Could not copy to clipboard.'),
    );
  }

  private isPendingCountdownAck(lastAppliedEventId: StateUpdatePayload['lastAppliedEventId']): boolean {
    const pendingEventId = this.pendingCountdownEventId();
    return pendingEventId !== null && lastAppliedEventId === pendingEventId;
  }
}

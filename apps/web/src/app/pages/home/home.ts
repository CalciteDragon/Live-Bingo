import { Component, effect, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { switchMap, take } from 'rxjs';
import { SessionStoreService } from '../../core/session-store.service';
import { MatchApiService, type ApiError } from '../../core/match-api.service';
import { MatchSocketService } from '../../core/match-socket.service';
import { generateAlias } from '../../core/alias';
import type { RestErrorCode } from '@bingo/shared';

@Component({
  selector: 'app-home',
  standalone: true,
  template: `
    @if (abandonedBanner()) {
      <div class="banner-abandoned">
        Your match was abandoned.
        <button (click)="abandonedBanner.set(false)">Dismiss</button>
      </div>
    }

    <div class="home-container">
      <h1>Live Bingo</h1>

      <div class="alias-field">
        <label for="alias">Your name</label>
        <input
          id="alias"
          type="text"
          maxlength="32"
          [value]="sessionStore.alias() ?? ''"
          (change)="onAliasChange($event)"
        />
      </div>

      <div class="mode-tabs">
        <button (click)="mode.set('create')" [class.active]="mode() === 'create'">Create Match</button>
        <button (click)="mode.set('join')" [class.active]="mode() === 'join'">Join Match</button>
      </div>

      @if (mode() === 'create') {
        <div class="create-section">
          <button (click)="createMatch()" [disabled]="loading()">Create</button>
          @if (createError()) {
            <p class="error">{{ createError() }}</p>
          }
        </div>
      }

      @if (mode() === 'join') {
        <div class="join-section">
          <input
            type="text"
            maxlength="6"
            placeholder="Enter 6-char code"
            [value]="joinCodeInput()"
            (input)="onJoinCodeInput($event)"
          />
          <button (click)="joinByCode()" [disabled]="loading()">Join</button>
          @if (joinError()) {
            <p class="error">{{ joinError() }}</p>
          }
        </div>
      }
    </div>
  `,
})
export class HomeComponent {
  readonly sessionStore = inject(SessionStoreService);
  private readonly matchApi     = inject(MatchApiService);
  private readonly socket        = inject(MatchSocketService);
  private readonly router        = inject(Router);
  private readonly route         = inject(ActivatedRoute);

  readonly mode           = signal<'create' | 'join'>('create');
  readonly joinCodeInput  = signal('');
  readonly loading        = signal(false);
  readonly createError    = signal<string | null>(null);
  readonly joinError      = signal<string | null>(null);
  readonly abandonedBanner = signal(false);

  constructor() {
    if (this.sessionStore.alias() === null) {
      this.sessionStore.saveAlias(generateAlias());
    }

    this.route.queryParamMap.pipe(take(1)).subscribe(params => {
      if (params.get('abandoned') === 'true') {
        this.abandonedBanner.set(true);
        this.sessionStore.clear();
        this.socket.disconnect();
      }
      const code = params.get('joinCode');
      if (code) {
        this.joinCodeInput.set(code.toUpperCase());
        this.mode.set('join');
      }
    });

    // Status-route effect: self-correct navigation when the user arrives at home
    // while an active session exists (e.g. browser back-button during a match).
    effect(() => {
      const s = this.sessionStore.matchState();
      if (!s) return;
      if (s.status === 'Lobby')      this.router.navigate(['/lobby', s.matchId]);
      if (s.status === 'InProgress') this.router.navigate(['/match', s.matchId]);
      if (s.status === 'Completed')  this.router.navigate(['/match', s.matchId]);
      // 'Abandoned' stays on home — the ?abandoned=true banner handles that path.
    });
  }

  onAliasChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    if (value) {
      this.sessionStore.saveAlias(value);
    }
  }

  onJoinCodeInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value.toUpperCase();
    this.joinCodeInput.set(value);
  }

  createMatch(): void {
    const alias = this.sessionStore.alias()!;
    this.loading.set(true);
    this.createError.set(null);

    this.matchApi.createMatch(alias).subscribe({
      next: res => {
        this.sessionStore.matchId.set(res.matchId);
        this.sessionStore.playerId.set(res.state.players[0]!.playerId);
        this.sessionStore.joinCode.set(res.joinCode);
        this.sessionStore.matchState.set(res.state);
        this.socket.connect(res.matchId);
        // Navigation is handled by the status-route effect.
      },
      error: (err: ApiError) => {
        this.loading.set(false);
        this.createError.set(err.message);
      },
    });
  }

  joinByCode(): void {
    const code  = this.joinCodeInput();
    const alias = this.sessionStore.alias()!;

    if (code.length !== 6) {
      this.joinError.set('Enter a 6-character invite code.');
      return;
    }

    this.loading.set(true);
    this.joinError.set(null);

    this.matchApi
      .resolveJoinCode(code)
      .pipe(switchMap(res => this.matchApi.joinMatch(res.matchId, alias, code)))
      .subscribe({
        next: res => {
          this.sessionStore.matchId.set(res.matchId);
          this.sessionStore.playerId.set(res.playerId);
          this.sessionStore.matchState.set(res.state);
          this.socket.connect(res.matchId);
          // Navigation is handled by the status-route effect.
        },
        error: (err: ApiError) => {
          this.loading.set(false);
          this.joinError.set(this.formatJoinError(err.code));
        },
      });
  }

  private formatJoinError(code: RestErrorCode): string {
    switch (code) {
      case 'MATCH_NOT_FOUND':    return 'This match no longer exists.';
      case 'MATCH_FULL':         return 'This match is already full.';
      case 'JOIN_CODE_EXPIRED':  return 'This invite link has expired.';
      case 'MATCH_NOT_JOINABLE': return 'This match has already started.';
      case 'JOIN_CODE_INVALID':  return 'This invite code is not valid.';
      case 'CLIENT_CONFLICT':    return 'You are already in this match.';
      default:                   return 'Something went wrong. Please try again.';
    }
  }
}

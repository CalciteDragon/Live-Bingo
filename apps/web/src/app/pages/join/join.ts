import { Component, effect, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { switchMap, take } from 'rxjs';
import { SessionStoreService } from '../../core/session-store.service';
import { MatchApiService, type ApiError } from '../../core/match-api.service';
import { generateAlias } from '../../core/alias';
import type { RestErrorCode } from '@bingo/shared';

@Component({
  selector: 'app-join',
  standalone: true,
  template: `
    <div class="page">
      <div class="card" style="text-align: center">
        @if (needsAlias()) {
          <div class="form-group" style="text-align: left">
            <label for="join-alias">Your name</label>
            <input
              id="join-alias"
              type="text"
              maxlength="32"
              [value]="aliasInput()"
              (input)="onAliasInput($event)"
            />
            @if (aliasError()) {
              <p class="error-text">{{ aliasError() }}</p>
            }
          </div>
          <button class="btn-primary full-width" (click)="submitAlias()">Join</button>
        } @else if (loading()) {
          <p class="text-muted">Joining match...</p>
        } @else if (error()) {
          <p class="error-text" style="margin-bottom: 1rem">{{ error() }}</p>
          @if (conflictMatchId()) {
            <button class="btn-primary" (click)="navigateToMatch()">Go to your active match</button>
          }
        }
      </div>
    </div>
  `,
})
export class JoinComponent {
  private readonly sessionStore = inject(SessionStoreService);
  private readonly matchApi     = inject(MatchApiService);
  private readonly router       = inject(Router);
  private readonly route        = inject(ActivatedRoute);

  readonly loading         = signal(false);
  readonly error           = signal<string | null>(null);
  readonly conflictMatchId = signal<string | null>(null);
  readonly needsAlias      = signal(false);
  readonly aliasInput      = signal('');
  readonly aliasError      = signal<string | null>(null);

  private code = '';

  constructor() {
    this.route.paramMap.pipe(take(1)).subscribe(params => {
      const code  = params.get('code')!;
      this.code   = code;
      const alias = this.sessionStore.alias();

      if (!alias) {
        this.aliasInput.set(generateAlias());
        this.needsAlias.set(true);
        return;
      }

      this.loading.set(true);
      this.startJoin(code, alias);
    });

    // Navigate once session state is written.
    effect(() => {
      const s = this.sessionStore.matchState();
      if (!s) return;
      if (s.status === 'Lobby')      this.router.navigate(['/lobby', s.matchId]);
      if (s.status === 'InProgress') this.router.navigate(['/match', s.matchId]);
      if (s.status === 'Completed')  this.router.navigate(['/match', s.matchId]);
    });
  }

  onAliasInput(event: Event): void {
    this.aliasInput.set((event.target as HTMLInputElement).value);
  }

  submitAlias(): void {
    const value = this.aliasInput().trim();
    if (!value) {
      this.aliasError.set('Name is required.');
      return;
    }
    this.aliasError.set(null);
    this.sessionStore.saveAlias(value);
    this.needsAlias.set(false);
    this.loading.set(true);
    this.startJoin(this.code, value);
  }

  navigateToMatch(): void {
    const matchId = this.conflictMatchId();
    if (matchId) {
      this.router.navigate(['/lobby', matchId]);
    }
  }

  private startJoin(code: string, alias: string): void {
    let resolvedMatchId: string | null = null;

    this.matchApi
      .resolveJoinCode(code)
      .pipe(
        switchMap(res => {
          resolvedMatchId = res.matchId;
          return this.matchApi.joinMatch(res.matchId, alias, code);
        }),
      )
      .subscribe({
        next: res => {
          this.sessionStore.matchId.set(res.matchId);
          this.sessionStore.playerId.set(res.playerId);
          this.sessionStore.joinCode.set(code);
          this.sessionStore.matchState.set(res.state);
          // Navigation is handled by the status-route effect.
          // Socket connection is handled by the session guard on the destination route.
        },
        error: (err: ApiError) => {
          if (err.code === 'CLIENT_CONFLICT' && resolvedMatchId) {
            // Already a participant — restore session via GET and navigate.
            this.matchApi.getMatch(resolvedMatchId).subscribe({
              next: res => {
                this.sessionStore.matchId.set(res.matchId);
                this.sessionStore.playerId.set(res.playerId);
                this.sessionStore.joinCode.set(code);
                this.sessionStore.matchState.set(res.state);
                // Status-route effect handles navigation.
              },
              error: () => {
                this.loading.set(false);
                this.error.set(this.formatError(err.code));
                this.conflictMatchId.set(resolvedMatchId);
              },
            });
            return;
          }
          this.loading.set(false);
          this.error.set(this.formatError(err.code));
        },
      });
  }

  private formatError(code: RestErrorCode): string {
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

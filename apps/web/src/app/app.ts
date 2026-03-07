import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SessionStoreService } from './core/session-store.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    <nav class="app-nav">
      <button class="app-nav__logo" (click)="goHome()">Live Bingo</button>
      @if (pageLabel()) {
        <span class="app-nav__page">{{ pageLabel() }}</span>
      }
    </nav>

    @if (showLeaveWarning()) {
      <div class="modal-backdrop">
        <div class="modal">
          <h2>Leave match?</h2>
          <p>Your match is still in progress. Leaving now will disconnect you from the game.</p>
          <div class="modal__actions">
            <button class="btn-secondary" (click)="showLeaveWarning.set(false)">Stay</button>
            <button class="btn-danger" (click)="confirmLeave()">Leave</button>
          </div>
        </div>
      </div>
    }

    <router-outlet />
  `,
})
export class App {
  private readonly router       = inject(Router);
  private readonly sessionStore = inject(SessionStoreService);
  private readonly destroyRef   = inject(DestroyRef);

  readonly showLeaveWarning = signal(false);
  readonly currentUrl       = signal(this.router.url);

  readonly isInProgress = computed(() =>
    this.sessionStore.matchState()?.status === 'InProgress',
  );

  readonly pageLabel = computed(() => {
    const url = this.currentUrl();
    if (url.startsWith('/lobby')) return 'Lobby';
    if (url.startsWith('/match')) return 'Match';
    if (url.startsWith('/join'))  return 'Join';
    return null;
  });

  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(e => this.currentUrl.set(e.urlAfterRedirects));
  }

  goHome(): void {
    if (this.isInProgress()) {
      this.showLeaveWarning.set(true);
    } else {
      this.router.navigate(['/']);
    }
  }

  confirmLeave(): void {
    this.showLeaveWarning.set(false);
    this.sessionStore.clearSession();
    this.router.navigate(['/']);
  }
}

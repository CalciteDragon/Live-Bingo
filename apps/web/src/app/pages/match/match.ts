import { Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SessionStoreService } from '../../core/session-store.service';

@Component({
  selector: 'app-match',
  template: `<p>Match — stub</p>`,
})
export class MatchComponent {
  private readonly sessionStore = inject(SessionStoreService);
  private readonly router       = inject(Router);

  constructor() {
    const matchId = this.sessionStore.matchId();
    if (matchId && this.sessionStore.matchState()?.status === 'InProgress') {
      this.sessionStore.saveSession(matchId, '/match');
    }

    effect(() => {
      const s = this.sessionStore.matchState();
      if (s?.status === 'Lobby')     this.router.navigate(['/lobby', s.matchId]);
      if (s?.status === 'Completed') this.sessionStore.clearSession();
      if (s?.status === 'Abandoned') this.router.navigate(['/'], { queryParams: { abandoned: true } });
    });
  }
}

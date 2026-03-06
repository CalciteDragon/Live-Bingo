import { inject } from '@angular/core';
import { type CanActivateFn, type ActivatedRouteSnapshot, Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { SessionStoreService } from './session-store.service';
import { MatchApiService } from './match-api.service';
import { MatchSocketService } from './match-socket.service';

export const sessionGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const sessionStore = inject(SessionStoreService);
  const matchApi     = inject(MatchApiService);
  const socket       = inject(MatchSocketService);
  const router       = inject(Router);

  const matchId = route.paramMap.get('matchId');

  if (!matchId) {
    router.navigate(['/']);
    return false;
  }

  if (sessionStore.matchId() === matchId) {
    return true;
  }

  return matchApi.getMatch(matchId).pipe(
    map(res => {
      sessionStore.matchId.set(res.matchId);
      sessionStore.playerId.set(res.playerId);
      sessionStore.matchState.set(res.state);
      socket.connect(matchId);
      return true as const;
    }),
    catchError(() => {
      router.navigate(['/']);
      return of(false as const);
    }),
  );
};

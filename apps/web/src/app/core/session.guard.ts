import { inject } from '@angular/core';
import { type CanActivateFn, type ActivatedRouteSnapshot, Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { SessionStoreService } from './session-store.service';
import { MatchApiService } from './match-api.service';
import { MatchSocketService } from './match-socket.service';

/**
 * Precondition for all match routes: session store is populated and the
 * WebSocket is connected. This is the ONLY place that calls socket.connect().
 *
 * Components set session store data and navigate — the guard handles connection.
 * app.ts disconnects the socket on NavigationEnd whenever the destination is not
 * a match route, so no individual page needs to manage disconnection.
 */
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
    // Socket may be disconnected if the user navigated home mid-session.
    // Reconnect so the open handler sends SYNC_STATE and rehydrates state.
    if (socket.connectionStatus() === 'disconnected') {
      socket.connect(matchId);
    }
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

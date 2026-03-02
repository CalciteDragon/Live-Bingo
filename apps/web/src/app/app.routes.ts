import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home').then(m => m.HomeComponent),
  },
  {
    path: 'lobby/:matchId',
    loadComponent: () => import('./pages/lobby/lobby').then(m => m.LobbyComponent),
  },
  {
    path: 'match/:matchId',
    loadComponent: () => import('./pages/match/match').then(m => m.MatchComponent),
  },
];

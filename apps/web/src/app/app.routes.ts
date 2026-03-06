import { Routes } from '@angular/router';
import { sessionGuard } from './core/session.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home').then(m => m.HomeComponent),
  },
  {
    path: 'join/:code',
    loadComponent: () => import('./pages/join/join').then(m => m.JoinComponent),
  },
  {
    path: 'lobby/:matchId',
    canActivate: [sessionGuard],
    loadComponent: () => import('./pages/lobby/lobby').then(m => m.LobbyComponent),
  },
  {
    path: 'match/:matchId',
    canActivate: [sessionGuard],
    loadComponent: () => import('./pages/match/match').then(m => m.MatchComponent),
  },
];

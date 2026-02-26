import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home').then(m => m.HomeComponent),
  },
  {
    path: 'lobby/:id',
    loadComponent: () => import('./pages/lobby/lobby').then(m => m.LobbyComponent),
  },
  {
    path: 'match/:id',
    loadComponent: () => import('./pages/match/match').then(m => m.MatchComponent),
  },
  {
    path: 'results/:id',
    loadComponent: () => import('./pages/results/results').then(m => m.ResultsComponent),
  },
];

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import type {
  CreateMatchResponse,
  JoinMatchResponse,
  GetMatchResponse,
  ResolveJoinCodeResponse,
  RestErrorCode,
} from '@bingo/shared';
import { environment } from '../../environments/environment';

export interface ApiError {
  code: RestErrorCode;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class MatchApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  createMatch(alias: string): Observable<CreateMatchResponse> {
    return this.http
      .post<CreateMatchResponse>(`${this.base}/matches`, { alias })
      .pipe(catchError(e => throwError(() => this.mapError(e))));
  }

  joinMatch(matchId: string, alias: string, joinCode?: string): Observable<JoinMatchResponse> {
    return this.http
      .post<JoinMatchResponse>(`${this.base}/matches/${matchId}/join`, { alias, joinCode })
      .pipe(catchError(e => throwError(() => this.mapError(e))));
  }

  getMatch(matchId: string): Observable<GetMatchResponse> {
    return this.http
      .get<GetMatchResponse>(`${this.base}/matches/${matchId}`)
      .pipe(catchError(e => throwError(() => this.mapError(e))));
  }

  resolveJoinCode(code: string): Observable<ResolveJoinCodeResponse> {
    return this.http
      .get<ResolveJoinCodeResponse>(`${this.base}/matches/by-code/${code}`)
      .pipe(catchError(e => throwError(() => this.mapError(e))));
  }

  private mapError(e: unknown): ApiError {
    if (
      e != null &&
      typeof e === 'object' &&
      'error' in e &&
      e.error != null &&
      typeof e.error === 'object' &&
      'code' in e.error
    ) {
      const err = e.error as { code: RestErrorCode; message: string };
      return { code: err.code, message: err.message ?? '' };
    }
    return { code: 'MATCH_NOT_FOUND', message: 'An unexpected error occurred.' };
  }
}

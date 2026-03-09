import { Injectable } from '@angular/core';
import { Observable, of, interval } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import type { TimerState } from '@bingo/shared';

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

@Injectable({ providedIn: 'root' })
export class TimerService {
  getDisplayTimer$(timer: TimerState): Observable<string> {
    if (!timer.startedAt) return of('00:00');

    const startMs = Date.parse(timer.startedAt);

    return interval(1000).pipe(
      startWith(0),
      map(() => {
        const elapsed = Date.now() - startMs;
        if (timer.mode === 'stopwatch') {
          return formatMs(Math.max(0, elapsed));
        } else {
          const remaining = (timer.countdownDurationMs ?? 0) - elapsed;
          return formatMs(Math.max(0, remaining));
        }
      }),
    );
  }
}

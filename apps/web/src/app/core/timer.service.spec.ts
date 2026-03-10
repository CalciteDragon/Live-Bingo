import { TestBed } from '@angular/core/testing';
import { TimerService } from './timer.service';
import type { TimerState } from '@bingo/shared';

function makeTimer(overrides: Partial<TimerState> = {}): TimerState {
  return {
    mode: 'stopwatch',
    startedAt: null,
    countdownDurationMs: null,
    ...overrides,
  };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
});

describe('TimerService — null guard', () => {
  it('returns 00:00 immediately when startedAt is null', () => {
    TestBed.configureTestingModule({});
    const service = TestBed.inject(TimerService);

    const values: string[] = [];
    const sub = service.getDisplayTimer$(makeTimer()).subscribe(v => values.push(v));
    sub.unsubscribe();

    expect(values).toEqual(['00:00']);
  });
});

describe('TimerService — stopwatch', () => {
  it('emits 00:00 immediately then counts up each second', () => {
    vi.useFakeTimers();
    const now = new Date('2024-01-01T00:00:00.000Z').getTime();
    vi.setSystemTime(now);

    TestBed.configureTestingModule({});
    const service = TestBed.inject(TimerService);

    const timer = makeTimer({ startedAt: new Date(now).toISOString() });
    const values: string[] = [];
    const sub = service.getDisplayTimer$(timer).subscribe(v => values.push(v));

    expect(values[0]).toBe('00:00');

    vi.advanceTimersByTime(1000);
    expect(values[1]).toBe('00:01');

    vi.advanceTimersByTime(59000);
    expect(values[60]).toBe('01:00');

    sub.unsubscribe();
  });

  it('formats minutes and seconds with leading zeros', () => {
    vi.useFakeTimers();
    const now = new Date('2024-01-01T00:00:00.000Z').getTime();
    vi.setSystemTime(now);

    TestBed.configureTestingModule({});
    const service = TestBed.inject(TimerService);

    const timer = makeTimer({ startedAt: new Date(now).toISOString() });
    const values: string[] = [];
    const sub = service.getDisplayTimer$(timer).subscribe(v => values.push(v));

    vi.advanceTimersByTime(9000);
    expect(values[9]).toBe('00:09');

    sub.unsubscribe();
  });
});

describe('TimerService — countdown', () => {
  it('emits the full duration immediately then counts down', () => {
    vi.useFakeTimers();
    const now = new Date('2024-01-01T00:00:00.000Z').getTime();
    vi.setSystemTime(now);

    TestBed.configureTestingModule({});
    const service = TestBed.inject(TimerService);

    const timer = makeTimer({
      mode: 'countdown',
      startedAt: new Date(now).toISOString(),
      countdownDurationMs: 120_000,
    });
    const values: string[] = [];
    const sub = service.getDisplayTimer$(timer).subscribe(v => values.push(v));

    expect(values[0]).toBe('02:00');

    vi.advanceTimersByTime(1000);
    expect(values[1]).toBe('01:59');

    vi.advanceTimersByTime(59000);
    expect(values[60]).toBe('01:00');

    sub.unsubscribe();
  });

  it('clamps at 00:00 when time has expired', () => {
    vi.useFakeTimers();
    const now = new Date('2024-01-01T00:00:00.000Z').getTime();
    vi.setSystemTime(now);

    TestBed.configureTestingModule({});
    const service = TestBed.inject(TimerService);

    const timer = makeTimer({
      mode: 'countdown',
      startedAt: new Date(now).toISOString(),
      countdownDurationMs: 2_000,
    });
    const values: string[] = [];
    const sub = service.getDisplayTimer$(timer).subscribe(v => values.push(v));

    vi.advanceTimersByTime(5000);
    // All values after expiry must be 00:00
    expect(values.slice(2).every(v => v === '00:00')).toBe(true);

    sub.unsubscribe();
  });
});

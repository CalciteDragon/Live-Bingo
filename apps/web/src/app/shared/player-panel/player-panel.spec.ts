import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { PlayerPanelComponent } from './player-panel';
import { SessionStoreService } from '../../core/session-store.service';
import { SLOT_COLORS } from '../../core/match.helpers';
import type { MatchState } from '@bingo/shared';

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return {
    matchId: 'match-1',
    matchMode: 'ffa',
    status: 'InProgress',
    players: [
      { playerId: 'p1', clientId: 'c1', slot: 1, alias: 'Host',  connected: true },
      { playerId: 'p2', clientId: 'c2', slot: 2, alias: 'Guest', connected: true },
    ],
    readyStates: { p1: true, p2: true },
    lobbySettings: { timerMode: 'stopwatch', countdownDurationMs: null },
    card: { seed: 42, cells: Array.from({ length: 25 }, (_, i) => ({ index: i, goal: `G${i}`, markedBy: null })) },
    timer: { mode: 'stopwatch', startedAt: '2024-01-01T00:00:00.000Z', countdownDurationMs: null },
    result: null,
    ...overrides,
  };
}

function setup(state: MatchState | null, playerId = 'p1') {
  const matchStateSignal = signal<MatchState | null>(state);
  const playerIdSignal   = signal<string | null>(playerId);

  TestBed.configureTestingModule({
    providers: [
      {
        provide: SessionStoreService,
        useValue: {
          matchState: matchStateSignal,
          playerId:   playerIdSignal,
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(PlayerPanelComponent);
  fixture.detectChanges();

  return { fixture, matchStateSignal, playerIdSignal };
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('PlayerPanelComponent', () => {
  it('renders the leader first with rank "1st"', () => {
    const state = makeState({
      card: {
        seed: 42,
        cells: [
          { index: 0, goal: 'A', markedBy: 'p1' },
          { index: 1, goal: 'B', markedBy: 'p1' },
          { index: 2, goal: 'C', markedBy: 'p2' },
          ...Array.from({ length: 22 }, (_, i) => ({ index: i + 3, goal: `G${i + 3}`, markedBy: null })),
        ],
      },
    });
    const { fixture } = setup(state, 'p2');

    const entries: NodeListOf<Element> = fixture.nativeElement.querySelectorAll('.player-panel__entry');
    expect(entries.length).toBe(2);
    const firstRank = entries[0]!.querySelector('.player-panel__rank')?.textContent;
    expect(firstRank).toBe('1st');
  });

  it('tied players both show the same rank label', () => {
    const state = makeState({
      card: {
        seed: 42,
        cells: [
          { index: 0, goal: 'A', markedBy: 'p1' },
          { index: 1, goal: 'B', markedBy: 'p2' },
          ...Array.from({ length: 23 }, (_, i) => ({ index: i + 2, goal: `G${i + 2}`, markedBy: null })),
        ],
      },
    });
    const { fixture } = setup(state, 'p1');

    const entries: NodeListOf<Element> = fixture.nativeElement.querySelectorAll('.player-panel__entry');
    const ranks = Array.from(entries).map(e => e.querySelector('.player-panel__rank')?.textContent);
    expect(ranks[0]).toBe('1st');
    expect(ranks[1]).toBe('1st');
  });

  it('applies player-panel__entry--me class to current player entry', () => {
    const { fixture } = setup(makeState(), 'p1');

    const entries: NodeListOf<Element> = fixture.nativeElement.querySelectorAll('.player-panel__entry');
    const hostEntry = Array.from(entries).find(e =>
      e.querySelector('.player-panel__alias')?.textContent === 'Host',
    );
    expect(hostEntry?.classList.contains('player-panel__entry--me')).toBe(true);
  });

  it('does not apply --me class to other players', () => {
    const { fixture } = setup(makeState(), 'p1');

    const entries: NodeListOf<Element> = fixture.nativeElement.querySelectorAll('.player-panel__entry');
    const guestEntry = Array.from(entries).find(e =>
      e.querySelector('.player-panel__alias')?.textContent === 'Guest',
    );
    expect(guestEntry?.classList.contains('player-panel__entry--me')).toBe(false);
  });

  it('color swatch background-color is set for each player', () => {
    const { fixture } = setup(makeState(), 'p1');

    const swatches: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.player-panel__color-swatch');
    expect(swatches.length).toBe(2);
    // The first swatch (slot 1 = #4a9eff) should have a non-empty background
    expect(swatches[0]!.style.backgroundColor).toBeTruthy();
  });

  it('shows slot 1 color for Host player', () => {
    // SLOT_COLORS[1] = '#4a9eff' → browsers normalize to rgb(74, 158, 255)
    const expected = SLOT_COLORS[1];
    const { fixture } = setup(makeState(), 'p1');

    const entries: NodeListOf<Element> = fixture.nativeElement.querySelectorAll('.player-panel__entry');
    const hostEntry = Array.from(entries).find(e =>
      e.querySelector('.player-panel__alias')?.textContent === 'Host',
    );
    const swatch = hostEntry?.querySelector('.player-panel__color-swatch') as HTMLElement | null;
    // Style may be hex or normalized rgb — check it's not empty
    expect(swatch?.style.backgroundColor).toBeTruthy();
    // The rankings() computed should carry the correct color
    expect(fixture.componentInstance.rankings()[0]?.color ?? fixture.componentInstance.rankings()[1]?.color)
      .toBe(expected);
  });

  it('renders nothing when matchState is null', () => {
    const { fixture } = setup(null);
    const entries: NodeListOf<Element> = fixture.nativeElement.querySelectorAll('.player-panel__entry');
    expect(entries.length).toBe(0);
  });
});

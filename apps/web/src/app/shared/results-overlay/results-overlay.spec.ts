import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ResultsOverlayComponent } from './results-overlay';
import { SessionStoreService } from '../../core/session-store.service';
import { MatchSocketService } from '../../core/match-socket.service';
import { ClientIdService } from '../../core/client-id.service';
import type { MatchState } from '@bingo/shared';

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return {
    matchId: 'match-1',
    matchMode: 'ffa',
    status: 'Completed',
    players: [
      { playerId: 'p1', clientId: 'c1', slot: 1, alias: 'Host',  connected: true },
      { playerId: 'p2', clientId: 'c2', slot: 2, alias: 'Guest', connected: true },
    ],
    readyStates: { p1: true, p2: true },
    lobbySettings: { timerMode: 'stopwatch', countdownDurationMs: null },
    card: {
      seed: 42,
      cells: [
        { index: 0, goal: 'A', markedBy: 'p1' },
        { index: 1, goal: 'B', markedBy: 'p1' },
        { index: 2, goal: 'C', markedBy: 'p2' },
        ...Array.from({ length: 22 }, (_, i) => ({ index: i + 3, goal: `G${i + 3}`, markedBy: null })),
      ],
    },
    timer: { mode: 'stopwatch', startedAt: '2024-01-01T00:00:00.000Z', stoppedAt: '2024-01-01T00:04:32.000Z', countdownDurationMs: null },
    result: { winnerId: 'p1', reason: 'line' },
    ...overrides,
  };
}

function make3PlayerState(overrides: Partial<MatchState> = {}): MatchState {
  return {
    matchId: 'match-1',
    matchMode: 'ffa',
    status: 'Completed',
    players: [
      { playerId: 'p1', clientId: 'c1', slot: 1, alias: 'Host',  connected: true },
      { playerId: 'p2', clientId: 'c2', slot: 2, alias: 'Guest', connected: true },
      { playerId: 'p3', clientId: 'c3', slot: 3, alias: 'Third', connected: true },
    ],
    readyStates: { p1: true, p2: true, p3: true },
    lobbySettings: { timerMode: 'stopwatch', countdownDurationMs: null },
    card: {
      seed: 42,
      cells: [
        { index: 0, goal: 'A', markedBy: 'p1' },
        { index: 1, goal: 'B', markedBy: 'p1' },
        { index: 2, goal: 'C', markedBy: 'p1' },
        { index: 3, goal: 'D', markedBy: 'p2' },
        { index: 4, goal: 'E', markedBy: 'p2' },
        { index: 5, goal: 'F', markedBy: 'p3' },
        ...Array.from({ length: 19 }, (_, i) => ({ index: i + 6, goal: `G${i + 6}`, markedBy: null })),
      ],
    },
    // p1=3, p2=2, p3=1 → ranks 1, 2, 3
    timer: { mode: 'stopwatch', startedAt: '2024-01-01T00:00:00.000Z', stoppedAt: '2024-01-01T00:04:32.000Z', countdownDurationMs: null },
    result: { winnerId: 'p1', reason: 'majority' },
    ...overrides,
  };
}

function setup(state: MatchState | null, playerId: string) {
  const matchStateSignal = signal<MatchState | null>(state);
  const playerIdSignal   = signal<string | null>(playerId);
  const matchIdSignal    = signal<string | null>(state?.matchId ?? null);
  const mockSend         = vi.fn();

  TestBed.configureTestingModule({
    providers: [
      {
        provide: SessionStoreService,
        useValue: {
          matchState: matchStateSignal,
          playerId:   playerIdSignal,
          matchId:    matchIdSignal,
        },
      },
      {
        provide: MatchSocketService,
        useValue: { send: mockSend },
      },
      {
        provide: ClientIdService,
        useValue: { clientId: 'test-client' },
      },
    ],
  });

  const fixture = TestBed.createComponent(ResultsOverlayComponent);
  fixture.detectChanges();

  return { fixture, matchStateSignal, playerIdSignal, mockSend };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.clearAllMocks();
});

describe('ResultsOverlayComponent — headline', () => {
  it('shows "You won!" when current player is winner', () => {
    const { fixture } = setup(makeState({ result: { winnerId: 'p1', reason: 'line' } }), 'p1');
    expect(fixture.nativeElement.textContent).toContain('You won!');
  });

  it('shows "You came 2nd!" when current player is runner-up in a 2-player match', () => {
    const { fixture } = setup(makeState({ result: { winnerId: 'p1', reason: 'line' } }), 'p2');
    expect(fixture.nativeElement.textContent).toContain('You came 2nd!');
  });

  it('shows "It\'s a draw!" on draw', () => {
    const { fixture } = setup(makeState({ result: { winnerId: null, reason: 'draw' } }), 'p1');
    expect(fixture.nativeElement.textContent).toContain("It's a draw!");
  });

  it('shows "You came 2nd!" for 2nd-place player in a 3-player match', () => {
    const { fixture } = setup(make3PlayerState(), 'p2');
    expect(fixture.nativeElement.textContent).toContain('You came 2nd!');
  });

  it('shows "You came 3rd!" for 3rd-place player in a 3-player match', () => {
    const { fixture } = setup(make3PlayerState(), 'p3');
    expect(fixture.nativeElement.textContent).toContain('You came 3rd!');
  });
});

describe('ResultsOverlayComponent — reason label', () => {
  it('shows "Line" for line win', () => {
    const { fixture } = setup(makeState({ result: { winnerId: 'p1', reason: 'line' } }), 'p1');
    expect(fixture.nativeElement.textContent).toContain('Line');
  });

  it('shows "Majority" for majority win', () => {
    const { fixture } = setup(makeState({ result: { winnerId: 'p1', reason: 'majority' } }), 'p1');
    expect(fixture.nativeElement.textContent).toContain('Majority');
  });

  it('shows "Time expired" for timer_expiry win', () => {
    const { fixture } = setup(makeState({ result: { winnerId: 'p1', reason: 'timer_expiry' } }), 'p1');
    expect(fixture.nativeElement.textContent).toContain('Time expired');
  });
});

describe('ResultsOverlayComponent — score summary', () => {
  it('shows cell counts for each player', () => {
    const { fixture } = setup(makeState(), 'p1');
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Host');
    expect(text).toContain('Guest');
    expect(text).toContain('2 cells'); // p1 has 2
    expect(text).toContain('1 cell');  // p2 has 1 (singular)
  });

  it('renders all players sorted by count descending', () => {
    const { fixture } = setup(make3PlayerState(), 'p1');
    const rows: NodeListOf<Element> = fixture.nativeElement.querySelectorAll('.results-overlay__score-row');
    expect(rows.length).toBe(3);
    // p1 has 3 cells (highest) — should be first
    expect(rows[0]!.textContent).toContain('Host');
    expect(rows[0]!.textContent).toContain('3 cells');
  });
});

describe('ResultsOverlayComponent — host-only buttons', () => {
  it('shows View Board, Rematch and Back to Lobby buttons for host (slot 1)', () => {
    const { fixture } = setup(makeState(), 'p1');
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('View Board');
    expect(text).toContain('Rematch');
    expect(text).toContain('Back to Lobby');
  });

  it('shows View Board button for guest (slot 2) but not host actions', () => {
    const { fixture } = setup(makeState(), 'p2');
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('View Board');
    expect(text).not.toContain('Rematch');
    expect(text).not.toContain('Back to Lobby');
    expect(text).toContain('Waiting for host');
  });
});

describe('ResultsOverlayComponent — viewBoard output', () => {
  it('emits viewBoard when View Board button is clicked (host)', () => {
    const { fixture } = setup(makeState(), 'p1');
    const viewBoardSpy = vi.fn();
    fixture.componentInstance.viewBoard.subscribe(viewBoardSpy);

    const buttons: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('button');
    const viewBoardBtn = Array.from(buttons).find(b => b.textContent?.trim() === 'View Board');
    viewBoardBtn?.click();

    expect(viewBoardSpy).toHaveBeenCalledOnce();
  });

  it('emits viewBoard when View Board button is clicked (guest)', () => {
    const { fixture } = setup(makeState(), 'p2');
    const viewBoardSpy = vi.fn();
    fixture.componentInstance.viewBoard.subscribe(viewBoardSpy);

    const buttons: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('button');
    const viewBoardBtn = Array.from(buttons).find(b => b.textContent?.trim() === 'View Board');
    viewBoardBtn?.click();

    expect(viewBoardSpy).toHaveBeenCalledOnce();
  });
});

describe('ResultsOverlayComponent — socket actions', () => {
  it('sends REMATCH when host clicks Rematch', () => {
    const { fixture, mockSend } = setup(makeState(), 'p1');

    const buttons: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('button');
    const rematchBtn = Array.from(buttons).find(b => b.textContent?.trim() === 'Rematch');
    rematchBtn?.click();

    expect(mockSend).toHaveBeenCalledOnce();
    const sent = mockSend.mock.calls[0][0];
    expect(sent.type).toBe('REMATCH');
    expect(sent.matchId).toBe('match-1');
  });

  it('sends BACK_TO_LOBBY when host clicks Back to Lobby', () => {
    const { fixture, mockSend } = setup(makeState(), 'p1');

    const buttons: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('button');
    const backBtn = Array.from(buttons).find(b => b.textContent?.trim() === 'Back to Lobby');
    backBtn?.click();

    expect(mockSend).toHaveBeenCalledOnce();
    const sent = mockSend.mock.calls[0][0];
    expect(sent.type).toBe('BACK_TO_LOBBY');
    expect(sent.matchId).toBe('match-1');
  });
});

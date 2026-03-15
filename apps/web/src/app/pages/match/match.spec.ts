import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { of } from 'rxjs';
import { MatchComponent } from './match';
import { SessionStoreService } from '../../core/session-store.service';
import { MatchSocketService } from '../../core/match-socket.service';
import { ClientIdService } from '../../core/client-id.service';
import { TimerService } from '../../core/timer.service';
import type { MatchState, ServerMessage, Cell } from '@bingo/shared';

function makeCell(index: number, markedBy: string | null = null): Cell {
  return { index, goal: `Goal ${index}`, markedBy };
}

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
    card: { seed: 42, cells: Array.from({ length: 25 }, (_, i) => makeCell(i)) },
    timer: { mode: 'stopwatch', startedAt: '2024-01-01T00:00:00.000Z', countdownDurationMs: null },
    result: null,
    ...overrides,
  };
}

function setup(initialState: MatchState | null = makeState(), playerId = 'p1') {
  const matchStateSignal = signal<MatchState | null>(initialState);
  const matchIdSignal    = signal<string | null>(initialState?.matchId ?? null);
  const playerIdSignal   = signal<string | null>(playerId);
  const messages$        = new Subject<ServerMessage>();
  const mockNavigate     = vi.fn();
  const mockSaveSession  = vi.fn();
  const mockSend         = vi.fn();
  const mockConnect      = vi.fn();
  const mockDisconnect   = vi.fn();

  TestBed.configureTestingModule({
    providers: [
      {
        provide: SessionStoreService,
        useValue: {
          matchState:  matchStateSignal,
          matchId:     matchIdSignal,
          playerId:    playerIdSignal,
          saveSession: mockSaveSession,
        },
      },
      {
        provide: MatchSocketService,
        useValue: { messages$: messages$.asObservable(), send: mockSend, connect: mockConnect, disconnect: mockDisconnect, isReconnecting: signal(false) },
      },
      {
        provide: ClientIdService,
        useValue: { clientId: 'test-client' },
      },
      {
        provide: TimerService,
        useValue: { getDisplayTimer$: vi.fn().mockReturnValue(of('00:00')) },
      },
      { provide: Router, useValue: { navigate: mockNavigate } },
    ],
  });

  const fixture   = TestBed.createComponent(MatchComponent);
  const component = fixture.componentInstance;

  return { fixture, component, matchStateSignal, matchIdSignal, playerIdSignal, messages$, mockNavigate, mockSaveSession, mockSend, mockConnect, mockDisconnect };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

describe('MatchComponent — session persistence', () => {
  it('saves /match session on load when status is InProgress', () => {
    const { mockSaveSession } = setup(makeState({ status: 'InProgress' }));
    expect(mockSaveSession).toHaveBeenCalledWith('match-1', '/match');
  });

  it('does not save session on load when status is not InProgress', () => {
    const { mockSaveSession } = setup(makeState({ status: 'Completed', result: { winnerId: 'p1', reason: 'line' } }));
    expect(mockSaveSession).not.toHaveBeenCalled();
  });

  it('does not save session on load when matchState is null', () => {
    const { mockSaveSession } = setup(null);
    expect(mockSaveSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Status-route effect
// ---------------------------------------------------------------------------

describe('MatchComponent — status-route effect', () => {
  it('navigates to /lobby/:matchId when status becomes Lobby', () => {
    const { matchStateSignal, mockNavigate } = setup();

    matchStateSignal.set(makeState({ matchId: 'match-1', status: 'Lobby' }));
    TestBed.flushEffects();

    expect(mockNavigate).toHaveBeenCalledWith(['/lobby', 'match-1']);
  });

  it('navigates to / with ?abandoned=true when status becomes Abandoned', () => {
    const { matchStateSignal, mockNavigate } = setup();

    matchStateSignal.set(makeState({ matchId: 'match-1', status: 'Abandoned' }));
    TestBed.flushEffects();

    expect(mockNavigate).toHaveBeenCalledWith(['/'], { queryParams: { abandoned: true } });
  });

  it('does not navigate when status is InProgress', () => {
    const { mockNavigate } = setup(makeState({ status: 'InProgress' }));
    TestBed.flushEffects();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not navigate when status is Completed (overlay renders in-place)', () => {
    const { mockNavigate } = setup(makeState({ status: 'Completed', result: { winnerId: 'p1', reason: 'line' } }));
    TestBed.flushEffects();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not navigate when matchState is null', () => {
    const { mockNavigate } = setup(null);
    TestBed.flushEffects();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// WebSocket message handling
// ---------------------------------------------------------------------------

describe('MatchComponent — WebSocket message handling', () => {
  it('updates matchState on STATE_SYNC', () => {
    const { messages$, matchStateSignal } = setup();
    const newState = makeState({ status: 'InProgress' });

    messages$.next({ type: 'STATE_SYNC', matchId: 'match-1', payload: { state: newState } });

    expect(matchStateSignal()).toEqual(newState);
  });

  it('updates matchState on STATE_UPDATE', () => {
    const { messages$, matchStateSignal } = setup();
    const newState = makeState({ status: 'InProgress' });

    messages$.next({ type: 'STATE_UPDATE', matchId: 'match-1', payload: { state: newState } });

    expect(matchStateSignal()).toEqual(newState);
  });

  it('sets errorMessage on ERROR and auto-clears after 3 s', () => {
    vi.useFakeTimers();
    const { component, messages$ } = setup();

    messages$.next({ type: 'ERROR', matchId: 'match-1', payload: { code: 'NOT_AUTHORIZED', message: 'Not allowed' } });

    expect(component.errorMessage()).toBe('Not allowed');

    vi.advanceTimersByTime(3000);
    expect(component.errorMessage()).toBeNull();

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// onCellClick
// ---------------------------------------------------------------------------

describe('MatchComponent — onCellClick', () => {
  it('sends MARK_CELL for an unmarked cell', () => {
    const { component, mockSend } = setup(makeState());

    component.onCellClick(0);

    expect(mockSend).toHaveBeenCalledOnce();
    const msg = mockSend.mock.calls[0][0];
    expect(msg.type).toBe('MARK_CELL');
    expect(msg.payload.cellIndex).toBe(0);
  });

  it('sends UNMARK_CELL for a cell marked by the current player', () => {
    const state = makeState({
      card: {
        seed: 42,
        cells: [makeCell(0, 'p1'), ...Array.from({ length: 24 }, (_, i) => makeCell(i + 1))],
      },
    });
    const { component, mockSend } = setup(state, 'p1');

    component.onCellClick(0);

    expect(mockSend).toHaveBeenCalledOnce();
    const msg = mockSend.mock.calls[0][0];
    expect(msg.type).toBe('UNMARK_CELL');
    expect(msg.payload.cellIndex).toBe(0);
  });

  it('does not send anything for a cell marked by the opponent', () => {
    const state = makeState({
      card: {
        seed: 42,
        cells: [makeCell(0, 'p2'), ...Array.from({ length: 24 }, (_, i) => makeCell(i + 1))],
      },
    });
    const { component, mockSend } = setup(state, 'p1');

    component.onCellClick(0);

    expect(mockSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Computed signals
// ---------------------------------------------------------------------------

describe('MatchComponent — computed signals', () => {
  it('isCompleted is true when status is Completed', () => {
    const { component } = setup(makeState({ status: 'Completed', result: { winnerId: 'p1', reason: 'line' } }));
    expect(component.isCompleted()).toBe(true);
  });

  it('isCompleted is false when status is InProgress', () => {
    const { component } = setup(makeState({ status: 'InProgress' }));
    expect(component.isCompleted()).toBe(false);
  });

  it('isActive is true when status is InProgress', () => {
    const { component } = setup(makeState({ status: 'InProgress' }));
    expect(component.isActive()).toBe(true);
  });

  it('isActive is false when status is Completed', () => {
    const { component } = setup(makeState({ status: 'Completed', result: { winnerId: 'p1', reason: 'line' } }));
    expect(component.isActive()).toBe(false);
  });

  it('playerColorMap returns a color for each player keyed by playerId', () => {
    const { component } = setup(makeState());
    const colorMap = component.playerColorMap();
    expect(colorMap['p1']).toBe('#4a9eff');
    expect(colorMap['p2']).toBe('#ff6b6b');
  });

  it('playerColorMap returns empty map when matchState is null', () => {
    const { component } = setup(null);
    expect(component.playerColorMap()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Player panel
// ---------------------------------------------------------------------------

describe('MatchComponent — player panel', () => {
  it('renders app-player-panel', () => {
    const { fixture } = setup(makeState({ status: 'InProgress' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-player-panel')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Socket discipline
// ---------------------------------------------------------------------------

describe('MatchComponent — socket discipline', () => {
  it('does not call connect()', () => {
    const { fixture, mockConnect } = setup();
    TestBed.flushEffects();
    fixture.detectChanges();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('does not call disconnect()', () => {
    const { fixture, mockDisconnect } = setup();
    TestBed.flushEffects();
    fixture.detectChanges();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });
});

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { LobbyComponent } from './lobby';
import { SessionStoreService } from '../../core/session-store.service';
import { MatchSocketService } from '../../core/match-socket.service';
import { ClientIdService } from '../../core/client-id.service';
import type { MatchState, ServerMessage } from '@bingo/shared';

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return {
    matchId: 'match-1',
    matchMode: 'ffa',
    status: 'Lobby',
    players: [
      { playerId: 'p1', clientId: 'c1', slot: 1, alias: 'Host',  connected: true },
      { playerId: 'p2', clientId: 'c2', slot: 2, alias: 'Guest', connected: true },
    ],
    readyStates: {},
    lobbySettings: { timerMode: 'stopwatch', countdownDurationMs: null },
    card: { seed: 42, cells: [] },
    timer: { mode: 'stopwatch', startedAt: null, countdownDurationMs: null },
    result: null,
    ...overrides,
  };
}

function setup(initialState: MatchState | null = null) {
  const matchStateSignal      = signal<MatchState | null>(initialState);
  const matchIdSignal         = signal<string | null>('match-1');
  const playerIdSignal        = signal<string | null>('p1');
  const joinCodeSignal        = signal<string | null>('ABC123');
  const sessionReplacedSignal = signal(false);
  const wasKickedSignal       = signal(false);

  const messagesSubject = new Subject<ServerMessage>();

  const mockSend         = vi.fn();
  const mockConnect      = vi.fn();
  const mockDisconnect   = vi.fn();
  const mockNavigate     = vi.fn();
  const mockSaveSession  = vi.fn();
  const mockClearSession = vi.fn();
  const mockClear        = vi.fn();

  TestBed.configureTestingModule({
    providers: [
      {
        provide: SessionStoreService,
        useValue: {
          matchState:        matchStateSignal,
          matchId:           matchIdSignal,
          playerId:          playerIdSignal,
          joinCode:          joinCodeSignal,
          alias:             signal('TestAlias'),
          clear:        mockClear,
          saveSession:  mockSaveSession,
          clearSession: mockClearSession,
        },
      },
      {
        provide: MatchSocketService,
        useValue: {
          messages$:        messagesSubject.asObservable(),
          send:             mockSend,
          connect:          mockConnect,
          disconnect:       mockDisconnect,
          connectionStatus: signal('connected'),
          isReconnecting:   signal(false),
          sessionReplaced:  sessionReplacedSignal,
          wasKicked:        wasKickedSignal,
        },
      },
      {
        provide: ClientIdService,
        useValue: { clientId: 'client-uuid-1' },
      },
      { provide: Router, useValue: { navigate: mockNavigate } },
    ],
  });

  const fixture = TestBed.createComponent(LobbyComponent);
  const comp    = fixture.componentInstance;

  return {
    fixture, comp,
    matchStateSignal, matchIdSignal, playerIdSignal,
    sessionReplacedSignal, wasKickedSignal,
    messagesSubject,
    mockSend, mockConnect, mockDisconnect, mockNavigate, mockSaveSession, mockClearSession, mockClear,
  };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.clearAllMocks();
});

describe('LobbyComponent — socket messages', () => {
  it('STATE_SYNC updates matchState in SessionStoreService', () => {
    const { messagesSubject, matchStateSignal } = setup();
    const state = makeState();

    messagesSubject.next({ type: 'STATE_SYNC', matchId: 'match-1', payload: { state } });

    expect(matchStateSignal()).toEqual(state);
  });

  it('STATE_UPDATE updates matchState in SessionStoreService', () => {
    const { messagesSubject, matchStateSignal } = setup();
    const state = makeState({ status: 'InProgress' });

    messagesSubject.next({ type: 'STATE_UPDATE', matchId: 'match-1', payload: { state } });

    expect(matchStateSignal()).toEqual(state);
  });

  it('STATE_SYNC syncs countdownDurationMs when lobbySettings has a value', () => {
    const { comp, messagesSubject } = setup();
    const state = makeState({ lobbySettings: { timerMode: 'countdown', countdownDurationMs: 120_000 } });

    messagesSubject.next({ type: 'STATE_SYNC', matchId: 'match-1', payload: { state } });

    expect(comp.countdownDurationMs()).toBe(120_000);
  });

  it('STATE_SYNC clears stale pending countdown intent and applies server value', async () => {
    const { comp, messagesSubject } = setup();

    comp.onCountdownInput({ target: { value: '180000' } } as unknown as Event);
    await new Promise(resolve => setTimeout(resolve, 550));

    comp.onCountdownInput({ target: { value: '200000' } } as unknown as Event);

    const syncedState = makeState({
      lobbySettings: { timerMode: 'countdown', countdownDurationMs: 240_000 },
    });
    messagesSubject.next({ type: 'STATE_SYNC', matchId: 'match-1', payload: { state: syncedState } });

    expect(comp.countdownDurationMs()).toBe(240_000);
  });

  it('PRESENCE_UPDATE patches players and readyStates into existing matchState', () => {
    const initial = makeState({ readyStates: { p1: true, p2: true } });
    const { matchStateSignal, messagesSubject } = setup(initial);

    const updatedPlayers = [
      { playerId: 'p1', clientId: 'c1', slot: 1 as const, alias: 'Host',  connected: true },
      { playerId: 'p2', clientId: 'c2', slot: 2 as const, alias: 'Guest', connected: false },
    ];
    const updatedReadyStates = { p1: true, p2: false };
    messagesSubject.next({
      type: 'PRESENCE_UPDATE',
      matchId: 'match-1',
      payload: { players: updatedPlayers, readyStates: updatedReadyStates },
    });

    expect(matchStateSignal()!.players).toEqual(updatedPlayers);
    // readyStates from payload replaces local state
    expect(matchStateSignal()!.readyStates).toEqual(updatedReadyStates);
  });

  it('PRESENCE_UPDATE is ignored when matchState is null', () => {
    const { matchStateSignal, messagesSubject } = setup(null);

    messagesSubject.next({
      type: 'PRESENCE_UPDATE',
      matchId: 'match-1',
      payload: { players: [], readyStates: {} },
    });

    expect(matchStateSignal()).toBeNull();
  });

  it('ERROR sets errorMessage signal', () => {
    const { comp, messagesSubject } = setup();

    messagesSubject.next({
      type: 'ERROR',
      matchId: 'match-1',
      payload: { code: 'INVALID_STATE', message: 'Something went wrong' },
    });

    expect(comp.errorMessage()).toBe('Something went wrong');
  });
});

describe('LobbyComponent — ready toggle', () => {
  it('sends SET_READY with ready: true when currently not ready', () => {
    const state = makeState({ readyStates: {} });
    const { comp, mockSend } = setup(state);

    comp.toggleReady();

    expect(mockSend).toHaveBeenCalledOnce();
    const msg = mockSend.mock.calls[0]![0];
    expect(msg.type).toBe('SET_READY');
    expect(msg.payload.ready).toBe(true);
    expect(msg.matchId).toBe('match-1');
  });

  it('sends SET_READY with ready: false when currently ready', () => {
    const state = makeState({ readyStates: { p1: true } });
    const { comp, mockSend } = setup(state);

    comp.toggleReady();

    const msg = mockSend.mock.calls[0]![0];
    expect(msg.type).toBe('SET_READY');
    expect(msg.payload.ready).toBe(false);
  });

  it('SET_READY message includes a valid eventId UUID', () => {
    const state = makeState();
    const { comp, mockSend } = setup(state);

    comp.toggleReady();

    const msg = mockSend.mock.calls[0]![0];
    expect(msg.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('LobbyComponent — start button', () => {
  it('canStart() is false when only one player is ready', () => {
    const state = makeState({ readyStates: { p1: true } });
    const { comp } = setup(state);

    expect(comp.canStart()).toBe(false);
  });

  it('canStart() is false when only one player is in the match', () => {
    const state = makeState({
      players: [{ playerId: 'p1', clientId: 'c1', slot: 1, alias: 'Host', connected: true }],
      readyStates: { p1: true },
    });
    const { comp } = setup(state);

    expect(comp.canStart()).toBe(false);
  });

  it('canStart() is true when all players are ready and player is host', () => {
    const state = makeState({ readyStates: { p1: true, p2: true } });
    const { comp } = setup(state);

    expect(comp.canStart()).toBe(true);
  });

  it('startMatch() sends START_MATCH message', () => {
    const state = makeState({ readyStates: { p1: true, p2: true } });
    const { comp, mockSend } = setup(state);

    comp.startMatch();

    const msg = mockSend.mock.calls[0]![0];
    expect(msg.type).toBe('START_MATCH');
    expect(msg.matchId).toBe('match-1');
  });
});

describe('LobbyComponent — timer settings', () => {
  it('onTimerModeChange to countdown sends SET_LOBBY_SETTINGS with timerMode: countdown', () => {
    const state = makeState();
    const { comp, mockSend } = setup(state);

    comp.onTimerModeChange({ target: { value: 'countdown' } } as unknown as Event);

    const msg = mockSend.mock.calls[0]![0];
    expect(msg.type).toBe('SET_LOBBY_SETTINGS');
    expect(msg.payload.timerMode).toBe('countdown');
    expect(msg.payload.countdownDurationMs).toBeDefined();
  });

  it('onTimerModeChange to stopwatch sends SET_LOBBY_SETTINGS without countdownDurationMs', () => {
    const state = makeState();
    const { comp, mockSend } = setup(state);

    comp.onTimerModeChange({ target: { value: 'stopwatch' } } as unknown as Event);

    const msg = mockSend.mock.calls[0]![0];
    expect(msg.type).toBe('SET_LOBBY_SETTINGS');
    expect(msg.payload.timerMode).toBe('stopwatch');
    expect(msg.payload.countdownDurationMs).toBeUndefined();
  });

  it('ignores non-ack STATE_UPDATE countdown while local intent is pending', async () => {
    const state = makeState({ lobbySettings: { timerMode: 'countdown', countdownDurationMs: 300_000 } });
    const { comp, mockSend, messagesSubject } = setup(state);

    comp.onCountdownInput({ target: { value: '180000' } } as unknown as Event);
    await new Promise(resolve => setTimeout(resolve, 550));

    expect(mockSend).toHaveBeenCalledOnce();
    const pendingEventId = mockSend.mock.calls[0]![0].eventId as string;

    const otherUpdate = makeState({
      lobbySettings: { timerMode: 'countdown', countdownDurationMs: 120_000 },
    });
    messagesSubject.next({
      type: 'STATE_UPDATE',
      matchId: 'match-1',
      payload: { state: otherUpdate, lastAppliedEventId: 'not-the-pending-event' },
    });

    expect(comp.countdownDurationMs()).toBe(180_000);

    const ackUpdate = makeState({
      lobbySettings: { timerMode: 'countdown', countdownDurationMs: 175_000 },
    });
    messagesSubject.next({
      type: 'STATE_UPDATE',
      matchId: 'match-1',
      payload: { state: ackUpdate, lastAppliedEventId: pendingEventId },
    });

    expect(comp.countdownDurationMs()).toBe(175_000);
  });

  it('does not overwrite countdown while actively editing and no pending ack', () => {
    const state = makeState({ lobbySettings: { timerMode: 'countdown', countdownDurationMs: 300_000 } });
    const { comp, messagesSubject } = setup(state);

    comp.onCountdownInput({ target: { value: '210000' } } as unknown as Event);
    comp.onCountdownFocus();

    const incoming = makeState({
      lobbySettings: { timerMode: 'countdown', countdownDurationMs: 150_000 },
    });
    messagesSubject.next({
      type: 'STATE_UPDATE',
      matchId: 'match-1',
      payload: { state: incoming, lastAppliedEventId: 'someone-else' },
    });

    expect(comp.countdownDurationMs()).toBe(210_000);

    comp.onCountdownBlur();
    messagesSubject.next({
      type: 'STATE_UPDATE',
      matchId: 'match-1',
      payload: { state: incoming, lastAppliedEventId: 'someone-else-again' },
    });

    expect(comp.countdownDurationMs()).toBe(150_000);
  });
});

describe('LobbyComponent — status-route effect', () => {
  it('navigates to /match/:matchId when status becomes InProgress', () => {
    const { matchStateSignal, mockNavigate } = setup();

    matchStateSignal.set(makeState({ matchId: 'match-1', status: 'InProgress' }));
    TestBed.flushEffects();

    expect(mockNavigate).toHaveBeenCalledWith(['/match', 'match-1']);
  });

  it('clears session when status becomes Completed', () => {
    const { matchStateSignal, mockClearSession } = setup();

    matchStateSignal.set(makeState({ matchId: 'match-1', status: 'Completed' }));
    TestBed.flushEffects();

    expect(mockClearSession).toHaveBeenCalledOnce();
  });

  it('does not save or clear session when status becomes InProgress or Abandoned', () => {
    const { matchStateSignal, mockSaveSession, mockClearSession } = setup();

    matchStateSignal.set(makeState({ matchId: 'match-1', status: 'InProgress' }));
    TestBed.flushEffects();

    // saveSession was called once on load (/lobby); should not be called again for InProgress
    expect(mockSaveSession).toHaveBeenCalledOnce();
    expect(mockClearSession).not.toHaveBeenCalled();
  });

  it('navigates to /match/:matchId when status becomes Completed', () => {
    const { matchStateSignal, mockNavigate } = setup();

    matchStateSignal.set(makeState({ matchId: 'match-1', status: 'Completed' }));
    TestBed.flushEffects();

    expect(mockNavigate).toHaveBeenCalledWith(['/match', 'match-1']);
  });

  it('navigates to / with ?abandoned=true when status becomes Abandoned', () => {
    const { matchStateSignal, mockNavigate } = setup();

    matchStateSignal.set(makeState({ matchId: 'match-1', status: 'Abandoned' }));
    TestBed.flushEffects();

    expect(mockNavigate).toHaveBeenCalledWith(['/'], { state: { abandoned: true } });
  });

  it('does not navigate when status is Lobby', () => {
    const { matchStateSignal, mockNavigate } = setup();

    matchStateSignal.set(makeState({ status: 'Lobby' }));
    TestBed.flushEffects();

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not navigate when matchState is null', () => {
    const { mockNavigate } = setup(null);

    TestBed.flushEffects();

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates without needing a MATCH_STARTED message — state.status drives routing', () => {
    // The effect reacts to state.status directly; no lifecycle message required
    const { matchStateSignal, mockNavigate } = setup();

    matchStateSignal.set(makeState({ status: 'InProgress' }));
    TestBed.flushEffects();

    expect(mockNavigate).toHaveBeenCalledWith(['/match', 'match-1']);
  });
});

describe('LobbyComponent — socket lifecycle', () => {
  it('does not call connect()', () => {
    const { mockConnect } = setup();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('does not call disconnect()', () => {
    const { mockDisconnect } = setup();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });
});

describe('LobbyComponent — session persistence', () => {
  it('saves /lobby session on load with joinCode', () => {
    const { mockSaveSession } = setup();
    expect(mockSaveSession).toHaveBeenCalledWith('match-1', '/lobby', 'ABC123');
  });
});

describe('LobbyComponent — player list identity', () => {
  it('sets isMe=true only for the current player', () => {
    const state = makeState();
    const { comp } = setup(state);

    const players = comp.playersWithLocalStatus();
    const me    = players.find(p => p.playerId === 'p1');
    const other = players.find(p => p.playerId === 'p2');

    expect(me?.isMe).toBe(true);
    expect(other?.isMe).toBe(false);
  });
});

describe('LobbyComponent — kick player', () => {
  it('openKickConfirm sets playerToKick with resolved alias', () => {
    const state = makeState();
    const { comp } = setup(state);

    comp.openKickConfirm({ playerId: 'p2', alias: 'Guest' });

    expect(comp.playerToKick()).toEqual({ playerId: 'p2', alias: 'Guest' });
  });

  it('openKickConfirm resolves null alias to "Unknown"', () => {
    const state = makeState();
    const { comp } = setup(state);

    comp.openKickConfirm({ playerId: 'p2', alias: null });

    expect(comp.playerToKick()).toEqual({ playerId: 'p2', alias: 'Unknown' });
  });

  it('cancelKick clears playerToKick', () => {
    const state = makeState();
    const { comp } = setup(state);

    comp.openKickConfirm({ playerId: 'p2', alias: 'Guest' });
    comp.cancelKick();

    expect(comp.playerToKick()).toBeNull();
  });

  it('confirmKick sends KICK_PLAYER with correct playerId', () => {
    const state = makeState();
    const { comp, mockSend } = setup(state);

    comp.openKickConfirm({ playerId: 'p2', alias: 'Guest' });
    comp.confirmKick();

    expect(mockSend).toHaveBeenCalledOnce();
    const msg = mockSend.mock.calls[0]![0];
    expect(msg.type).toBe('KICK_PLAYER');
    expect(msg.payload.playerId).toBe('p2');
    expect(msg.matchId).toBe('match-1');
  });

  it('confirmKick clears playerToKick signal after sending', () => {
    const state = makeState();
    const { comp } = setup(state);

    comp.openKickConfirm({ playerId: 'p2', alias: 'Guest' });
    comp.confirmKick();

    expect(comp.playerToKick()).toBeNull();
  });

  it('confirmKick does nothing when playerToKick is null', () => {
    const state = makeState();
    const { comp, mockSend } = setup(state);

    comp.confirmKick();

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('host sees kick button on non-self player cards', () => {
    // playerIdSignal defaults to 'p1' (host) in setup()
    const state = makeState();
    const { fixture } = setup(state);
    fixture.detectChanges();

    // p2's card should have a kick button; p1's should not
    const playerCards = fixture.nativeElement.querySelectorAll('.player-card') as NodeListOf<Element>;
    // Find cards with a .btn-danger button inside them (the kick button)
    const cardsWithKick = Array.from(playerCards).filter(card => card.querySelector('.btn-danger'));
    expect(cardsWithKick).toHaveLength(1);
  });

  it('host does not see kick button on own player card', () => {
    const state = makeState();
    const { fixture } = setup(state);
    fixture.detectChanges();

    // The host's card (p1) should have no kick button
    const playerCards = fixture.nativeElement.querySelectorAll('.player-card') as NodeListOf<Element>;
    const hostCard = Array.from(playerCards).find(card =>
      card.textContent?.includes('Host')
    );
    expect(hostCard?.querySelector('.btn-danger')).toBeNull();
  });

  it('non-host does not see any kick buttons', () => {
    const state = makeState();
    const { fixture, playerIdSignal } = setup(state);
    playerIdSignal.set('p2'); // switch to non-host
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('.player-card .btn-danger');
    expect(buttons).toHaveLength(0);
  });

  it('clicking kick button opens confirmation modal with correct alias', () => {
    const state = makeState();
    const { fixture } = setup(state);
    fixture.detectChanges();

    // Click the kick button (there is exactly one, on the guest's card)
    const kickBtn = fixture.nativeElement.querySelector('.player-card .btn-danger') as HTMLButtonElement;
    kickBtn.click();
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('.modal') as HTMLElement | null;
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('Guest');
  });

  it('clicking Cancel in modal closes it without sending', () => {
    const state = makeState();
    const { fixture, comp, mockSend } = setup(state);
    fixture.detectChanges();

    comp.openKickConfirm({ playerId: 'p2', alias: 'Guest' });
    fixture.detectChanges();

    const cancelBtn = fixture.nativeElement.querySelector('.modal .btn-ghost') as HTMLButtonElement;
    cancelBtn.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.modal')).toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('clicking modal backdrop closes modal without sending', () => {
    const state = makeState();
    const { fixture, comp, mockSend } = setup(state);
    fixture.detectChanges();

    comp.openKickConfirm({ playerId: 'p2', alias: 'Guest' });
    fixture.detectChanges();

    const backdrop = fixture.nativeElement.querySelector('.modal-backdrop') as HTMLElement;
    backdrop.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.modal')).toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('clicking Confirm Kick button in modal sends KICK_PLAYER and closes modal', () => {
    const state = makeState();
    const { fixture, comp, mockSend } = setup(state);
    fixture.detectChanges();

    comp.openKickConfirm({ playerId: 'p2', alias: 'Guest' });
    fixture.detectChanges();

    // The modal has two .btn-danger buttons: the kick button in the player card and the confirm button in the modal.
    // Query specifically inside .modal to get the confirm button.
    const confirmBtn = fixture.nativeElement.querySelector('.modal .btn-danger') as HTMLButtonElement;
    confirmBtn.click();
    fixture.detectChanges();

    expect(mockSend).toHaveBeenCalledOnce();
    const msg = mockSend.mock.calls[0]![0];
    expect(msg.type).toBe('KICK_PLAYER');
    expect(msg.payload.playerId).toBe('p2');
    expect(fixture.nativeElement.querySelector('.modal')).toBeNull();
  });
});

describe('LobbyComponent — kicked player UX', () => {
  it('does not set errorMessage when ERROR code is KICKED', () => {
    const { comp, messagesSubject } = setup();

    messagesSubject.next({
      type: 'ERROR',
      matchId: 'match-1',
      payload: { code: 'KICKED', message: 'You have been removed from the match by the host' },
    });

    expect(comp.errorMessage()).toBeNull();
  });

  it('navigates to / with ?kicked=true when wasKicked becomes true', () => {
    const { wasKickedSignal, mockNavigate, mockClear } = setup();

    wasKickedSignal.set(true);
    TestBed.flushEffects();

    expect(mockNavigate).toHaveBeenCalledWith(['/'], { state: { kicked: true } });
    expect(mockClear).toHaveBeenCalledOnce();
  });

  it('still sets errorMessage for other error codes when wasKicked is false', () => {
    const { comp, messagesSubject } = setup();

    messagesSubject.next({
      type: 'ERROR',
      matchId: 'match-1',
      payload: { code: 'INVALID_STATE', message: 'Something went wrong' },
    });

    expect(comp.errorMessage()).toBe('Something went wrong');
  });
});

import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { MatchSocketService } from './match-socket.service';
import { ClientIdService } from './client-id.service';
import { environment } from '../../environments/environment';
import type { ServerMessage } from '@bingo/shared';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN       = 1;
  static readonly CLOSING    = 2;
  static readonly CLOSED     = 3;

  static instances: MockWebSocket[] = [];

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  sentMessages: string[] = [];

  private listeners: Record<string, ((e: any) => void)[]> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(event: string, cb: (e: any) => void) {
    (this.listeners[event] ??= []).push(cb);
  }

  removeEventListener(event: string, cb: (e: any) => void) {
    this.listeners[event] = (this.listeners[event] ?? []).filter(fn => fn !== cb);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', {});
  }

  emit(event: string, payload: unknown) {
    (this.listeners[event] ?? []).forEach(cb => cb(payload));
  }

  /** Simulate connection open. */
  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit('open', {});
  }

  /** Simulate incoming message. */
  receive(msg: ServerMessage) {
    this.emit('message', { data: JSON.stringify(msg) });
  }
}

describe('MatchSocketService', () => {
  let svc: MatchSocketService;
  let clientId: string;

  beforeEach(() => {
    localStorage.clear();
    MockWebSocket.instances = [];
    (globalThis as any).WebSocket = MockWebSocket;

    TestBed.configureTestingModule({});
    svc      = TestBed.inject(MatchSocketService);
    clientId = TestBed.inject(ClientIdService).clientId;
  });

  afterEach(() => {
    localStorage.clear();
    delete (globalThis as any).WebSocket;
  });

  it('starts in disconnected state', () => {
    expect(svc.connectionStatus()).toBe('disconnected');
  });

  it('constructs the correct WebSocket URL', () => {
    svc.connect('match-1');
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe(
      `${environment.wsBaseUrl}/ws?matchId=match-1&clientId=${encodeURIComponent(clientId)}`,
    );
  });

  it('transitions to connecting then connected', () => {
    svc.connect('match-1');
    expect(svc.connectionStatus()).toBe('connecting');

    MockWebSocket.instances[0].open();
    expect(svc.connectionStatus()).toBe('connected');
  });

  it('sends SYNC_STATE automatically after open', () => {
    svc.connect('match-1');
    MockWebSocket.instances[0].open();

    const sent = JSON.parse(MockWebSocket.instances[0].sentMessages[0]);
    expect(sent.type).toBe('SYNC_STATE');
    expect(sent.matchId).toBe('match-1');
    expect(sent.clientId).toBe(clientId);
  });

  it('transitions to disconnected on close', () => {
    svc.connect('match-1');
    MockWebSocket.instances[0].open();
    MockWebSocket.instances[0].close();
    expect(svc.connectionStatus()).toBe('disconnected');
  });

  it('messages$ emits incoming server messages', () => {
    const received: ServerMessage[] = [];
    svc.messages$.subscribe(m => received.push(m));

    svc.connect('match-1');
    const ws = MockWebSocket.instances[0];
    ws.open();

    const msg: ServerMessage = { type: 'MATCH_STARTED', matchId: 'match-1', payload: {} };
    ws.receive(msg);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(msg);
  });

  it('send() serializes the message when socket is open', () => {
    svc.connect('match-1');
    MockWebSocket.instances[0].open();

    svc.send({
      type: 'SET_READY',
      matchId: 'match-1',
      clientId,
      eventId: crypto.randomUUID(),
      payload: { ready: true },
    });

    // First message is SYNC_STATE, second is SET_READY
    const sent = JSON.parse(MockWebSocket.instances[0].sentMessages[1]);
    expect(sent.type).toBe('SET_READY');
    expect(sent.payload.ready).toBe(true);
  });

  it('send() is a no-op when socket is not open', () => {
    svc.connect('match-1');
    // Don't open the socket — readyState is CONNECTING

    svc.send({
      type: 'SYNC_STATE',
      matchId: 'match-1',
      clientId,
      eventId: crypto.randomUUID(),
      payload: {},
    });

    expect(MockWebSocket.instances[0].sentMessages).toHaveLength(0);
  });

  it('disconnect() closes the socket and sets disconnected', () => {
    svc.connect('match-1');
    MockWebSocket.instances[0].open();
    svc.disconnect();
    expect(svc.connectionStatus()).toBe('disconnected');
  });

  it('multiple subscribers share the same socket (share operator)', () => {
    const r1: ServerMessage[] = [];
    const r2: ServerMessage[] = [];
    svc.messages$.subscribe(m => r1.push(m));
    svc.messages$.subscribe(m => r2.push(m));

    svc.connect('match-1');
    MockWebSocket.instances[0].open();

    const msg: ServerMessage = { type: 'MATCH_STARTED', matchId: 'match-1', payload: {} };
    MockWebSocket.instances[0].receive(msg);

    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    // Only one WebSocket should have been created
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

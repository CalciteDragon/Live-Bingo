import { Injectable, inject, signal } from '@angular/core';
import { Observable, Subject, share } from 'rxjs';
import type { ClientMessage, ServerMessage, WsErrorPayload } from '@bingo/shared';
import { ClientIdService } from './client-id.service';
import { environment } from '../../environments/environment';
import { randomUUID } from './uuid';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

const MAX_RECONNECT_DELAY_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class MatchSocketService {
  private readonly clientId = inject(ClientIdService).clientId;

  readonly connectionStatus = signal<ConnectionStatus>('disconnected');
  /** True only during a reconnect attempt (not the initial connection). */
  readonly isReconnecting = signal(false);
  /** Emits when the server replaces this session with a newer connection (e.g. second tab). */
  readonly sessionReplaced = signal(false);

  private readonly messageSubject = new Subject<ServerMessage>();
  readonly messages$: Observable<ServerMessage> = this.messageSubject.asObservable().pipe(share());

  private socket: WebSocket | null = null;
  private currentMatchId: string | null = null;
  private intentionalDisconnect = false;
  private reconnectAttempts = 0;
  private reconnectTimerId: ReturnType<typeof setTimeout> | null = null;

  connect(matchId: string): void {
    this.cancelReconnect();
    // Mark as intentional so the old socket's onclose doesn't schedule a reconnect.
    this.intentionalDisconnect = true;
    this.closeSocket();
    this.intentionalDisconnect = false;
    this.reconnectAttempts = 0;
    this.sessionReplaced.set(false);
    this.currentMatchId = matchId;
    this.openSocket(matchId);
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.cancelReconnect();
    this.closeSocket();
    this.currentMatchId = null;
    this.isReconnecting.set(false);
    this.connectionStatus.set('disconnected');
  }

  send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  private openSocket(matchId: string): void {
    const wsOrigin = environment.wsBaseUrl ||
      `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
    const url =
      `${wsOrigin}/ws` +
      `?matchId=${encodeURIComponent(matchId)}` +
      `&clientId=${encodeURIComponent(this.clientId)}`;

    this.connectionStatus.set('connecting');
    const ws = new WebSocket(url);
    this.socket = ws;

    ws.addEventListener('open', () => {
      this.connectionStatus.set('connected');
      this.isReconnecting.set(false);
      this.reconnectAttempts = 0;
      this.send({
        type: 'SYNC_STATE',
        matchId,
        clientId: this.clientId,
        eventId: randomUUID(),
        payload: {},
      });
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        if (msg.type === 'ERROR' && (msg.payload as WsErrorPayload).code === 'SESSION_REPLACED') {
          this.intentionalDisconnect = true;
          this.cancelReconnect();
          this.currentMatchId = null;
          this.sessionReplaced.set(true);
        }
        this.messageSubject.next(msg);
      } catch {
        // ignore malformed frames
      }
    });

    ws.addEventListener('close', () => {
      if (!this.intentionalDisconnect && this.currentMatchId === matchId) {
        this.scheduleReconnect(matchId);
      } else if (this.intentionalDisconnect) {
        this.connectionStatus.set('disconnected');
      }
    });

    ws.addEventListener('error', () => {
      // 'close' always follows 'error' — reconnect is handled there
    });
  }

  private closeSocket(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  private scheduleReconnect(matchId: string): void {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempts++;
    this.isReconnecting.set(true);
    this.connectionStatus.set('connecting');
    this.reconnectTimerId = setTimeout(() => {
      if (!this.intentionalDisconnect && this.currentMatchId === matchId) {
        this.openSocket(matchId);
      }
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimerId !== null) {
      clearTimeout(this.reconnectTimerId);
      this.reconnectTimerId = null;
    }
    this.reconnectAttempts = 0;
  }
}

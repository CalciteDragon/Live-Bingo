import { Injectable, inject, signal } from '@angular/core';
import { Observable, Subject, share } from 'rxjs';
import type { ClientMessage, ServerMessage } from '@bingo/shared';
import { ClientIdService } from './client-id.service';
import { environment } from '../../environments/environment';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

@Injectable({ providedIn: 'root' })
export class MatchSocketService {
  private readonly clientId = inject(ClientIdService).clientId;

  readonly connectionStatus = signal<ConnectionStatus>('disconnected');

  private readonly messageSubject = new Subject<ServerMessage>();
  readonly messages$: Observable<ServerMessage> = this.messageSubject.asObservable().pipe(share());

  private socket: WebSocket | null = null;
  private currentMatchId: string | null = null;

  connect(matchId: string): void {
    this.disconnect();

    this.currentMatchId = matchId;
    const url =
      `${environment.wsBaseUrl}/ws` +
      `?matchId=${encodeURIComponent(matchId)}` +
      `&clientId=${encodeURIComponent(this.clientId)}`;

    this.connectionStatus.set('connecting');
    const ws = new WebSocket(url);
    this.socket = ws;

    ws.addEventListener('open', () => {
      this.connectionStatus.set('connected');
      this.send({
        type: 'SYNC_STATE',
        matchId,
        clientId: this.clientId,
        eventId: crypto.randomUUID(),
        payload: {},
      });
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      try {
        this.messageSubject.next(JSON.parse(event.data) as ServerMessage);
      } catch {
        // ignore malformed frames
      }
    });

    ws.addEventListener('close', () => {
      this.connectionStatus.set('disconnected');
    });

    ws.addEventListener('error', () => {
      this.connectionStatus.set('disconnected');
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.currentMatchId = null;
    this.connectionStatus.set('disconnected');
  }

  send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }
}

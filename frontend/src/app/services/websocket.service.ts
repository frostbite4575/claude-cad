import { Injectable, OnDestroy } from '@angular/core';
import { Subject, Observable } from 'rxjs';

export interface WSMessage {
  type: string;
  payload: any;
}

@Injectable({
  providedIn: 'root',
})
export class WebsocketService implements OnDestroy {
  private socket: WebSocket | null = null;
  private messagesSubject = new Subject<WSMessage>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  messages$: Observable<WSMessage> = this.messagesSubject.asObservable();

  constructor() {
    this.connect();
  }

  private connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;

    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      console.log('WebSocket connected');
    };

    this.socket.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);
        this.messagesSubject.next(message);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    this.socket.onclose = () => {
      console.log('WebSocket disconnected, reconnecting in 2s...');
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };

    this.socket.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  send(message: WSMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  ngOnDestroy() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}

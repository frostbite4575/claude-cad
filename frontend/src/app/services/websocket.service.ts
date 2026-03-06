import { Injectable, OnDestroy } from '@angular/core';
import { Subject, Observable, BehaviorSubject } from 'rxjs';

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
  private reconnectDelay = 2000;
  private readonly maxReconnectDelay = 30000;

  private connectedSubject = new BehaviorSubject<boolean>(false);

  messages$: Observable<WSMessage> = this.messagesSubject.asObservable();
  connected$: Observable<boolean> = this.connectedSubject.asObservable();

  get isConnected(): boolean {
    return this.connectedSubject.value;
  }

  constructor() {
    this.connect();
  }

  private connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;

    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectDelay = 2000; // reset on successful connect
      this.connectedSubject.next(true);
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
      this.connectedSubject.next(false);
      console.log(`WebSocket disconnected, reconnecting in ${(this.reconnectDelay / 1000).toFixed(0)}s...`);
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
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

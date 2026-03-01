import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { WebsocketService } from '../../services/websocket.service';
import type { ChatMessage } from '../../models/chat';

@Component({
  selector: 'app-chat-panel',
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-panel.component.html',
  styleUrl: './chat-panel.component.scss',
})
export class ChatPanelComponent implements OnInit, OnDestroy {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef<HTMLDivElement>;

  messages: ChatMessage[] = [];
  inputText = '';
  loading = false;

  private subscription!: Subscription;

  constructor(private wsService: WebsocketService, private sanitizer: DomSanitizer) {}

  ngOnInit() {
    this.subscription = this.wsService.messages$.subscribe((msg) => {
      if (msg.type === 'chat_response') {
        const payload = msg.payload as { role: string; content: string; done: boolean };
        this.messages.push({
          role: 'assistant',
          content: payload.content,
          timestamp: new Date(),
        });
        if (payload.done) {
          this.loading = false;
        }
        this.scrollToBottom();
      } else if (msg.type === 'chat_tool_use') {
        const payload = msg.payload as { tool: string; input: Record<string, unknown> };
        this.messages.push({
          role: 'tool',
          content: this.formatToolName(payload.tool),
          toolName: payload.tool,
          toolInput: payload.input,
          timestamp: new Date(),
        });
        this.scrollToBottom();
      }
    });
  }

  ngOnDestroy() {
    this.subscription?.unsubscribe();
  }

  send() {
    const text = this.inputText.trim();
    if (!text || this.loading) return;

    this.messages.push({
      role: 'user',
      content: text,
      timestamp: new Date(),
    });

    this.wsService.send({
      type: 'chat_message',
      payload: { message: text },
    });

    this.inputText = '';
    this.loading = true;
    this.scrollToBottom();
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  /** Escape HTML, then turn `/api/...` paths and http(s) URLs into clickable links */
  linkify(text: string): SafeHtml {
    // Escape HTML first to prevent XSS
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // Match `/api/...` paths (backtick-wrapped or bare) and full http(s) URLs
    const html = escaped.replace(
      /`(\/api\/[^\s`]+)`|(?:https?:\/\/[^\s<]+)|(\/api\/export\/[^\s<,)]+)/g,
      (match, backtickPath) => {
        const path = backtickPath || match;
        const href = path.startsWith('http') ? path : path;
        const label = path.startsWith('http') ? path : path;
        // Derive filename from the export path (e.g. /api/export/dxf → export.dxf)
        const extMatch = path.match(/\/api\/export\/(\w+)/);
        const downloadAttr = extMatch ? `download="export.${extMatch[1]}"` : 'download';
        return `<a class="chat-link" href="${href}" ${downloadAttr}>${label}</a>`;
      }
    );
    // Bypass Angular sanitizer so href and download attributes are preserved
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  clearChat() {
    this.messages = [];
    this.loading = false;
    this.wsService.send({ type: 'clear_conversation', payload: {} });
  }

  private formatToolName(name: string): string {
    return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private scrollToBottom() {
    setTimeout(() => {
      const el = this.messagesContainer?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }, 0);
  }
}

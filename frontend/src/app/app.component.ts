import { Component } from '@angular/core';
import { ViewportComponent } from './components/viewport/viewport.component';
import { ToolbarComponent } from './components/toolbar/toolbar.component';
import { ChatPanelComponent } from './components/chat-panel/chat-panel.component';

@Component({
  selector: 'app-root',
  imports: [ViewportComponent, ToolbarComponent, ChatPanelComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {}

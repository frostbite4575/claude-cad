import { Component, HostBinding } from '@angular/core';
import { ViewportComponent } from './components/viewport/viewport.component';
import { ToolbarComponent } from './components/toolbar/toolbar.component';
import { ChatPanelComponent } from './components/chat-panel/chat-panel.component';
import { ToolPanelComponent } from './components/tool-panel/tool-panel.component';

@Component({
  selector: 'app-root',
  imports: [ViewportComponent, ToolbarComponent, ChatPanelComponent, ToolPanelComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  toolPanelOpen = false;

  @HostBinding('class.tool-panel-open')
  get isToolPanelOpen() { return this.toolPanelOpen; }
}

import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ToolDefService, ToolCategory, ToolDef } from '../../services/tool-def.service';
import { WebsocketService } from '../../services/websocket.service';
import { ToolFormComponent } from './tool-form.component';

@Component({
  selector: 'app-tool-panel',
  imports: [CommonModule, FormsModule, ToolFormComponent],
  templateUrl: './tool-panel.component.html',
  styleUrl: './tool-panel.component.scss',
})
export class ToolPanelComponent implements OnInit, OnDestroy {
  categories: ToolCategory[] = [];
  filteredCategories: ToolCategory[] = [];
  searchQuery = '';
  expandedCategory: string | null = null;
  selectedTool: ToolDef | null = null;

  resultMessage = '';
  resultSuccess = true;

  private subs: Subscription[] = [];

  constructor(
    private toolDefService: ToolDefService,
    private wsService: WebsocketService,
  ) {}

  ngOnInit() {
    this.toolDefService.fetchToolDefs();
    this.subs.push(
      this.toolDefService.categories$.subscribe((cats) => {
        this.categories = cats;
        this.applyFilter();
      }),
      this.wsService.messages$.subscribe((msg) => {
        if (msg.type === 'tool_result') {
          const payload = msg.payload as { tool: string; result: string };
          try {
            const parsed = JSON.parse(payload.result);
            this.resultSuccess = parsed.success !== false;
            this.resultMessage = parsed.description || parsed.error || payload.result;
          } catch {
            this.resultSuccess = !payload.result.startsWith('Error');
            this.resultMessage = payload.result.slice(0, 200);
          }
          // Auto-clear after a few seconds
          setTimeout(() => { this.resultMessage = ''; }, 5000);
        }
      }),
    );
  }

  ngOnDestroy() {
    this.subs.forEach((s) => s.unsubscribe());
  }

  onSearchChange() {
    this.applyFilter();
  }

  private applyFilter() {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) {
      this.filteredCategories = this.categories;
      return;
    }

    this.filteredCategories = this.categories
      .map((cat) => ({
        ...cat,
        tools: cat.tools.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            cat.name.toLowerCase().includes(q)
        ),
      }))
      .filter((cat) => cat.tools.length > 0);

    // Auto-expand categories when searching
    if (this.filteredCategories.length === 1) {
      this.expandedCategory = this.filteredCategories[0].name;
    }
  }

  toggleCategory(name: string) {
    this.expandedCategory = this.expandedCategory === name ? null : name;
  }

  selectTool(tool: ToolDef) {
    this.selectedTool = tool;
    this.resultMessage = '';
  }

  goBack() {
    this.selectedTool = null;
    this.resultMessage = '';
  }

  onExecute(event: { tool: string; input: Record<string, any> }) {
    this.resultMessage = '';
    this.wsService.send({
      type: 'tool_execute',
      payload: event,
    });
  }

  formatName(name: string): string {
    return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  get totalTools(): number {
    return this.categories.reduce((sum, c) => sum + c.tools.length, 0);
  }
}

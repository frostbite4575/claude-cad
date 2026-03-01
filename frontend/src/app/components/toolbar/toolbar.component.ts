import { Component, OnDestroy, OnInit } from '@angular/core';
import { NgClass } from '@angular/common';
import { Subscription } from 'rxjs';
import { DrawingToolService, DrawingTool } from '../../services/drawing-tool.service';
import { WebsocketService } from '../../services/websocket.service';
import { SelectionService } from '../../services/selection.service';

@Component({
  selector: 'app-toolbar',
  imports: [NgClass],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss'
})
export class ToolbarComponent implements OnInit, OnDestroy {
  activeTool: DrawingTool | null = null;
  hasSelection = false;
  private subs: Subscription[] = [];

  constructor(
    private drawingToolService: DrawingToolService,
    private wsService: WebsocketService,
    private selectionService: SelectionService,
  ) {}

  ngOnInit() {
    this.subs.push(
      this.drawingToolService.activeTool$.subscribe(
        (tool) => (this.activeTool = tool)
      ),
      this.selectionService.selected$.subscribe(
        (id) => (this.hasSelection = id !== null)
      ),
    );
  }

  ngOnDestroy() {
    this.subs.forEach((s) => s.unsubscribe());
  }

  setTool(tool: DrawingTool): void {
    this.drawingToolService.setTool(tool);
  }

  undo(): void {
    this.wsService.send({ type: 'undo', payload: {} });
  }

  redo(): void {
    this.wsService.send({ type: 'redo', payload: {} });
  }

  deleteSelected(): void {
    const id = this.selectionService.selectedEntityId;
    if (!id) return;
    this.wsService.send({
      type: 'tool_execute',
      payload: { tool: 'delete_entity', input: { entity_id: id } },
    });
  }

  extrudeSelected(): void {
    const id = this.selectionService.selectedEntityId;
    if (!id) return;
    this.wsService.send({
      type: 'tool_execute',
      payload: { tool: 'extrude', input: { entity_id: id, height: 1.0 } },
    });
  }

  exportDxf(): void {
    const a = document.createElement('a');
    a.href = '/api/export/dxf';
    a.download = 'export.dxf';
    a.click();
  }

  exportStep(): void {
    const a = document.createElement('a');
    a.href = '/api/export/step';
    a.download = 'export.step';
    a.click();
  }
}

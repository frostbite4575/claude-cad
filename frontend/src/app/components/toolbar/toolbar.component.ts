import { Component, OnDestroy, OnInit } from '@angular/core';
import { NgClass } from '@angular/common';
import { Subscription } from 'rxjs';
import { DrawingToolService, DrawingTool, SketchPlane } from '../../services/drawing-tool.service';
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
  sketchPlane: SketchPlane = 'XY';
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
      this.selectionService.selection$.subscribe(
        (set) => (this.hasSelection = set.size > 0)
      ),
      this.drawingToolService.sketchPlane$.subscribe(
        (plane) => (this.sketchPlane = plane)
      ),
    );
  }

  ngOnDestroy() {
    this.subs.forEach((s) => s.unsubscribe());
  }

  setTool(tool: DrawingTool): void {
    this.drawingToolService.setTool(tool);
  }

  cycleSketchPlane(): void {
    const planes: SketchPlane[] = ['XY', 'XZ', 'YZ'];
    const idx = planes.indexOf(this.sketchPlane);
    this.drawingToolService.setSketchPlane(planes[(idx + 1) % 3]);
  }

  undo(): void {
    this.wsService.send({ type: 'undo', payload: {} });
  }

  redo(): void {
    this.wsService.send({ type: 'redo', payload: {} });
  }

  deleteSelected(): void {
    const ids = this.selectionService.selectedIds;
    if (ids.size === 0) return;
    for (const id of ids) {
      this.wsService.send({
        type: 'tool_execute',
        payload: { tool: 'delete_entity', input: { entity_id: id } },
      });
    }
  }

  extrudeSelected(): void {
    const id = this.selectionService.selectedEntityId;
    if (!id) return;
    const input = prompt('Extrude height (inches):', '1.0');
    if (!input) return;
    const height = parseFloat(input);
    if (isNaN(height) || height === 0) return;
    this.wsService.send({
      type: 'tool_execute',
      payload: { tool: 'extrude', input: { entity_id: id, height } },
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

  exportStl(): void {
    const a = document.createElement('a');
    a.href = '/api/export/stl';
    a.download = 'export.stl';
    a.click();
  }

  importStep(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.step,.stp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const response = await fetch('/api/import/step', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: text,
        });
        const result = await response.json();
        if (!result.success) {
          console.error('STEP import failed:', result.error);
        }
      } catch (err) {
        console.error('Failed to import STEP:', err);
      }
    };
    input.click();
  }

  saveProject(): void {
    const a = document.createElement('a');
    a.href = '/api/project/save';
    a.download = 'project.ccad';
    a.click();
  }

  loadProject(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ccad,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const project = JSON.parse(text);
        const response = await fetch('/api/project/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(project),
        });
        const result = await response.json();
        if (!result.success) {
          console.error('Project load failed:', result.error);
        }
      } catch (err) {
        console.error('Failed to load project:', err);
      }
    };
    input.click();
  }
}

import { Component, OnDestroy, OnInit } from '@angular/core';
import { NgClass } from '@angular/common';
import { Subscription } from 'rxjs';
import { DrawingToolService, DrawingTool } from '../../services/drawing-tool.service';

@Component({
  selector: 'app-toolbar',
  imports: [NgClass],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss'
})
export class ToolbarComponent implements OnInit, OnDestroy {
  activeTool: DrawingTool | null = null;
  private sub!: Subscription;

  constructor(private drawingToolService: DrawingToolService) {}

  ngOnInit() {
    this.sub = this.drawingToolService.activeTool$.subscribe(
      (tool) => (this.activeTool = tool)
    );
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  setTool(tool: DrawingTool): void {
    this.drawingToolService.setTool(tool);
  }

  exportDxf(): void {
    const a = document.createElement('a');
    a.href = '/api/export/dxf';
    a.download = 'export.dxf';
    a.click();
  }
}

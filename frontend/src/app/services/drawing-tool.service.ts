import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type DrawingTool = 'line' | 'rectangle' | 'circle' | 'arc' | 'measure';
export type SketchPlane = 'XY' | 'XZ' | 'YZ';

@Injectable({ providedIn: 'root' })
export class DrawingToolService {
  private activeToolSubject = new BehaviorSubject<DrawingTool | null>(null);
  activeTool$ = this.activeToolSubject.asObservable();

  private sketchPlaneSubject = new BehaviorSubject<SketchPlane>('XY');
  sketchPlane$ = this.sketchPlaneSubject.asObservable();

  get activeTool(): DrawingTool | null {
    return this.activeToolSubject.value;
  }

  get sketchPlane(): SketchPlane {
    return this.sketchPlaneSubject.value;
  }

  setTool(tool: DrawingTool | null): void {
    // Toggle: clicking same tool deactivates it
    this.activeToolSubject.next(this.activeToolSubject.value === tool ? null : tool);
  }

  clearTool(): void {
    this.activeToolSubject.next(null);
  }

  setSketchPlane(plane: SketchPlane): void {
    this.sketchPlaneSubject.next(plane);
  }
}

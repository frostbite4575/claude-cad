import {
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  AfterViewInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as THREE from 'three';
import { WebsocketService, WSMessage } from '../../services/websocket.service';
import { DrawingToolService, DrawingTool, SketchPlane } from '../../services/drawing-tool.service';
import { SelectionService } from '../../services/selection.service';
import { SceneService } from '../../services/scene.service';
import { EntityRenderService } from '../../services/entity-render.service';
import { SnappingService } from '../../services/snapping.service';
import { DrawingService } from '../../services/drawing.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-viewport',
  imports: [FormsModule],
  templateUrl: './viewport.component.html',
  styleUrl: './viewport.component.scss',
})
export class ViewportComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private subscription!: Subscription;
  private toolSub!: Subscription;
  private raycaster = new THREE.Raycaster();
  private pointerDownPos = { x: 0, y: 0 };
  private currentSketchPlane: SketchPlane = 'XY';

  // Template-bound state
  wsConnected = true;
  selectedEntityId: string | null = null;
  propPanelName = '';
  propPanelType = '';
  propPanelKind = '';
  propPanelDims = '';
  measureResult = '';
  showHelp = false;
  showEntityList = false;
  entityList: { id: string; name: string; kind: string; selected: boolean; visible: boolean }[] = [];
  showExtrudeInput = false;
  extrudeHeight = '1.0';
  editingName = false;
  editNameValue = '';
  dimensionText = '';
  dimensionX = 0;
  dimensionY = 0;
  drawingToolActive = false;
  coordX = '';
  coordY = '';

  get snapEnabled() { return this.snappingService.snapEnabled; }
  get snapSize() { return this.snappingService.snapSize; }
  get viewMode() { return this.entityRenderService.viewMode; }

  constructor(
    private ngZone: NgZone,
    private wsService: WebsocketService,
    private drawingToolService: DrawingToolService,
    private selectionService: SelectionService,
    private sceneService: SceneService,
    private entityRenderService: EntityRenderService,
    private snappingService: SnappingService,
    private drawingService: DrawingService,
  ) {}

  ngOnInit() {
    this.subscription = this.wsService.messages$.subscribe((msg) => {
      this.handleMessage(msg);
    });

    this.wsService.connected$.subscribe((connected) => {
      this.wsConnected = connected;
    });

    this.toolSub = this.drawingToolService.activeTool$.subscribe((tool) => {
      this.ngZone.run(() => this.onToolChanged(tool));
    });

    this.drawingToolService.sketchPlane$.subscribe((plane) => {
      this.currentSketchPlane = plane;
      this.drawingService.updateDrawingPlane(plane);
      if (this.drawingToolActive && this.snappingService.snapEnabled) {
        this.snappingService.showDrawingGrid(this.sceneService.gridGroup, plane);
      }
    });
  }

  ngAfterViewInit() {
    this.sceneService.init(this.canvasRef.nativeElement);
    this.ngZone.runOutsideAngular(() => {
      this.sceneService.startRenderLoop();
      const canvas = this.canvasRef.nativeElement;
      canvas.addEventListener('pointerdown', this.onPointerDown);
      canvas.addEventListener('pointerup', this.onPointerUp);
    });
    window.addEventListener('keydown', this.onKeyDown);
  }

  ngOnDestroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    const canvas = this.canvasRef?.nativeElement;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onPointerDown);
      canvas.removeEventListener('pointerup', this.onPointerUp);
      canvas.removeEventListener('pointermove', this.onPointerMove);
    }
    this.subscription?.unsubscribe();
    this.toolSub?.unsubscribe();
    this.sceneService.dispose();
    this.drawingService.dispose();
    this.snappingService.dispose();
  }

  // --- Drawing tool activation ---

  private onToolChanged(tool: DrawingTool | null) {
    const canvas = this.canvasRef.nativeElement;

    if (tool) {
      this.drawingToolActive = true;
      this.drawingService.reset();
      this.drawingService.clearPreview(this.sceneService.previewGroup);
      this.drawingService.clearMeasure(this.sceneService.measureGroup);
      this.measureResult = '';
      this.snappingService.rebuildSnapPoints(this.sceneService.meshGroup);
      this.sceneService.setOrbitForDrawing(true);
      canvas.addEventListener('pointermove', this.onPointerMove);
      canvas.style.cursor = 'crosshair';
      if (this.snappingService.snapEnabled) {
        this.snappingService.showDrawingGrid(this.sceneService.gridGroup, this.currentSketchPlane);
      }
    } else {
      this.drawingToolActive = false;
      this.drawingService.reset();
      this.coordX = '';
      this.coordY = '';
      this.dimensionText = '';
      this.drawingService.clearPreview(this.sceneService.previewGroup);
      this.snappingService.hideDrawingGrid(this.sceneService.gridGroup);
      this.snappingService.hideSnapIndicator();
      this.sceneService.setOrbitForDrawing(false);
      canvas.removeEventListener('pointermove', this.onPointerMove);
      canvas.style.cursor = '';
    }
  }

  // --- Pointer events ---

  private onPointerMove = (e: PointerEvent) => {
    if (!this.drawingToolActive) return;

    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );

    this.raycaster.setFromCamera(ndc, this.sceneService.camera);
    const intersection = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.drawingService.drawingPlane, intersection);

    if (hit) {
      let snapped = this.snappingService.snapToGrid(intersection, this.currentSketchPlane);

      const geoSnap = this.snappingService.findSnapPoint(snapped, this.sceneService.camera, canvas);
      if (geoSnap) {
        snapped = geoSnap.clone();
        this.snappingService.showSnapIndicator(geoSnap, this.sceneService.scene, this.sceneService.camera);
      } else {
        this.snappingService.hideSnapIndicator();
      }

      this.drawingService.mouseWorldPos = snapped;
      const coords2d = this.drawingService.to2D(snapped, this.currentSketchPlane);
      this.ngZone.run(() => {
        this.coordX = coords2d.x.toFixed(3);
        this.coordY = coords2d.y.toFixed(3);
      });
      this.updatePreview();
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0) return;

    const dx = e.clientX - this.pointerDownPos.x;
    const dy = e.clientY - this.pointerDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) >= 5) return;

    if (this.drawingToolActive) {
      this.ngZone.run(() => this.handleDrawingClick(e));
    } else {
      this.ngZone.run(() => this.handleCanvasClick(e));
    }
  };

  private handleDrawingClick(_e: PointerEvent) {
    if (!this.drawingService.mouseWorldPos) return;

    this.drawingService.drawingPoints.push(this.drawingService.mouseWorldPos.clone());
    const tool = this.drawingToolService.activeTool;
    if (!tool) return;

    const points = this.drawingService.drawingPoints;
    const plane = this.currentSketchPlane;

    switch (tool) {
      case 'line':
        if (points.length >= 2) {
          const p0 = this.drawingService.to2D(points[0], plane);
          const p1 = this.drawingService.to2D(points[1], plane);
          this.sendToolExecute('sketch_line', { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y, plane });
          this.finishShape();
        }
        break;

      case 'rectangle':
        if (points.length >= 2) {
          const r0 = this.drawingService.to2D(points[0], plane);
          const r1 = this.drawingService.to2D(points[1], plane);
          const w = Math.abs(r1.x - r0.x);
          const h = Math.abs(r1.y - r0.y);
          if (w < 0.001 || h < 0.001) { this.finishShape(); return; }
          this.sendToolExecute('sketch_rectangle', {
            x: Math.min(r0.x, r1.x), y: Math.min(r0.y, r1.y), width: w, height: h, plane,
          });
          this.finishShape();
        }
        break;

      case 'circle':
        if (points.length >= 2) {
          const radius = points[0].distanceTo(points[1]);
          if (radius < 0.001) { this.finishShape(); return; }
          const cc = this.drawingService.to2D(points[0], plane);
          this.sendToolExecute('sketch_circle', { center_x: cc.x, center_y: cc.y, radius, plane });
          this.finishShape();
        }
        break;

      case 'arc':
        if (points.length >= 3) {
          const arc = this.drawingService.compute3PointArc(points[0], points[1], points[2], plane);
          if (!arc) { this.finishShape(); return; }
          this.sendToolExecute('sketch_arc', {
            center_x: arc.cx, center_y: arc.cy, radius: arc.radius,
            start_angle: arc.startDeg, end_angle: arc.endDeg, plane,
          });
          this.finishShape();
        }
        break;

      case 'measure':
        if (points.length >= 2) {
          const dist = points[0].distanceTo(points[1]);
          const p2d0 = this.drawingService.to2D(points[0], plane);
          const p2d1 = this.drawingService.to2D(points[1], plane);
          const mdx = Math.abs(p2d1.x - p2d0.x);
          const mdy = Math.abs(p2d1.y - p2d0.y);
          this.measureResult = `Distance: ${dist.toFixed(4)}" (dx: ${mdx.toFixed(4)}", dy: ${mdy.toFixed(4)}")`;
          this.drawingService.clearMeasure(this.sceneService.measureGroup);
          const geom = new THREE.BufferGeometry().setFromPoints([points[0], points[1]]);
          const mat = new THREE.LineDashedMaterial({ color: 0xff8800, dashSize: 0.15, gapSize: 0.08 });
          const line = new THREE.Line(geom, mat);
          line.computeLineDistances();
          this.sceneService.measureGroup.add(line);
          this.finishShape();
        }
        break;
    }
  }

  private sendToolExecute(tool: string, input: Record<string, unknown>) {
    this.wsService.send({ type: 'tool_execute', payload: { tool, input } });
  }

  private finishShape() {
    this.drawingService.drawingPoints = [];
    this.drawingService.clearPreview(this.sceneService.previewGroup);
    this.dimensionText = '';
  }

  // --- Preview rendering ---

  private updatePreview() {
    const previewGroup = this.sceneService.previewGroup;
    this.drawingService.clearPreview(previewGroup);
    this.dimensionText = '';

    const tool = this.drawingToolService.activeTool;
    if (!tool || !this.drawingService.mouseWorldPos) return;

    const points = this.drawingService.drawingPoints;
    const mouse = this.drawingService.mouseWorldPos;
    const plane = this.currentSketchPlane;
    const canvas = this.canvasRef.nativeElement;

    switch (tool) {
      case 'line':
        if (points.length === 1) {
          this.drawingService.addPreviewLine(previewGroup, points[0], mouse);
          const len = points[0].distanceTo(mouse);
          this.updateDimension(`${len.toFixed(3)}"`, points[0].clone().lerp(mouse, 0.5), canvas);
        }
        break;

      case 'rectangle':
        if (points.length === 1) {
          const corners = this.drawingService.makeRectCorners(points[0], mouse, plane);
          for (let i = 0; i < corners.length - 1; i++) {
            this.drawingService.addPreviewLine(previewGroup, corners[i], corners[i + 1]);
          }
          const r0 = this.drawingService.to2D(points[0], plane);
          const r1 = this.drawingService.to2D(mouse, plane);
          const w = Math.abs(r1.x - r0.x);
          const h = Math.abs(r1.y - r0.y);
          this.updateDimension(`${w.toFixed(3)}" × ${h.toFixed(3)}"`, points[0].clone().lerp(mouse, 0.5), canvas);
        }
        break;

      case 'circle':
        if (points.length === 1) {
          const radius = points[0].distanceTo(mouse);
          this.drawingService.addPreviewCircle(previewGroup, points[0], radius, plane);
          this.updateDimension(`R ${radius.toFixed(3)}"`, mouse, canvas);
        }
        break;

      case 'measure':
        if (points.length === 1) {
          this.drawingService.addPreviewLine(previewGroup, points[0], mouse);
          const mDist = points[0].distanceTo(mouse);
          this.updateDimension(`${mDist.toFixed(4)}"`, points[0].clone().lerp(mouse, 0.5), canvas);
        }
        break;

      case 'arc':
        if (points.length === 1) {
          this.drawingService.addPreviewLine(previewGroup, points[0], mouse);
          const len = points[0].distanceTo(mouse);
          this.updateDimension(`${len.toFixed(3)}"`, points[0].clone().lerp(mouse, 0.5), canvas);
        } else if (points.length === 2) {
          const arc = this.drawingService.compute3PointArc(points[0], points[1], mouse, plane);
          if (arc) {
            let center: THREE.Vector3;
            switch (plane) {
              case 'XY': center = new THREE.Vector3(arc.cx, arc.cy, 0); break;
              case 'XZ': center = new THREE.Vector3(arc.cx, 0, arc.cy); break;
              case 'YZ': center = new THREE.Vector3(0, arc.cx, arc.cy); break;
            }
            this.drawingService.addPreviewArc(previewGroup, center, arc.radius, arc.startRad, arc.endRad, plane);
            this.updateDimension(`R ${arc.radius.toFixed(3)}"`, mouse, canvas);
          } else {
            this.drawingService.addPreviewLine(previewGroup, points[0], points[1]);
          }
        }
        break;
    }
  }

  private updateDimension(text: string, anchorWorld: THREE.Vector3, canvas: HTMLCanvasElement) {
    this.dimensionText = text;
    if (text) {
      const s = this.sceneService.toScreen(anchorWorld, canvas);
      this.dimensionX = s.x;
      this.dimensionY = s.y;
    }
  }

  // --- Snap/grid controls ---

  toggleSnap(): void {
    this.snappingService.toggleSnap();
    if (this.drawingToolActive) {
      this.snappingService.snapEnabled
        ? this.snappingService.showDrawingGrid(this.sceneService.gridGroup, this.currentSketchPlane)
        : this.snappingService.hideDrawingGrid(this.sceneService.gridGroup);
    }
  }

  cycleGridSize(): void {
    this.snappingService.cycleGridSize();
    if (this.drawingToolActive && this.snappingService.snapEnabled) {
      this.snappingService.showDrawingGrid(this.sceneService.gridGroup, this.currentSketchPlane);
    }
  }

  // --- View controls ---

  setView(view: 'front' | 'top' | 'right' | 'iso'): void {
    this.sceneService.setView(view);
  }

  zoomToFit(): void {
    this.sceneService.zoomToFit();
  }

  cycleViewMode(): void {
    this.entityRenderService.cycleViewMode();
  }

  // --- Entity selection ---

  private handleCanvasClick(e: PointerEvent) {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );

    this.raycaster.setFromCamera(ndc, this.sceneService.camera);

    const meshes = this.sceneService.meshGroup.children.filter((c) => c instanceof THREE.Mesh) as THREE.Mesh[];
    const hits = this.raycaster.intersectObjects(meshes, false);

    if (hits.length > 0) {
      const entityId = hits[0].object.userData['entityId'] as string | undefined;
      if (entityId) {
        if (e.shiftKey) {
          this.toggleEntitySelection(entityId);
        } else {
          if (entityId === this.selectedEntityId) {
            this.selectEntity(null);
          } else {
            this.selectEntity(entityId);
          }
        }
        return;
      }
    }

    this.selectEntity(null);
  }

  private selectEntity(entityId: string | null) {
    for (const id of this.selectionService.selectedIds) {
      this.entityRenderService.applyHighlight(id, false);
    }

    this.selectedEntityId = entityId;
    this.selectionService.select(entityId);

    if (entityId) {
      this.entityRenderService.applyHighlight(entityId, true);
      this.updatePropertyPanel(entityId);
    } else {
      this.propPanelName = '';
    }

    this.wsService.send({ type: 'entity_selected', payload: { entityId } });
  }

  private toggleEntitySelection(entityId: string) {
    const wasSelected = this.selectionService.selectedIds.has(entityId);
    this.selectionService.toggle(entityId);
    this.entityRenderService.applyHighlight(entityId, !wasSelected);

    this.selectedEntityId = this.selectionService.selectedEntityId;

    if (this.selectionService.selectionCount === 1) {
      this.updatePropertyPanel(this.selectedEntityId!);
    } else if (this.selectionService.selectionCount > 1) {
      this.propPanelName = `${this.selectionService.selectionCount} selected`;
      this.propPanelType = 'multiple';
      this.propPanelKind = '';
      this.propPanelDims = '';
    } else {
      this.propPanelName = '';
    }
  }

  private updatePropertyPanel(entityId: string) {
    const data = this.entityRenderService.getPropertyPanelData(entityId);
    if (!data) return;
    this.propPanelName = data.name;
    this.propPanelType = data.type;
    this.propPanelKind = data.kind;
    this.propPanelDims = data.dims;
  }

  deselectEntity(): void { this.selectEntity(null); }

  startRename(): void {
    this.editingName = true;
    this.editNameValue = this.propPanelName;
    setTimeout(() => {
      const input = document.querySelector('.prop-name-input') as HTMLInputElement;
      if (input) { input.focus(); input.select(); }
    }, 50);
  }

  confirmRename(): void {
    if (!this.selectedEntityId || !this.editNameValue.trim()) {
      this.editingName = false;
      return;
    }
    this.sendToolExecute('rename_entity', { entity_id: this.selectedEntityId, name: this.editNameValue.trim() });
    this.propPanelName = this.editNameValue.trim();
    this.entityRenderService.entityInfoCache.set(this.selectedEntityId, {
      ...this.entityRenderService.entityInfoCache.get(this.selectedEntityId)!,
      name: this.editNameValue.trim(),
    });
    this.editingName = false;
  }

  cancelRename(): void { this.editingName = false; }

  // --- Entity list ---

  toggleEntityList(): void {
    this.showEntityList = !this.showEntityList;
    if (this.showEntityList) this.rebuildEntityList();
  }

  private rebuildEntityList(): void {
    this.entityList = this.entityRenderService.buildEntityList(this.selectionService.selectedIds);
  }

  toggleEntityVisibility(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.entityRenderService.toggleVisibility(id);
    this.rebuildEntityList();
  }

  selectFromList(id: string, event: MouseEvent): void {
    if (event.shiftKey) {
      this.toggleEntitySelection(id);
    } else {
      this.selectEntity(id);
    }
    this.rebuildEntityList();
  }

  deleteSelected(): void {
    if (!this.selectedEntityId) return;
    this.sendToolExecute('delete_entity', { entity_id: this.selectedEntityId });
  }

  extrudeSelected(): void {
    if (!this.selectedEntityId) return;
    this.showExtrudeInput = true;
    this.extrudeHeight = '1.0';
    setTimeout(() => {
      const input = document.querySelector('.extrude-input input') as HTMLInputElement;
      if (input) { input.focus(); input.select(); }
    }, 50);
  }

  confirmExtrude(): void {
    if (!this.selectedEntityId) return;
    const height = parseFloat(this.extrudeHeight);
    if (isNaN(height) || height === 0) return;
    this.showExtrudeInput = false;
    this.sendToolExecute('extrude', { entity_id: this.selectedEntityId, height });
  }

  cancelExtrude(): void { this.showExtrudeInput = false; }

  // --- Keyboard shortcuts ---

  private onKeyDown = (event: KeyboardEvent) => {
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (event.key === 'Escape' && this.drawingToolActive) {
      event.preventDefault();
      this.drawingService.drawingPoints = [];
      this.drawingService.clearPreview(this.sceneService.previewGroup);
      this.drawingToolService.clearTool();
      return;
    }

    if (event.key === 'Delete' && this.selectionService.selectionCount > 0) {
      event.preventDefault();
      for (const id of this.selectionService.selectedIds) {
        this.sendToolExecute('delete_entity', { entity_id: id });
      }
      return;
    }

    if (event.ctrlKey && event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.wsService.send({ type: 'undo', payload: {} });
    } else if ((event.ctrlKey && event.key === 'y') || (event.ctrlKey && event.shiftKey && event.key === 'Z')) {
      event.preventDefault();
      this.wsService.send({ type: 'redo', payload: {} });
    } else if (event.ctrlKey && event.key === 's') {
      event.preventDefault();
      const a = document.createElement('a');
      a.href = '/api/project/save';
      a.download = 'project.ccad';
      a.click();
    } else if (event.key === '1') {
      this.setView('front');
    } else if (event.key === '7') {
      this.setView('top');
    } else if (event.key === '3') {
      this.setView('right');
    } else if (event.key === '0') {
      this.setView('iso');
    } else if (event.key === 'Home') {
      event.preventDefault();
      this.zoomToFit();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      this.toggleEntityList();
    } else if (event.key === '?' || (event.shiftKey && event.key === '/')) {
      this.showHelp = !this.showHelp;
    } else if (event.ctrlKey && event.key === 'd') {
      event.preventDefault();
      if (this.selectionService.selectionCount > 0) {
        for (const id of this.selectionService.selectedIds) {
          this.sendToolExecute('duplicate_entity', { entity_id: id });
        }
      }
    } else if (!event.ctrlKey && event.key.toLowerCase() === 'l') {
      this.drawingToolService.setTool('line');
    } else if (!event.ctrlKey && event.key.toLowerCase() === 'r') {
      this.drawingToolService.setTool('rectangle');
    } else if (!event.ctrlKey && event.key.toLowerCase() === 'c') {
      this.drawingToolService.setTool('circle');
    } else if (!event.ctrlKey && event.key.toLowerCase() === 'a') {
      this.drawingToolService.setTool('arc');
    } else if (!event.ctrlKey && event.key.toLowerCase() === 'm') {
      this.drawingToolService.setTool('measure');
    } else if (!event.ctrlKey && event.key.toLowerCase() === 'v') {
      this.cycleViewMode();
    } else if (event.ctrlKey && event.key === 'o') {
      event.preventDefault();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.ccad,.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const project = JSON.parse(text);
          await fetch('/api/project/load', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(project),
          });
        } catch (err) {
          console.error('Failed to load project:', err);
        }
      };
      input.click();
    }
  };

  // --- Message handling ---

  private handleMessage(msg: WSMessage) {
    if (msg.type === 'mesh_update') {
      const meshGroup = this.sceneService.meshGroup;
      this.entityRenderService.clearAll(meshGroup);
      const meshes = (msg.payload as any).meshes;
      for (const meshData of meshes) {
        this.entityRenderService.addMesh(meshGroup, meshData);
      }

      if (this.drawingToolActive) {
        this.snappingService.rebuildSnapPoints(meshGroup);
      }

      this.entityRenderService.applyViewMode();
      this.entityRenderService.applyHiddenEntities();

      if (this.showEntityList) {
        this.rebuildEntityList();
      }

      // Reapply selection after rebuild
      const selectedIds = this.selectionService.selectedIds;
      if (selectedIds.size > 0) {
        let anyRemoved = false;
        for (const id of selectedIds) {
          if (this.entityRenderService.entityRegistry.has(id)) {
            this.entityRenderService.applyHighlight(id, true);
          } else {
            anyRemoved = true;
          }
        }
        if (anyRemoved) {
          const remaining = [...selectedIds].filter(id => this.entityRenderService.entityRegistry.has(id));
          this.selectionService.select(null);
          for (const id of remaining) {
            this.selectionService.toggle(id);
            this.entityRenderService.applyHighlight(id, true);
          }
        }
        this.selectedEntityId = this.selectionService.selectedEntityId;
        if (this.selectionService.selectionCount === 1 && this.selectedEntityId) {
          this.updatePropertyPanel(this.selectedEntityId);
        } else if (this.selectionService.selectionCount > 1) {
          this.propPanelName = `${this.selectionService.selectionCount} selected`;
          this.propPanelType = 'multiple';
          this.propPanelKind = '';
          this.propPanelDims = '';
        } else {
          this.propPanelName = '';
        }
      }
    }
  }
}

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
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebsocketService, WSMessage } from '../../services/websocket.service';
import { DrawingToolService, DrawingTool, SketchPlane } from '../../services/drawing-tool.service';
import { SelectionService } from '../../services/selection.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-viewport',
  imports: [FormsModule],
  templateUrl: './viewport.component.html',
  styleUrl: './viewport.component.scss',
})
export class ViewportComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private animationId = 0;
  private subscription!: Subscription;
  private toolSub!: Subscription;
  private meshGroup = new THREE.Group();

  // Entity selection state
  private entityRegistry = new Map<string, { mesh: THREE.Mesh | null; lines: THREE.LineSegments | null; kind: 'sketch' | 'solid' }>();
  private entityInfoCache = new Map<string, { name: string; type: string }>();
  selectedEntityId: string | null = null;
  private raycaster = new THREE.Raycaster();
  private pointerDownPos = { x: 0, y: 0 };

  // Property panel (template-bound)
  propPanelName = '';
  propPanelType = '';
  propPanelKind = '';
  propPanelDims = '';

  // Measure tool state
  measureResult = '';
  private measureGroup = new THREE.Group();

  // View mode
  viewMode: 'shaded' | 'wireframe' | 'both' = 'both';

  // Help overlay
  showHelp = false;

  // Entity list
  showEntityList = false;
  entityList: { id: string; name: string; kind: string; selected: boolean; visible: boolean }[] = [];
  private hiddenEntities = new Set<string>();

  // Extrude dialog
  showExtrudeInput = false;
  extrudeHeight = '1.0';

  // Rename
  editingName = false;
  editNameValue = '';

  // Dimension display
  dimensionText = '';
  dimensionX = 0;
  dimensionY = 0;

  // Drawing mode state
  drawingToolActive = false;
  coordX = '';
  coordY = '';
  snapEnabled = true;
  snapSize = 0.25;
  private drawingPoints: THREE.Vector3[] = [];
  private previewGroup = new THREE.Group();
  private gridGroup = new THREE.Group();
  private currentSketchPlane: SketchPlane = 'XY';
  private drawingPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private mouseWorldPos: THREE.Vector3 | null = null;
  private previewMaterial = new THREE.LineDashedMaterial({
    color: 0x00e5ff,
    dashSize: 0.1,
    gapSize: 0.05,
  });
  private snapIndicator: THREE.Mesh | null = null;
  private snapPointCache: THREE.Vector3[] = [];

  constructor(
    private ngZone: NgZone,
    private wsService: WebsocketService,
    private drawingToolService: DrawingToolService,
    private selectionService: SelectionService,
  ) {}

  ngOnInit() {
    this.subscription = this.wsService.messages$.subscribe((msg) => {
      this.handleMessage(msg);
    });

    this.toolSub = this.drawingToolService.activeTool$.subscribe((tool) => {
      this.ngZone.run(() => this.onToolChanged(tool));
    });

    this.drawingToolService.sketchPlane$.subscribe((plane) => {
      this.currentSketchPlane = plane;
      this.updateDrawingPlane();
      if (this.drawingToolActive && this.snapEnabled) {
        this.showDrawingGrid();
      }
    });
  }

  ngAfterViewInit() {
    this.initScene();
    this.ngZone.runOutsideAngular(() => {
      this.animate();
      const canvas = this.canvasRef.nativeElement;
      canvas.addEventListener('pointerdown', this.onPointerDown);
      canvas.addEventListener('pointerup', this.onPointerUp);
    });
    window.addEventListener('keydown', this.onKeyDown);
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    const canvas = this.canvasRef?.nativeElement;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onPointerDown);
      canvas.removeEventListener('pointerup', this.onPointerUp);
      canvas.removeEventListener('pointermove', this.onPointerMove);
    }
    this.subscription?.unsubscribe();
    this.toolSub?.unsubscribe();
    this.controls?.dispose();
    this.renderer?.dispose();
    this.previewMaterial.dispose();
    if (this.snapIndicator) {
      this.snapIndicator.geometry.dispose();
      (this.snapIndicator.material as THREE.Material).dispose();
    }
  }

  // --- Drawing tool activation ---

  private onToolChanged(tool: DrawingTool | null) {
    const canvas = this.canvasRef.nativeElement;

    if (tool) {
      this.drawingToolActive = true;
      this.drawingPoints = [];
      this.mouseWorldPos = null;
      this.clearPreview();
      this.clearMeasure();
      this.rebuildSnapPoints();

      // Reconfigure orbit: left-click disabled for orbit, right-click orbits
      this.controls.mouseButtons = {
        LEFT: -1 as any, // disable left-click orbit
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };

      canvas.addEventListener('pointermove', this.onPointerMove);
      canvas.style.cursor = 'crosshair';
      if (this.snapEnabled) this.showDrawingGrid();
    } else {
      this.drawingToolActive = false;
      this.drawingPoints = [];
      this.mouseWorldPos = null;
      this.coordX = '';
      this.coordY = '';
      this.dimensionText = '';
      this.clearPreview();
      this.hideDrawingGrid();
      this.hideSnapIndicator();

      // Restore default orbit controls
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };

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

    this.raycaster.setFromCamera(ndc, this.camera);
    const intersection = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.drawingPlane, intersection);

    if (hit) {
      let snapped = this.snapToGrid(intersection);

      // Geometry snap takes priority over grid snap
      const geoSnap = this.findSnapPoint(snapped);
      if (geoSnap) {
        snapped = geoSnap.clone();
        this.showSnapIndicator(geoSnap);
      } else {
        this.hideSnapIndicator();
      }

      this.mouseWorldPos = snapped;
      const coords2d = this.to2D(snapped);
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
    // Only process left-click
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

  private handleDrawingClick(e: PointerEvent) {
    if (!this.mouseWorldPos) return;

    this.drawingPoints.push(this.mouseWorldPos.clone());
    const tool = this.drawingToolService.activeTool;
    if (!tool) return;

    const points = this.drawingPoints;

    const plane = this.currentSketchPlane;

    switch (tool) {
      case 'line':
        if (points.length >= 2) {
          const p0 = this.to2D(points[0]);
          const p1 = this.to2D(points[1]);
          this.sendToolExecute('sketch_line', {
            x1: p0.x, y1: p0.y,
            x2: p1.x, y2: p1.y,
            plane,
          });
          this.finishShape();
        }
        break;

      case 'rectangle':
        if (points.length >= 2) {
          const r0 = this.to2D(points[0]);
          const r1 = this.to2D(points[1]);
          const w = Math.abs(r1.x - r0.x);
          const h = Math.abs(r1.y - r0.y);
          if (w < 0.001 || h < 0.001) {
            this.finishShape();
            return;
          }
          this.sendToolExecute('sketch_rectangle', {
            x: Math.min(r0.x, r1.x),
            y: Math.min(r0.y, r1.y),
            width: w,
            height: h,
            plane,
          });
          this.finishShape();
        }
        break;

      case 'circle':
        if (points.length >= 2) {
          const radius = points[0].distanceTo(points[1]);
          if (radius < 0.001) {
            this.finishShape();
            return;
          }
          const cc = this.to2D(points[0]);
          this.sendToolExecute('sketch_circle', {
            center_x: cc.x,
            center_y: cc.y,
            radius,
            plane,
          });
          this.finishShape();
        }
        break;

      case 'arc':
        // 3-point arc: start → end → midpoint on arc
        if (points.length >= 3) {
          const arc = this.compute3PointArc(points[0], points[1], points[2]);
          if (!arc) {
            this.finishShape();
            return;
          }
          this.sendToolExecute('sketch_arc', {
            center_x: arc.cx,
            center_y: arc.cy,
            radius: arc.radius,
            start_angle: arc.startDeg,
            end_angle: arc.endDeg,
            plane,
          });
          this.finishShape();
        }
        break;

      case 'measure':
        if (points.length >= 2) {
          const dist = points[0].distanceTo(points[1]);
          const p2d0 = this.to2D(points[0]);
          const p2d1 = this.to2D(points[1]);
          const dx = Math.abs(p2d1.x - p2d0.x);
          const dy = Math.abs(p2d1.y - p2d0.y);
          this.measureResult = `Distance: ${dist.toFixed(4)}" (dx: ${dx.toFixed(4)}", dy: ${dy.toFixed(4)}")`;
          // Show persistent measurement line
          this.clearMeasure();
          const geom = new THREE.BufferGeometry().setFromPoints([points[0], points[1]]);
          const mat = new THREE.LineDashedMaterial({ color: 0xff8800, dashSize: 0.15, gapSize: 0.08 });
          const line = new THREE.Line(geom, mat);
          line.computeLineDistances();
          this.measureGroup.add(line);
          this.finishShape();
        }
        break;
    }
  }

  private sendToolExecute(tool: string, input: Record<string, unknown>) {
    this.wsService.send({
      type: 'tool_execute',
      payload: { tool, input },
    });
  }

  private finishShape() {
    this.drawingPoints = [];
    this.clearPreview();
    this.dimensionText = '';
  }

  // --- Preview rendering ---

  private updatePreview() {
    this.clearPreview();
    this.dimensionText = '';

    const tool = this.drawingToolService.activeTool;
    if (!tool || !this.mouseWorldPos) return;

    const points = this.drawingPoints;
    const mouse = this.mouseWorldPos;

    switch (tool) {
      case 'line':
        if (points.length === 1) {
          this.addPreviewLine(points[0], mouse);
          const len = points[0].distanceTo(mouse);
          const mid = points[0].clone().lerp(mouse, 0.5);
          this.updateDimension(`${len.toFixed(3)}"`, mid);
        }
        break;

      case 'rectangle':
        if (points.length === 1) {
          const p = points[0];
          const corners = this.makeRectCorners(p, mouse);
          for (let i = 0; i < corners.length - 1; i++) {
            this.addPreviewLine(corners[i], corners[i + 1]);
          }
          const r0 = this.to2D(p);
          const r1 = this.to2D(mouse);
          const w = Math.abs(r1.x - r0.x);
          const h = Math.abs(r1.y - r0.y);
          const mid = p.clone().lerp(mouse, 0.5);
          this.updateDimension(`${w.toFixed(3)}" × ${h.toFixed(3)}"`, mid);
        }
        break;

      case 'circle':
        if (points.length === 1) {
          const radius = points[0].distanceTo(mouse);
          this.addPreviewCircle(points[0], radius);
          this.updateDimension(`R ${radius.toFixed(3)}"`, mouse);
        }
        break;

      case 'measure':
        if (points.length === 1) {
          this.addPreviewLine(points[0], mouse);
          const mDist = points[0].distanceTo(mouse);
          const mMid = points[0].clone().lerp(mouse, 0.5);
          this.updateDimension(`${mDist.toFixed(4)}"`, mMid);
        }
        break;

      case 'arc':
        if (points.length === 1) {
          this.addPreviewLine(points[0], mouse);
          const len = points[0].distanceTo(mouse);
          const mid = points[0].clone().lerp(mouse, 0.5);
          this.updateDimension(`${len.toFixed(3)}"`, mid);
        } else if (points.length === 2) {
          const arc = this.compute3PointArc(points[0], points[1], mouse);
          if (arc) {
            let center: THREE.Vector3;
            switch (this.currentSketchPlane) {
              case 'XY': center = new THREE.Vector3(arc.cx, arc.cy, 0); break;
              case 'XZ': center = new THREE.Vector3(arc.cx, 0, arc.cy); break;
              case 'YZ': center = new THREE.Vector3(0, arc.cx, arc.cy); break;
            }
            this.addPreviewArc(center, arc.radius, arc.startRad, arc.endRad);
            this.updateDimension(`R ${arc.radius.toFixed(3)}"`, mouse);
          } else {
            this.addPreviewLine(points[0], points[1]);
          }
        }
        break;
    }
  }

  private addPreviewLine(a: THREE.Vector3, b: THREE.Vector3) {
    const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geom, this.previewMaterial);
    line.computeLineDistances();
    this.previewGroup.add(line);
  }

  private makeRectCorners(p1: THREE.Vector3, p2: THREE.Vector3): THREE.Vector3[] {
    switch (this.currentSketchPlane) {
      case 'XY': return [
        new THREE.Vector3(p1.x, p1.y, 0), new THREE.Vector3(p2.x, p1.y, 0),
        new THREE.Vector3(p2.x, p2.y, 0), new THREE.Vector3(p1.x, p2.y, 0),
        new THREE.Vector3(p1.x, p1.y, 0),
      ];
      case 'XZ': return [
        new THREE.Vector3(p1.x, 0, p1.z), new THREE.Vector3(p2.x, 0, p1.z),
        new THREE.Vector3(p2.x, 0, p2.z), new THREE.Vector3(p1.x, 0, p2.z),
        new THREE.Vector3(p1.x, 0, p1.z),
      ];
      case 'YZ': return [
        new THREE.Vector3(0, p1.y, p1.z), new THREE.Vector3(0, p2.y, p1.z),
        new THREE.Vector3(0, p2.y, p2.z), new THREE.Vector3(0, p1.y, p2.z),
        new THREE.Vector3(0, p1.y, p1.z),
      ];
    }
  }

  private addPreviewCircle(center: THREE.Vector3, radius: number) {
    const segments = 64;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const dx = radius * Math.cos(angle);
      const dy = radius * Math.sin(angle);
      switch (this.currentSketchPlane) {
        case 'XY': pts.push(new THREE.Vector3(center.x + dx, center.y + dy, 0)); break;
        case 'XZ': pts.push(new THREE.Vector3(center.x + dx, 0, center.z + dy)); break;
        case 'YZ': pts.push(new THREE.Vector3(0, center.y + dx, center.z + dy)); break;
      }
    }
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geom, this.previewMaterial);
    line.computeLineDistances();
    this.previewGroup.add(line);
  }

  private addPreviewArc(center: THREE.Vector3, radius: number, startAngle: number, endAngle: number) {
    let sweep = endAngle - startAngle;
    // Normalize to positive sweep (CCW)
    if (sweep <= 0) sweep += Math.PI * 2;

    const segments = Math.max(16, Math.round(sweep / (Math.PI * 2) * 64));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + (i / segments) * sweep;
      const dx = radius * Math.cos(angle);
      const dy = radius * Math.sin(angle);
      switch (this.currentSketchPlane) {
        case 'XY': pts.push(new THREE.Vector3(center.x + dx, center.y + dy, 0)); break;
        case 'XZ': pts.push(new THREE.Vector3(center.x + dx, 0, center.z + dy)); break;
        case 'YZ': pts.push(new THREE.Vector3(0, center.y + dx, center.z + dy)); break;
      }
    }
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geom, this.previewMaterial);
    line.computeLineDistances();
    this.previewGroup.add(line);
  }

  /**
   * Compute a circular arc through 3 points: start, end, and a midpoint on the arc.
   * Returns center, radius, and start/end angles, or null if collinear.
   */
  private compute3PointArc(
    p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3
  ): { cx: number; cy: number; radius: number; startRad: number; endRad: number; startDeg: number; endDeg: number } | null {
    // Convert 3D points to 2D sketch coordinates
    const s1 = this.to2D(p1), s2 = this.to2D(p2), s3 = this.to2D(p3);
    const ax = s1.x, ay = s1.y;
    const bx = s2.x, by = s2.y;
    const cx = s3.x, cy = s3.y;

    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-10) return null; // collinear

    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
    const radius = Math.sqrt((ax - ux) * (ax - ux) + (ay - uy) * (ay - uy));

    if (radius < 0.001) return null;

    // Angles from center to each point
    const a1 = Math.atan2(ay - uy, ax - ux);
    const a2 = Math.atan2(by - uy, bx - ux);
    const a3 = Math.atan2(cy - uy, cx - ux);

    // We need start=p1, end=p2, passing through p3.
    // Determine arc direction: does going CCW from p1 to p2 pass through p3?
    const normalizeAngle = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const na1 = normalizeAngle(a1);
    const na2 = normalizeAngle(a2);
    const na3 = normalizeAngle(a3);

    // CCW sweep from p1 to p2
    let ccwSweep = normalizeAngle(na2 - na1);
    if (ccwSweep === 0) ccwSweep = Math.PI * 2;
    // Check if p3 is within this CCW sweep
    const toP3 = normalizeAngle(na3 - na1);
    const p3InCCW = toP3 < ccwSweep;

    let startRad: number, endRad: number;
    if (p3InCCW) {
      // CCW from p1 to p2 passes through p3
      startRad = a1;
      endRad = a2;
    } else {
      // CW from p1 to p2 passes through p3 — swap to get correct arc
      startRad = a2;
      endRad = a1;
    }

    return {
      cx: ux, cy: uy, radius,
      startRad, endRad,
      startDeg: startRad * (180 / Math.PI),
      endDeg: endRad * (180 / Math.PI),
    };
  }

  // --- Geometry snapping ---

  /** Build snap points (endpoints/midpoints) from all edge geometry in the scene. */
  private rebuildSnapPoints() {
    this.snapPointCache = [];
    this.meshGroup.traverse((child) => {
      if (child instanceof THREE.LineSegments) {
        const positions = child.geometry.getAttribute('position');
        if (!positions) return;
        const count = positions.count;
        // Edge segments come in pairs (p0, p1, p2, p3, ...) where each pair is a line segment
        for (let i = 0; i < count - 1; i += 2) {
          const a = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));
          const b = new THREE.Vector3(positions.getX(i + 1), positions.getY(i + 1), positions.getZ(i + 1));
          this.snapPointCache.push(a, b);
          // Midpoint
          this.snapPointCache.push(a.clone().lerp(b, 0.5));
        }
      }
    });
  }

  /** Find nearest snap point within threshold (in screen pixels). Returns snapped world pos or null. */
  private findSnapPoint(worldPos: THREE.Vector3, screenThreshold: number = 12): THREE.Vector3 | null {
    if (this.snapPointCache.length === 0) return null;

    const canvas = this.canvasRef.nativeElement;
    const screenPos = worldPos.clone().project(this.camera);
    const sx = (screenPos.x + 1) / 2 * canvas.clientWidth;
    const sy = (-screenPos.y + 1) / 2 * canvas.clientHeight;

    let bestDist = Infinity;
    let bestPoint: THREE.Vector3 | null = null;

    for (const pt of this.snapPointCache) {
      const sp = pt.clone().project(this.camera);
      const px = (sp.x + 1) / 2 * canvas.clientWidth;
      const py = (-sp.y + 1) / 2 * canvas.clientHeight;
      const dist = Math.sqrt((px - sx) ** 2 + (py - sy) ** 2);
      if (dist < screenThreshold && dist < bestDist) {
        bestDist = dist;
        bestPoint = pt;
      }
    }

    return bestPoint;
  }

  private showSnapIndicator(pos: THREE.Vector3) {
    if (!this.snapIndicator) {
      const geom = new THREE.RingGeometry(0.06, 0.1, 16);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff8800, side: THREE.DoubleSide, depthTest: false });
      this.snapIndicator = new THREE.Mesh(geom, mat);
      this.snapIndicator.renderOrder = 999;
      this.scene.add(this.snapIndicator);
    }
    this.snapIndicator.position.copy(pos);
    // Orient ring to face camera
    this.snapIndicator.lookAt(this.camera.position);
    this.snapIndicator.visible = true;
  }

  private hideSnapIndicator() {
    if (this.snapIndicator) {
      this.snapIndicator.visible = false;
    }
  }

  /** Project a 3D point to screen pixel coordinates. */
  private toScreen(pos: THREE.Vector3): { x: number; y: number } {
    const v = pos.clone().project(this.camera);
    const canvas = this.canvasRef.nativeElement;
    return {
      x: (v.x + 1) / 2 * canvas.clientWidth,
      y: (-v.y + 1) / 2 * canvas.clientHeight,
    };
  }

  private updateDimension(text: string, anchorWorld: THREE.Vector3) {
    this.dimensionText = text;
    if (text) {
      const s = this.toScreen(anchorWorld);
      this.dimensionX = s.x;
      this.dimensionY = s.y;
    }
  }

  private clearPreview() {
    while (this.previewGroup.children.length > 0) {
      const child = this.previewGroup.children[0];
      this.previewGroup.remove(child);
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
      }
    }
  }

  private clearMeasure() {
    while (this.measureGroup.children.length > 0) {
      const child = this.measureGroup.children[0];
      this.measureGroup.remove(child);
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    this.measureResult = '';
  }

  // --- Grid snap ---

  private snapToGrid(pos: THREE.Vector3): THREE.Vector3 {
    if (!this.snapEnabled) return pos;
    const s = this.snapSize;
    switch (this.currentSketchPlane) {
      case 'XY':
        return new THREE.Vector3(Math.round(pos.x / s) * s, Math.round(pos.y / s) * s, pos.z);
      case 'XZ':
        return new THREE.Vector3(Math.round(pos.x / s) * s, pos.y, Math.round(pos.z / s) * s);
      case 'YZ':
        return new THREE.Vector3(pos.x, Math.round(pos.y / s) * s, Math.round(pos.z / s) * s);
    }
  }

  toggleSnap(): void {
    this.snapEnabled = !this.snapEnabled;
    if (this.drawingToolActive) {
      this.snapEnabled ? this.showDrawingGrid() : this.hideDrawingGrid();
    }
  }

  private readonly gridSizes = [0.0625, 0.125, 0.25, 0.5, 1.0];

  cycleGridSize(): void {
    const idx = this.gridSizes.indexOf(this.snapSize);
    this.snapSize = this.gridSizes[(idx + 1) % this.gridSizes.length];
    if (this.drawingToolActive && this.snapEnabled) {
      this.showDrawingGrid();
    }
  }

  setView(view: 'front' | 'top' | 'right' | 'iso'): void {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const target = this.controls.target.clone();
    let newPos: THREE.Vector3;

    switch (view) {
      case 'front': newPos = new THREE.Vector3(target.x, target.y, target.z + dist); break;
      case 'top':   newPos = new THREE.Vector3(target.x, target.y + dist, target.z); break;
      case 'right': newPos = new THREE.Vector3(target.x + dist, target.y, target.z); break;
      case 'iso':   newPos = new THREE.Vector3(target.x + dist * 0.577, target.y + dist * 0.577, target.z + dist * 0.577); break;
    }

    this.animateCamera(newPos, target);
  }

  zoomToFit(): void {
    const box = new THREE.Box3();
    let hasContent = false;

    this.meshGroup.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.computeBoundingBox();
        if (child.geometry.boundingBox) {
          box.expandByObject(child);
          hasContent = true;
        }
      }
    });

    if (!hasContent) return;

    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.camera.fov * (Math.PI / 180);
    const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.5;

    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const newPos = center.clone().add(direction.multiplyScalar(dist));

    this.animateCamera(newPos, center);
  }

  private updateDrawingPlane(): void {
    switch (this.currentSketchPlane) {
      case 'XY': this.drawingPlane.set(new THREE.Vector3(0, 0, 1), 0); break;
      case 'XZ': this.drawingPlane.set(new THREE.Vector3(0, 1, 0), 0); break;
      case 'YZ': this.drawingPlane.set(new THREE.Vector3(1, 0, 0), 0); break;
    }
  }

  /** Convert 3D world point to 2D sketch coordinates based on current plane. */
  private to2D(p: THREE.Vector3): { x: number; y: number } {
    switch (this.currentSketchPlane) {
      case 'XY': return { x: p.x, y: p.y };
      case 'XZ': return { x: p.x, y: p.z };
      case 'YZ': return { x: p.y, y: p.z };
    }
  }

  private animateCamera(targetPos: THREE.Vector3, targetLookAt: THREE.Vector3): void {
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const duration = 300;
    const startTime = performance.now();

    const step = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad

      this.camera.position.lerpVectors(startPos, targetPos, ease);
      this.controls.target.lerpVectors(startTarget, targetLookAt, ease);
      this.controls.update();

      if (t < 1) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }

  private showDrawingGrid() {
    this.hideDrawingGrid();
    const extent = 20; // inches each direction
    const step = this.snapSize;
    const points: THREE.Vector3[] = [];
    const offset = 0.001; // slight offset to avoid z-fighting

    switch (this.currentSketchPlane) {
      case 'XY':
        for (let x = -extent; x <= extent; x += step) {
          points.push(new THREE.Vector3(x, -extent, offset));
          points.push(new THREE.Vector3(x, extent, offset));
        }
        for (let y = -extent; y <= extent; y += step) {
          points.push(new THREE.Vector3(-extent, y, offset));
          points.push(new THREE.Vector3(extent, y, offset));
        }
        break;
      case 'XZ':
        for (let x = -extent; x <= extent; x += step) {
          points.push(new THREE.Vector3(x, offset, -extent));
          points.push(new THREE.Vector3(x, offset, extent));
        }
        for (let z = -extent; z <= extent; z += step) {
          points.push(new THREE.Vector3(-extent, offset, z));
          points.push(new THREE.Vector3(extent, offset, z));
        }
        break;
      case 'YZ':
        for (let y = -extent; y <= extent; y += step) {
          points.push(new THREE.Vector3(offset, y, -extent));
          points.push(new THREE.Vector3(offset, y, extent));
        }
        for (let z = -extent; z <= extent; z += step) {
          points.push(new THREE.Vector3(offset, -extent, z));
          points.push(new THREE.Vector3(offset, extent, z));
        }
        break;
    }

    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0x334466, transparent: true, opacity: 0.3 });
    const lines = new THREE.LineSegments(geom, mat);
    this.gridGroup.add(lines);
  }

  private hideDrawingGrid() {
    while (this.gridGroup.children.length > 0) {
      const child = this.gridGroup.children[0];
      this.gridGroup.remove(child);
      if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
  }

  // --- Scene init ---

  private initScene() {
    const canvas = this.canvasRef.nativeElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x1a1a2e);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.add(this.meshGroup);
    this.scene.add(this.previewGroup);
    this.scene.add(this.gridGroup);
    this.scene.add(this.measureGroup);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.set(6, 5, 8);
    this.camera.lookAt(0, 0, 0);

    // Controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dir1.position.set(5, 10, 7);
    this.scene.add(dir1);

    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(-5, -2, -5);
    this.scene.add(dir2);

    // Grid
    const grid = new THREE.GridHelper(20, 20, 0x444466, 0x333355);
    this.scene.add(grid);

    // Handle resize
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    const canvas = this.canvasRef.nativeElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    // Ignore if user is typing in an input/textarea
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    // Escape cancels drawing
    if (event.key === 'Escape' && this.drawingToolActive) {
      event.preventDefault();
      this.drawingPoints = [];
      this.clearPreview();
      this.drawingToolService.clearTool();
      return;
    }

    // Delete key deletes selected entities
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
    } else if (
      (event.ctrlKey && event.key === 'y') ||
      (event.ctrlKey && event.shiftKey && event.key === 'Z')
    ) {
      event.preventDefault();
      this.wsService.send({ type: 'redo', payload: {} });
    } else if (event.ctrlKey && event.key === 's') {
      event.preventDefault();
      const a = document.createElement('a');
      a.href = '/api/project/save';
      a.download = 'project.ccad';
      a.click();
    // View shortcuts (numpad-style)
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

  // --- Entity selection (when no drawing tool active) ---

  private handleCanvasClick(e: PointerEvent) {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );

    this.raycaster.setFromCamera(ndc, this.camera);

    // Only intersect Mesh objects (skip LineSegments)
    const meshes = this.meshGroup.children.filter((c) => c instanceof THREE.Mesh) as THREE.Mesh[];
    const hits = this.raycaster.intersectObjects(meshes, false);

    if (hits.length > 0) {
      const entityId = hits[0].object.userData['entityId'] as string | undefined;
      if (entityId) {
        if (e.shiftKey) {
          // Shift+Click: toggle in multi-selection
          this.toggleEntitySelection(entityId);
        } else {
          // Regular click: toggle single selection
          if (entityId === this.selectedEntityId) {
            this.selectEntity(null);
          } else {
            this.selectEntity(entityId);
          }
        }
        return;
      }
    }

    // Clicked empty space — deselect all
    this.selectEntity(null);
  }

  private selectEntity(entityId: string | null) {
    // Clear all old highlights
    for (const id of this.selectionService.selectedIds) {
      this.applyHighlight(id, false);
    }

    this.selectedEntityId = entityId;
    this.selectionService.select(entityId);

    // Apply new highlight
    if (entityId) {
      this.applyHighlight(entityId, true);
      this.updatePropertyPanel(entityId);
    } else {
      this.propPanelName = '';
    }

    // Notify backend
    this.wsService.send({
      type: 'entity_selected',
      payload: { entityId },
    });
  }

  private toggleEntitySelection(entityId: string) {
    const wasSelected = this.selectionService.selectedIds.has(entityId);
    this.selectionService.toggle(entityId);
    this.applyHighlight(entityId, !wasSelected);

    // Update primary selection pointer
    this.selectedEntityId = this.selectionService.selectedEntityId;

    // Update property panel for the primary selection
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

  private applyHighlight(entityId: string, selected: boolean) {
    const entry = this.entityRegistry.get(entityId);
    if (!entry) return;

    if (entry.kind === 'sketch') {
      // Sketch: cyan ↔ yellow
      const color = selected ? 0xffdd00 : 0x00e5ff;
      if (entry.mesh) {
        (entry.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
      }
      if (entry.lines) {
        (entry.lines.material as THREE.LineBasicMaterial).color.setHex(color);
      }
    } else {
      // Solid: steel-blue ↔ orange
      if (entry.mesh) {
        const mat = entry.mesh.material as THREE.MeshStandardMaterial;
        mat.color.setHex(selected ? 0xe87a30 : 0x7090b0);
        mat.emissive.setHex(selected ? 0x331800 : 0x000000);
      }
      if (entry.lines) {
        (entry.lines.material as THREE.LineBasicMaterial).color.setHex(selected ? 0xe87a30 : 0x000000);
      }
    }
  }

  private updatePropertyPanel(entityId: string) {
    const entry = this.entityRegistry.get(entityId);
    const info = this.entityInfoCache.get(entityId);
    if (!entry || !info) return;

    const target = entry.mesh || entry.lines;
    if (!target) return;

    const bbox = new THREE.Box3().setFromObject(target);
    const size = bbox.getSize(new THREE.Vector3());

    this.propPanelName = info.name;
    this.propPanelType = info.type;
    this.propPanelKind = entry.kind;
    this.propPanelDims = `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} in`;
  }

  deselectEntity(): void {
    this.selectEntity(null);
  }

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
    this.entityInfoCache.set(this.selectedEntityId, {
      ...this.entityInfoCache.get(this.selectedEntityId)!,
      name: this.editNameValue.trim(),
    });
    this.editingName = false;
  }

  cancelRename(): void {
    this.editingName = false;
  }

  cycleViewMode(): void {
    const modes: Array<'shaded' | 'wireframe' | 'both'> = ['both', 'shaded', 'wireframe'];
    const idx = modes.indexOf(this.viewMode);
    this.viewMode = modes[(idx + 1) % modes.length];
    this.applyViewMode();
  }

  private applyViewMode(): void {
    for (const [id, entry] of this.entityRegistry) {
      if (this.hiddenEntities.has(id)) continue;
      if (entry.kind === 'sketch') continue; // Sketches always show as lines

      if (entry.mesh) {
        entry.mesh.visible = this.viewMode !== 'wireframe';
        if (this.viewMode === 'wireframe') {
          // Keep mesh invisible
        }
      }
      if (entry.lines) {
        entry.lines.visible = this.viewMode !== 'shaded';
      }
    }
  }

  toggleEntityList(): void {
    this.showEntityList = !this.showEntityList;
    if (this.showEntityList) this.rebuildEntityList();
  }

  private rebuildEntityList(): void {
    const selectedIds = this.selectionService.selectedIds;
    this.entityList = [];
    for (const [id, entry] of this.entityRegistry) {
      const info = this.entityInfoCache.get(id);
      this.entityList.push({
        id,
        name: info?.name || id,
        kind: entry.kind,
        selected: selectedIds.has(id),
        visible: !this.hiddenEntities.has(id),
      });
    }
  }

  toggleEntityVisibility(id: string, event: MouseEvent): void {
    event.stopPropagation();
    const entry = this.entityRegistry.get(id);
    if (!entry) return;

    if (this.hiddenEntities.has(id)) {
      this.hiddenEntities.delete(id);
      if (entry.mesh) entry.mesh.visible = true;
      if (entry.lines) entry.lines.visible = true;
    } else {
      this.hiddenEntities.add(id);
      if (entry.mesh) entry.mesh.visible = false;
      if (entry.lines) entry.lines.visible = false;
    }
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
    // Focus the input after Angular renders it
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

  cancelExtrude(): void {
    this.showExtrudeInput = false;
  }

  // --- Animation & message handling ---

  private animate = () => {
    this.animationId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

  };

  private handleMessage(msg: WSMessage) {
    if (msg.type === 'mesh_update') {
      this.clearMeshes();
      const meshes = (msg.payload as any).meshes;
      for (const meshData of meshes) {
        this.addMesh(meshData);
      }

      // Rebuild snap cache if drawing
      if (this.drawingToolActive) {
        this.rebuildSnapPoints();
      }

      // Apply view mode and visibility
      this.applyViewMode();
      for (const hiddenId of this.hiddenEntities) {
        const entry = this.entityRegistry.get(hiddenId);
        if (entry) {
          if (entry.mesh) entry.mesh.visible = false;
          if (entry.lines) entry.lines.visible = false;
        }
      }

      // Rebuild entity list if visible
      if (this.showEntityList) {
        this.rebuildEntityList();
      }

      // Reapply selection after rebuild
      const selectedIds = this.selectionService.selectedIds;
      if (selectedIds.size > 0) {
        let anyRemoved = false;
        for (const id of selectedIds) {
          if (this.entityRegistry.has(id)) {
            this.applyHighlight(id, true);
          } else {
            anyRemoved = true;
          }
        }
        if (anyRemoved) {
          // Re-select only entities that still exist
          const remaining = [...selectedIds].filter(id => this.entityRegistry.has(id));
          this.selectionService.select(null);
          for (const id of remaining) {
            this.selectionService.toggle(id);
            this.applyHighlight(id, true);
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

  private clearMeshes() {
    this.entityRegistry.clear();
    this.entityInfoCache.clear();
    while (this.meshGroup.children.length > 0) {
      const child = this.meshGroup.children[0];
      this.meshGroup.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  }

  private addMesh(data: {
    vertices: number[];
    indices: number[];
    normals: number[];
    edges: number[];
    entityId?: string;
    entityKind?: 'sketch' | 'solid';
    name?: string;
    entityType?: string;
  }) {
    const isSketch = data.entityKind === 'sketch';
    const entityId = data.entityId;
    let createdMesh: THREE.Mesh | null = null;
    let createdLines: THREE.LineSegments | null = null;

    if (isSketch) {
      // Sketch rendering: cyan lines + optional translucent fill
      if (data.edges.length > 0) {
        const edgeGeometry = new THREE.BufferGeometry();
        edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(data.edges, 3));
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x00e5ff, linewidth: 2 });
        const lines = new THREE.LineSegments(edgeGeometry, lineMaterial);
        if (entityId) lines.userData['entityId'] = entityId;
        this.meshGroup.add(lines);
        createdLines = lines;
      }

      // Optional translucent fill for closed sketches (faces with triangles)
      if (data.vertices.length > 0 && data.indices.length > 0) {
        const fillGeometry = new THREE.BufferGeometry();
        fillGeometry.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices, 3));
        fillGeometry.setIndex(data.indices);
        fillGeometry.computeVertexNormals();
        const fillMaterial = new THREE.MeshBasicMaterial({
          color: 0x00e5ff,
          transparent: true,
          opacity: 0.1,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
        if (entityId) fillMesh.userData['entityId'] = entityId;
        this.meshGroup.add(fillMesh);
        createdMesh = fillMesh;
      }
    } else {
      // Solid rendering
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices, 3));
      geometry.setIndex(data.indices);

      if (data.normals.length > 0) {
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
      } else {
        geometry.computeVertexNormals();
      }

      const material = new THREE.MeshStandardMaterial({
        color: 0x7090b0,
        metalness: 0.3,
        roughness: 0.6,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      if (entityId) mesh.userData['entityId'] = entityId;
      this.meshGroup.add(mesh);
      createdMesh = mesh;

      // Edge lines
      let edgeGeometry: THREE.BufferGeometry;
      if (data.edges.length > 0) {
        edgeGeometry = new THREE.BufferGeometry();
        edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(data.edges, 3));
      } else {
        edgeGeometry = new THREE.EdgesGeometry(geometry, 15);
      }

      const lineMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
      const lines = new THREE.LineSegments(edgeGeometry, lineMaterial);
      if (entityId) lines.userData['entityId'] = entityId;
      this.meshGroup.add(lines);
      createdLines = lines;
    }

    // Register entity for selection
    if (entityId) {
      this.entityRegistry.set(entityId, {
        mesh: createdMesh,
        lines: createdLines,
        kind: isSketch ? 'sketch' : 'solid',
      });
      if (data.name || data.entityType) {
        this.entityInfoCache.set(entityId, {
          name: data.name || entityId,
          type: data.entityType || 'unknown',
        });
      }
    }
  }
}

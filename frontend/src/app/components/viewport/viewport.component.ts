import {
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  AfterViewInit,
} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebsocketService, WSMessage } from '../../services/websocket.service';
import { DrawingToolService, DrawingTool } from '../../services/drawing-tool.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-viewport',
  imports: [],
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
  private selectedEntityId: string | null = null;
  private raycaster = new THREE.Raycaster();
  private pointerDownPos = { x: 0, y: 0 };

  // Tooltip (template-bound)
  tooltipVisible = false;
  tooltipX = 0;
  tooltipY = 0;
  tooltipEntityName = '';
  tooltipEntityType = '';
  tooltipDimensions = '';

  // Drawing mode state
  drawingToolActive = false;
  coordX = '';
  coordY = '';
  private drawingPoints: THREE.Vector3[] = [];
  private previewGroup = new THREE.Group();
  private drawingPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private mouseWorldPos: THREE.Vector3 | null = null;
  private previewMaterial = new THREE.LineDashedMaterial({
    color: 0x00e5ff,
    dashSize: 0.1,
    gapSize: 0.05,
  });

  constructor(
    private ngZone: NgZone,
    private wsService: WebsocketService,
    private drawingToolService: DrawingToolService,
  ) {}

  ngOnInit() {
    this.subscription = this.wsService.messages$.subscribe((msg) => {
      this.handleMessage(msg);
    });

    this.toolSub = this.drawingToolService.activeTool$.subscribe((tool) => {
      this.ngZone.run(() => this.onToolChanged(tool));
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
  }

  // --- Drawing tool activation ---

  private onToolChanged(tool: DrawingTool | null) {
    const canvas = this.canvasRef.nativeElement;

    if (tool) {
      this.drawingToolActive = true;
      this.drawingPoints = [];
      this.mouseWorldPos = null;
      this.clearPreview();

      // Reconfigure orbit: left-click disabled for orbit, right-click orbits
      this.controls.mouseButtons = {
        LEFT: -1 as any, // disable left-click orbit
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };

      canvas.addEventListener('pointermove', this.onPointerMove);
      canvas.style.cursor = 'crosshair';
    } else {
      this.drawingToolActive = false;
      this.drawingPoints = [];
      this.mouseWorldPos = null;
      this.coordX = '';
      this.coordY = '';
      this.clearPreview();

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
      this.mouseWorldPos = intersection;
      this.ngZone.run(() => {
        this.coordX = intersection.x.toFixed(3);
        this.coordY = intersection.y.toFixed(3);
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

    switch (tool) {
      case 'line':
        if (points.length >= 2) {
          this.sendToolExecute('sketch_line', {
            x1: points[0].x, y1: points[0].y,
            x2: points[1].x, y2: points[1].y,
          });
          this.finishShape();
        }
        break;

      case 'rectangle':
        if (points.length >= 2) {
          const w = Math.abs(points[1].x - points[0].x);
          const h = Math.abs(points[1].y - points[0].y);
          if (w < 0.001 || h < 0.001) {
            this.finishShape();
            return;
          }
          this.sendToolExecute('sketch_rectangle', {
            x: Math.min(points[0].x, points[1].x),
            y: Math.min(points[0].y, points[1].y),
            width: w,
            height: h,
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
          this.sendToolExecute('sketch_circle', {
            center_x: points[0].x,
            center_y: points[0].y,
            radius,
          });
          this.finishShape();
        }
        break;

      case 'arc':
        if (points.length >= 3) {
          const center = points[0];
          const radius = center.distanceTo(points[1]);
          if (radius < 0.001) {
            this.finishShape();
            return;
          }
          const startAngle = Math.atan2(points[1].y - center.y, points[1].x - center.x) * (180 / Math.PI);
          const endAngle = Math.atan2(points[2].y - center.y, points[2].x - center.x) * (180 / Math.PI);
          this.sendToolExecute('sketch_arc', {
            center_x: center.x,
            center_y: center.y,
            radius,
            start_angle: startAngle,
            end_angle: endAngle,
          });
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
  }

  // --- Preview rendering ---

  private updatePreview() {
    this.clearPreview();

    const tool = this.drawingToolService.activeTool;
    if (!tool || !this.mouseWorldPos) return;

    const points = this.drawingPoints;
    const mouse = this.mouseWorldPos;

    switch (tool) {
      case 'line':
        if (points.length === 1) {
          this.addPreviewLine(points[0], mouse);
        }
        break;

      case 'rectangle':
        if (points.length === 1) {
          const p = points[0];
          const corners = [
            new THREE.Vector3(p.x, p.y, 0),
            new THREE.Vector3(mouse.x, p.y, 0),
            new THREE.Vector3(mouse.x, mouse.y, 0),
            new THREE.Vector3(p.x, mouse.y, 0),
            new THREE.Vector3(p.x, p.y, 0),
          ];
          for (let i = 0; i < corners.length - 1; i++) {
            this.addPreviewLine(corners[i], corners[i + 1]);
          }
        }
        break;

      case 'circle':
        if (points.length === 1) {
          const radius = points[0].distanceTo(mouse);
          this.addPreviewCircle(points[0], radius);
        }
        break;

      case 'arc':
        if (points.length === 1) {
          // Radius line from center to mouse
          this.addPreviewLine(points[0], mouse);
        } else if (points.length === 2) {
          // Arc from start angle sweeping to mouse angle
          const center = points[0];
          const radius = center.distanceTo(points[1]);
          const startAngle = Math.atan2(points[1].y - center.y, points[1].x - center.x);
          const endAngle = Math.atan2(mouse.y - center.y, mouse.x - center.x);
          this.addPreviewArc(center, radius, startAngle, endAngle);
          // Also show the radius lines
          this.addPreviewLine(center, points[1]);
          this.addPreviewLine(center, new THREE.Vector3(
            center.x + radius * Math.cos(endAngle),
            center.y + radius * Math.sin(endAngle),
            0,
          ));
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

  private addPreviewCircle(center: THREE.Vector3, radius: number) {
    const segments = 64;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(
        center.x + radius * Math.cos(angle),
        center.y + radius * Math.sin(angle),
        0,
      ));
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
      pts.push(new THREE.Vector3(
        center.x + radius * Math.cos(angle),
        center.y + radius * Math.sin(angle),
        0,
      ));
    }
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geom, this.previewMaterial);
    line.computeLineDistances();
    this.previewGroup.add(line);
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

    if (event.ctrlKey && event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.wsService.send({ type: 'undo', payload: {} });
    } else if (
      (event.ctrlKey && event.key === 'y') ||
      (event.ctrlKey && event.shiftKey && event.key === 'Z')
    ) {
      event.preventDefault();
      this.wsService.send({ type: 'redo', payload: {} });
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
        // Toggle: clicking same entity deselects
        if (entityId === this.selectedEntityId) {
          this.selectEntity(null);
        } else {
          this.selectEntity(entityId);
        }
        return;
      }
    }

    // Clicked empty space — deselect
    this.selectEntity(null);
  }

  private selectEntity(entityId: string | null) {
    // Clear old highlight
    if (this.selectedEntityId) {
      this.applyHighlight(this.selectedEntityId, false);
    }

    this.selectedEntityId = entityId;

    // Apply new highlight
    if (entityId) {
      this.applyHighlight(entityId, true);
      this.updateTooltip(entityId);
    } else {
      this.tooltipVisible = false;
    }

    // Notify backend
    this.wsService.send({
      type: 'entity_selected',
      payload: { entityId },
    });
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

  private updateTooltip(entityId: string) {
    const entry = this.entityRegistry.get(entityId);
    const info = this.entityInfoCache.get(entityId);
    if (!entry || !info) {
      this.tooltipVisible = false;
      return;
    }

    // Compute bounding box center and project to screen
    const target = entry.mesh || entry.lines;
    if (!target) {
      this.tooltipVisible = false;
      return;
    }

    const bbox = new THREE.Box3().setFromObject(target);
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());

    // Project to screen
    const projected = center.clone().project(this.camera);
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    this.tooltipX = ((projected.x + 1) / 2) * rect.width;
    this.tooltipY = ((-projected.y + 1) / 2) * rect.height;

    this.tooltipEntityName = info.name;
    this.tooltipEntityType = info.type;
    this.tooltipDimensions = `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} in`;
    this.tooltipVisible = true;
  }

  // --- Animation & message handling ---

  private animate = () => {
    this.animationId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    // Update tooltip position each frame if visible
    if (this.tooltipVisible && this.selectedEntityId) {
      this.ngZone.run(() => this.updateTooltip(this.selectedEntityId!));
    }
  };

  private handleMessage(msg: WSMessage) {
    if (msg.type === 'mesh_update') {
      this.clearMeshes();
      const meshes = (msg.payload as any).meshes;
      for (const meshData of meshes) {
        this.addMesh(meshData);
      }

      // Reapply selection after rebuild
      if (this.selectedEntityId) {
        if (this.entityRegistry.has(this.selectedEntityId)) {
          this.applyHighlight(this.selectedEntityId, true);
          this.updateTooltip(this.selectedEntityId);
        } else {
          // Entity was removed — auto-deselect
          this.selectedEntityId = null;
          this.tooltipVisible = false;
          this.wsService.send({
            type: 'entity_selected',
            payload: { entityId: null },
          });
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

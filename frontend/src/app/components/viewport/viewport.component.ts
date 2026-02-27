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
  private meshGroup = new THREE.Group();

  constructor(
    private ngZone: NgZone,
    private wsService: WebsocketService,
  ) {}

  ngOnInit() {
    this.subscription = this.wsService.messages$.subscribe((msg) => {
      this.handleMessage(msg);
    });
  }

  ngAfterViewInit() {
    this.initScene();
    this.ngZone.runOutsideAngular(() => this.animate());
    window.addEventListener('keydown', this.onKeyDown);
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    this.subscription?.unsubscribe();
    this.controls?.dispose();
    this.renderer?.dispose();
  }

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
    }
  }

  private clearMeshes() {
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
  }) {
    const isSketch = data.entityKind === 'sketch';

    if (isSketch) {
      // Sketch rendering: cyan lines + optional translucent fill
      if (data.edges.length > 0) {
        const edgeGeometry = new THREE.BufferGeometry();
        edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(data.edges, 3));
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x00e5ff, linewidth: 2 });
        const lines = new THREE.LineSegments(edgeGeometry, lineMaterial);
        this.meshGroup.add(lines);
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
        this.meshGroup.add(fillMesh);
      }
    } else {
      // Solid rendering (existing behavior)
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
      this.meshGroup.add(mesh);

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
      this.meshGroup.add(lines);
    }
  }
}

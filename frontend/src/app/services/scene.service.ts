import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

@Injectable({ providedIn: 'root' })
export class SceneService {
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  controls!: OrbitControls;

  readonly meshGroup = new THREE.Group();
  readonly previewGroup = new THREE.Group();
  readonly gridGroup = new THREE.Group();
  readonly measureGroup = new THREE.Group();

  private animationId = 0;
  private resizeHandler = () => this.onResize();

  init(canvas: HTMLCanvasElement): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x1a1a2e);

    this.scene = new THREE.Scene();
    this.scene.add(this.meshGroup);
    this.scene.add(this.previewGroup);
    this.scene.add(this.gridGroup);
    this.scene.add(this.measureGroup);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.set(6, 5, 8);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dir1.position.set(5, 10, 7);
    this.scene.add(dir1);

    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(-5, -2, -5);
    this.scene.add(dir2);

    const grid = new THREE.GridHelper(20, 20, 0x444466, 0x333355);
    this.scene.add(grid);

    window.addEventListener('resize', this.resizeHandler);
  }

  startRenderLoop(): void {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  stopRenderLoop(): void {
    cancelAnimationFrame(this.animationId);
  }

  dispose(): void {
    this.stopRenderLoop();
    window.removeEventListener('resize', this.resizeHandler);
    this.controls?.dispose();
    this.renderer?.dispose();
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

  setOrbitForDrawing(enabled: boolean): void {
    if (enabled) {
      this.controls.mouseButtons = {
        LEFT: -1 as any,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
    } else {
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
    }
  }

  toScreen(pos: THREE.Vector3, canvas: HTMLCanvasElement): { x: number; y: number } {
    const v = pos.clone().project(this.camera);
    return {
      x: (v.x + 1) / 2 * canvas.clientWidth,
      y: (-v.y + 1) / 2 * canvas.clientHeight,
    };
  }

  private animateCamera(targetPos: THREE.Vector3, targetLookAt: THREE.Vector3): void {
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const duration = 300;
    const startTime = performance.now();

    const step = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      this.camera.position.lerpVectors(startPos, targetPos, ease);
      this.controls.target.lerpVectors(startTarget, targetLookAt, ease);
      this.controls.update();

      if (t < 1) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }

  private onResize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
}

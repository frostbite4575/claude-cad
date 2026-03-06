import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { SketchPlane } from './drawing-tool.service';

@Injectable({ providedIn: 'root' })
export class DrawingService {
  drawingPoints: THREE.Vector3[] = [];
  mouseWorldPos: THREE.Vector3 | null = null;
  drawingPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  private previewMaterial = new THREE.LineDashedMaterial({
    color: 0x00e5ff,
    dashSize: 0.1,
    gapSize: 0.05,
  });

  updateDrawingPlane(plane: SketchPlane): void {
    switch (plane) {
      case 'XY': this.drawingPlane.set(new THREE.Vector3(0, 0, 1), 0); break;
      case 'XZ': this.drawingPlane.set(new THREE.Vector3(0, 1, 0), 0); break;
      case 'YZ': this.drawingPlane.set(new THREE.Vector3(1, 0, 0), 0); break;
    }
  }

  to2D(p: THREE.Vector3, plane: SketchPlane): { x: number; y: number } {
    switch (plane) {
      case 'XY': return { x: p.x, y: p.y };
      case 'XZ': return { x: p.x, y: p.z };
      case 'YZ': return { x: p.y, y: p.z };
    }
  }

  reset(): void {
    this.drawingPoints = [];
    this.mouseWorldPos = null;
  }

  addPreviewLine(previewGroup: THREE.Group, a: THREE.Vector3, b: THREE.Vector3): void {
    const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geom, this.previewMaterial);
    line.computeLineDistances();
    previewGroup.add(line);
  }

  addPreviewCircle(previewGroup: THREE.Group, center: THREE.Vector3, radius: number, plane: SketchPlane): void {
    const segments = 64;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const dx = radius * Math.cos(angle);
      const dy = radius * Math.sin(angle);
      switch (plane) {
        case 'XY': pts.push(new THREE.Vector3(center.x + dx, center.y + dy, 0)); break;
        case 'XZ': pts.push(new THREE.Vector3(center.x + dx, 0, center.z + dy)); break;
        case 'YZ': pts.push(new THREE.Vector3(0, center.y + dx, center.z + dy)); break;
      }
    }
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geom, this.previewMaterial);
    line.computeLineDistances();
    previewGroup.add(line);
  }

  addPreviewArc(previewGroup: THREE.Group, center: THREE.Vector3, radius: number, startAngle: number, endAngle: number, plane: SketchPlane): void {
    let sweep = endAngle - startAngle;
    if (sweep <= 0) sweep += Math.PI * 2;

    const segments = Math.max(16, Math.round(sweep / (Math.PI * 2) * 64));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + (i / segments) * sweep;
      const dx = radius * Math.cos(angle);
      const dy = radius * Math.sin(angle);
      switch (plane) {
        case 'XY': pts.push(new THREE.Vector3(center.x + dx, center.y + dy, 0)); break;
        case 'XZ': pts.push(new THREE.Vector3(center.x + dx, 0, center.z + dy)); break;
        case 'YZ': pts.push(new THREE.Vector3(0, center.y + dx, center.z + dy)); break;
      }
    }
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geom, this.previewMaterial);
    line.computeLineDistances();
    previewGroup.add(line);
  }

  makeRectCorners(p1: THREE.Vector3, p2: THREE.Vector3, plane: SketchPlane): THREE.Vector3[] {
    switch (plane) {
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

  compute3PointArc(
    p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, plane: SketchPlane
  ): { cx: number; cy: number; radius: number; startRad: number; endRad: number; startDeg: number; endDeg: number } | null {
    const s1 = this.to2D(p1, plane), s2 = this.to2D(p2, plane), s3 = this.to2D(p3, plane);
    const ax = s1.x, ay = s1.y;
    const bx = s2.x, by = s2.y;
    const cx = s3.x, cy = s3.y;

    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-10) return null;

    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
    const radius = Math.sqrt((ax - ux) * (ax - ux) + (ay - uy) * (ay - uy));

    if (radius < 0.001) return null;

    const a1 = Math.atan2(ay - uy, ax - ux);
    const a2 = Math.atan2(by - uy, bx - ux);
    const a3 = Math.atan2(cy - uy, cx - ux);

    const normalizeAngle = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const na1 = normalizeAngle(a1);
    const na2 = normalizeAngle(a2);
    const na3 = normalizeAngle(a3);

    let ccwSweep = normalizeAngle(na2 - na1);
    if (ccwSweep === 0) ccwSweep = Math.PI * 2;
    const toP3 = normalizeAngle(na3 - na1);
    const p3InCCW = toP3 < ccwSweep;

    let startRad: number, endRad: number;
    if (p3InCCW) {
      startRad = a1;
      endRad = a2;
    } else {
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

  clearPreview(previewGroup: THREE.Group): void {
    while (previewGroup.children.length > 0) {
      const child = previewGroup.children[0];
      previewGroup.remove(child);
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
      }
    }
  }

  clearMeasure(measureGroup: THREE.Group): void {
    while (measureGroup.children.length > 0) {
      const child = measureGroup.children[0];
      measureGroup.remove(child);
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
  }

  dispose(): void {
    this.previewMaterial.dispose();
  }
}

import { describe, it, expect } from 'vitest';
import { writeDxf, buildBendLineDxfEntities } from './dxf-export.js';
import type { LayeredDxfEntity } from './dxf-export.js';

// --- writeDxf ---

describe('writeDxf', () => {
  it('produces valid DXF structure', () => {
    const dxf = writeDxf([
      { type: 'LINE', x1: 0, y1: 0, x2: 10, y2: 0 },
    ]);

    // Must contain required sections
    expect(dxf).toContain('HEADER');
    expect(dxf).toContain('TABLES');
    expect(dxf).toContain('ENTITIES');
    expect(dxf).toContain('EOF');
  });

  it('writes SECTION/ENDSEC pairs', () => {
    const dxf = writeDxf([]);
    const sections = dxf.match(/SECTION/g);
    const endsecs = dxf.match(/ENDSEC/g);
    // 3 sections: HEADER, TABLES, ENTITIES
    expect(sections?.length).toBe(3);
    expect(endsecs?.length).toBe(3);
  });

  it('writes LINE entities correctly', () => {
    const dxf = writeDxf([
      { type: 'LINE', x1: 1.5, y1: 2.5, x2: 3.5, y2: 4.5 },
    ]);

    expect(dxf).toContain('LINE');
    // Group code 10 = start X, 20 = start Y, 11 = end X, 21 = end Y
    expect(dxf).toContain('1.5');
    expect(dxf).toContain('2.5');
    expect(dxf).toContain('3.5');
    expect(dxf).toContain('4.5');
  });

  it('writes ARC entities correctly', () => {
    const dxf = writeDxf([
      { type: 'ARC', cx: 5, cy: 5, radius: 2, startAngle: 0, endAngle: 90 },
    ]);

    expect(dxf).toContain('ARC');
    // Check center, radius, angles are present
    const lines = dxf.split('\n');
    expect(lines.some(l => l.trim() === '5')).toBe(true);  // center coords
    expect(lines.some(l => l.trim() === '2')).toBe(true);  // radius
    expect(lines.some(l => l.trim() === '0')).toBe(true);  // start angle
    expect(lines.some(l => l.trim() === '90')).toBe(true); // end angle
  });

  it('writes CIRCLE entities correctly', () => {
    const dxf = writeDxf([
      { type: 'CIRCLE', cx: 3, cy: 4, radius: 1.5 },
    ]);

    expect(dxf).toContain('CIRCLE');
    const lines = dxf.split('\n');
    expect(lines.some(l => l.trim() === '1.5')).toBe(true); // radius
  });

  it('writes multiple entities', () => {
    const dxf = writeDxf([
      { type: 'LINE', x1: 0, y1: 0, x2: 10, y2: 0 },
      { type: 'LINE', x1: 10, y1: 0, x2: 10, y2: 10 },
      { type: 'CIRCLE', cx: 5, cy: 5, radius: 2 },
    ]);

    const lineCount = (dxf.match(/\nLINE\n/g) || []).length;
    const circleCount = (dxf.match(/\nCIRCLE\n/g) || []).length;
    expect(lineCount).toBe(2);
    expect(circleCount).toBe(1);
  });

  it('handles empty entity list', () => {
    const dxf = writeDxf([]);
    expect(dxf).toContain('HEADER');
    expect(dxf).toContain('ENTITIES');
    expect(dxf).toContain('EOF');
    // No entity types should appear in ENTITIES section
    expect(dxf).not.toContain('\nLINE\n');
  });

  it('sets units to inches', () => {
    const dxf = writeDxf([]);
    expect(dxf).toContain('$INSUNITS');
    // Group code 70 with value 1 = inches
    const lines = dxf.split('\n');
    const insUnitsIdx = lines.findIndex(l => l.trim() === '$INSUNITS');
    expect(insUnitsIdx).toBeGreaterThan(-1);
    // Next group code should be 70, then value 1
    expect(lines[insUnitsIdx + 1].trim()).toBe('70');
    expect(lines[insUnitsIdx + 2].trim()).toBe('1');
  });
});

// --- TABLES section ---

describe('DXF TABLES section', () => {
  it('includes LTYPE table with CONTINUOUS', () => {
    const dxf = writeDxf([]);
    expect(dxf).toContain('LTYPE');
    expect(dxf).toContain('CONTINUOUS');
  });

  it('includes LAYER table with layer 0', () => {
    const dxf = writeDxf([]);
    expect(dxf).toContain('LAYER');
  });

  it('includes BEND layer when extra layered entities present', () => {
    const extra: LayeredDxfEntity[] = [
      { entity: { type: 'LINE', x1: 0, y1: 5, x2: 10, y2: 5 }, layer: 'BEND' },
    ];
    const dxf = writeDxf([], extra);
    expect(dxf).toContain('BEND');
  });

  it('has TABLE/ENDTAB pairs', () => {
    const dxf = writeDxf([]);
    const tables = (dxf.match(/\nTABLE\n/g) || []).length;
    const endtabs = (dxf.match(/\nENDTAB\n/g) || []).length;
    expect(tables).toBe(endtabs);
    expect(tables).toBeGreaterThanOrEqual(2); // LTYPE + LAYER
  });
});

// --- Extra layered entities ---

describe('writeDxf with extra layered entities', () => {
  it('writes entities on specified layer', () => {
    const extra: LayeredDxfEntity[] = [
      { entity: { type: 'LINE', x1: 0, y1: 5, x2: 12, y2: 5 }, layer: 'BEND' },
    ];
    const dxf = writeDxf([], extra);

    // The BEND layer should appear in the entity section
    // Look for a LINE entity followed by layer assignment
    const lines = dxf.split('\n');
    const entitySectionStart = lines.findIndex(l => l.trim() === 'ENTITIES');
    const subset = lines.slice(entitySectionStart);

    // Find LINE entity
    const lineIdx = subset.findIndex(l => l.trim() === 'LINE');
    expect(lineIdx).toBeGreaterThan(-1);

    // Next group code 8 (layer) should be 'BEND'
    const layerCodeIdx = subset.findIndex((l, i) => i > lineIdx && l.trim() === '8');
    expect(layerCodeIdx).toBeGreaterThan(-1);
    expect(subset[layerCodeIdx + 1].trim()).toBe('BEND');
  });
});

// --- buildBendLineDxfEntities ---

describe('buildBendLineDxfEntities', () => {
  it('creates horizontal bend lines for X-axis bends', () => {
    const bends = [{ position: 3, axis: 'X' as const }];
    const result = buildBendLineDxfEntities(bends, 10, 8);

    expect(result).toHaveLength(1);
    expect(result[0].layer).toBe('BEND');

    const line = result[0].entity;
    expect(line.type).toBe('LINE');
    if (line.type === 'LINE') {
      expect(line.y1).toBe(3);
      expect(line.y2).toBe(3);
      expect(line.x1).toBe(0);
      expect(line.x2).toBe(10); // full plate width
    }
  });

  it('creates vertical bend lines for Y-axis bends', () => {
    const bends = [{ position: 4, axis: 'Y' as const }];
    const result = buildBendLineDxfEntities(bends, 10, 8);

    expect(result).toHaveLength(1);
    const line = result[0].entity;
    if (line.type === 'LINE') {
      expect(line.x1).toBe(4);
      expect(line.x2).toBe(4);
      expect(line.y1).toBe(0);
      expect(line.y2).toBe(8); // full plate length
    }
  });

  it('handles multiple bends', () => {
    const bends = [
      { position: 2, axis: 'X' as const },
      { position: 5, axis: 'X' as const },
      { position: 3, axis: 'Y' as const },
    ];
    const result = buildBendLineDxfEntities(bends, 10, 8);
    expect(result).toHaveLength(3);
    expect(result.every(r => r.layer === 'BEND')).toBe(true);
  });

  it('returns empty for no bends', () => {
    const result = buildBendLineDxfEntities([], 10, 8);
    expect(result).toHaveLength(0);
  });
});

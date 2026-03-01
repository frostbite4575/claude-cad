import { describe, it, expect } from 'vitest';
import { parseDxf } from './dxf-import.js';

// Helper: build a minimal DXF string with an ENTITIES section
function makeDxf(entityBlock: string): string {
  return [
    '  0', 'SECTION',
    '  2', 'ENTITIES',
    entityBlock,
    '  0', 'ENDSEC',
    '  0', 'EOF',
  ].join('\n');
}

// --- parseDxf ---

describe('parseDxf', () => {
  it('parses a LINE entity', () => {
    const dxf = makeDxf([
      '  0', 'LINE',
      '  8', '0',
      ' 10', '1.5',
      ' 20', '2.5',
      ' 11', '3.5',
      ' 21', '4.5',
    ].join('\n'));

    const result = parseDxf(dxf);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].type).toBe('LINE');

    const line = result.entities[0] as any;
    expect(line.x1).toBe(1.5);
    expect(line.y1).toBe(2.5);
    expect(line.x2).toBe(3.5);
    expect(line.y2).toBe(4.5);
    expect(line.layer).toBe('0');
  });

  it('parses an ARC entity', () => {
    const dxf = makeDxf([
      '  0', 'ARC',
      '  8', 'CUT',
      ' 10', '5.0',
      ' 20', '5.0',
      ' 40', '2.0',
      ' 50', '0',
      ' 51', '90',
    ].join('\n'));

    const result = parseDxf(dxf);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].type).toBe('ARC');

    const arc = result.entities[0] as any;
    expect(arc.cx).toBe(5);
    expect(arc.cy).toBe(5);
    expect(arc.radius).toBe(2);
    expect(arc.startAngle).toBe(0);
    expect(arc.endAngle).toBe(90);
    expect(arc.layer).toBe('CUT');
  });

  it('parses a CIRCLE entity', () => {
    const dxf = makeDxf([
      '  0', 'CIRCLE',
      '  8', '0',
      ' 10', '3.0',
      ' 20', '4.0',
      ' 40', '1.5',
    ].join('\n'));

    const result = parseDxf(dxf);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].type).toBe('CIRCLE');

    const circle = result.entities[0] as any;
    expect(circle.cx).toBe(3);
    expect(circle.cy).toBe(4);
    expect(circle.radius).toBe(1.5);
  });

  it('parses multiple entities', () => {
    const dxf = makeDxf([
      '  0', 'LINE',
      '  8', '0',
      ' 10', '0', ' 20', '0', ' 11', '10', ' 21', '0',
      '  0', 'LINE',
      '  8', '0',
      ' 10', '10', ' 20', '0', ' 11', '10', ' 21', '10',
      '  0', 'CIRCLE',
      '  8', '0',
      ' 10', '5', ' 20', '5', ' 40', '2',
    ].join('\n'));

    const result = parseDxf(dxf);
    expect(result.entities).toHaveLength(3);
    expect(result.entities.filter(e => e.type === 'LINE')).toHaveLength(2);
    expect(result.entities.filter(e => e.type === 'CIRCLE')).toHaveLength(1);
  });

  it('tracks layers', () => {
    const dxf = makeDxf([
      '  0', 'LINE',
      '  8', 'CUT',
      ' 10', '0', ' 20', '0', ' 11', '10', ' 21', '0',
      '  0', 'LINE',
      '  8', 'BEND',
      ' 10', '5', ' 20', '0', ' 11', '5', ' 21', '10',
    ].join('\n'));

    const result = parseDxf(dxf);
    expect(result.layers).toContain('CUT');
    expect(result.layers).toContain('BEND');
  });

  it('counts skipped unsupported entities', () => {
    const dxf = makeDxf([
      '  0', 'TEXT',
      '  8', '0',
      '  1', 'Hello',
      '  0', 'LINE',
      '  8', '0',
      ' 10', '0', ' 20', '0', ' 11', '10', ' 21', '0',
    ].join('\n'));

    const result = parseDxf(dxf);
    expect(result.skipped).toBe(1);
    expect(result.entities).toHaveLength(1); // only the LINE
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('handles empty ENTITIES section', () => {
    const dxf = makeDxf('');
    const result = parseDxf(dxf);
    expect(result.entities).toHaveLength(0);
    expect(result.skipped).toBe(0);
  });

  it('parses LWPOLYLINE as line segments', () => {
    const dxf = makeDxf([
      '  0', 'LWPOLYLINE',
      '  8', '0',
      ' 70', '1',   // closed
      ' 10', '0', ' 20', '0',
      ' 10', '10', ' 20', '0',
      ' 10', '10', ' 20', '10',
      ' 10', '0', ' 20', '10',
    ].join('\n'));

    const result = parseDxf(dxf);
    // Closed 4-vertex polyline = 4 line segments
    expect(result.entities).toHaveLength(4);
    expect(result.entities.every(e => e.type === 'LINE')).toBe(true);
  });

  it('parses open LWPOLYLINE correctly', () => {
    const dxf = makeDxf([
      '  0', 'LWPOLYLINE',
      '  8', '0',
      ' 70', '0',   // open
      ' 10', '0', ' 20', '0',
      ' 10', '5', ' 20', '0',
      ' 10', '5', ' 20', '5',
    ].join('\n'));

    const result = parseDxf(dxf);
    // Open 3-vertex polyline = 2 line segments
    expect(result.entities).toHaveLength(2);
  });

  it('handles Windows-style line endings', () => {
    const dxf = '  0\r\nSECTION\r\n  2\r\nENTITIES\r\n  0\r\nLINE\r\n  8\r\n0\r\n 10\r\n1\r\n 20\r\n2\r\n 11\r\n3\r\n 21\r\n4\r\n  0\r\nENDSEC\r\n  0\r\nEOF\r\n';
    const result = parseDxf(dxf);
    expect(result.entities).toHaveLength(1);
  });

  it('defaults layer to "0" when not specified', () => {
    const dxf = makeDxf([
      '  0', 'LINE',
      ' 10', '0', ' 20', '0', ' 11', '10', ' 21', '0',
    ].join('\n'));

    const result = parseDxf(dxf);
    expect(result.entities[0].layer).toBe('0');
  });
});

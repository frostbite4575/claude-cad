import { describe, it, expect, beforeEach } from 'vitest';
import {
  findMaterial,
  calculateBend,
  getBoltClearance,
  MATERIALS_DB,
  BOLT_CLEARANCE,
} from './materials.js';

// --- findMaterial ---

describe('findMaterial', () => {
  it('finds exact name match', () => {
    const mat = findMaterial('18ga mild steel');
    expect(mat).toBeDefined();
    expect(mat!.thickness).toBe(0.0478);
    expect(mat!.material_type).toBe('mild steel');
  });

  it('is case-insensitive', () => {
    const mat = findMaterial('18GA MILD STEEL');
    expect(mat).toBeDefined();
    expect(mat!.name).toBe('18ga mild steel');
  });

  it('trims whitespace', () => {
    const mat = findMaterial('  18ga mild steel  ');
    expect(mat).toBeDefined();
  });

  it('finds partial match', () => {
    const mat = findMaterial('18ga mild');
    expect(mat).toBeDefined();
    expect(mat!.name).toBe('18ga mild steel');
  });

  it('returns undefined for unknown material', () => {
    expect(findMaterial('unobtanium')).toBeUndefined();
  });

  it('finds aluminum', () => {
    const mat = findMaterial('1/4 aluminum');
    expect(mat).toBeDefined();
    expect(mat!.thickness).toBe(0.250);
    expect(mat!.material_type).toBe('aluminum');
  });

  it('finds stainless', () => {
    const mat = findMaterial('16ga stainless');
    expect(mat).toBeDefined();
    expect(mat!.thickness).toBe(0.0598);
  });
});

// --- calculateBend ---

describe('calculateBend', () => {
  it('computes 90° bend on 18ga mild steel', () => {
    const result = calculateBend(0.0478, 0.0478, 0.40, 90);
    expect(result.bend_allowance).toBeGreaterThan(0);
    expect(result.bend_deduction).toBeGreaterThan(0);
    expect(result.inside_setback).toBeGreaterThan(0);
  });

  it('bend allowance increases with angle', () => {
    const ba45 = calculateBend(0.0478, 0.0478, 0.40, 45);
    const ba90 = calculateBend(0.0478, 0.0478, 0.40, 90);
    const ba135 = calculateBend(0.0478, 0.0478, 0.40, 135);
    expect(ba90.bend_allowance).toBeGreaterThan(ba45.bend_allowance);
    expect(ba135.bend_allowance).toBeGreaterThan(ba90.bend_allowance);
  });

  it('bend allowance increases with radius', () => {
    const small = calculateBend(0.0478, 0.0478, 0.40, 90);
    const large = calculateBend(0.0478, 0.250, 0.40, 90);
    expect(large.bend_allowance).toBeGreaterThan(small.bend_allowance);
  });

  it('bend allowance increases with thickness', () => {
    const thin = calculateBend(0.0478, 0.0478, 0.40, 90);
    const thick = calculateBend(0.250, 0.250, 0.40, 90);
    expect(thick.bend_allowance).toBeGreaterThan(thin.bend_allowance);
  });

  it('returns 4-decimal precision', () => {
    const result = calculateBend(0.0478, 0.0478, 0.40, 90);
    // Check that values are rounded to 4 decimal places
    expect(result.bend_allowance).toBe(Math.round(result.bend_allowance * 10000) / 10000);
    expect(result.bend_deduction).toBe(Math.round(result.bend_deduction * 10000) / 10000);
    expect(result.inside_setback).toBe(Math.round(result.inside_setback * 10000) / 10000);
  });

  it('does not return NaN for 180° bend', () => {
    const result = calculateBend(0.0478, 0.0478, 0.40, 180);
    expect(Number.isFinite(result.bend_allowance)).toBe(true);
    expect(Number.isFinite(result.bend_deduction)).toBe(true);
    expect(Number.isFinite(result.inside_setback)).toBe(true);
  });

  it('known value check: 90° bend, R=T=0.0478, K=0.40', () => {
    // BA = π × (0.0478 + 0.40 × 0.0478) × (90/180)
    //    = π × (0.0478 + 0.01912) × 0.5
    //    = π × 0.06692 × 0.5
    //    ≈ 0.10509
    const result = calculateBend(0.0478, 0.0478, 0.40, 90);
    expect(result.bend_allowance).toBeCloseTo(0.1051, 3);
  });
});

// --- getBoltClearance ---

describe('getBoltClearance', () => {
  it('returns standard clearance for 1/4 bolt', () => {
    const result = getBoltClearance('1/4');
    expect(result).toBeDefined();
    expect(result!.diameter).toBe(0.2810);
    expect(result!.radius).toBeCloseTo(0.1405, 4);
  });

  it('returns close fit when requested', () => {
    const result = getBoltClearance('1/4', 'close');
    expect(result).toBeDefined();
    expect(result!.diameter).toBe(0.2660);
  });

  it('returns loose fit when requested', () => {
    const result = getBoltClearance('1/4', 'loose');
    expect(result).toBeDefined();
    expect(result!.diameter).toBe(0.3125);
  });

  it('handles # bolt sizes', () => {
    const result = getBoltClearance('#10');
    expect(result).toBeDefined();
    expect(result!.diameter).toBe(0.2010);
  });

  it('strips "inch" suffix', () => {
    const result = getBoltClearance('1/4 inch');
    expect(result).toBeDefined();
    expect(result!.diameter).toBe(0.2810);
  });

  it('strips "bolt" suffix', () => {
    const result = getBoltClearance('3/8 bolt');
    expect(result).toBeDefined();
    expect(result!.diameter).toBe(0.4062);
  });

  it('returns undefined for unknown size', () => {
    expect(getBoltClearance('M10')).toBeUndefined();
  });

  it('covers all sizes in BOLT_CLEARANCE', () => {
    for (const size of Object.keys(BOLT_CLEARANCE)) {
      const result = getBoltClearance(size);
      expect(result, `missing result for ${size}`).toBeDefined();
      expect(result!.diameter).toBeGreaterThan(0);
      expect(result!.radius).toBeCloseTo(result!.diameter / 2, 6);
    }
  });
});

// --- MATERIALS_DB integrity ---

describe('MATERIALS_DB', () => {
  it('has at least 20 materials', () => {
    expect(MATERIALS_DB.length).toBeGreaterThanOrEqual(20);
  });

  it('all materials have positive thickness', () => {
    for (const mat of MATERIALS_DB) {
      expect(mat.thickness, `${mat.name} thickness`).toBeGreaterThan(0);
    }
  });

  it('all materials have positive inner_bend_radius', () => {
    for (const mat of MATERIALS_DB) {
      expect(mat.inner_bend_radius, `${mat.name} radius`).toBeGreaterThan(0);
    }
  });

  it('k_factor is between 0 and 1 for all materials', () => {
    for (const mat of MATERIALS_DB) {
      expect(mat.k_factor, `${mat.name} k_factor`).toBeGreaterThan(0);
      expect(mat.k_factor, `${mat.name} k_factor`).toBeLessThan(1);
    }
  });

  it('all three material types are represented', () => {
    const types = new Set(MATERIALS_DB.map(m => m.material_type));
    expect(types.has('mild steel')).toBe(true);
    expect(types.has('stainless')).toBe(true);
    expect(types.has('aluminum')).toBe(true);
  });
});

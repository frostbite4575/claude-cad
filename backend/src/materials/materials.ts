// --- Types ---

export interface Material {
  name: string;
  material_type: 'mild steel' | 'stainless' | 'aluminum';
  thickness: number;        // inches
  inner_bend_radius: number; // inches
  k_factor: number;
}

export interface BendLine {
  id: string;
  position: number;         // inches from edge
  axis: 'X' | 'Y';         // bend runs along this axis
  angle_deg: number;        // bend angle in degrees
  direction: 'up' | 'down'; // fold direction
}

export interface BendCalculation {
  bend_allowance: number;
  bend_deduction: number;
  inside_setback: number;
}

// --- Materials Database ---

export const MATERIALS_DB: Material[] = [
  // Mild steel — common gauges and fractional sizes
  { name: '18ga mild steel',  material_type: 'mild steel', thickness: 0.0478, inner_bend_radius: 0.0478, k_factor: 0.40 },
  { name: '16ga mild steel',  material_type: 'mild steel', thickness: 0.0598, inner_bend_radius: 0.0598, k_factor: 0.40 },
  { name: '14ga mild steel',  material_type: 'mild steel', thickness: 0.0747, inner_bend_radius: 0.0747, k_factor: 0.41 },
  { name: '12ga mild steel',  material_type: 'mild steel', thickness: 0.1046, inner_bend_radius: 0.1046, k_factor: 0.41 },
  { name: '11ga mild steel',  material_type: 'mild steel', thickness: 0.1196, inner_bend_radius: 0.1196, k_factor: 0.42 },
  { name: '10ga mild steel',  material_type: 'mild steel', thickness: 0.1345, inner_bend_radius: 0.1345, k_factor: 0.42 },
  { name: '1/8 mild steel',   material_type: 'mild steel', thickness: 0.125,  inner_bend_radius: 0.125,  k_factor: 0.42 },
  { name: '3/16 mild steel',  material_type: 'mild steel', thickness: 0.1875, inner_bend_radius: 0.1875, k_factor: 0.42 },
  { name: '1/4 mild steel',   material_type: 'mild steel', thickness: 0.250,  inner_bend_radius: 0.250,  k_factor: 0.42 },
  { name: '3/8 mild steel',   material_type: 'mild steel', thickness: 0.375,  inner_bend_radius: 0.375,  k_factor: 0.43 },
  { name: '1/2 mild steel',   material_type: 'mild steel', thickness: 0.500,  inner_bend_radius: 0.500,  k_factor: 0.44 },

  // Stainless steel
  { name: '22ga stainless',   material_type: 'stainless',  thickness: 0.0312, inner_bend_radius: 0.0312, k_factor: 0.40 },
  { name: '20ga stainless',   material_type: 'stainless',  thickness: 0.0375, inner_bend_radius: 0.0375, k_factor: 0.40 },
  { name: '18ga stainless',   material_type: 'stainless',  thickness: 0.0478, inner_bend_radius: 0.0478, k_factor: 0.41 },
  { name: '16ga stainless',   material_type: 'stainless',  thickness: 0.0598, inner_bend_radius: 0.0598, k_factor: 0.41 },
  { name: '14ga stainless',   material_type: 'stainless',  thickness: 0.0747, inner_bend_radius: 0.0747, k_factor: 0.42 },
  { name: '10ga stainless',   material_type: 'stainless',  thickness: 0.1345, inner_bend_radius: 0.1345, k_factor: 0.42 },
  { name: '1/8 stainless',    material_type: 'stainless',  thickness: 0.125,  inner_bend_radius: 0.125,  k_factor: 0.42 },
  { name: '3/16 stainless',   material_type: 'stainless',  thickness: 0.1875, inner_bend_radius: 0.1875, k_factor: 0.42 },

  // Aluminum
  { name: '0.040 aluminum',   material_type: 'aluminum',   thickness: 0.040,  inner_bend_radius: 0.040,  k_factor: 0.35 },
  { name: '0.063 aluminum',   material_type: 'aluminum',   thickness: 0.063,  inner_bend_radius: 0.063,  k_factor: 0.36 },
  { name: '1/8 aluminum',     material_type: 'aluminum',   thickness: 0.125,  inner_bend_radius: 0.125,  k_factor: 0.38 },
  { name: '3/16 aluminum',    material_type: 'aluminum',   thickness: 0.1875, inner_bend_radius: 0.250,  k_factor: 0.38 },
  { name: '1/4 aluminum',     material_type: 'aluminum',   thickness: 0.250,  inner_bend_radius: 0.375,  k_factor: 0.39 },
];

// --- Bolt Clearance Holes (ASME B18.2.8 standard clearance) ---
// Keys are bolt nominal size strings, values are clearance hole diameters in inches

export const BOLT_CLEARANCE: Record<string, { close: number; standard: number; loose: number }> = {
  '#4':    { close: 0.1285, standard: 0.1360, loose: 0.1495 },
  '#6':    { close: 0.1495, standard: 0.1570, loose: 0.1695 },
  '#8':    { close: 0.1695, standard: 0.1770, loose: 0.1990 },
  '#10':   { close: 0.1960, standard: 0.2010, loose: 0.2280 },
  '1/4':   { close: 0.2660, standard: 0.2810, loose: 0.3125 },
  '5/16':  { close: 0.3320, standard: 0.3440, loose: 0.3750 },
  '3/8':   { close: 0.3970, standard: 0.4062, loose: 0.4375 },
  '7/16':  { close: 0.4531, standard: 0.4688, loose: 0.5000 },
  '1/2':   { close: 0.5156, standard: 0.5312, loose: 0.5625 },
  '9/16':  { close: 0.5781, standard: 0.5938, loose: 0.6250 },
  '5/8':   { close: 0.6406, standard: 0.6562, loose: 0.6875 },
  '3/4':   { close: 0.7656, standard: 0.8125, loose: 0.8750 },
  '7/8':   { close: 0.8906, standard: 0.9375, loose: 1.0000 },
  '1':     { close: 1.0156, standard: 1.0625, loose: 1.1250 },
};

/**
 * Look up bolt clearance hole diameter by bolt size string.
 * Accepts formats like "3/8", "#10", "1/4", "1/2 inch", "3/8 bolt", etc.
 * Returns standard fit by default.
 */
export function getBoltClearance(
  boltSize: string,
  fit: 'close' | 'standard' | 'loose' = 'standard'
): { diameter: number; radius: number } | undefined {
  // Clean input: remove "inch", "bolt", quotes, extra whitespace
  const cleaned = boltSize.replace(/["']/g, '').replace(/\b(inch|bolt|screw|cap)\b/gi, '').trim();

  const entry = BOLT_CLEARANCE[cleaned];
  if (!entry) return undefined;

  const diameter = entry[fit];
  return { diameter, radius: diameter / 2 };
}

// --- Custom Bend Table Overrides ---
// In-memory overrides (persist via JSON file)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BEND_TABLE_PATH = path.join(__dirname, '..', '..', 'custom-bend-table.json');

interface BendOverride {
  k_factor: number;
  inner_bend_radius?: number;
}

let customBendTable: Record<string, BendOverride> = {};

// Load on startup
try {
  if (fs.existsSync(BEND_TABLE_PATH)) {
    customBendTable = JSON.parse(fs.readFileSync(BEND_TABLE_PATH, 'utf-8'));
  }
} catch { /* start empty */ }

function saveBendTable() {
  fs.writeFileSync(BEND_TABLE_PATH, JSON.stringify(customBendTable, null, 2));
}

export function setCustomBend(materialName: string, k_factor: number, inner_bend_radius?: number): void {
  customBendTable[materialName.toLowerCase().trim()] = { k_factor, inner_bend_radius };
  saveBendTable();
}

export function getCustomBend(materialName: string): BendOverride | undefined {
  return customBendTable[materialName.toLowerCase().trim()];
}

export function getAllBendOverrides(): Record<string, BendOverride> {
  return { ...customBendTable };
}

// --- Material Densities (lb/in³) ---

export const MATERIAL_DENSITY: Record<string, number> = {
  'mild steel': 0.284,
  'stainless': 0.289,
  'aluminum': 0.098,
};

// --- Approximate Material Costs ($/lb) — shop defaults, user can override ---

export const MATERIAL_COST_PER_LB: Record<string, number> = {
  'mild steel': 0.50,
  'stainless': 2.00,
  'aluminum': 1.50,
};

// --- Cut Cost ($/inch of cut length) — plasma table default ---
export const DEFAULT_CUT_COST_PER_INCH = 0.02;

// --- Functions ---

/**
 * Find a material by case-insensitive partial match.
 * Returns the first match, with custom bend overrides applied if present.
 */
export function findMaterial(name: string): Material | undefined {
  const lower = name.toLowerCase().trim();
  // Try exact match first
  let mat = MATERIALS_DB.find(m => m.name.toLowerCase() === lower);
  if (!mat) {
    // Partial match
    mat = MATERIALS_DB.find(m => m.name.toLowerCase().includes(lower) || lower.includes(m.name.toLowerCase()));
  }
  if (!mat) return undefined;

  // Apply custom overrides if present
  const override = getCustomBend(mat.name);
  if (override) {
    return {
      ...mat,
      k_factor: override.k_factor,
      inner_bend_radius: override.inner_bend_radius ?? mat.inner_bend_radius,
    };
  }
  return mat;
}

/**
 * Calculate bend allowance, bend deduction, and inside setback.
 *
 * BA = π × (R + K × T) × (angle / 180)
 * BD = 2 × (R + T) × tan(angle/2) - BA
 * Inside setback = tan(angle/2) × (R + T)
 */
export function calculateBend(
  thickness: number,
  radius: number,
  k_factor: number,
  angle_deg: number
): BendCalculation {
  // Clamp to avoid tan(90°) = Infinity at 180° bends
  const clampedAngle = Math.min(angle_deg, 179.9);
  const angleRad = (clampedAngle * Math.PI) / 180;
  const bend_allowance = Math.PI * (radius + k_factor * thickness) * (clampedAngle / 180);
  const outside_setback = (radius + thickness) * Math.tan(angleRad / 2);
  const bend_deduction = 2 * outside_setback - bend_allowance;
  const inside_setback = Math.tan(angleRad / 2) * (radius + thickness);

  return {
    bend_allowance: Math.round(bend_allowance * 10000) / 10000,
    bend_deduction: Math.round(bend_deduction * 10000) / 10000,
    inside_setback: Math.round(inside_setback * 10000) / 10000,
  };
}

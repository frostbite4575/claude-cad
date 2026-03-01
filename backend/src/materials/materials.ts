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
  { name: '10ga mild steel',  material_type: 'mild steel', thickness: 0.1345, inner_bend_radius: 0.1345, k_factor: 0.42 },
  { name: '3/16 mild steel',  material_type: 'mild steel', thickness: 0.1875, inner_bend_radius: 0.1875, k_factor: 0.42 },
  { name: '1/4 mild steel',   material_type: 'mild steel', thickness: 0.250,  inner_bend_radius: 0.250,  k_factor: 0.42 },
  { name: '3/8 mild steel',   material_type: 'mild steel', thickness: 0.375,  inner_bend_radius: 0.375,  k_factor: 0.43 },
  { name: '1/2 mild steel',   material_type: 'mild steel', thickness: 0.500,  inner_bend_radius: 0.500,  k_factor: 0.44 },
  { name: '10ga stainless',   material_type: 'stainless',  thickness: 0.1345, inner_bend_radius: 0.1345, k_factor: 0.42 },
  { name: '1/8 stainless',    material_type: 'stainless',  thickness: 0.125,  inner_bend_radius: 0.125,  k_factor: 0.42 },
  { name: '3/16 stainless',   material_type: 'stainless',  thickness: 0.1875, inner_bend_radius: 0.1875, k_factor: 0.42 },
  { name: '1/8 aluminum',     material_type: 'aluminum',   thickness: 0.125,  inner_bend_radius: 0.125,  k_factor: 0.38 },
  { name: '3/16 aluminum',    material_type: 'aluminum',   thickness: 0.1875, inner_bend_radius: 0.250,  k_factor: 0.38 },
];

// --- Functions ---

/**
 * Find a material by case-insensitive partial match.
 * Returns the first match or undefined.
 */
export function findMaterial(name: string): Material | undefined {
  const lower = name.toLowerCase().trim();
  // Try exact match first
  const exact = MATERIALS_DB.find(m => m.name.toLowerCase() === lower);
  if (exact) return exact;
  // Partial match
  return MATERIALS_DB.find(m => m.name.toLowerCase().includes(lower) || lower.includes(m.name.toLowerCase()));
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
  const angleRad = (angle_deg * Math.PI) / 180;
  const bend_allowance = Math.PI * (radius + k_factor * thickness) * (angle_deg / 180);
  const outside_setback = (radius + thickness) * Math.tan(angleRad / 2);
  const bend_deduction = 2 * outside_setback - bend_allowance;
  const inside_setback = Math.tan(angleRad / 2) * (radius + thickness);

  return {
    bend_allowance: Math.round(bend_allowance * 10000) / 10000,
    bend_deduction: Math.round(bend_deduction * 10000) / 10000,
    inside_setback: Math.round(inside_setback * 10000) / 10000,
  };
}

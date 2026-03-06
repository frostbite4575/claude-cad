import type { DocumentState } from '../../state/document-state.js';

/**
 * Validate that numeric inputs are finite positive numbers where required.
 * Returns an error string if validation fails, or null if OK.
 */
export function validatePositive(input: Record<string, any>, ...fields: string[]): string | null {
  for (const f of fields) {
    const val = input[f];
    if (val === undefined || val === null) return `Missing required field: ${f}`;
    if (typeof val !== 'number' || !isFinite(val)) return `${f} must be a finite number, got: ${val}`;
    if (val <= 0) return `${f} must be positive, got: ${val}`;
  }
  return null;
}

export function validateNumeric(input: Record<string, any>, ...fields: string[]): string | null {
  for (const f of fields) {
    const val = input[f];
    if (val === undefined || val === null) return `Missing required field: ${f}`;
    if (typeof val !== 'number' || !isFinite(val)) return `${f} must be a finite number, got: ${val}`;
  }
  return null;
}

export function validateRequired(input: Record<string, any>, ...fields: string[]): string | null {
  for (const f of fields) {
    if (input[f] === undefined || input[f] === null) return `Missing required field: ${f}`;
  }
  return null;
}

export function validateEntityExists(entityId: string, state: DocumentState): string | null {
  if (!state.getEntity(entityId)) return `Entity ${entityId} not found`;
  return null;
}

export function validateEnum(value: any, allowed: string[], fieldName: string): string | null {
  if (!allowed.includes(value)) return `${fieldName} must be one of: ${allowed.join(', ')}. Got: ${value}`;
  return null;
}

export function validateMinLength(arr: any[] | undefined, min: number, fieldName: string): string | null {
  if (!arr || !Array.isArray(arr)) return `${fieldName} must be an array`;
  if (arr.length < min) return `${fieldName} requires at least ${min} items, got ${arr.length}`;
  return null;
}

export function fail(error: string): string {
  return JSON.stringify({ success: false, error });
}

export function ok(data: Record<string, any>): string {
  return JSON.stringify({ success: true, ...data });
}

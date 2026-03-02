import type { OpenCascadeInstance } from './oc-init.js';

export interface StepImportResult {
  shapes: any[];
  warnings: string[];
}

/**
 * Import a STEP file and return the resulting shapes.
 * Uses Emscripten's virtual filesystem (MEMFS) to write the file, then reads it with STEPControl_Reader.
 */
export function importStep(oc: OpenCascadeInstance, stepContent: string): StepImportResult {
  const warnings: string[] = [];
  const FS = (oc as any).FS;
  const filename = '/import_temp.step';

  // Write STEP content to MEMFS
  FS.writeFile(filename, stepContent);

  try {
    const reader = new (oc as any).STEPControl_Reader_1();
    const RetDone = (oc as any).IFSelect_ReturnStatus.IFSelect_RetDone;

    // Read the file
    const readStatus = reader.ReadFile(filename);
    const readOk = readStatus?.value !== undefined
      ? readStatus.value === RetDone.value
      : readStatus === 0;

    if (!readOk) {
      reader.delete();
      throw new Error(`STEPControl_Reader.ReadFile failed with status ${JSON.stringify(readStatus)}`);
    }

    // Transfer all roots
    const nbRoots = reader.NbRootsForTransfer();
    if (nbRoots === 0) {
      reader.delete();
      throw new Error('STEP file contains no transferable roots');
    }

    reader.TransferRoots(new oc.Message_ProgressRange_1());

    const shapes: any[] = [];
    const nbShapes = reader.NbShapes();
    for (let i = 1; i <= nbShapes; i++) {
      shapes.push(reader.Shape(i));
    }

    if (shapes.length === 0) {
      warnings.push('STEP file was read but produced no shapes.');
    }

    reader.delete();
    return { shapes, warnings };
  } finally {
    // Clean up MEMFS
    try { FS.unlink(filename); } catch { /* ignore */ }
  }
}

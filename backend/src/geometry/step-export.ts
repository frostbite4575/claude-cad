import type { OpenCascadeInstance } from './oc-init.js';

export interface StepExportResult {
  stepContent: string;
  warnings: string[];
}

// Known MEMFS directories that exist at startup — not our STEP file
const MEMFS_BUILTIN = new Set(['.', '..', 'tmp', 'home', 'dev', 'proc']);

/**
 * Export one or more OC shapes to STEP format (AP203).
 * Uses Emscripten's virtual filesystem (MEMFS) to write/read the file.
 *
 * Note: STEPControl_Writer.Write() mangles the JS filename string when
 * passing it to C++, so the file lands in MEMFS under a garbled name.
 * We work around this by snapshotting the MEMFS root before/after and
 * reading whatever new file appeared.
 */
export function exportStep(oc: OpenCascadeInstance, shapes: any[]): StepExportResult {
  const warnings: string[] = [];
  const FS = (oc as any).FS;

  // Create STEP writer
  const writer = new (oc as any).STEPControl_Writer_1();

  // Set units to inches
  try {
    (oc as any).Interface_Static.SetCVal('write.step.unit', 'IN');
  } catch (err: any) {
    warnings.push(`Could not set STEP units to inches: ${err.message || String(err)}`);
  }

  // IFSelect_ReturnStatus enum — .value 0 = RetDone (success)
  const RetDone = (oc as any).IFSelect_ReturnStatus.IFSelect_RetDone;

  // Transfer each shape
  for (let i = 0; i < shapes.length; i++) {
    try {
      const status = writer.Transfer(
        shapes[i],
        (oc as any).STEPControl_StepModelType.STEPControl_AsIs,
        true // compgraph
      );
      if (status?.value !== undefined ? status.value !== RetDone.value : status !== 0) {
        warnings.push(`Shape ${i} transfer returned status ${JSON.stringify(status)}`);
      }
    } catch (err: any) {
      warnings.push(`Failed to transfer shape ${i}: ${err.message || String(err)}`);
    }
  }

  // Snapshot MEMFS root before writing
  const beforeFiles = new Set<string>(FS.readdir('/'));

  // Write to virtual filesystem (filename gets mangled by WASM string marshalling)
  const writeStatus = writer.Write('/output.step');
  const writeFailed = writeStatus?.value !== undefined
    ? writeStatus.value !== RetDone.value
    : writeStatus !== 0;
  if (writeFailed) {
    writer.delete();
    throw new Error(`STEPControl_Writer.Write failed with status ${JSON.stringify(writeStatus)}`);
  }

  // Find the new file that appeared in MEMFS root
  const afterFiles = FS.readdir('/') as string[];
  const newFiles = afterFiles.filter((f: string) => !beforeFiles.has(f) && !MEMFS_BUILTIN.has(f));

  if (newFiles.length === 0) {
    writer.delete();
    throw new Error('STEP write succeeded but no new file found in MEMFS');
  }

  // Read the new file (use the last one if multiple appeared)
  const stepFilename = '/' + newFiles[newFiles.length - 1];
  let stepContent: string;
  try {
    const data = FS.readFile(stepFilename);
    stepContent = new TextDecoder('utf-8').decode(data);
  } catch (err: any) {
    writer.delete();
    throw new Error(`Failed to read STEP file '${stepFilename}' from MEMFS: ${err.message || String(err)}`);
  }

  // Clean up
  try {
    FS.unlink(stepFilename);
  } catch {
    // Ignore cleanup errors
  }
  writer.delete();

  return { stepContent, warnings };
}

import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);

// opencascade.js doesn't declare "type":"module", use createRequire for reliable loading
const wasmPath = require.resolve('opencascade.js/dist/opencascade.wasm.wasm');
const ocModule = require('opencascade.js/dist/opencascade.wasm.js');
const opencascadeFactory = ocModule.default || ocModule;

const initOpenCascade = (): Promise<any> => {
  // Read WASM binary directly to avoid Emscripten fetch issues in Node.js
  const wasmBinary = readFileSync(wasmPath);
  return opencascadeFactory({
    wasmBinary,
  });
};

let ocInstance: any = null;

export type OpenCascadeInstance = any;

export async function initOC(): Promise<OpenCascadeInstance> {
  if (ocInstance) return ocInstance;

  console.log('Loading opencascade.js WASM (~30MB, may take a few seconds)...');
  ocInstance = await initOpenCascade();
  console.log('opencascade.js initialized');

  return ocInstance;
}

export function getOC(): OpenCascadeInstance {
  if (!ocInstance) throw new Error('OpenCascade not initialized. Call initOC() first.');
  return ocInstance;
}

export function createDemoBox(oc: OpenCascadeInstance) {
  // Create a 4x3x1 inch box centered roughly at origin
  const box = new oc.BRepPrimAPI_MakeBox_1(4, 3, 1);
  const shape = box.Shape();
  box.delete();
  return shape;
}

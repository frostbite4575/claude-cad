/**
 * WASM memory safety utility for opencascade.js objects.
 * Ensures .delete() is always called on disposable objects, even if an error occurs.
 */

/**
 * Execute a function with automatic cleanup of OpenCASCADE WASM disposables.
 * All objects in the disposables array will have .delete() called in the finally block.
 *
 * Usage:
 *   return withCleanup([maker, vec, trsf], () => {
 *     const shape = maker.Shape();
 *     return shape;
 *   });
 */
export function withCleanup<T>(disposables: { delete(): void }[], fn: () => T): T {
  try {
    return fn();
  } finally {
    for (const d of disposables) {
      try { d.delete(); } catch { /* already deleted or invalid */ }
    }
  }
}

/**
 * A collector that tracks disposable objects and cleans them up when done.
 * Useful when the number of disposables is dynamic (e.g. loops).
 *
 * Usage:
 *   const gc = new DisposableCollector();
 *   try {
 *     const p1 = gc.track(new oc.gp_Pnt_3(0, 0, 0));
 *     // ... use p1 ...
 *     return result;
 *   } finally {
 *     gc.cleanup();
 *   }
 */
export class DisposableCollector {
  private items: { delete(): void }[] = [];

  track<T extends { delete(): void }>(item: T): T {
    this.items.push(item);
    return item;
  }

  cleanup(): void {
    for (const item of this.items) {
      try { item.delete(); } catch { /* already deleted or invalid */ }
    }
    this.items = [];
  }
}

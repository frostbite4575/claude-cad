import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class SelectionService {
  private selectionSubject = new BehaviorSubject<Set<string>>(new Set());
  selection$ = this.selectionSubject.asObservable();

  /** Backward-compatible: emits the single selected ID (first in set) or null. */
  selected$ = this.selection$.pipe(
    map(set => set.size > 0 ? [...set][0] : null)
  );

  get selectedEntityId(): string | null {
    const set = this.selectionSubject.value;
    return set.size > 0 ? [...set][0] : null;
  }

  get selectedIds(): Set<string> {
    return this.selectionSubject.value;
  }

  get selectionCount(): number {
    return this.selectionSubject.value.size;
  }

  /** Single select (replaces selection). Pass null to clear. */
  select(entityId: string | null): void {
    this.selectionSubject.next(entityId ? new Set([entityId]) : new Set());
  }

  /** Toggle an entity in the selection (for Shift+Click). */
  toggle(entityId: string): void {
    const set = new Set(this.selectionSubject.value);
    if (set.has(entityId)) {
      set.delete(entityId);
    } else {
      set.add(entityId);
    }
    this.selectionSubject.next(set);
  }

  /** Clear all selections. */
  clear(): void {
    this.selectionSubject.next(new Set());
  }
}

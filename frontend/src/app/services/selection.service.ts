import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SelectionService {
  private selectedSubject = new BehaviorSubject<string | null>(null);
  selected$ = this.selectedSubject.asObservable();

  get selectedEntityId(): string | null {
    return this.selectedSubject.value;
  }

  select(entityId: string | null): void {
    this.selectedSubject.next(entityId);
  }
}

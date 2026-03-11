import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';

export interface ToolProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: any;
  minItems?: number;
  maxItems?: number;
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, ToolProperty>;
  required: string[];
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}

export interface ToolCategory {
  name: string;
  tools: ToolDef[];
}

@Injectable({ providedIn: 'root' })
export class ToolDefService {
  private categoriesSubject = new BehaviorSubject<ToolCategory[]>([]);
  categories$: Observable<ToolCategory[]> = this.categoriesSubject.asObservable();
  private loaded = false;

  constructor(private http: HttpClient) {}

  fetchToolDefs(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.http.get<{ categories: ToolCategory[] }>('/api/tool-defs').subscribe({
      next: (res) => this.categoriesSubject.next(res.categories),
      error: (err) => {
        console.error('Failed to fetch tool definitions:', err);
        this.loaded = false;
      },
    });
  }

  get categories(): ToolCategory[] {
    return this.categoriesSubject.value;
  }
}

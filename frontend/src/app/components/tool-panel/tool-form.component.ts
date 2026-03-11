import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ToolDef, ToolProperty } from '../../services/tool-def.service';
import { SelectionService } from '../../services/selection.service';

export interface FieldDef {
  key: string;
  label: string;
  description: string;
  required: boolean;
  widget: 'number' | 'text' | 'select' | 'checkbox' | 'points' | 'number-array' | 'string-array';
  options?: string[];
  isEntityId: boolean;
}

@Component({
  selector: 'app-tool-form',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './tool-form.component.html',
  styleUrl: './tool-form.component.scss',
})
export class ToolFormComponent implements OnChanges, OnInit, OnDestroy {
  @Input() tool!: ToolDef;
  @Output() execute = new EventEmitter<{ tool: string; input: Record<string, any> }>();

  form = new FormGroup<Record<string, FormControl>>({});
  fields: FieldDef[] = [];

  private selSub?: Subscription;
  private entityIdFields: string[] = [];
  private userEdited = new Set<string>();

  constructor(private selectionService: SelectionService) {}

  ngOnInit() {
    this.selSub = this.selectionService.selection$.subscribe((ids) => {
      this.autoFillEntityIds(ids);
    });
  }

  ngOnDestroy() {
    this.selSub?.unsubscribe();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['tool'] && this.tool) {
      this.buildForm();
    }
  }

  private buildForm() {
    const schema = this.tool.input_schema;
    const props = schema.properties || {};
    const required = new Set(schema.required || []);

    this.fields = [];
    this.entityIdFields = [];
    this.userEdited.clear();
    const controls: Record<string, FormControl> = {};

    for (const [key, prop] of Object.entries(props)) {
      const field = this.buildField(key, prop, required.has(key));
      this.fields.push(field);

      const defaultValue = field.widget === 'checkbox' ? false : '';
      const validators = field.required ? [Validators.required] : [];
      controls[key] = new FormControl(defaultValue, validators);

      if (field.isEntityId) {
        this.entityIdFields.push(key);
      }
    }

    this.form = new FormGroup(controls);

    // Track user edits to entity_id fields
    for (const key of this.entityIdFields) {
      controls[key].valueChanges.subscribe(() => {
        this.userEdited.add(key);
      });
    }

    // Initial auto-fill
    this.autoFillEntityIds(this.selectionService.selectedIds);
  }

  private buildField(key: string, prop: ToolProperty, isRequired: boolean): FieldDef {
    const label = this.formatLabel(key);
    const description = prop.description || '';
    const isEntityId = /entity_id|profile_id|spine_id/.test(key);

    // Determine widget type
    let widget: FieldDef['widget'] = 'text';
    let options: string[] | undefined;

    if (prop.type === 'number') {
      widget = 'number';
    } else if (prop.type === 'boolean') {
      widget = 'checkbox';
    } else if (prop.type === 'string' && prop.enum) {
      widget = 'select';
      options = prop.enum;
    } else if (prop.type === 'array') {
      if (prop.items?.type === 'array') {
        // Nested array (e.g. polygon points [[x,y], ...])
        widget = 'points';
      } else if (prop.items?.type === 'number') {
        widget = 'number-array';
      } else {
        widget = 'string-array';
      }
    }

    return { key, label, description, required: isRequired, widget, options, isEntityId };
  }

  private autoFillEntityIds(ids: Set<string>) {
    const idArray = [...ids];
    for (let i = 0; i < this.entityIdFields.length; i++) {
      const key = this.entityIdFields[i];
      if (this.userEdited.has(key)) continue;

      const control = this.form.get(key);
      if (!control) continue;

      // entity_id_2 / second entity field gets the second selection
      const isSecondEntity = /entity_id_2|spine_id/.test(key);
      const value = isSecondEntity ? (idArray[1] || '') : (idArray[0] || '');
      control.setValue(value, { emitEvent: false });
    }
  }

  submit() {
    if (this.form.invalid) return;

    const raw = this.form.getRawValue();
    const input: Record<string, any> = {};

    for (const field of this.fields) {
      const value = raw[field.key];

      // Skip empty optional fields
      if (!field.required && (value === '' || value === null || value === undefined)) continue;

      switch (field.widget) {
        case 'number':
          input[field.key] = parseFloat(value);
          break;
        case 'checkbox':
          input[field.key] = !!value;
          break;
        case 'points':
          // Parse "x,y" per line into [[x,y], ...]
          input[field.key] = (value as string)
            .split('\n')
            .filter((l: string) => l.trim())
            .map((l: string) => l.split(',').map((n: string) => parseFloat(n.trim())));
          break;
        case 'number-array':
          input[field.key] = (value as string)
            .split(',')
            .filter((s: string) => s.trim())
            .map((s: string) => parseFloat(s.trim()));
          break;
        case 'string-array':
          input[field.key] = (value as string)
            .split(',')
            .map((s: string) => s.trim())
            .filter((s: string) => s);
          break;
        default:
          input[field.key] = value;
      }
    }

    this.execute.emit({ tool: this.tool.name, input });
  }

  private formatLabel(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

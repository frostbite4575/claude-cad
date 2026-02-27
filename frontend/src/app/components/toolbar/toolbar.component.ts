import { Component } from '@angular/core';

@Component({
  selector: 'app-toolbar',
  imports: [],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss'
})
export class ToolbarComponent {
  exportDxf(): void {
    const a = document.createElement('a');
    a.href = '/api/export/dxf';
    a.download = 'export.dxf';
    a.click();
  }
}

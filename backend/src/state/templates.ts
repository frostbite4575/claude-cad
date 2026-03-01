import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

export interface PartTemplate {
  name: string;
  description: string;
  type: 'flat_profile' | 'box' | 'cylinder' | 'sheet_metal' | 'custom';
  parameters: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

// Ensure templates directory exists
function ensureDir() {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  }
}

function templatePath(name: string): string {
  // Sanitize name for filesystem
  const safe = name.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();
  return path.join(TEMPLATES_DIR, `${safe}.json`);
}

export function saveTemplate(template: PartTemplate): { success: boolean; path: string } {
  ensureDir();
  const filePath = templatePath(template.name);
  template.updatedAt = new Date().toISOString();
  if (!template.createdAt) {
    template.createdAt = template.updatedAt;
  }
  fs.writeFileSync(filePath, JSON.stringify(template, null, 2));
  return { success: true, path: filePath };
}

export function loadTemplate(name: string): PartTemplate | null {
  const filePath = templatePath(name);
  if (!fs.existsSync(filePath)) {
    // Try case-insensitive search
    ensureDir();
    const files = fs.readdirSync(TEMPLATES_DIR);
    const safeName = name.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();
    const match = files.find(f => f.replace('.json', '') === safeName);
    if (!match) return null;
    const content = fs.readFileSync(path.join(TEMPLATES_DIR, match), 'utf-8');
    return JSON.parse(content);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

export function listTemplates(): PartTemplate[] {
  ensureDir();
  const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json'));
  const templates: PartTemplate[] = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8');
      templates.push(JSON.parse(content));
    } catch {
      // Skip invalid files
    }
  }
  return templates.sort((a, b) => a.name.localeCompare(b.name));
}

export function deleteTemplate(name: string): boolean {
  const filePath = templatePath(name);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

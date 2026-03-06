# Claude CAD

An AI-first browser-based general-purpose 3D CAD tool. Talk to Claude in natural language to build 3D geometry, or use traditional CAD tools manually. Supports full 3D modeling, 2D sketching, sheet metal, and multiple export formats (DXF, STEP, STL).

## Architecture

```
Angular 19 Frontend (UI + Three.js viewport)
        ↕ HTTP / WebSocket
Node.js Backend
  ├── opencascade.js (WASM geometry kernel)
  ├── Anthropic API (Claude AI agent)
  └── MCP tool execution layer
```

- **Frontend:** Angular 19, Three.js 3D viewport, dark three-panel layout (toolbar | viewport | chat)
- **Backend:** Node.js + Express, opencascade.js (OpenCASCADE compiled to WASM), WebSocket for real-time mesh updates
- **AI:** Claude via Anthropic API with an agentic tool-use loop
- **Units:** Configurable (inches default, mm supported)

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- An [Anthropic API key](https://console.anthropic.com/)

### Setup

```bash
# Clone the repo
git clone https://github.com/frostbite4575/claude-cad.git
cd claude-cad

# Backend
cd backend
npm install
cp .env.example .env        # add your ANTHROPIC_API_KEY
npm run dev                  # starts on :3000

# Frontend (in a second terminal)
cd frontend
npm install
ng serve                     # starts on :4200, proxies API to :3000
```

Open [http://localhost:4200](http://localhost:4200) in your browser.

## Features

### AI Tools (60+)

Talk to Claude in the chat panel to create and manipulate geometry:

| Category | Tools |
|----------|-------|
| **Primitives** | `create_box`, `create_cylinder`, `create_sphere`, `create_polygon` |
| **2D Sketching** | `sketch_line`, `sketch_rectangle`, `sketch_circle`, `sketch_arc`, `sketch_polyline`, `create_flat_profile` |
| **Modeling** | `extrude`, `revolve`, `shell`, `loft`, `sweep` |
| **Booleans** | `boolean_union`, `boolean_subtract`, `boolean_intersect` |
| **Modifiers** | `fillet`, `chamfer` |
| **Transforms** | `translate`, `rotate`, `scale`, `mirror`, `linear_pattern`, `circular_pattern`, `duplicate_entity` |
| **Cutouts** | `cut_hole`, `cut_bolt_hole`, `cut_slot`, `cut_pattern_linear`, `cut_pattern_circular` |
| **Sheet Metal** | `create_sheet_metal_plate`, `add_bend_line`, `fold_sheet_metal`, `get_flat_pattern` |
| **Scene** | `get_scene_info`, `delete_entity`, `rename_entity`, `set_units`, `undo`, `redo` |
| **Export/Import** | `export_dxf`, `export_step`, `export_stl`, `import_dxf`, `import_step` |
| **Measurement** | `measure_distance`, `measure_entity`, `estimate_weight`, `estimate_cost` |
| **Templates** | `save_template`, `load_template`, `list_templates`, `delete_template` |

### Example Prompts

- "Create a 6x4x2 inch box"
- "Draw a circle at 1,1 radius 0.5 and extrude it 3 inches"
- "Subtract the cylinder from the box"
- "Fillet the vertical edges with radius 0.25"
- "Mirror the part across the YZ plane"
- "Revolve a profile sketch into a vase shape"
- "Export as STEP for Fusion 360"

### Geometry Pipeline

```
Tool call (AI or manual)
  → opencascade.js BRep kernel (server-side WASM)
  → Tessellation → vertices + triangles + edge lines
  → WebSocket → Three.js BufferGeometry
  → GPU render with CAD-style edge lines
```

All BRep/NURBS math runs on the backend. The browser only renders triangle meshes with edge overlays.

### Rendering

- **Solids:** Shaded mesh with black edge lines
- **Sketches:** Cyan wireframe with translucent fill
- Undo/redo via Ctrl+Z / Ctrl+Y

## Project Structure

```
CAD-system/
├── frontend/                # Angular 19 app
│   └── src/app/
│       ├── components/      # viewport, chat panel, toolbar
│       ├── services/        # WebSocket, geometry, API
│       └── models/          # TypeScript interfaces
├── backend/                 # Node.js server
│   └── src/
│       ├── geometry/        # OC wrappers: primitives, booleans, transforms,
│       │                    #   sketches, fillets, tessellator, DXF/STEP/STL export
│       ├── ai/              # Anthropic client, agent loop, 60+ tool definitions
│       │   └── tools/       # Domain-specific tool modules
│       ├── materials/       # Material database, bend calculations
│       └── state/           # Document state, undo/redo manager, templates
└── shared/                  # Shared TypeScript types
```

## Export Formats

- **DXF** — Lines, arcs, and circles only (no splines). Optional layer classification (OUTSIDE/INSIDE) for CNC workflows.
- **STEP** — Full 3D geometry for interchange with SolidWorks, Fusion 360, FreeCAD, etc.
- **STL** — Triangulated mesh for 3D printing.

## Tech Stack

- [Angular 19](https://angular.dev/)
- [Three.js](https://threejs.org/)
- [opencascade.js](https://github.com/nicholasgasior/opencascade.js) (OpenCASCADE WASM)
- [Anthropic Claude API](https://docs.anthropic.com/)
- Node.js + Express + WebSocket

## License

MIT

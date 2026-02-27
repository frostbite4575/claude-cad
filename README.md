# Claude CAD

An AI-first browser-based CAD tool for metal fabrication and plasma cutting. Talk to Claude in natural language to build 3D geometry, or use traditional CAD tools manually. Primary output is DXF flat patterns in inches for Hypertherm plasma tables, fed into ProNest nesting software.

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
- **Units:** Inches throughout

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

### AI Tools (24)

Talk to Claude in the chat panel to create and manipulate geometry:

| Category | Tools |
|----------|-------|
| **Primitives** | `create_box`, `create_cylinder`, `create_sphere`, `create_polygon` |
| **2D Sketching** | `sketch_line`, `sketch_rectangle`, `sketch_circle`, `sketch_arc`, `extrude` |
| **Booleans** | `boolean_union`, `boolean_subtract`, `boolean_intersect` |
| **Modifiers** | `fillet`, `chamfer` |
| **Transforms** | `translate`, `rotate`, `mirror`, `linear_pattern`, `circular_pattern` |
| **Scene** | `get_scene_info`, `delete_entity`, `undo`, `redo` |
| **Export** | `export_dxf`, `export_step` |

### Example Prompts

- "Create a 6x4x0.25 inch plate"
- "Draw a circle at 1,1 radius 0.5 and create a circular pattern of 6 around the origin"
- "Subtract the holes from the plate"
- "Mirror the part across the YZ plane"
- "Export as DXF for the plasma table"

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
│       │                    #   sketches, fillets, tessellator, DXF/STEP export
│       ├── ai/              # Anthropic client, agent loop, 24 tool definitions
│       └── state/           # Document state, undo/redo manager
└── shared/                  # Shared TypeScript types
```

## Export Formats

- **DXF** — Lines, arcs, and circles only (no splines). Designed for plasma table compatibility with ProNest.
- **STEP** — Full 3D geometry for interchange with SolidWorks, Fusion 360, FreeCAD, etc.

## Tech Stack

- [Angular 19](https://angular.dev/)
- [Three.js](https://threejs.org/)
- [opencascade.js](https://github.com/nicholasgasior/opencascade.js) (OpenCASCADE WASM)
- [Anthropic Claude API](https://docs.anthropic.com/)
- Node.js + Express + WebSocket

## License

MIT

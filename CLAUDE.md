# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude CAD — an AI-first browser-based general-purpose 3D CAD tool. Two interaction modes: natural language chat (Claude builds geometry via MCP tools) and traditional manual CAD tools (click-to-draw). Supports full 3D modeling, 2D sketching, sheet metal, and multiple export formats (DXF, STEP, STL).

## Architecture

```
Angular 19 Frontend (UI + Three.js viewport)
        ↕ HTTP / WebSocket
Node.js Backend
  ├── opencascade.js (WASM geometry kernel)
  ├── Anthropic API (Claude AI agent)
  └── MCP tool execution layer
```

- **Frontend:** Angular 19, Three.js for 3D rendering, left toolbar + center viewport + right chat panel
- **Backend:** Node.js, opencascade.js (OpenCASCADE compiled to WASM running server-side), Express or similar
- **AI:** Claude via Anthropic API, API key stored server-side only
- **Units:** Configurable (inches default, mm supported)
- **Package manager:** npm

## Geometry Pipeline

```
Tool call (AI or manual) → opencascade.js on Node.js backend
  → BRepMesh_IncrementalMesh tessellation
  → vertices + triangle indices + edge data
  → JSON or binary over WebSocket to browser
  → THREE.BufferGeometry + THREE.LineSegments (edge lines for CAD look)
  → GPU renders in viewport
```

BRep/NURBS math stays on the backend for precision. Browser only receives and renders triangle meshes. Always extract edges separately and render as LineSegments on top of shaded mesh for CAD appearance. Call `computeVertexNormals()` on all geometry for correct curved surface lighting.

## CAD Features (Full 3D Modeling)

- 2D sketching: lines, arcs, circles, rectangles, polylines on configurable planes (XY/XZ/YZ)
- Extrude (boss and cut), revolve, shell, loft, sweep
- Boolean operations (union, subtract, intersect)
- Fillet and chamfer (with edge filtering)
- Mirror, linear pattern, circular pattern
- Cutout tools: holes, bolt holes, slots, pattern cuts
- Sheet metal module: plates, bend lines, fold, flat pattern
- DXF export (arcs and lines only — no splines) with optional layer classification
- STEP export (full 3D interchange)
- STL export (3D printing)
- DXF/STEP import
- Templates, nesting, weight/cost estimation

## AI Agent Loop

```javascript
while (true) {
  const response = await anthropic.messages.create({ messages, tools });
  messages.push(response);
  if (response.stop_reason === 'end_turn') break;
  const results = await executeMCPTools(response.tool_calls);
  messages.push({ role: 'user', content: results });
}
```

The MCP server maintains full document state in memory. Every tool response returns: entity IDs, success/failure, human-readable description, key dimensions. Claude uses this to self-verify before the next tool call.

## Build Commands

```bash
# Frontend
cd frontend
npm install
ng serve                    # dev server at localhost:4200
ng build                    # production build
ng test                     # unit tests (Karma)
ng test --include='**/specific.spec.ts'  # single test file

# Backend
cd backend
npm install
npm run dev                 # dev server with hot reload
npm test                    # tests
```

## Project Structure

```
CAD-system/
├── frontend/               # Angular 19 app
│   └── src/
│       ├── app/
│       │   ├── components/  # UI components (toolbar, viewport, chat panel)
│       │   ├── services/    # geometry service, API service, state management
│       │   └── models/      # TypeScript interfaces for geometry, tools, etc.
│       └── assets/
├── backend/                # Node.js server
│   └── src/
│       ├── geometry/       # opencascade.js wrapper, tessellation, export
│       ├── ai/             # Anthropic API integration, agent loop, tool modules
│       │   └── tools/      # Domain-specific tool modules (primitives, booleans, etc.)
│       ├── routes/         # Express API routes
│       └── state/          # Document state management
└── shared/                 # Shared TypeScript types between frontend/backend
```

## Key Design Decisions

- **State management:** Backend maintains full document state (feature tree, entity registry). State summary sent to Claude on every agent turn. Design entity ID system to be stable across operations.
- **Error recovery:** Checkpoint-based undo/redo. Both AI and manual operations use the same undo stack.
- **DXF export:** Output format is arcs-and-lines only (no splines). Optional layer classification (OUTSIDE/INSIDE) for CNC workflows.
- **Sheet metal module:** Optional module with materials/tooling lookup table (thickness, bend radius, bend allowance) for accurate flat pattern unfolding.

## Reference Documents

The three markdown files in the project root are planning notes from early conversations — not specs:
- `claude-cad-project.md` — architecture overview and tech stack rationale
- `claude-cad-design-decisions.md` — tradeoff analysis for 12 key design questions
- `claude-cad-questions.md` — technical Q&A reference (BRep, tessellation, kernels, etc.)

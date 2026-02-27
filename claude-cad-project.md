# Claude CAD — Project Overview

## What We're Building

An AI-first, browser-based CAD tool designed specifically for metal fabrication and plasma cutting workflows. Instead of the traditional approach where a user clicks through toolbars and menus, Claude acts as the interface — you describe what you want in natural language, and Claude builds it using a set of CAD tools exposed via MCP (Model Context Protocol).

The end goal is a system where a fabricator can say *"make me a 12x6 inch bracket with four 3/8 holes in the corners and a 2 inch slot in the center"* and receive a finished flat pattern DXF file ready for the plasma table — without touching a single CAD toolbar.

---

## The Problem We're Solving

At a metal fab shop like Manac, the workflow from design idea to plasma cut part involves:

1. Opening a full CAD program (Solid Edge, Inventor, etc.)
2. Manually sketching and constraining geometry
3. Generating a flat pattern
4. Exporting a DXF
5. Importing that DXF into nesting software
6. Arranging parts on available scrap
7. Sending to the plasma cutter

Steps 1–4 are a significant bottleneck for simple, repetitive parts. A fabricator with no CAD training can't do them. An AI-driven tool collapses steps 1–4 into a single natural language conversation.

---

## Architecture

The architecture mirrors what Onshape does under the hood — but built with open source components and designed from the ground up for AI-first interaction.

```
User (natural language)
        ↓
Claude (via Anthropic API)
        ↓
MCP Server (Node.js)
        ↓
OpenCASCADE geometry kernel (pythonOCC or opencascade.js)
        ↓
Tessellator → mesh data → Three.js viewport (Angular frontend)
        ↓
DXF / flat pattern export → nesting pipeline → plasma cutter
```

### How Onshape compares

| Component         | Onshape              | Claude CAD           |
|-------------------|----------------------|----------------------|
| Geometry kernel   | Parasolid (on AWS)   | OpenCASCADE (local)  |
| Viewport renderer | Custom WebGL         | Three.js (WebGL)     |
| AI layer          | None (user drives)   | Claude via API       |
| Interface         | Toolbar / GUI        | Natural language      |
| File output       | DXF, STEP, etc.      | DXF (primary target) |

---

## Tech Stack

### Backend
- **Node.js** — MCP server and API layer
- **OpenCASCADE (OCCT)** — geometry kernel via `pythonOCC` (Python bindings) or `opencascade.js` (WASM compiled for browser/Node)
- Handles all solid modeling math: BRep, NURBS surfaces, boolean operations, flat pattern unfolding, DXF export

### Frontend
- **Angular** — application framework
- **Three.js** — 3D viewport rendering via WebGL
- Receives tessellated mesh data from the backend and renders it in the browser
- No expensive GPU or workstation required

### AI Layer
- **Claude** via Anthropic API
- Given a set of MCP tools it can call to build geometry
- Reasons about the user's intent and chains tool calls together
- Same agent loop pattern as Claude Code: think → act → observe → repeat

### MCP Tools (planned)
```
create_sketch
add_line / add_arc / add_circle
add_constraint (parallel, tangent, equal, coincident)
extrude
boolean_subtract / boolean_union
add_fillet
mirror / pattern
unfold_sheet_metal
export_dxf
export_step
```

---

## Key Concepts

### BRep (Boundary Representation)
How OpenCASCADE stores geometry internally. Instead of describing the inside of a solid, it describes the skin — faces, edges, and vertices that form a watertight shell. Precise and editable, but not directly drawable by a GPU.

### NURBS
The math used to describe curved surfaces and edges in BRep. Mathematically exact — a cylinder isn't approximated, it's described with an equation. Allows precise manufacturing output.

### Tessellation
The process of converting BRep/NURBS geometry into triangles that a GPU can draw. OpenCASCADE's `BRepMesh_IncrementalMesh` handles this. Lower deflection tolerance = more triangles = smoother curves.

### WebGL / Three.js
WebGL is the browser-native API for talking to the GPU — the browser equivalent of what Solid Edge uses OpenGL for and Inventor uses DirectX for. Three.js is a JavaScript library that wraps WebGL into a friendly API. Tessellated mesh data from OCCT gets loaded into `THREE.BufferGeometry` and rendered in the viewport.

### The Agent Loop
Borrowed from Claude Code's architecture. Claude receives a task, calls MCP tools, observes the results, and continues until the task is complete. The loop:
```
User request
    → Claude reasons about what tools to call
    → MCP tool executes (e.g. create_sketch, add_line)
    → Result fed back to Claude
    → Claude calls next tool
    → Repeat until DXF is ready
```

---

## Why Not Just Use Onshape's API?

Onshape has a full REST API and is built on Parasolid — the same kernel used by Solid Edge and SolidWorks. An MCP server wrapping the Onshape API is a valid and faster path to a working prototype, and was the original approach explored.

**Pros of Onshape API approach:**
- Parasolid quality geometry for free (on the free tier)
- No need to manage a geometry kernel yourself
- DXF and flat pattern export already built in
- Well documented REST API with Node.js samples

**Cons:**
- Dependent on Onshape's servers and free tier limits
- Feature creation API uses internal `btType` parameter structures that are complex and undocumented
- Less control over the full pipeline
- Not truly self-hosted

**The ground-up approach** gives full control, works offline (important for a shop floor), and builds toward a system that could be tailored specifically to trailer fabrication workflows.

**Recommended path:** Start with the Onshape API for prototyping and validating the concept. Once the MCP tool interface is proven out, migrate the geometry layer to OpenCASCADE for a self-hosted production version.

---

## Phase 1 — Prototype (Onshape API)

- [ ] Set up Onshape free account and developer portal API keys
- [ ] Build Node.js MCP server with basic Onshape REST wrappers
- [ ] Implement tools: `create_document`, `create_sketch`, `add_extrude`, `export_dxf`
- [ ] Test Claude driving part creation via MCP tools
- [ ] Validate DXF output quality for plasma cutting

## Phase 2 — Ground-Up Build

- [ ] Set up OpenCASCADE via pythonOCC or opencascade.js
- [ ] Build tessellation pipeline: OCCT solid → triangle mesh → JSON
- [ ] Integrate Three.js viewport in Angular frontend
- [ ] Port MCP tools to use OCCT instead of Onshape API
- [ ] Implement constraint solver for 2D sketching
- [ ] Implement sheet metal unfolding and DXF export

## Phase 3 — Nesting Integration

- [ ] Connect DXF output to nesting software (DeepNest or custom)
- [ ] Build scrap inventory awareness into the pipeline
- [ ] Full workflow: natural language → part → nested DXF → plasma cutter

---

## Reference: How the Big Programs Do It

| Program     | Geometry Kernel | Renderer         | Platform  |
|-------------|-----------------|------------------|-----------|
| Solid Edge  | Parasolid       | OpenGL           | Windows   |
| Inventor    | ShapeManager*   | DirectX / OGS    | Windows   |
| SolidWorks  | Parasolid       | OpenGL           | Windows   |
| Onshape     | Parasolid       | WebGL (custom)   | Browser   |
| FreeCAD     | OpenCASCADE     | OpenGL           | Cross-platform |
| **Claude CAD** | **OpenCASCADE** | **WebGL / Three.js** | **Browser** |

*ShapeManager is Autodesk's internal fork of ACIS

---

## Notes

- Parasolid and ACIS dominate the commercial kernel market. Licensing Parasolid directly costs tens of thousands of dollars per year — it's aimed at companies building commercial CAD products, not individuals.
- OpenCASCADE is the only serious open source alternative. It powers FreeCAD and was salvaged from an abandoned French CAD program in 1998.
- Three.js is the right choice for the renderer — it's WebGL under the hood, the same technology Onshape uses, just with a friendlier API that saves significant development time.
- The constraint solver (what makes sketch lines snap parallel, tangent, etc.) is its own hard problem. SolveSpace has an open source solver worth investigating for Phase 2.

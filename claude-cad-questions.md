# Claude CAD — Questions & Answers Reference

A running log of important questions and answers from the initial project planning conversations. Use this as a reference when making design decisions during development.

---

## Table of Contents

1. [How is Claude Code built?](#how-is-claude-code-built)
2. [Can I build a Claude CAD using the same techniques?](#can-i-build-a-claude-cad-using-the-same-techniques)
3. [Does Onshape have an API?](#does-onshape-have-an-api)
4. [What does it take to build a CAD program from the ground up?](#what-does-it-take-to-build-a-cad-program-from-the-ground-up)
5. [How does OCCT geometry get rendered in Three.js?](#how-does-occt-geometry-get-rendered-in-threejs)
6. [Explain BRep, NURBS, GPU triangles, tessellation, Float32Array](#explain-brep-nurbs-gpu-triangles-tessellation-float32array)
7. [What kernels and renderers do Solid Edge, Inventor, and Onshape use?](#what-kernels-and-renderers-do-solid-edge-inventor-and-onshape-use)
8. [How do they render it?](#how-do-they-render-it)
9. [Why is Solid Edge so bad and crashes so much?](#why-is-solid-edge-so-bad-and-crashes-so-much)
10. [What is NX and how would you fix those problems in a modern way?](#what-is-nx-and-how-would-you-fix-those-problems-in-a-modern-way)
11. [Should I start 2D then go 3D or go 3D from the start?](#should-i-start-2d-then-go-3d-or-go-3d-from-the-start)
12. [Will I run into hardware problems?](#will-i-run-into-hardware-problems)
13. [Questions I should be asking that I haven't yet](#questions-i-should-be-asking-that-i-havent-yet)

---

## How is Claude Code built?

Claude Code started as an internal tool at Anthropic — originally a command line script that told an engineer what music was playing. Once it got filesystem access it spread rapidly and 50% of Anthropic's engineering team was using it within days.

**Tech stack:** TypeScript, React, Ink, Yoga, and Bun. Ships as a single `cli.js` file (~10.5MB) that bundles the agent logic, platform-specific ripgrep binaries for file search, and Tree-sitter WASM modules for code parsing. Zero external dependencies.

**Core architecture — the agent loop:**
```javascript
while (true) {
  const response = await callAPI(messages);
  messages.push(response);
  if (response.stop_reason === "end_turn") break;
  const results = await executeTools(response);
  messages.push({ role: "user", content: results });
}
```
Everything — multi-step tasks, error recovery, iterative refinement — emerges from this simple loop. The model decides what to do. The loop executes those decisions. Results feed back. Repeat.

**Planning:** Uses TodoWrite to create structured task lists before executing. The UI renders these as interactive checklists.

**Sub-agents:** Spawned via the Task tool for parallel execution, sequential pipelines, and git worktree isolation.

**Development pace:** ~60-100 internal releases per day. ~5 PRs per engineer per day. 90% of the code is written by Claude Code itself.

---

## Can I build a Claude CAD using the same techniques?

Yes. The architecture maps directly:

| Claude Code | Claude CAD |
|---|---|
| Tools: ReadFile, EditFile, Bash | Tools: CreateSketch, ExtrudeFeature, AddHole |
| Manipulates files and terminal | Manipulates geometry via CAD kernel API |
| Renders output as terminal text | Renders output as 3D viewport |
| Agent loop unchanged | Agent loop unchanged |

The MCP server approach is the right path — an MCP server wrapping a CAD program's API, with Claude using those tools to build geometry from natural language descriptions.

---

## Does Onshape have an API?

Yes — Onshape has a very rich REST API built in from the ground up since it's cloud-native.

**Key facts:**
- Authentication via API keys or OAuth2
- Developer portal at `https://cad.onshape.com/appstore/dev-portal`
- Sample code in Python, Node.js, Java, and C#
- API Explorer (Glassworks) for testing calls interactively
- Can create documents, part studios, features, and export files programmatically

**Three integration patterns:**
1. **File exchange** — import/export in various formats
2. **Live link** — server app reads/writes Onshape data via REST
3. **In-tab** — web app embedded inside the Onshape UI

**Forum insight — the "build it manually first" method:**
The feature creation API uses internal `btType` parameter structures that aren't well documented. The recommended approach: build the part manually in Onshape first, call the feature list API to get back the full JSON representation, then use that as a template for programmatic creation.

**Node.js architecture:**
```
Client (frontend / Claude)
    → Node/Express middleware server
        → Onshape REST API
```
Keep API keys server-side in the middleware layer.

**Why Onshape API is attractive for prototyping:** You get Parasolid-quality geometry through a free API tier — licensing Parasolid directly would cost tens of thousands of dollars per year.

---

## What does it take to build a CAD program from the ground up?

**The core problem: the geometry kernel**

Everything in CAD depends on a geometry kernel — the math engine that represents 3D shapes. Building one from scratch is PhD-level work. Realistic options:

- **OpenCASCADE (OCCT)** — most capable open source kernel, what FreeCAD uses, C++ with Python bindings. The right choice for a serious build.
- **libfive** — newer, uses signed distance functions instead of BRep. Easier but less capable for manufacturing.

**The layers of a full CAD program (bottom to top):**
1. Geometry kernel — the math
2. Parametric feature tree — tracks operation history for rebuilding
3. Constraint solver — 2D sketch engine (parallel lines, tangent circles, etc.)
4. 3D renderer — real-time visualization
5. File I/O — STEP, DXF, STL, etc.
6. UI — the interface

**The AI-first architecture flips the model:**

Traditional: `User clicks → UI → Feature tree → Kernel → Geometry`

Claude CAD: `User describes → Claude → MCP tools → Kernel API → Geometry → Renderer`

Claude becomes the UI. You never need to build a sketch toolbar or feature manager. Claude handles intent, the kernel handles math, you just need a viewport.

**Realistic tech stack:**
- Backend: Node.js or Python wrapping OpenCASCADE
- Renderer: Three.js (convert OCCT mesh to `THREE.BufferGeometry`)
- MCP server: tools like `create_sketch`, `extrude`, `boolean_subtract`, `export_dxf`
- AI: Claude via Anthropic API
- Frontend: Angular with Three.js viewport

**Difficulty breakdown:**

| Component | Difficulty |
|---|---|
| OpenCASCADE bindings | Hard |
| Parametric feature tree | Hard |
| Constraint solver | Very Hard |
| DXF flat pattern export | Medium |
| Three.js renderer | Medium |
| MCP server | Easy |
| Claude integration | Easy |

**Practical scope for your use case:** You don't need full parametric 3D solid modeling. You need 3D solid modeling → sheet metal unfold → flat pattern → DXF. That's a much narrower and more achievable scope.

---

## How does OCCT geometry get rendered in Three.js?

**The pipeline:**
```
OCCT Solid (BRep math)
        ↓
BRepMesh_IncrementalMesh (tessellate)
        ↓
Extract vertices + triangle indices
        ↓
JSON/binary over HTTP or WebSocket
        ↓
THREE.BufferGeometry
        ↓
GPU renders triangles
```

**Tessellation in Python:**
```python
from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh

mesh = BRepMesh_IncrementalMesh(shape, 0.1)  # 0.1mm deflection tolerance
mesh.Perform()
# Then traverse faces to extract vertex/triangle data
```

**Loading into Three.js:**
```javascript
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
geometry.setIndex(indices);
geometry.computeVertexNormals(); // important for lighting on curved surfaces

const mesh = new THREE.Mesh(
  geometry,
  new THREE.MeshStandardMaterial({ color: 0x888888 })
);
scene.add(mesh);
```

**For CAD appearance (visible edges):** Extract edges separately from OCCT and render as `THREE.LineSegments` on top of the shaded mesh. This gives the hard edge lines that make it look like CAD rather than a blob.

**Key insight:** The BRep/NURBS math stays on the server for precise operations (measuring, exporting DXF, boolean operations). The triangles are only for your eyes.

---

## Explain BRep, NURBS, GPU triangles, tessellation, Float32Array

**BRep (Boundary Representation)**
Describes a solid by its skin — the faces, edges, and vertices that form the outside boundary. Everything inside is implied to be solid material. Used by all serious CAD kernels because it's precise, lightweight, and editable.

**NURBS (Non-Uniform Rational B-Splines)**
The math for describing smooth curved surfaces using control points. Like a flexible rod clamped at certain points — the curve bends smoothly between them. Mathematically exact — a cylinder isn't approximated, it's described perfectly with an equation.

**Why GPUs only draw triangles**
GPUs are parallel calculators optimized for one operation: take three points in space, determine which pixels fall inside that triangle, color them. Three points always define a flat plane unambiguously (four might not be coplanar), so triangles are the universal primitive. Your GPU has no concept of "cylinder" — everything must be converted to triangles first.

**Tessellation**
Converting smooth mathematical geometry (BRep/NURBS) into triangles the GPU can draw. Like approximating a sphere with a geodesic dome — more triangles = smoother, fewer = visible facets. The quality/performance tradeoff is the tessellation deflection tolerance setting.

**Float32Array**
A typed JavaScript array that holds only 32-bit floating point numbers, packed tightly in memory. Unlike regular JavaScript arrays (flexible but slow), `Float32Array` can be read directly by the GPU. Essential for passing geometry data efficiently.
```javascript
// Regular array — flexible, slow, GPU can't read directly
[1.0, 0.0, 0.0, 0.0, 1.0, 0.0]

// Float32Array — rigid, fast, GPU-ready
new Float32Array([1.0, 0.0, 0.0, 0.0, 1.0, 0.0])
```

---

## What kernels and renderers do Solid Edge, Inventor, and Onshape use?

| Program | Geometry Kernel | Renderer | Platform |
|---|---|---|---|
| Solid Edge | Parasolid (Siemens) | OpenGL primary, DirectX secondary | Windows |
| Inventor | ShapeManager (Autodesk fork of ACIS) | DirectX / OGS system | Windows |
| SolidWorks | Parasolid | OpenGL | Windows |
| Onshape | Parasolid (on AWS) | WebGL (custom) | Browser |
| FreeCAD | OpenCASCADE | OpenGL | Cross-platform |
| **Claude CAD** | **OpenCASCADE** | **WebGL / Three.js** | **Browser** |

**The kernel market:**
- **Parasolid** (Siemens) — the gold standard, used by Solid Edge, NX, SolidWorks, Onshape
- **ACIS** (originally, now owned by Siemens/Spatial) — once dominant, lost ground
- **ShapeManager** — Autodesk's internal ACIS fork, not licensed externally
- **Granite** — PTC's proprietary kernel for Creo
- **CGM** — Dassault's proprietary kernel for CATIA
- **OpenCASCADE** — only serious open source option

Licensing Parasolid directly costs tens of thousands of dollars per year. OpenCASCADE is free.

---

## How do they render it?

**Onshape:** Uses WebGL in the browser for the interactive viewport. Parasolid runs natively on AWS — geometry math is server-side, only tessellated mesh data is sent to the browser. Photorealistic rendering (Render Studio) uses NVIDIA Iray running on cloud GPU servers.

**Solid Edge:** Uses OpenGL as primary renderer. Geometry loaded into GPU memory via OpenGL display lists for performance. DirectX available as secondary option.

**Inventor:** Uses Autodesk's OGS (One Graphics System) — a shared rendering layer across all Autodesk products dating to 2007. Uses DirectX 9/10/11 and OpenGL. Autodesk is rebuilding it around Hydra (Pixar's USD framework) to support modern APIs like Vulkan and ray tracing.

**Key insight for your project:** Three.js is WebGL under the hood — the same technology Onshape uses. You get 80% of their capability with 10% of the development effort by using Three.js instead of writing a custom WebGL renderer. The only difference is Onshape has more control over low-level optimizations.

---

## Why is Solid Edge so bad and crashes so much?

1. **30 years of legacy code** — built in 1996, every new feature bolted onto architecture designed for hardware that no longer exists. The UI and file handling code in many places is genuinely from the late 90s.

2. **Parasolid rebuild failures** — when editing a part, Parasolid recalculates every face and intersection from scratch. If any feature produces degenerate geometry, the rebuild fails. Complex error to diagnose and recover from.

3. **Fragile parametric feature tree** — history-based modeling means one bad edit cascades through everything downstream. Features lose their references when upstream geometry changes. Called the "topological naming problem" — unsolved in all CAD programs, handled worse in Solid Edge than most.

4. **Poor memory management** — loads entire part files into RAM even when not actively used. Large assemblies hit the ceiling on most workstations.

5. **Deep Windows integration** — antivirus scans, Windows Updates, network drives all interfere. Tightly coupled to Windows-specific technologies rather than being isolated from OS-level interference.

6. **Siemens' priorities** — NX is Siemens' flagship. Solid Edge is mid-market and competes for engineering budget against NX, Teamcenter, and a dozen other Siemens products.

**Note:** Parasolid itself is rock solid. The crashes are almost never the geometry engine — they're the decades of UI code and Windows integration wrapped around it.

---

## What is NX and how would you fix those problems in a modern way?

**What is NX?**
Siemens' flagship high-end CAD/CAM/CAE platform. Used for jet engines, aircraft, automobiles. Same Parasolid kernel as Solid Edge but with far more engineering investment, advanced surfacing, deep manufacturing integration. Significantly more expensive — enterprise licensing.

**Modern fixes for each problem:**

**Legacy code →** Start from scratch with cloud-native architecture (what Onshape did). Clean separation between kernel, rendering, and application logic communicating through well-defined APIs. Tradeoff: lose 30 years of edge case handling.

**Parasolid rebuild failures →** Direct modeling / Synchronous Technology — push faces directly on the finished solid instead of replaying a history tree. No cascading failures because there's no history. Also: persistent topological IDs that survive rebuilds so downstream features don't lose their references.

**Fragile feature tree →** Variational modeling — define the entire part as a system of constraints solved simultaneously rather than sequentially. No ordering, no cascading. More robust but harder to implement and debug.

**Memory on large assemblies →** Lazy loading — don't load parts into RAM until needed. Onshape takes this further by keeping all geometry on the server and streaming only triangles to the browser. Your local machine never holds actual geometry, just display meshes.

**Windows instability →** Run in the browser (sandboxed, isolated from OS interference) or use Electron to wrap the app in a Chromium container, isolating it from Windows weirdness the way VS Code and Figma do.

**Vendor priority →** Open source (FreeCAD, OpenCASCADE) or a focused startup where CAD is the only product (Onshape). Siemens has a hundred products — a dedicated team beats a neglected product line every time.

---

## Should I start 2D then go 3D or go 3D from the start?

**Go 3D from the start.** The instinct is right.

**Why not 2D first:**
- OpenCASCADE is a 3D kernel — 2D is just 3D with Z locked to zero. You're not simplifying, you're artificially constraining.
- Three.js is inherently 3D. Constraining it to 2D then unlocking it later is backwards.
- Starting 2D then adding 3D means refactoring your entire MCP tool set, tessellation pipeline, viewport, and data models. Building things twice.

**Why 3D is actually easier for your workflow:**
- Sheet metal flat patterns are done correctly by modeling the 3D bent part first, then unfolding it. Working backwards from a 2D flat pattern and manually calculating bend allowances is the less correct approach.
- OCCT handles the unfolding math automatically when you start from a 3D solid.
- This is how Solid Edge, Inventor, and every serious CAD program does it.

**The constraint solver concern:**
People worry about needing a 2D constraint solver before going 3D. But Claude is driving the geometry — it places geometry correctly from the start by calculating coordinates. You don't need an interactive constraint solver until you want users to click and drag sketch entities. That's a v2 problem.

**Recommended first milestone:**
Get Claude to generate a basic extruded plate with holes via MCP tools → tessellate it → render in Three.js → export a DXF. Once that pipeline works end to end, everything else is adding tool types on top of the same foundation.

---

## Will I run into hardware problems?

**Short answer: No, for your use case.**

**OpenCASCADE / geometry computation:**
Simple prismatic parts (plates, brackets, channels, flanges) use maybe 50-100ms of CPU and a few hundred MB of RAM. Could run on a Raspberry Pi. Hardware only becomes a concern with complex imported geometry (car body panels, castings) where OCCT has to heal messy geometry.

**Three.js / browser rendering:**
Your RX 6600 is massively overpowered for CAD viewport rendering. A plate with holes tessellates to ~2,000 triangles. Games push 10-50 million per frame. Even integrated graphics handles Three.js fine for mechanical parts.

**Server options:**
- **Local shop PC** (your Skylake i5, 32GB, RX 6600) — fine for this
- **Cheap VPS** ($10-20/month, 2 vCPUs, 4GB RAM) — handles OCCT for single users easily
- **Multi-user scaling** — a good problem to have later, not a day-one concern

**Where you might actually hit limits:**
- OCCT with complex boolean operations on messy imported STEP geometry
- `opencascade.js` (WASM) is 2-5x slower than native and downloads at ~30-40MB
- Very large assemblies (hundreds of parts) can stress browser GPU memory

**The real bottleneck:**
The Anthropic API response time (2-10 seconds for Claude to reason through a complex part) will dominate the user experience — not hardware. More compute won't make it feel faster. This is the same experience as Claude Code and is acceptable — users watch it think, then see results.

---

## Questions I should be asking that I haven't yet

### Will bite you early

**How does Claude track state across multiple tool calls?**
Claude has no memory between API calls. If it calls `create_sketch`, then `add_extrude`, then `add_fillet` — how does it know what IDs the previous operations returned? You need a state system where the MCP server tracks the current document state and feeds it back to Claude on every turn. Design this before writing your first line of code or you'll rewrite the core later.

**What does a tool response actually look like?**
When Claude calls `create_sketch` and OCCT creates geometry, what does the tool return? An ID? A geometry description? A thumbnail? How does Claude verify the geometry is correct before moving to the next step? Design self-verification into the agent loop.

**How do you handle Claude making a geometry mistake halfway through?**
Does it start over? Is there an `undo` tool? Does it roll back to a checkpoint? Decide the error recovery strategy upfront.

### Fabrication-specific

**What are your actual material thicknesses and bend radii at Manac?**
OCCT needs real numbers for correct flat pattern unfolding. Bend allowance depends on material type, thickness, and press brake tooling radius. Wrong bend allowance = parts that don't fit. Build a materials/tooling table into the system from day one.

**What file format does your plasma table controller actually accept?**
DXF has many versions (R12, R14, 2000, 2004, 2010). Some controllers are picky about version, units, layer names, and geometry types (some won't handle splines — only arcs and lines). Know exactly what your machine wants before building the export pipeline.

**What nesting software are you using or planning to use?**
DeepNest, SigmaNest, ProNest, True Shape all have different import requirements, and some have APIs. If your nesting software has an API you could close the entire loop: natural language → part → nested plasma file in one workflow. That's the real prize.

### AI design

**How do you write the system prompt for the CAD agent?**
More important than most people realize. Claude needs to know: what units to use, your shop's standard practices, what materials you work with, how to name things, when to ask for clarification vs make assumptions. A well-crafted system prompt is the difference between an AI that works the way your shop works and one that produces technically correct but practically wrong parts.

**How do you handle ambiguous requests?**
"Make me a bracket" — what does Claude do? Ask clarifying questions or make assumptions and show you something? Define this behavior upfront. Claude Code asks before destructive operations, assumes on creative ones. A similar philosophy probably applies here.

**How do you validate that the part Claude built is actually what was asked for?**
Does Claude describe what it built? List the dimensions? Flag anything unusual (a hole larger than the plate it's in)? Build a self-verification step into the agent loop to catch errors before they become wasted plasma cuts.

### Project management

**What is your actual MVP?**
You could spend six months building infrastructure and never cut a part. The minimum useful thing is probably: type a description → get a DXF → open in nesting software → looks right. Everything else is polish. Define this before you start.

**Are you building for yourself first or for other people at the shop?**
Building for yourself: you can tolerate rough edges and a chat interface. Building for other fabricators: needs to feel finished, handle errors gracefully, require no technical knowledge. Know which one you're building — the UI requirements are completely different.

**How do you handle versioning of parts?**
If you make a bracket today and need to modify it in three months, how do you find it, load it, and edit it? Do you store the OCCT geometry? The original natural language prompt? The feature history? This is a simpler version of the PLM problem Siemens built Teamcenter to solve. Design basic part versioning from the start.

---

*Last updated: February 2026*
*See also: claude-cad-project.md for the full architecture overview*

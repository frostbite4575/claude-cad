# Claude CAD — Design Decisions & Approaches

For each key design question, 2-3 different approaches are presented with tradeoffs.
Use this to make informed decisions before writing code.

---

## Table of Contents

1. [How does Claude track state across tool calls?](#1-how-does-claude-track-state-across-tool-calls)
2. [What does a tool response look like?](#2-what-does-a-tool-response-look-like)
3. [How do you handle Claude making a geometry mistake?](#3-how-do-you-handle-claude-making-a-geometry-mistake)
4. [How do you handle material thicknesses and bend radii?](#4-how-do-you-handle-material-thicknesses-and-bend-radii)
5. [What DXF format does the plasma table need?](#5-what-dxf-format-does-the-plasma-table-need)
6. [How do you integrate with nesting software?](#6-how-do-you-integrate-with-nesting-software)
7. [How do you write the system prompt?](#7-how-do-you-write-the-system-prompt)
8. [How do you handle ambiguous requests?](#8-how-do-you-handle-ambiguous-requests)
9. [How do you validate the part Claude built?](#9-how-do-you-validate-the-part-claude-built)
10. [What is the MVP?](#10-what-is-the-mvp)
11. [Who are you building for?](#11-who-are-you-building-for)
12. [How do you handle part versioning?](#12-how-do-you-handle-part-versioning)

---

## 1. How does Claude track state across tool calls?

The core problem: Claude has no memory between API calls. If it calls
`create_sketch` and gets back ID `sketch_001`, then calls `extrude` referencing
that sketch, how does the whole conversation stay coherent as the part grows
more complex?

---

### Option A — Server-side state, ID references only

The MCP server maintains a full document state object in memory. Each tool call
returns only a simple ID. Claude references those IDs in subsequent calls. After
every tool call, the server injects a compact state summary back into Claude's
context automatically.

```
Claude calls: create_sketch({ plane: "XY" })
Server returns: { id: "sketch_001", status: "ok" }

Claude calls: add_line({ sketch_id: "sketch_001", x1: 0, y1: 0, x2: 100, y2: 0 })
Server returns: { id: "line_001", status: "ok" }

Claude calls: extrude({ sketch_id: "sketch_001", depth: 6 })
Server returns: { id: "solid_001", status: "ok" }

// After each call, server appends to Claude's context:
// "Current document: sketch_001 (XY plane, 4 lines), solid_001 (extruded 6mm)"
```

**Pros:**
- Clean and simple. Claude doesn't get flooded with geometry data.
- Server is the single source of truth.
- Easy to implement — just a dictionary mapping IDs to OCCT shapes.
- Scales well as parts get complex.

**Cons:**
- Claude can't reason about geometry it can't see. If a boolean operation
  produces unexpected results, Claude only knows the ID, not what went wrong.
- Requires careful design of the state summary injected into context.

**Best for:** Production system once the tool set is proven out. Clean
architecture that's easy to debug.

---

### Option B — Full geometry description in every response

Every tool call returns a complete human-readable description of the current
state of the part — dimensions, features, hole positions, everything. Claude
reads this on every turn and has full awareness of what exists.

```
Claude calls: extrude({ sketch_id: "sketch_001", depth: 6 })
Server returns: {
  id: "solid_001",
  description: {
    type: "rectangular_solid",
    dimensions: "100mm x 60mm x 6mm",
    features: [],
    bounding_box: { x: 100, y: 60, z: 6 },
    volume_mm3: 36000,
    surface_area_mm2: 15120
  }
}
```

**Pros:**
- Claude has complete situational awareness at all times.
- Can catch its own mistakes — if dimensions don't match the request,
  Claude notices immediately.
- No hidden state. Everything Claude knows is visible in the conversation.

**Cons:**
- Responses get large as parts get complex. Eats context window.
- Computing a full description after every operation adds latency.
- On a complex part with 20 features, the response might be 2-3KB per tool
  call — adds up fast.

**Best for:** Early prototyping and debugging. When you're still figuring out
what information Claude actually needs to reason well.

---

### Option C — Snapshot-based context with visual thumbnail

The MCP server maintains state server-side (like Option A) but after each tool
call it renders a small thumbnail of the current part and returns it to Claude
along with a brief text summary. Claude literally sees what it's building.

```
Claude calls: extrude({ sketch_id: "sketch_001", depth: 6 })
Server returns: {
  id: "solid_001",
  summary: "Rectangular plate 100x60x6mm, no features yet",
  thumbnail: "<base64 PNG 200x200px>"
}
```

**Pros:**
- Claude can visually verify its work matches the intent.
- Catches geometric errors that text descriptions might miss
  (e.g. a hole that punched through the wrong face).
- Most intuitive — mirrors how a human designer reviews their work.

**Cons:**
- More complex to implement — need server-side rendering pipeline just for
  thumbnails.
- Images consume a lot of context window tokens (expensive API-wise).
- Latency increases — rendering a thumbnail adds 100-500ms per tool call.

**Best for:** Demo-quality prototype that impresses stakeholders. Also genuinely
useful for validating complex parts. Worth building toward once Option A is
working.

---

### Recommendation

Start with **Option A** for the architecture. Add **Option B's** description
fields selectively — not everything, just what Claude needs (bounding box,
feature count, key dimensions). Keep **Option C** in your back pocket as a
future feature once the core pipeline is solid.

---

## 2. What does a tool response look like?

When Claude calls an MCP tool, what data structure comes back? This shapes
everything — how Claude reasons, how errors are handled, how state is tracked.

---

### Option A — Minimal ID-based response

```json
{
  "success": true,
  "id": "solid_001",
  "type": "solid",
  "message": "Extruded sketch_001 by 6mm successfully"
}
```

On failure:
```json
{
  "success": false,
  "error": "OCCT_BOOLEAN_FAILURE",
  "message": "Boolean subtract failed — tool body does not intersect target",
  "suggestion": "Check that the cutting tool overlaps the base solid"
}
```

**Pros:** Small responses, fast, easy to parse. Claude gets just enough to
continue or recover.

**Cons:** Claude has limited information to reason about complex geometry
problems.

---

### Option B — Rich structured response

```json
{
  "success": true,
  "id": "solid_001",
  "type": "solid",
  "operation": "extrude",
  "result": {
    "bounding_box": { "x": 100.0, "y": 60.0, "z": 6.0 },
    "volume_mm3": 36000.0,
    "face_count": 6,
    "edge_count": 12,
    "vertex_count": 8,
    "is_manifold": true,
    "is_closed": true
  },
  "warnings": [],
  "elapsed_ms": 42
}
```

**Pros:** Claude can do sanity checks on every operation. Knows immediately if
something is wrong — e.g. face count way higher than expected means something
split unexpectedly.

**Cons:** More data per response. More complex to generate on the server side.

---

### Option C — Hierarchical document response

After every operation, the response includes the full updated document tree —
not just the result of this operation, but the entire feature history and
current state.

```json
{
  "success": true,
  "operation_id": "solid_001",
  "document": {
    "features": [
      { "id": "sketch_001", "type": "sketch", "plane": "XY", "entity_count": 4 },
      { "id": "solid_001", "type": "extrude", "source": "sketch_001", "depth": 6 }
    ],
    "current_solid": {
      "id": "solid_001",
      "bounding_box": { "x": 100.0, "y": 60.0, "z": 6.0 }
    }
  }
}
```

**Pros:** Claude always has the full picture. Can reference any previous feature
by ID. Makes undo/rollback straightforward — just reference an earlier feature
ID.

**Cons:** Response grows linearly with part complexity. A 30-feature part means
a 30-item feature list on every response.

---

### Recommendation

**Option B** is the sweet spot. Rich enough for Claude to self-verify, compact
enough not to flood the context window. Add the `warnings` array from day one —
OCCT produces warnings on near-degenerate geometry that are worth surfacing to
Claude. Include **Option C's** document tree only when Claude explicitly requests
it via a `get_document_state` tool rather than on every response.

---

## 3. How do you handle Claude making a geometry mistake?

OCCT operations can fail outright (boolean subtract finds no intersection) or
succeed but produce wrong geometry (hole in wrong position, wrong depth). How
does the system recover?

---

### Option A — Checkpoint and rollback

The server saves a snapshot of the OCCT shape after every successful operation.
A `rollback` MCP tool lets Claude revert to any previous checkpoint by ID.

```
Claude calls: add_hole({ solid_id: "solid_001", x: 50, y: 30, diameter: 10, depth: "through" })
Server saves checkpoint: "checkpoint_003"
Server returns: { id: "solid_002", checkpoint: "checkpoint_003", ... }

// Claude realizes the hole is in the wrong position
Claude calls: rollback({ to_checkpoint: "checkpoint_002" })
Server restores OCCT shape to state before the hole
Server returns: { id: "solid_001", status: "restored" }

// Claude tries again with corrected coordinates
Claude calls: add_hole({ solid_id: "solid_001", x: 80, y: 15, diameter: 10, depth: "through" })
```

**Pros:**
- Clean mental model. Claude can experiment and back out mistakes.
- Mirrors how a human designer uses Ctrl+Z.
- OCCT shapes are immutable in this model — every operation produces a new
  shape, previous ones are preserved.

**Cons:**
- Memory usage grows — storing snapshots of every OCCT shape.
- Need a cleanup strategy to purge old checkpoints.
- Claude needs to know when to rollback vs when to fix forward.

**Best for:** Interactive sessions where Claude is exploring a design, making
multiple attempts at a complex feature.

---

### Option B — Start over with corrected parameters

No rollback. If something goes wrong, Claude uses a `reset_document` tool to
clear everything and rebuilds the part from scratch with corrected parameters.
Since Claude has the full conversation history, it knows every tool call it made
and can replay them with corrections.

```
// Claude realizes hole position was wrong
Claude calls: reset_document()
// Claude replays all previous operations with corrected hole position
Claude calls: create_sketch(...)
Claude calls: add_rectangle(...)
Claude calls: extrude(...)
Claude calls: add_hole({ x: 80, y: 15, ... })  // corrected position
```

**Pros:**
- Dead simple to implement — no snapshot storage, no rollback logic.
- Forces Claude to be deliberate — can't just undo lazily.
- The rebuilt part is cleaner — no accidental leftover geometry from a bad
  operation that was "undone."

**Cons:**
- Slow for complex parts — rebuilding 20 operations to fix operation 19 is
  wasteful.
- Uses more API tokens replaying everything.
- Frustrating if the rebuild itself hits a different error.

**Best for:** Simple parts with few features. Good enough for MVP.

---

### Option C — Fix-forward with repair tools

Instead of rolling back or starting over, the system provides repair tools that
Claude can use to fix geometry in place.

```
Tools available:
- move_feature({ feature_id, offset_x, offset_y, offset_z })
- resize_feature({ feature_id, new_dimension, value })
- delete_feature({ feature_id })
- replace_feature({ feature_id, new_params })
```

```
// Hole is in wrong position — fix it in place
Claude calls: move_feature({ feature_id: "hole_001", offset_x: 30, offset_y: -15 })
Server moves the hole, rebuilds affected geometry
Returns: { id: "solid_003", status: "ok" }
```

**Pros:**
- Most natural for a history-based system. Mirrors how designers work in
  Solid Edge or Inventor.
- Efficient — only rebuilds what changed.
- Builds toward a full parametric editor.

**Cons:**
- Hardest to implement. Requires a proper parametric feature tree with
  dependency tracking.
- OCCT doesn't have native "move a feature" — you have to replay the tree
  from the changed feature forward.
- The topological naming problem bites here — downstream features may lose
  their references when an upstream feature changes.

**Best for:** V2 once the core pipeline is proven. The right long-term
architecture but too complex for an MVP.

---

### Recommendation

Start with **Option B** (start over) for the MVP — it's the simplest and
sufficient for simple parts. Implement **Option A** (checkpoints) next — it's
not that complex and dramatically improves the experience. Save **Option C**
(fix-forward) for when you're building toward a proper parametric system.

---

## 4. How do you handle material thicknesses and bend radii?

Sheet metal flat patterns depend entirely on accurate bend calculations. Wrong
numbers mean parts that don't fit when bent. This data needs to live somewhere
in the system.

---

### Option A — Hardcoded materials table in the system prompt

Define your shop's standard materials and tooling directly in Claude's system
prompt as a reference table. Claude reads this and uses the correct values when
building sheet metal parts.

```
MATERIALS REFERENCE (Manac Fabrication):
- 3/16" mild steel: thickness=4.76mm, bend_radius=4.76mm, k_factor=0.42
- 1/4" mild steel: thickness=6.35mm, bend_radius=6.35mm, k_factor=0.42
- 3/8" mild steel: thickness=9.53mm, bend_radius=9.53mm, k_factor=0.44
- 1/2" mild steel: thickness=12.7mm, bend_radius=12.7mm, k_factor=0.44
- 10ga mild steel: thickness=3.57mm, bend_radius=3.57mm, k_factor=0.40

PRESS BRAKE TOOLING:
- Standard V-die opening: 8x material thickness
- Available punch radii: 3mm, 5mm, 8mm, 12mm
```

**Pros:**
- Dead simple to implement — just text in the system prompt.
- Claude can reference it without any tool calls.
- Easy to update — edit the prompt.

**Cons:**
- System prompt gets long if you have many materials.
- No validation — Claude could hallucinate a thickness that isn't on the list.
- Hard to share/update across multiple instances of the system.

**Best for:** MVP and early testing. Gets you running immediately.

---

### Option B — Materials database with MCP tool

Store materials and tooling data in a database (even SQLite). Expose it via MCP
tools Claude can query.

```
Claude calls: get_material({ name: "1/4 mild steel" })
Server queries DB, returns:
{
  "name": "1/4\" mild steel",
  "thickness_mm": 6.35,
  "bend_radius_mm": 6.35,
  "k_factor": 0.42,
  "density_g_cm3": 7.85,
  "yield_strength_mpa": 250
}

Claude calls: list_available_materials()
Returns: ["3/16\" mild steel", "1/4\" mild steel", "3/8\" mild steel", ...]

Claude calls: calculate_bend_allowance({
  material: "1/4 mild steel",
  bend_angle_deg: 90,
  inside_radius_mm: 6.35
})
Returns: { bend_allowance_mm: 11.2, bend_deduction_mm: 4.1 }
```

**Pros:**
- Single source of truth. Update the DB and every session uses new values.
- Claude is forced to query rather than guess — more reliable.
- Can be extended to include stock availability, cost per kg, etc.
- Bend allowance calculations done server-side with proven math — not
  left to Claude to compute.

**Cons:**
- More infrastructure to set up.
- Adds tool calls to every sheet metal operation.

**Best for:** Production system. The right architecture once you're past MVP.

---

### Option C — Materials config file per project

Instead of a database or system prompt, each project has a JSON config file that
defines the materials and tooling for that job. Claude reads this file at the
start of a session.

```json
{
  "project": "Manac Trailer Frame",
  "materials": [
    {
      "id": "steel_quarter",
      "name": "1/4\" mild steel",
      "thickness_mm": 6.35,
      "k_factor": 0.42,
      "default_bend_radius_mm": 6.35
    }
  ],
  "tooling": {
    "press_brake_capacity_ton": 220,
    "available_v_dies": [32, 50, 80],
    "available_punch_radii_mm": [3, 5, 8, 12]
  }
}
```

**Pros:**
- Project-specific — different jobs can have different material sets.
- Easy to version control alongside the parts.
- Portable — the config travels with the project.

**Cons:**
- Someone has to create and maintain the config for each project.
- Risk of stale configs with wrong values.

**Best for:** Multi-project environments where different jobs use different
material specs.

---

### Recommendation

**Option A** to start — get it working. **Option B** for production — it's the
right long-term architecture and not that complex to build. SQLite is one npm
package away and gives you a proper materials library that the whole shop can
share and update.

---

## 5. What DXF format does the plasma table need?

You need to know this before building the export pipeline. DXF has many
versions and plasma controllers are picky.

---

### Option A — Export DXF R12 (the safe default)

DXF R12 is the oldest, simplest, most universally compatible version. Every
plasma controller on earth reads it. It only supports lines, arcs, circles, and
polylines — no splines, no complex curves.

**What this means for your geometry:**
OCCT's curved edges (fillets, holes) must be approximated as arcs and polylines
rather than true NURBS curves. For plasma cutting this is fine — the machine
follows arcs natively and the approximation is within cutting tolerance.

```python
# OCCT DXF export with R12 compatibility
from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
# Export edges as lines and arcs only, no splines
```

**Pros:**
- Works with literally everything. Hypertherm, Esab, Burny, Fanuc — all read R12.
- No surprises on the shop floor.
- Forces you to keep geometry clean and simple.

**Cons:**
- Splines get approximated. For most trailer parts this doesn't matter.
- No support for layers, colors, or line types (or very limited).

**Best for:** Default output format. Lowest risk.

---

### Option B — Export DXF 2000/2004 with layer structure

Modern DXF with proper layer support. Lets you separate cut geometry, bend
lines, part labels, and reference geometry onto different layers — which most
nesting software expects.

```
Layer 0: CUT — outer profile and holes (what the plasma follows)
Layer 1: BEND — bend lines (reference only, not cut)
Layer 2: LABEL — part number, material, quantity text
Layer 3: SCRAP — interior cutouts that drop as scrap
```

**Pros:**
- Nesting software uses layers to distinguish cut paths from reference geometry.
- Bend lines visible in nesting layout help the operator.
- Professional output that matches what Solid Edge produces.

**Cons:**
- Some older plasma controllers ignore layers and cut everything.
- More complex to generate correctly.

**Best for:** Once you know your nesting software's layer requirements. This is
probably what you want long-term.

---

### Option C — Query the controller and generate accordingly

Build a configurable export system. The MCP server has a `machine_profile` config
that specifies exactly what your plasma table controller needs — DXF version,
units (mm vs inches), layer names, arc approximation tolerance, whether splines
are supported.

```json
{
  "machine": "Hypertherm ProNest",
  "dxf_version": "R2000",
  "units": "inches",
  "layers": {
    "cut": "CUT",
    "bend": "SCORE",
    "label": "ANNO"
  },
  "arc_tolerance_mm": 0.1,
  "supports_splines": false
}
```

Claude never thinks about DXF format — it just calls `export_dxf()` and the
server generates the right format for your specific machine.

**Pros:**
- Machine-agnostic from Claude's perspective.
- Easy to support multiple machines or change machines later.
- All the messy format details live in config, not in Claude's tool logic.

**Cons:**
- Requires upfront effort to profile your machine correctly.
- Someone needs to maintain the config if the machine changes.

**Best for:** Production system. The cleanest architecture — Claude shouldn't
need to know what DXF version your plasma table likes.

---

### Recommendation

**Find out what your specific plasma controller accepts first** — this is the
most important step. Walk up to the machine and find the model number. Then
start with **Option A** (R12) to get DXF output working at all, and evolve to
**Option C** (machine profile config) for production. **Option B's** layer
structure fits naturally inside Option C.

---

## 6. How do you integrate with nesting software?

The end goal is closing the loop — from Claude building a part to that part
being nested on a sheet and sent to the plasma cutter.

---

### Option A — File drop integration (simplest)

Claude CAD exports a DXF to a watched folder. Your nesting software (DeepNest,
ProNest, etc.) watches that folder and automatically picks up new files for
nesting. No API needed — just a shared folder on the network.

```
Claude CAD exports → /shop/dxf_output/bracket_001.dxf
Nesting software watches /shop/dxf_output/
Operator opens nesting software, sees new part, drags onto sheet
```

**Pros:**
- Works with any nesting software regardless of API availability.
- Zero integration code — it's just file I/O.
- Operator stays in control of the nesting step.
- Reliable — file systems don't break.

**Cons:**
- Manual step still required (operator drags part into nest).
- No feedback to Claude CAD about whether the part nested successfully.
- No scrap inventory awareness.

**Best for:** MVP. Gets you cutting parts immediately with zero nesting
integration complexity.

---

### Option B — DeepNest API integration

DeepNest is an open source nesting tool with a programmatic interface. You can
drive it from Node.js directly — feed it a list of DXF files and a sheet size,
get back a nested layout.

```javascript
// Pseudo-code — DeepNest integration
const nest = new DeepNest();
nest.addSheet({ width: 2440, height: 1220, material: "1/4 mild steel" });
nest.addPart({ dxf: "bracket_001.dxf", quantity: 4 });
nest.addPart({ dxf: "gusset_002.dxf", quantity: 8 });
const result = await nest.run({ time_limit_seconds: 30 });
// result contains nested layout DXF ready for plasma table
```

**Pros:**
- Full automation — Claude CAD can close the entire loop.
- Open source — free, no licensing cost.
- Can incorporate scrap inventory: feed DeepNest the actual scrap dimensions
  from your existing scrap database.

**Cons:**
- DeepNest's nesting quality is decent but not commercial-grade.
- Requires learning DeepNest's API (not as well documented as commercial tools).
- Nesting optimization takes time — 30-60 seconds for complex nests.

**Best for:** Self-hosted, fully automated workflow. Great if you want to close
the loop completely without commercial nesting software licensing.

---

### Option C — Commercial nesting software API (ProNest, SigmaNest)

ProNest (Hypertherm) and SigmaNest both have APIs for programmatic integration.
If your shop already licenses one of these, you can drive nesting programmatically
from Claude CAD.

```
Claude CAD exports DXF
    → ProNest API call: import_part(dxf_path, quantity)
    → ProNest API call: create_nest(sheet_material, sheet_size)
    → ProNest API call: run_nesting()
    → ProNest API call: export_cut_file(machine_profile)
    → File sent to plasma controller
```

**Pros:**
- Commercial-grade nesting quality — material utilization significantly better
  than DeepNest.
- Already licensed by many shops.
- Outputs directly in the format your plasma controller expects.

**Cons:**
- API access may require additional licensing cost.
- APIs vary in quality and documentation between vendors.
- Dependent on vendor's software being installed on a local machine.

**Best for:** Shops already using ProNest or SigmaNest commercially. Highest
quality nesting output.

---

### Recommendation

**Option A** for MVP — just export DXF and let the operator nest manually.
This is actually fine for a first version and lets you focus on the part
creation pipeline rather than nesting integration. Once the part creation side
is solid, add **Option B** (DeepNest) if you want full automation on a budget,
or **Option C** (commercial API) if your shop already has the license.

---

## 7. How do you write the system prompt?

The system prompt is what turns Claude from a general AI into a fabrication
assistant that works the way your shop works. This is high leverage — a good
system prompt saves enormous amounts of back-and-forth.

---

### Option A — Minimal system prompt, Claude figures it out

Keep the system prompt short and trust Claude's general reasoning ability.

```
You are a CAD assistant for a metal fabrication shop that manufactures trailers.
You help users design parts for plasma cutting. When a user describes a part,
use the available MCP tools to build it in 3D, unfold it to a flat pattern,
and export a DXF file. Always confirm dimensions with the user before cutting.
Default units are inches. Default material is 1/4" mild steel unless specified.
```

**Pros:**
- Simple to write and maintain.
- Claude's general knowledge handles most cases.
- Easy to iterate — short prompts are easy to tweak.

**Cons:**
- Claude may make assumptions that don't match your shop's practices.
- No shop-specific knowledge (standard hole sizes, typical part names, etc.).
- More likely to ask unnecessary clarifying questions.

**Best for:** Early prototyping. Write this first, then extend it as you learn
where Claude makes wrong assumptions.

---

### Option B — Detailed shop-specific system prompt

A comprehensive prompt that encodes your shop's actual practices, standards,
and common part vocabulary.

```
You are a CAD assistant for Manac, a trailer manufacturing company in [location].
You design parts for plasma cutting on our [machine model] plasma table.

UNITS: Always work in inches unless explicitly told otherwise.

MATERIALS (default: 1/4" mild steel):
- 3/16" mild steel — light gussets, brackets under 6" span
- 1/4" mild steel — standard brackets, mounting plates, most structural parts
- 3/8" mild steel — heavy duty mounts, hitch components, high-stress brackets
- 1/2" mild steel — receiver tubes, heavy structural applications

STANDARD HOLE SIZES (match to bolt size):
- 1/2" bolt → 9/16" hole
- 5/8" bolt → 11/16" hole
- 3/4" bolt → 13/16" hole
- 1" bolt → 1-1/16" hole
Always ask which bolt size if not specified.

STANDARD PRACTICES:
- Edge distance for holes: minimum 1.5x hole diameter from edge
- Corner radii on plates: 1/4" unless otherwise specified
- Bend radius: match material thickness unless specified
- Part naming: [TYPE]_[SIZE]_[MATERIAL] e.g. BRACKET_12X6_025

WORKFLOW:
1. Confirm all dimensions with user before building
2. Build 3D part
3. Verify geometry looks correct
4. Unfold to flat pattern
5. Export DXF
6. Report flat pattern dimensions and estimated plasma cut time

COMMON PART TYPES at Manac:
- Mounting brackets (most common)
- Gussets and stiffeners
- Cross members
- Hitch plates
- Stake pocket covers
- Wiring brackets
```

**Pros:**
- Claude behaves predictably and matches shop standards.
- Fewer clarifying questions — Claude already knows your defaults.
- Encodes institutional knowledge that would otherwise be in someone's head.
- Part naming conventions produce consistent file names.

**Cons:**
- Takes effort to write well upfront.
- Needs maintenance as practices change.
- Long system prompt uses tokens on every API call (small cost increase).

**Best for:** Production system used by multiple people in the shop. Worth the
investment once you know what Claude gets wrong with the minimal prompt.

---

### Option C — Dynamic system prompt assembled at runtime

Instead of one static prompt, the system assembles the prompt at runtime by
pulling in relevant context — current scrap inventory, active job number,
materials in stock, recent parts for this project.

```javascript
function buildSystemPrompt(context) {
  return `
You are a CAD assistant for Manac trailer manufacturing.

CURRENT JOB: ${context.job_number} — ${context.job_description}
OPERATOR: ${context.operator_name}

MATERIALS CURRENTLY IN STOCK:
${context.available_materials.map(m => `- ${m.name}: ${m.sheets_available} sheets`).join('\n')}

RECENT PARTS FOR THIS JOB:
${context.recent_parts.map(p => `- ${p.name}: ${p.dimensions}`).join('\n')}

[...standard practices...]
  `;
}
```

**Pros:**
- Claude knows the current context — what's in stock, what job it's on.
- Can avoid specifying materials that aren't available.
- Recent parts help Claude maintain design consistency across a job.

**Cons:**
- More complex to implement — requires integration with inventory and job
  tracking systems.
- Dynamic prompts are harder to debug when Claude behaves unexpectedly.

**Best for:** Long-term, when Claude CAD is integrated with your broader
shop management workflow.

---

### Recommendation

Write **Option A** immediately to get started. Evolve it toward **Option B**
over the first few weeks as you identify where Claude makes wrong assumptions.
Keep **Option C** in mind as the integration with your scrap database and job
tracking grows — it's the most powerful but requires the most infrastructure.

---

## 8. How do you handle ambiguous requests?

"Make me a bracket" — what does Claude do? The wrong behavior (making
assumptions silently and building the wrong thing) wastes time. The wrong
behavior in the other direction (asking too many questions) is annoying.

---

### Option A — Ask first, build second

Claude always asks for all required dimensions and parameters before making a
single tool call. Nothing gets built until Claude has confirmed the spec.

```
User: "Make me a mounting bracket"

Claude: "I need a few details before I build this:
1. Overall dimensions (length x width)?
2. Material thickness? (default: 1/4" mild steel)
3. Mounting hole pattern — how many holes, what bolt size, where?
4. Will this be bent or flat?
5. Any slots, cutouts, or special features?"

User: "12x6, standard quarter inch, four 1/2" holes in the corners, flat"

Claude: [builds part]
```

**Pros:**
- Never builds the wrong thing.
- Forces the user to think through the spec before committing.
- Fewer wasted iterations.

**Cons:**
- Slow and question-heavy for experienced users who know what they want.
- Can feel like filling out a form rather than having a conversation.
- Annoying when the user just wants to see something quickly and iterate.

**Best for:** New users, complex parts, or situations where a mistake is
costly (expensive material, long plasma time).

---

### Option B — Build with assumptions, show and confirm

Claude makes reasonable assumptions based on your shop's standards (from the
system prompt), builds the part immediately, then shows the user what it built
and asks for confirmation or corrections.

```
User: "Make me a mounting bracket"

Claude: "Building a standard mounting bracket with typical defaults..."
[builds: 12x6" plate, 1/4" mild steel, four 9/16" holes at corners, 1" from edge]

Claude: "Here's what I built:
- 12x6 inch plate, 1/4" mild steel
- Four 9/16" holes (for 1/2" bolts) at corners, 1" from each edge
- Flat pattern ready, no bends

Does this look right, or what would you like to change?"
```

**Pros:**
- Fast — user sees something immediately.
- Iteration feels natural — like talking to a colleague who makes a first pass.
- Good for experienced users who can quickly spot what's wrong.

**Cons:**
- If the assumption is wildly wrong (user wanted a 48" bracket, Claude built 12"),
  the mismatch is jarring.
- Costs API tokens building something that might get thrown away.

**Best for:** Experienced fabricators who know what a "standard" part looks like.
Works well when the system prompt encodes good defaults.

---

### Option C — Clarify critical unknowns, assume the rest

Claude identifies which parameters are truly critical (ones where a wrong
assumption would produce an unusable part) versus which ones have safe defaults.
Asks only about the critical ones.

```
Critical — always ask:        Overall dimensions, number of holes
Safe to assume:               Hole size (from bolt size standard), edge distance,
                              corner radius, material (default from system prompt)
```

```
User: "Make me a mounting bracket"

Claude: "Just two quick questions:
1. What size — roughly how long and wide?
2. How many mounting holes, and what bolt size?"

User: "About 10 inches long, 4 inches wide, four 5/8" bolt holes"

Claude: [builds part with assumed defaults for everything else, shows result]
"Built a 10x4" bracket in 1/4" mild steel with four 11/16" holes
(for 5/8" bolts) at the corners, 1" from each edge. Look right?"
```

**Pros:**
- Balances speed with accuracy.
- Asks the minimum necessary questions.
- User doesn't feel interrogated but also doesn't get wildly wrong results.

**Cons:**
- Requires careful thought about what's "critical" vs "safe to assume."
- The line between critical and safe changes depending on context.

**Best for:** The best general-purpose approach. Encodes real fabrication
knowledge about what matters vs what has a safe default.

---

### Recommendation

**Option C** is the right long-term behavior. Implement it in the system prompt
by explicitly telling Claude which parameters are critical vs which have defaults.
Start with **Option B** for early testing — it's faster to iterate when you're
still figuring out what the defaults should even be.

---

## 9. How do you validate the part Claude built?

Claude builds a part. How do you know it's right before sending it to the
plasma table?

---

### Option A — Claude self-reports dimensions

After building, Claude calls a `measure_part` tool and reports back the key
dimensions in plain text.

```
Claude calls: measure_part({ solid_id: "solid_001" })
Returns: {
  "length": 12.0,
  "width": 6.0,
  "thickness": 0.25,
  "hole_count": 4,
  "hole_diameter": 0.5625,
  "hole_positions": [[1.0, 1.0], [11.0, 1.0], [1.0, 5.0], [11.0, 5.0]],
  "flat_pattern_size": "13.2 x 6.0 inches"
}

Claude reports: "Built 12x6\" bracket in 1/4\" steel.
Four 9/16\" holes at corners (1\" from each edge).
Flat pattern is 13.2x6\". Does this match what you need?"
```

**Pros:**
- Simple to implement — OCCT has measurement tools built in.
- Claude can compare measured dimensions to requested dimensions and flag
  discrepancies automatically.
- No visual rendering needed for validation.

**Cons:**
- Dimensional validation catches size errors but not shape errors.
- A hole in the wrong position might have the right size but wrong location.

**Best for:** Fast validation of simple rectangular parts. Add this from day one.

---

### Option B — 3D viewport review

The Three.js viewport shows the finished part. The user visually inspects it,
rotates it, confirms it looks right before exporting DXF.

```
User inspects part in viewport:
- Orbit around the part
- Check hole positions visually
- Confirm overall shape
- Click "Approve & Export DXF" when satisfied
```

**Pros:**
- Catches shape errors that dimensional reports miss.
- Intuitive — anyone can look at a 3D model and tell if it's wrong.
- No CAD knowledge required to review.

**Cons:**
- Requires the Three.js viewport to be working (more infrastructure).
- Visual inspection can miss small dimensional errors.
- Adds a manual step — user must actively review before exporting.

**Best for:** All production use. Visual review should always be the final step
before sending to the plasma table. You're already building Three.js anyway.

---

### Option C — Automated geometry checks

The system runs a set of automated checks on every part before allowing DXF
export. Claude cannot export a part that fails checks.

```
Checks run automatically:
✓ Is the solid watertight (manifold)?
✓ Are all holes smaller than the face they're on?
✓ Is edge distance >= 1.5x hole diameter for all holes?
✓ Is the flat pattern area within standard sheet sizes?
✓ Are there any zero-thickness walls or degenerate faces?
✓ Does part fit within plasma table cutting area (X x Y)?
⚠ WARNING: Hole at position (0.8", 0.8") is only 0.8" from edge (minimum 1.0")
```

**Pros:**
- Catches common fabrication errors automatically.
- Enforces shop standards programmatically — no human needs to remember the rules.
- Prevents obviously bad DXF files from reaching the plasma table.

**Cons:**
- Requires defining and implementing the checks — some upfront effort.
- Rules need maintenance as shop standards change.
- False positives possible — a check might flag something valid for a special
  case.

**Best for:** Production system. These checks encode fabrication knowledge and
prevent costly mistakes. Worth building incrementally — add checks as you
discover errors that reach the plasma table.

---

### Recommendation

Implement all three in layers. **Option A** (dimensional self-report) is trivial
to add and catches gross errors. **Option B** (viewport) you're already building.
**Option C** (automated checks) is the highest value addition for production — 
start with 3-4 basic checks (manifold solid, edge distance, part fits table) and
add more over time as you learn what errors actually happen.

---

## 10. What is the MVP?

The minimum thing that proves the concept and produces real value at the shop.

---

### Option A — Narrow MVP: one part type, end to end

Pick the single most common part your shop makes — probably a simple mounting
bracket. Build the entire pipeline for that one part type only. Nothing else.

```
MVP scope:
- Flat rectangular plate, one material (1/4" steel), inches
- Holes only (no bends, no slots, no complex cutouts)
- Claude builds it, Three.js shows it, DXF exports
- Operator takes DXF, imports into existing nesting software manually

Success criteria:
- Describe a bracket in plain English
- Get a DXF in under 60 seconds
- DXF opens correctly in nesting software
- Nested part cuts correctly on plasma table
```

**Pros:**
- Achievable in 2-4 weeks.
- Produces real value immediately — even one part type saves time.
- Validates the entire pipeline (Claude → OCCT → Three.js → DXF) without scope creep.
- Easy to demo and get feedback.

**Cons:**
- Only works for one part type — feels limited.
- May not cover the part types that cause the most pain at the shop.

**Best for:** Getting something real in people's hands as fast as possible.
The right approach.

---

### Option B — Broader MVP: common part vocabulary

Build the pipeline for the 5-6 most common part types at Manac rather than
just one.

```
MVP scope:
- Flat plates with holes
- Simple bent brackets (one bend)
- Gussets (triangular plates)
- Slotted plates
- Still no bends more complex than 90 degrees
- Still manual nesting
```

**Pros:**
- More useful from day one — covers more of the actual work.
- More interesting to demo — shows the breadth of what's possible.

**Cons:**
- 2-3x longer to build than Option A.
- More surface area for bugs.
- Risk of never finishing if scope keeps expanding.

**Best for:** If you have time and want a more complete initial release. But
easy to slip into an endless feature list.

---

### Option C — Infrastructure MVP: pipeline only, no real parts

Focus the MVP entirely on getting the technical pipeline working —
OCCT to Three.js to DXF — with a hardcoded test part. No natural language,
no Claude integration yet. Just prove the geometry engine and renderer work.

```
MVP scope:
- Hardcoded test part (e.g. 100x60x6mm plate with four holes)
- OCCT generates it
- Tessellated and rendered in Three.js correctly
- DXF exported and validated on plasma table
- No Claude, no MCP, no natural language
```

**Pros:**
- De-risks the hardest technical unknown (OCCT + Three.js pipeline) before
  adding AI complexity.
- If the geometry pipeline doesn't work, you find out in week 1 not week 6.
- Clean separation of concerns — validate each layer independently.

**Cons:**
- Produces no user-facing value. Can't demo to non-technical stakeholders.
- Might feel like not making progress toward the real goal.

**Best for:** If you're uncertain about the OCCT/Three.js technical stack.
A good first week of work before moving to Option A.

---

### Recommendation

Do **Option C** in week 1 (prove the tech stack), then **Option A** (one part
type end to end) as the real MVP. Resist the temptation to go to Option B until
Option A is working reliably and people at the shop are actually using it.

---

## 11. Who are you building for?

This changes the UI, error handling, and complexity tolerance significantly.

---

### Option A — Building for yourself only

You're the user. You understand the tech, you can tolerate rough edges, you
can read error messages.

```
UI requirements:
- Chat interface (just a text box and Claude's responses)
- Three.js viewport alongside the chat
- Raw JSON tool call visibility is fine
- Error messages can be technical
- No onboarding needed
```

**Pros:**
- Fastest to build — no polish required.
- Can iterate daily since you're both the developer and the user.
- Immediate real-world feedback on what works.

**Cons:**
- No one else can use it without your help.
- You might build for your own mental model rather than how other fabricators think.

**Best for:** Getting started. Build for yourself first, always.

---

### Option B — Building for other fabricators at the shop

Other people at Manac — some technical, some not — will use this directly.

```
Additional UI requirements:
- Simple, clean interface — not a chat window
- Error messages in plain English ("The hole is too close to the edge, 
  minimum distance is 1 inch")
- Confirmation dialogs before destructive operations
- Part library — save and reload common parts
- Print-friendly summary of what was built
- Works on a shop floor tablet or rugged laptop
```

**Pros:**
- Real multi-user value — amplifies the time savings across the whole team.
- Forces you to make the tool robust (other people find bugs you wouldn't).

**Cons:**
- 3-5x more UI work.
- Need to handle all the weird ways non-technical users interact with the system.
- Maintenance burden when others depend on it.

**Best for:** Once the core pipeline is proven and you're confident it works
reliably. Don't build for others until you've used it yourself for a while.

---

### Option C — Building as a product for other fab shops

Beyond Manac — a tool that other trailer manufacturers or metal fab shops could
use.

```
Additional requirements beyond Option B:
- Multi-tenant (each shop has their own materials, machines, settings)
- User authentication and access control
- Billing / usage tracking
- Documentation and onboarding
- Support for multiple machine types (different DXF requirements)
- Possibly: on-premise deployment for shops with network restrictions
```

**Pros:**
- Enormous potential market — every fab shop has this problem.
- Could become a real business.

**Cons:**
- Massive scope increase. Building a product vs building a tool.
- Legal, support, security, compliance considerations.
- Distracts from the core fabrication problem.

**Best for:** If the tool proves itself at Manac first. This is a year-two
consideration, not a day-one design decision.

---

### Recommendation

**Option A** to start, explicitly. Be honest with yourself that you're building
for you first. Once it works reliably for 30 days at the shop, consider
**Option B** — bring in one other fabricator as a beta tester. **Option C** is
a legitimate long-term possibility but don't let it influence early architecture
decisions.

---

## 12. How do you handle part versioning?

You make a bracket today. In three months someone needs to modify it slightly.
How do you find it, load it, and edit it?

---

### Option A — Store the natural language prompt

The simplest version: save the original text description that produced the part,
along with the exported DXF. To "edit" a part, load the original description
into a new Claude session and ask Claude to modify it.

```json
{
  "part_id": "BRACKET_12X6_025_001",
  "created": "2026-02-26",
  "created_by": "Luke",
  "job": "Manac-2026-0145",
  "prompt": "Make a 12x6 inch mounting bracket in 1/4\" mild steel with
             four 1/2\" bolt holes in the corners, 1\" from each edge",
  "dxf_path": "/parts/BRACKET_12X6_025_001.dxf",
  "notes": "Used on trailer tongue, driver side"
}
```

**Pros:**
- Dead simple to implement — just save a text file alongside the DXF.
- The prompt is human-readable — anyone can understand what the part is.
- No special file format to parse — Claude reads the prompt and rebuilds.

**Cons:**
- Claude has to rebuild the entire part from the prompt. If the prompt is
  ambiguous, the rebuilt part might differ slightly from the original.
- No feature-level editing — to change one hole, you modify the whole prompt.
- Depends on Claude interpreting the same prompt the same way consistently.

**Best for:** MVP. This is enough to get started and it's genuinely useful.

---

### Option B — Store the OCCT shape file + feature history

Save the actual OCCT geometry as a BREP file, plus a JSON log of every MCP
tool call that produced it (the "recipe"). To edit, load the recipe, replay it,
then add modification operations.

```json
{
  "part_id": "BRACKET_12X6_025_001",
  "brep_path": "/parts/BRACKET_12X6_025_001.brep",
  "dxf_path": "/parts/BRACKET_12X6_025_001.dxf",
  "feature_history": [
    { "tool": "create_sketch", "params": { "plane": "XY" }, "result_id": "sketch_001" },
    { "tool": "add_rectangle", "params": { "width": 12, "height": 6 }, "result_id": "rect_001" },
    { "tool": "extrude", "params": { "depth": 0.25 }, "result_id": "solid_001" },
    { "tool": "add_hole", "params": { "x": 1, "y": 1, "d": 0.5625 }, "result_id": "solid_002" },
    ...
  ]
}
```

**Pros:**
- Exact geometry preserved — load the BREP and you have exactly the original part.
- Feature history lets you replay and modify at any step.
- Can diff two versions — compare feature histories to see what changed.

**Cons:**
- BREP files can be large for complex parts.
- Feature history replay can fail if OCCT behavior changes between versions.
- More complex to implement than Option A.

**Best for:** Production system where part accuracy matters and you need
reliable versioning. The right long-term architecture.

---

### Option C — Git-based version control

Store everything (prompt, BREP, DXF, feature history) in a git repository.
Every modification is a commit. Full history, diff, branching for design variants.

```
/parts/
  BRACKET_12X6_025/
    v1/
      part.brep
      part.dxf
      part.json       (prompt + feature history)
      notes.md
    v2/
      part.brep       (modified hole positions)
      part.dxf
      part.json
      notes.md        ("moved holes to 1.5\" from edge per engineer request")
```

**Pros:**
- Full version history with diffs.
- Branch for design variants ("wide flange version", "heavy duty version").
- Blame — see who changed what and when.
- Free backup if pushed to GitHub/GitLab.
- Engineers already understand git.

**Cons:**
- Binary files (BREP, DXF) don't diff meaningfully in git — you see that
  they changed but not what changed geometrically.
- Overkill for a shop floor tool used by non-technical people.
- Adds git as a dependency and concept people need to understand.

**Best for:** If you're already comfortable with git and want rigorous version
control. Works well for a developer-run tool. Less practical for a shop floor
tool used by fabricators who don't know git.

---

### Recommendation

**Option A** (save the prompt + DXF) for the MVP — implement this in the first
week. **Option B** (BREP + feature history JSON) for production — add this once
you know the core pipeline is stable and part versioning becomes a real need.
Skip **Option C** unless you're the only user and already live in git.

---

*Last updated: February 2026*
*See also: claude-cad-project.md (architecture overview)*
*See also: claude-cad-questions.md (full Q&A log)*

# IS Mechanical — Plan Viewer: Full Codebase Review

## What This Software Is

**IS Plan Viewer** is a browser-based HVAC mechanical estimating and takeoff application. It allows HVAC contractors/estimators to:

1. **Upload construction PDF drawings** and view them on an interactive canvas
2. **Draw and measure duct runs** directly on the plans (spiral, snaplock, rectangular, oval, flex)
3. **Place fittings** (elbows, tees, wyes, reducers, transitions, boots, etc.) on the drawings
4. **Build vertical duct stacks** with multiple items
5. **Extract HVAC equipment schedules from plan images** using AI (Gemini, Claude, OpenAI vision APIs)
6. **Auto-price everything** using a configurable Price Book with material costs and labor hours
7. **Compile and aggregate** all takeoff data across multiple drawings into grouped, filterable reports
8. **Manage multiple projects** with a dashboard and Quickbase CRM integration

The entire application runs client-side in the browser using IndexedDB for persistence — there is no backend server.

---

## Architecture Overview

| File | Lines | Role |
|---|---|---|
| `index.html` | 10,617 | Main application: UI, PDF viewer, drawing canvas, all event handlers, IndexedDB storage, project/drawing management, routing, Price Book, stack palette, annotation system |
| `compiler.js` | 2,024 | Takeoff compiler: aggregates duct runs, fittings, stacks across pages/drawings into grouped hierarchical reports with material cost and labor hour calculations |
| `hvac-library.js` | 1,498 | HVAC component library: master catalog of equipment with matching engine, labor breakdown radar chart, price book sync |
| `multiselect.js` | 678 | Multi-select system: rectangle/lasso selection, bulk edit panel, copy/paste, move-drag of selected items |
| `price-defaults.js` | 590 | Centralized pricing data: spiral/snaplock/rect duct defaults, fitting SA formulas, shop overhead, labor categories, labor defaults loader |
| `schedule-ai.js` | 348 | AI schedule extraction: sends plan images to vision APIs (Gemini/Claude/OpenAI), parses structured equipment JSON |
| `labor-defaults.json` | 362 | Default labor hours by item type and size, broken down by labor category (rough, trim, stocking, startup, QC, etc.) |
| `projects.json` | 0 | Empty — likely a placeholder for static project data |

**Total: ~16,100 lines of code** across 8 files.

---

## Detailed Module Review

### 1. `index.html` — The Core Application (10,617 lines)

This is a monolithic single-page application containing everything from CSS to IndexedDB to the PDF canvas renderer. Key subsystems:

#### Storage Layer (lines ~977–1090)
- IndexedDB with 5 object stores: `projects`, `drawings`, `pageData`, `priceBook`, `hvacLibrary`
- Clean async helpers (`idbGet`, `idbPut`, `idbAdd`, `idbDelete`, `idbGetAllByIndex`)
- Binary drawing data stored as base64 blobs with encode/decode helpers

#### Routing (lines ~1329–1370)
- Hash-based client-side routing: `#/` (dashboard), `#/project/:id` (drawing manager), `#/viewer/:projectId/:drawingId` (viewer)
- `navigateTo()`, `parseRoute()`, `handleRoute()` pattern

#### Dashboard (lines ~1375–1945)
- Project grid with search, infinite scroll pagination (36 per page), IntersectionObserver-based lazy loading
- Quickbase CRM sidebar panel with sortable/filterable table, column filters, drag-to-import from QB to local projects
- New project modal with optional Quickbase import
- Project CRUD: create, rename, delete with confirmation dialogs
- Backup/restore: full IndexedDB export/import as JSON

#### Drawing Manager (lines ~2066–2680)
- Per-project drawing list with collapsible cards showing sheet-level metadata
- PDF upload via file picker or drag-and-drop
- Multi-PDF support, sheet deletion, drawing duplication (with/without takeoff data)
- Drawing rename, delete, re-upload

#### PDF Viewer & Canvas (lines ~2680–7840)
This is the heart of the application:
- **PDF rendering** via pdf.js with pan/zoom (mouse wheel, keyboard shortcuts)
- **Scale system**: Architectural scales (1/4"=1'-0", 1/8"=1'-0", etc.), engineering scales (1:10 through 1:500), custom calibration by measuring a known distance
- **Measurement mode**: Click-to-draw polylines, computes real-world distance from scale, ortho-constraint with Shift key
- **Duct draw mode**: Like measurement but auto-tags duct type, dimensions, gauge, liner
- **Snap system**: Fittings have connection points, measurements snap to fitting connectors and other endpoints within a threshold
- **Annotation system**: Configurable label size, text opacity, fill opacity with slider controls
- **Endpoint dragging**: Click-drag to reposition measurement endpoints and segments
- **Fitting placement**: Click canvas to drop a fitting, with rotation and mirror controls

#### Duct/Fitting Drawing Engine (lines ~7000–10520)
- Full rendering of duct runs as 2D plan-view outlines (parallel lines with proper width for rectangular, circles for round)
- Flex duct drawn with sinusoidal wavy lines
- Fitting drawing functions for every type: `drawElbow`, `drawTee`, `drawWye`, `drawReducer`, `drawTransition`, `drawBoot`, `drawEndCap`, `drawCoupling`, `drawRectTap`, `drawSaddle45Y`, `drawLateral`, `drawSquareWing`
- HVAC component symbols: plan-view representations for RTUs, fans, diffusers, terminal units, heaters, specialty items
- All drawn onto an HTML5 Canvas overlay

#### Price Book UI
- Floating draggable/resizable panel
- Sections for: spiral duct, snaplock, flex, rectangular duct, rectangular fittings, saddle taps, accessories, shop settings, labor categories
- Tabbed interface per duct/fitting type with size-specific pricing
- Labor breakdown radar chart per item with 9 categories (Rough, Air Handler, Condenser, Line Set, Trim, Venting, Stocking, Startup, QC)

#### Vertical Stack System (lines ~9045–9620)
- Place a stack point on the canvas, add items (duct runs, fittings) vertically
- Callout labels radiate outward from the stack center
- Full pricing integration with the compiler

### 2. `compiler.js` — Takeoff Compiler (2,024 lines)

**Purpose**: Aggregates all takeoff data (duct runs, fittings, HVAC components, stacks) across all pages and drawings in a project into a hierarchical grouped report.

**Key features**:
- **Multi-dimensional grouping**: Users drag-and-drop "chips" to group by Type, Size, Shape, Phase, Cost Group, Gauge, Lined/Unlined, Labor Category, System Tag, Page, Drawing — in any order
- **Data columns**: Qty, Total LF, Material $, Labor Hrs, Labor $, Total $
- **Labor breakdown**: 9 categories can be "pinned" as sub-columns, with collapsible dot-cluster indicators
- **Filtering**: Per-dimension filter popovers with checkboxes (All/None/individual)
- **Inline cell editing**: Click any numeric cell to override values; overrides persist back to IndexedDB source items
- **Grand total contingency**: Editable grand total row where typing a desired total auto-calculates a contingency delta
- **Radar chart**: SVG spider/radar chart showing labor hours by category, with editable inputs
- **Selection scope**: Toggle between "Selection" (only items selected on canvas) and "Entire Project"
- **Material cost calculation**: Full pricing pipeline — checks Price Book overrides, then size-specific defaults, then SA-based auto-calculation for rectangular fittings (SA × gauge weight × $/lb + liner + shop overhead)

### 3. `hvac-library.js` — HVAC Component Library (1,498 lines)

**Purpose**: A master catalog of HVAC equipment that persists across projects. Used for matching AI-extracted schedule items to known library entries.

**Key features**:
- **CRUD operations** on IndexedDB `hvacLibrary` store
- **8 categories**: Equipment, Fans, Air Distribution, Terminal Units, Energy Recovery, Heating, Makeup Air, Specialty
- **Matching engine**: Scores library entries against extracted items with 4 tiers:
  - 1.0: Exact match (manufacturer + model)
  - 0.8: Strong match (type + manufacturer)
  - 0.6: Fuzzy match (type + similar specs within tolerance)
  - 0.2–0.3: Category match
- **Library browser UI**: Tabbed category view, search, expandable cards with inline editing
- **Labor breakdown radar chart** per component with category-aware applicable labor categories
- **Match step UI**: Post-AI-extraction workflow showing extracted items with match indicators (green=matched, yellow=possible, blue=new), inline labor hour editing before import, bulk actions (Link All Matches, Save All New)
- **Price Book sync**: Bi-directional sync between library entries and the global Price Book

### 4. `multiselect.js` — Multi-Select & Bulk Edit (678 lines)

**Purpose**: Selection tools for the canvas.

**Key features**:
- **Rectangle selection** (Q key): Shift+drag to select items in a box
- **Lasso selection** (L key): Freehand polygon selection with ray-casting point-in-polygon test
- **Deselect mode** (Alt key): Removes items from selection
- **Move-drag**: Click-drag on selected items to reposition them
- **Bulk edit panel**: Floating panel to set System Tag, Phase, Cost Group, Gauge on all selected items at once
- **Copy/Paste**: Deep-clone selected items with offset
- **Delete**: Bulk delete with confirmation

### 5. `schedule-ai.js` — AI Schedule Extraction (348 lines)

**Purpose**: Uses vision AI to extract HVAC equipment from mechanical schedule images.

**Key features**:
- **Multi-provider**: Supports Google Gemini (default/free tier), Anthropic Claude, and OpenAI GPT-4o
- **Auto-detection**: Identifies provider from API key format (AIza → Gemini, sk-ant → Anthropic, sk- → OpenAI)
- **Detailed extraction prompt**: Extracts tag, type, category, CFM, tonnage, model, manufacturer, heating, voltage, refrigerant, MCA/MOCP, size, quantity, location, and technical notes
- **Smart categorization**: Maps extracted items into 8 categories with standardized type names
- **JSON parsing**: Handles markdown-wrapped AI responses
- **Symbol generation**: Converts extracted equipment into color-coded canvas symbols

### 6. `price-defaults.js` — Pricing Data (590 lines)

**Purpose**: Centralized default material costs and reference data.

**Content**:
- **Spiral duct pricing**: 3" through 36" diameter, by gauge (26/24/22), $/LF
- **Spiral fittings**: 90° elbows, 45° elbows, tees, couplings, end caps, reducers, wyes — all with size-specific pricing
- **Snaplock pricing**: Same fitting types for snaplock duct
- **Flex duct**: Black and silver flex, 4" through 20", $/ft
- **Rectangular fittings**: Surface area formulas for 12 fitting types, min-width class pricing, shop overhead defaults
- **Boot pricing**, **saddle tap pricing** (spiral and snaplock)
- **Shop settings**: Sheet metal $/lb, wrap insulation $/SF
- **Liner options**: 1" and 1.5" liner thickness
- **Labor categories**: 9 categories with applicability rules
- **Labor defaults loader**: Async load from `labor-defaults.json`

### 7. `labor-defaults.json` — Labor Hour Database (362 lines)

**Purpose**: Default labor hours for every item type, broken down by labor category.

**Structure**:
- **Duct section**: Hours per linear foot by duct type and size (spiral, round, rect, oval, flex)
- **Fittings section**: Hours per each by fitting type, size, and shape (spiral, snaplock, rect with min-width classes)
- **Accessories section**: Volume dampers, fire dampers, smoke dampers, access doors, boots
- **Equipment section**: Rooftop units (sm/standard/lg), split systems, mini splits, exhaust fans, unit heaters, ERVs, VAV boxes, diffusers, grilles, louvers
- **Rate table**: Default $45/hr with per-category overrides (stocking $35, startup $55)

---

## Strengths

1. **Domain depth**: This is not a generic drawing tool — it encodes deep HVAC trade knowledge. The pricing models (SA-based rectangular fitting costs, gauge-specific weights, shop overhead by perimeter class, liner adders) reflect real-world estimating workflows.

2. **Self-contained architecture**: Zero backend dependencies. Everything runs in the browser with IndexedDB. Users can work offline, and backup/restore is a simple JSON file.

3. **Comprehensive material database**: Hundreds of size-specific prices for spiral, snaplock, and rectangular ductwork across multiple gauges. This is ready-to-use pricing data.

4. **AI integration done right**: The schedule extraction prompt is extremely well-crafted — it handles edge cases (tag ranges, multiple tables, partial readings) and produces structured, normalized output. The matching engine with tiered scoring is pragmatic.

5. **Labor breakdown model**: The 9-category labor system (Rough, Air Handler, Condenser, Line Set, Trim, Venting, Stocking, Startup, QC) with radar chart visualization is a unique differentiator for HVAC estimating.

6. **Compiler flexibility**: The drag-and-drop multi-dimensional grouping with inline editing and grand total contingency is powerful for real estimating workflows.

7. **Canvas rendering quality**: The duct and fitting drawing functions produce professional-looking plan-view representations with proper geometry (parallel offsets, arc bends, branch intersections).

---

## Areas for Improvement

### Architecture

1. **Monolithic `index.html`** (10,617 lines): This file contains CSS, HTML, and ~9,600 lines of JavaScript. It should be decomposed:
   - Extract CSS into a separate `styles.css`
   - Split the JS into logical modules: `viewer.js`, `dashboard.js`, `drawing-manager.js`, `price-book-ui.js`, `stack-palette.js`, `canvas-renderer.js`, `storage.js`, `routing.js`
   - The fitting drawing functions alone (lines ~9616–10520) are a natural separate module

2. **No build system**: The app uses ES modules loaded directly in the browser. This works but limits the ability to use TypeScript, tree-shaking, minification, or code splitting. A lightweight bundler (Vite) would improve developer experience without adding complexity.

3. **Global function exposure**: Many functions are exposed on `window` for inline `onclick` handlers in HTML strings. This is fragile. Moving to event delegation or a minimal component pattern would improve maintainability.

### Code Quality

4. **Duplicated logic**: The `_HVAC_TYPE_TO_LABOR_KEY` mapping is duplicated identically between `compiler.js` (line 366) and `hvac-library.js` (line 303). The `LABOR_CATEGORIES`/`LABOR_CATS` array is defined three times (in `price-defaults.js`, `compiler.js`, and `hvac-library.js`). These should be imported from a single source.

5. **Potential bug in stack pricing** (compiler.js line 840): There's a line `stMatCost = (mwE && mwE.materialCost != null) ? mwE.materialCost : (0[mw] || 0);` — the expression `0[mw]` is accessing a property on the number `0`, which will always be `undefined`. This should likely reference `RECT_FLEX_CONN_DEFAULTS[mw]` instead (similar to the pattern at line 661).

6. **Mixed `var`/`let`/`const`**: The compiler radar functions use `var` (e.g., lines 1234, 1239, 1764) while the rest of the codebase uses `let`/`const`. Should be standardized.

7. **No error boundaries**: IndexedDB operations have basic try/catch but there's no user-facing error reporting. If a database operation fails silently, the user won't know their data wasn't saved.

### Data & Pricing

8. **Empty `projects.json`**: This file is empty (0 bytes). If it's not needed, remove it. If it's intended for static demo data, populate it or document its purpose.

9. **Snaplock tap pricing gaps**: Many entries in `SNAPLOCK_TAP_DEFAULTS` are empty objects (`{}`), meaning those sizes have no pricing. The UI should surface these gaps so users know to enter manual prices.

10. **Hardcoded Quickbase URL**: The QB integration points to a specific company instance (`reeisinc.quickbase.com`). This should be configurable for other users/companies.

### UX

11. **No undo/redo**: There is no undo system. Accidental deletions or edits can only be recovered via the backup/restore flow. An undo stack (even just for the last 10–20 actions) would significantly improve usability.

12. **No keyboard shortcut reference**: The app has many keyboard shortcuts (M=measure, D=duct draw, T=insert, S=stack, Q=select, L=lasso, F=fit, R=rotate, X=mirror, Del=delete) but no help panel or cheat sheet accessible from the UI.

13. **Panel state**: The Price Book and HVAC Library panels are floating draggable windows, but their positions aren't persisted. Reopening them resets position/size.

### Performance

14. **Full re-render on every interaction**: `renderCompiler()` rebuilds the entire compiler HTML on every toggle, filter change, or group reorder. For large projects this could become slow. A virtual DOM or incremental update approach would help.

15. **Canvas redraw efficiency**: `drawMeasureOverlay()` redraws all measurements, fittings, and stacks on every frame. For pages with hundreds of items, this could benefit from spatial indexing or layer caching.

---

## Summary

This is a sophisticated, domain-specific HVAC estimating application with impressive depth. The pricing models, labor breakdown system, AI schedule extraction, and multi-dimensional compiler are production-quality features that reflect real trade knowledge. The main area for improvement is the monolithic architecture of `index.html` — splitting it into focused modules would make the codebase significantly more maintainable as features continue to grow. The bug at compiler.js line 840 (`0[mw]`) should be fixed immediately as it silently produces incorrect pricing for flex connectors in vertical stacks.

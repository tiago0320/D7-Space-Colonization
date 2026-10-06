# D7-Space-Colonization

Studio web app for growing path-constrained space-colonization branches on imported PNG, JPG, or SVG grids, and for growing 3D branching along a built-in SVG lattice inside a 20' cube. Work stays in the browser: grids, variants, saved simulations, saved descriptor matrices, saved 3D variations, and saved Grid Growth iterations persist locally, and PNG snapshots can restore a layout later.

## Features

- Import grids into three slots and grow branching on the 20' × 20' site
- Place roots, merge nearby branches, and draw repulsion geometry by hand in Studio
- **3D Space**: clip a 2D chunk of grown branches, place it in a 20' × 20' × 20' cube, then transform it with Move / Rotate / Scale gizmos
- **Custom Grid** (3D Space): import an SVG, PNG, or JPG as a shared 20' × 20' reference lattice, extrude it, and persist the default locally
- **Generate Variations**: turn a confirmed 2D chunk into six volumetric solid studies (A1–B3) without thickening the 2D lines
- **3D Grid Growth**: grow space-colonization branches along the built-in SVG lattice in a 20' cube (Horizontal, Vertical, or Both), with display-only toggles for attractors and grid layers
- **Connect Root Networks** (3D Grid Growth): optional. Off, each root stays independent. On, nearby networks may join through unused SVG-grid edges within **Network Connection Distance** (default 1.0'). **Root Connection Bias** (default 50) only steers tips toward another network when it is already close. Joins flash yellow for about a second. Original root IDs are kept after a merge
- **Rectangular Geometry** (3D Grid Growth): the cyan selection box is a fixed 20' × 20' × 20' architectural module (1 unit = 1 foot). **Generate Geometry** clips the grown branches, then fits a smaller or larger chunk into that 20' cube without changing the box's meaning. Edit one rectangle at a time (width, thickness, length, move, rotate, duplicate, delete). Cuts at the selection are capped so each solid stays closed
- **Thin Surfaces** (3D Grid Growth): **SURFACE** shows zero-thickness strips along the branches. Strips miter at turns and weld at forks so joints do not overlap. Click a strip to select it (width, move, rotate, delete). Width is the strip width
- **GEOMETRY | SURFACE | BOTH** (3D Grid Growth): switch what is visible without deleting the other. GEOMETRY is the editable rectangles, SURFACE is the developed strips, BOTH overlays both
- **Show Human Scale** (3D Grid Growth): optional 6'-0" flat silhouette on the selection-box floor (30% of the 20' box height). It follows the box in world units, not viewport pixels. Viewport-only; it is not exported
- **Saved Iterations** (3D Grid Growth): store the actual viewport geometry (branch coordinates, edited boxes, clipped meshes, surfaces, selection box, camera) in IndexedDB. **Load** restores that same state without regenerating. **Reset Current** clears the working copy only
- **Grid Growth Export**: **Export Geometry**, **Export Surface**, or **Export Both** writes the generated rectangular solids and branch lines as OBJ or Rhino `.3dm` (units = feet). Rhino boxes are closed polysurfaces of the same Generate Geometry solids, including clips at the 20' cube. Layers are `GENERATED_GEOMETRY`, `DEVELOPED_SURFACES`, `SOURCE_BRANCHES`, `SELECTION_BOX`, and `ROOT_POINTS`
- **Export Branches SVG** (3D Grid Growth): download the white branch lines currently inside the cyan 20' box as SVG (1 unit = 1 foot, current camera view)
- **Branch Solids**: loft rectangular solids along the selected 2D branches; space between branches stays void
- **Section Loft Set**: add sequential morphed sections with preserved topology, then loft corresponding branches into 3D solids when you choose
- **Saved 3D Variations**: store the exact 3D study (sections, edits, loft, voxels, display, camera) in IndexedDB and reopen it later
- **Adaptive voxels**: Small / Medium / Large cubes from the current loft and visible branches, including disconnected lines
- **3D Export**: download the current loft or voxels as an OBJ mesh or a Rhino `.3dm` Brep / closed polysurface
- **360 Turntable**: preview and export a real H.264 MP4 of the current 3D study rotating 360° with a fixed camera
- **Outline + Interior**: red outer contour from the current camera, with black voxel edges still readable inside the form
- Display controls for grid opacity, attractor size/color, branch thickness, and branch hierarchy colors
- Save simulations locally (Lobby, Workspace, Gathering) with IndexedDB
- Export camera-independent PNG (with optional restore metadata) and SVG
- **Descriptor Matrix**: generate a pool of emergent branching candidates, analyze them as abstract sections, score them against a spatial descriptor, then show the best 25 diverse results in a 5 × 5 matrix
- **Save Matrix**: store a complete generated 5 × 5 matrix in IndexedDB (all 25 iterations, scores, and previews) and reopen it later without regenerating
- Export all 25 matrix simulations at once as a ZIP of individual PNGs or SVGs (fixed 20' × 20' site, no matrix UI)

## Getting started

Open `index.html` in a browser, or from this folder:

```bash
python -m http.server 8000
```

Then visit http://localhost:8000

## Controls

- **Studio**: Upload a grid, add roots, press Grow, then save or export
- Scroll to zoom, middle-drag to pan
- **3D Space** (tab): **Select 2D Chunk**, draw on the 2D Reference, **Confirm Selection**, then transform the chunk in the cube. Use **ISO / FRONT / PERSP** views, **Save PNG**, **Outline + Interior**, and **Reset 3D Space** (clears the workspace only; saved 3D variations stay)
- **Custom Grid**: import SVG/PNG/JPG in 3D Space; the lattice is shared with Generate Variations and stays in this browser
- **Generate Variations**: with a chunk selected, generate A1–B3 solids, then **Show Generated Solid** to inspect one
- **3D Grid Growth** (tab): pick Horizontal / Vertical / Both, set **Grid Layer Spacing**, **Generate Attractors**, add a root, then **Start**. **Connect Root Networks** lets separate roots join on the grid when they grow close; leave it off to keep them independent. **Display Settings** hide attractors or H/V grid lines without changing growth. Use **ISO / FRONT / TOP** cameras
- **Generate Geometry**: after growth, generate closed rectangles inside the 20' module. A smaller or larger chunk is normalized into that cube. Click a solid to edit it; in SURFACE, click a strip. **GEOMETRY | SURFACE | BOTH** switches visibility. **Show Human Scale** toggles the 6' figure (always 30% of the 20' box). **Reset Current** clears working geometry without deleting saved iterations
- **Saved Iterations**: **Save Iteration** stores the geometry currently on screen. **Load** restores those exact branches and boxes without regenerating; **Save Changes** overwrites the opened iteration; **Save As New Iteration** / **Duplicate** make independent copies. **Delete Iteration** does not touch 2D simulations or 3D Space variations
- **Grid Growth Export**: **Export Geometry** / **Export Surface** / **Export Both** download the generated solids and branch lines as OBJ and Rhino `.3dm` (feet). Rhino geometry is closed polysurfaces that match Generate Geometry. **Export Branches SVG** downloads the clipped branch lines in the active view. The human scale figure is not included
- **Section Loft**: with a chunk selected, **Create Loft Set**, **Add Morphed Section**, inspect layers, then **Generate Loft**
- **Saved 3D Variations**: **Save 3D Variation** stores the current study in this browser. **Open** restores it exactly; **Save** updates it, **Save As New** / **Duplicate** make independent copies. **Delete** does not touch 2D simulations or matrices
- **Voxels**: **Generate Voxels** from the loft and remaining branch lines, including disconnected islands; **Voxel Resolution** sets the smallest cell count across 20'; **Voxel Fidelity** controls how readily larger cubes replace small ones
- **360 Turntable**: set the view, **Preview**, then **Export MP4**. The camera stays fixed; the study rotates 360°. The 20' cube frames the video and is hidden in the recording
- **3D Export**: after a loft or voxels exist, **Export Loft/Voxel Mesh (.OBJ)** or **Export Loft/Voxel Polysurface (.3DM)** (units stay in feet)
- **Branch Solids**: with a chunk selected, **Generate Branch Solids** to loft along the 2D network without enclosing voids
- **Repulsion Geometry**: draw rectangles, circles, or polygons; switch Hard Boundary vs Repulsion
- **Saved Simulations**: name a layout and store it in this browser only
- **Descriptor Matrix**: pick Spatial Type and Descriptor, set Intensity (scoring strictness) and Variation (candidate range), then **Generate Matrix**
- **Save Matrix**: after a full 5 × 5 generate, save the matrix locally; filter **Saved Matrices** by Lobby / Workspace / Gathering and **Open Matrix** to restore all 25 iterations
- **Save All PNGs / Save All SVGs**: download one ZIP with the twenty-five current matrix cells as separate files
- Open a matrix cell in the Simulator to inspect the exact selected growth; add repulsion afterward if you want

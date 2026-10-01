# D7-Space-Colonization

Studio web app for growing path-constrained space-colonization branches on imported PNG, JPG, or SVG grids. Work stays in the browser: grids, variants, saved simulations, saved descriptor matrices, and saved 3D variations persist locally, and PNG snapshots can restore a layout later.

## Features

- Import grids into three slots and grow branching on the 20' × 20' site
- Place roots, merge nearby branches, and draw repulsion geometry by hand in Studio
- **3D Space**: clip a 2D chunk of grown branches, place it in a 20' × 20' × 20' cube, then transform it with Move / Rotate / Scale gizmos
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

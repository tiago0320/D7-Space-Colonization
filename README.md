# D7-Space-Colonization

Studio web app for growing path-constrained space-colonization branches on imported PNG, JPG, or SVG grids. Work stays in the browser: grids, variants, saved simulations, and saved descriptor matrices persist locally, and PNG snapshots can restore a layout later.

## Features

- Import grids into three slots and grow branching on the 20' × 20' site
- Place roots, merge nearby branches, and draw repulsion geometry by hand in Studio
- **3D Spatial Study**: select a 2D chunk of grown branches in Studio and generate a sectional 20' × 20' × 20' volume (Three.js viewer, orbit / zoom / pan)
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
- **3D Spatial Study** (tab): In Studio, use **Select Chunk**, draw a rectangle over branches, then **Generate 3D Space**
- **Repulsion Geometry**: draw rectangles, circles, or polygons; switch Hard Boundary vs Repulsion
- **Saved Simulations**: name a layout and store it in this browser only
- **Descriptor Matrix**: pick Spatial Type and Descriptor, set Intensity (scoring strictness) and Variation (candidate range), then **Generate Matrix**
- **Save Matrix**: after a full 5 × 5 generate, save the matrix locally; filter **Saved Matrices** by Lobby / Workspace / Gathering and **Open Matrix** to restore all 25 iterations
- **Save All PNGs / Save All SVGs**: download one ZIP with the twenty-five current matrix cells as separate files
- Open a matrix cell in the Simulator to inspect the exact selected growth; add repulsion afterward if you want

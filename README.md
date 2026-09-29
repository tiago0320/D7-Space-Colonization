# D7-Space-Colonization

Studio web app for growing path-constrained space-colonization branches on imported PNG, JPG, or SVG grids. Work stays in the browser: grids, variants, and saved simulations persist locally, and PNG snapshots can restore a layout later.

## Features

- Import grids into three slots and grow branching on the 20' × 20' site
- Place roots, merge nearby branches, and draw repulsion geometry by hand in Studio
- Display controls for grid opacity, attractor size/color, branch thickness, and branch hierarchy colors
- Save simulations locally (Lobby, Workspace, Gathering) with IndexedDB
- Export camera-independent PNG (with optional restore metadata) and SVG
- **Descriptor Matrix**: generate a pool of emergent branching candidates, analyze them as abstract sections, score them against a spatial descriptor, then show the best 9 diverse results
- Export all 9 matrix simulations at once as a ZIP of individual PNGs or SVGs (fixed 20' × 20' site, no matrix UI)

## Getting started

Open `index.html` in a browser, or from this folder:

```bash
python -m http.server 8000
```

Then visit http://localhost:8000

## Controls

- **Studio**: Upload a grid, add roots, press Grow, then save or export
- Scroll to zoom, middle-drag to pan
- **Repulsion Geometry**: draw rectangles, circles, or polygons; switch Hard Boundary vs Repulsion
- **Saved Simulations**: name a layout and store it in this browser only
- **Descriptor Matrix**: pick Spatial Type and Descriptor, set Intensity (scoring strictness) and Variation (candidate range), then Generate Matrix
- **Save All PNGs / Save All SVGs**: download one ZIP with the nine current matrix cells as separate files
- Open a matrix cell in the Simulator to inspect the exact selected growth; add repulsion afterward if you want

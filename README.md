# D7-Space-Colonization

Studio web app for growing path-constrained space-colonization branches on imported PNG, JPG, or SVG grids, and for growing 3D branching along a built-in SVG lattice inside a 20' cube. Work stays in the browser: grids, variants, saved simulations, saved descriptor matrices, and saved Grid Growth iterations persist locally, and PNG snapshots can restore a layout later.

## Features

- Import grids into three slots and grow branching on the 20' × 20' site
- Place roots, merge nearby branches, and draw repulsion geometry by hand in Studio
- **3D Grid Growth**: grow space-colonization branches along the built-in SVG lattice in a 20' cube (Horizontal, Vertical, or Both), with display-only toggles for attractors and grid layers
- **Connect Root Networks** (3D Grid Growth): optional. Off, each root stays independent. On, nearby networks may join through unused SVG-grid edges within **Network Connection Distance** (default 1.0'). **Root Connection Bias** (default 50) only steers tips toward another network when it is already close. Joins flash yellow for about a second. Original root IDs are kept after a merge
- **20' Module** (3D Grid Growth): the cyan selection box is a fixed 20' × 20' × 20' architectural module (1 unit = 1 foot). Place it on grown branches to clip the viewport and exports. The box itself never changes its 20' meaning
- **Descriptor Analysis** (3D Grid Growth): optional. Off = the manual growth workflow is unchanged. On = generate many 3D networks, score them in XYZ against a Lobby / Workspace / Gathering descriptor, then load one. The word sets spatial criteria, not a predetermined form
- **Show Human Scale** (3D Grid Growth): optional 6'-0" flat silhouette on the selection-box floor (30% of the 20' box height). It follows the box in world units, not viewport pixels. Viewport-only; it is not exported
- **Saved Iterations** (3D Grid Growth): store the actual viewport branching (branch coordinates, roots, attractors, selection box, camera) in IndexedDB. **Load** restores that same state without regenerating
- **Export Grasshopper Package** (optional): `grasshopper/D7_PrepMesh_To_Kangaroo.ghx` is a later Rhino/Grasshopper soap-film script. The browser does not run Kangaroo
- **Export Branches** (3D Grid Growth): download the white branch lines currently inside the cyan 20' box as SVG, OBJ, and Rhino `.3dm` (1 unit = 1 foot). SVG uses the current camera view. 3DM / OBJ layers are `SOURCE_BRANCHES`, `SELECTION_BOX`, and `ROOT_POINTS`
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
- **3D Grid Growth** (tab): pick Horizontal / Vertical / Both, set **Grid Layer Spacing**, **Generate Attractors**, add a root, then **Start**. **Connect Root Networks** lets separate roots join on the grid when they grow close; leave it off to keep them independent. **Display Settings** hide attractors or H/V grid lines without changing growth. Use **ISO / FRONT / TOP** cameras
- **Descriptor Analysis**: turn **Descriptor Mode** on, pick a category and word, **GENERATE CANDIDATES**, then **LOAD CANDIDATE**. Influence 0 is unguided branching; 100 strengthens biases without locking a form
- **Module**: after growth, **Move Box** / **Scale Box** place the 20' module on the network. **Show Human Scale** toggles the 6' figure (always 30% of the 20' box)
- **Saved Iterations**: **Save Iteration** stores the branching currently on screen. **Load** restores those exact branches without regenerating; **Save Changes** overwrites the opened iteration; **Save As New Iteration** / **Duplicate** make independent copies. **Delete Iteration** does not touch 2D simulations
- **Export Branches**: **Export Branches SVG** downloads the clipped branch lines in the active view. **Export Branches** writes OBJ and Rhino `.3dm` (feet) with `SOURCE_BRANCHES`, `SELECTION_BOX`, and `ROOT_POINTS`. The human scale figure is not included
- **Repulsion Geometry**: draw rectangles, circles, or polygons; switch Hard Boundary vs Repulsion
- **Saved Simulations**: name a layout and store it in this browser only
- **Descriptor Matrix**: pick Spatial Type and Descriptor, set Intensity (scoring strictness) and Variation (candidate range), then **Generate Matrix**
- **Save Matrix**: after a full 5 × 5 generate, save the matrix locally; filter **Saved Matrices** by Lobby / Workspace / Gathering and **Open Matrix** to restore all 25 iterations
- **Save All PNGs / Save All SVGs**: download one ZIP with the twenty-five current matrix cells as separate files
- Open a matrix cell in the Simulator to inspect the exact selected growth; add repulsion afterward if you want

# Space Colonization

Interactive 2D visualization of the space colonization algorithm used to grow branching structures (trees, veins, lightning, networks).

Open `index.html` in a browser, or from this folder:

```bash
python -m http.server 8000
```

Then visit http://localhost:8000

## How the algorithm works

1. Scatter **attractors** (resource points) in a region.
2. Plant one or more **seed nodes**.
3. Each step, every attractor picks the closest node inside the attraction radius.
4. Each chosen node grows one step toward the average direction of the attractors that picked it.
5. Attractors within the **kill distance** of a new node are removed.

Branching happens because neighboring nodes are pulled toward different local clusters of attractors.

## Controls

- Left drag paints attractors
- Right click plants a seed
- Space plays or pauses
- Presets load different attractor fields and growth settings

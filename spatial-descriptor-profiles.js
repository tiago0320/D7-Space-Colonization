/**
 * Descriptor catalogs, generation biases, and scoring profiles.
 * Biases nudge attractor / root placement. They do not prescribe a shape.
 */
(function (global) {
  const CUBE = 20;

  const CATALOG = {
    lobby: [
      { id: "interlocking", label: "Interlocking" },
      { id: "centralized", label: "Centralized" },
      { id: "sequential", label: "Sequential" },
      { id: "terraced", label: "Terraced" },
      { id: "continuous", label: "Continuous" },
    ],
    workspace: [
      { id: "porosity", label: "Porosity" },
      { id: "stepped", label: "Stepped" },
      { id: "overlooking", label: "Overlooking" },
      { id: "sequential", label: "Sequential" },
      { id: "compressed", label: "Compressed" },
    ],
    gathering: [
      { id: "nesting", label: "Nesting" },
      { id: "offset", label: "Offset" },
      { id: "terraced", label: "Terraced" },
      { id: "vertical-porosity", label: "Vertical Porosity" },
      { id: "slope", label: "Slope" },
    ],
  };

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function randRange(rng, a, b) {
    return a + rng() * (b - a);
  }

  function blob(x, y, z, c, r) {
    const dx = x - c.x;
    const dy = y - c.y;
    const dz = z - c.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const t = 1 - d / Math.max(0.8, r);
    return t > 0 ? t * t : 0;
  }

  function descriptorsFor(category) {
    const key = String(category || "lobby").toLowerCase();
    return CATALOG[key] || CATALOG.lobby;
  }

  function labelOf(category, id) {
    const list = descriptorsFor(category);
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i].label;
    return id;
  }

  function buildBias(category, descriptor, influence, rng) {
    const t = clamp(Number(influence) / 100, 0, 1);
    const cat = String(category || "lobby").toLowerCase();
    const id = String(descriptor || "").toLowerCase();
    const bias = {
      id: cat + ":" + id,
      influence: t,
      blobs: [],
      voids: [],
      zBands: [],
      horiz: 0,
      vert: 0,
      roots: [],
      connectNetworks: false,
      corridor: null,
    };
    function addBlob(x, y, z, r, w) {
      bias.blobs.push({ x: x, y: y, z: z, r: r, w: w });
    }
    function addRoot(x, y, z) {
      bias.roots.push({ x: clamp(x, 0.5, 19.5), y: clamp(y, 0.2, 19.5), z: clamp(z, 0.5, 19.5) });
    }

    if (id === "compressed") {
      const ax = randRange(rng, 4, 8);
      const az = randRange(rng, 4, 16);
      const bx = randRange(rng, 12, 16);
      const bz = randRange(rng, 4, 16);
      const y0 = randRange(rng, 3, 12);
      addBlob(ax, y0, az, randRange(rng, 4.5, 6.5), 1);
      addBlob(bx, y0 + randRange(rng, -1.5, 1.5), bz, randRange(rng, 4.5, 6.5), 1);
      bias.corridor = {
        ax: ax,
        ay: y0,
        az: az,
        bx: bx,
        by: y0,
        bz: bz,
        r: 1.6,
        w: -0.55,
      };
      addRoot(ax, Math.max(0.4, y0 - 2), az);
      addRoot(bx, Math.max(0.4, y0 - 2), bz);
      bias.connectNetworks = true;
      bias.horiz = 0.35;
    } else if (id === "centralized") {
      const cx = randRange(rng, 7.5, 12.5);
      const cy = randRange(rng, 4, 10);
      const cz = randRange(rng, 7.5, 12.5);
      addBlob(cx, cy, cz, randRange(rng, 5, 7.5), 1.2);
      addBlob(randRange(rng, 2, 18), randRange(rng, 2, 16), randRange(rng, 2, 18), 3.5, 0.28);
      addBlob(randRange(rng, 2, 18), randRange(rng, 2, 16), randRange(rng, 2, 18), 3.2, 0.22);
      addRoot(cx, Math.max(0.3, cy - 3), cz);
      bias.horiz = 0.15;
      bias.vert = 0.12;
    } else if (id === "terraced") {
      const bands = cat === "gathering" ? 3 : 4;
      const y0 = randRange(rng, 1.5, 3.5);
      const gap = (16 - y0) / Math.max(2, bands - 0.2);
      for (let i = 0; i < bands; i++) {
        const y = y0 + i * gap;
        bias.zBands.push({ y: y, h: 1.6, w: 1 });
        addBlob(randRange(rng, 5, 15), y, randRange(rng, 5, 15), cat === "gathering" ? 7 : 5.5, 0.55);
      }
      addRoot(randRange(rng, 6, 14), y0, randRange(rng, 6, 14));
      if (cat === "gathering") addRoot(randRange(rng, 6, 14), y0 + gap, randRange(rng, 6, 14));
      bias.horiz = cat === "gathering" ? 0.55 : 0.45;
      bias.vert = 0.08;
      bias.connectNetworks = cat === "gathering";
    } else if (id === "interlocking") {
      addBlob(randRange(rng, 5, 9), randRange(rng, 4, 12), randRange(rng, 5, 9), 5.5, 1);
      addBlob(randRange(rng, 11, 16), randRange(rng, 5, 13), randRange(rng, 10, 16), 5.5, 1);
      addBlob(randRange(rng, 8, 13), randRange(rng, 8, 14), randRange(rng, 6, 12), 4.2, 0.7);
      addRoot(randRange(rng, 5, 8), 1, randRange(rng, 5, 8));
      addRoot(randRange(rng, 12, 16), 2, randRange(rng, 12, 16));
      bias.connectNetworks = true;
    } else if (id === "sequential") {
      const x0 = randRange(rng, 3, 5);
      const z0 = randRange(rng, 4, 8);
      const n = cat === "workspace" ? 4 : 3;
      for (let i = 0; i < n; i++) {
        addBlob(x0 + i * 4.2, randRange(rng, 3, 8) + i * 0.6, z0 + i * randRange(rng, 1.2, 2.4), cat === "workspace" ? 3.6 : 4.4, 0.9);
      }
      addRoot(x0, 0.5, z0);
      bias.horiz = 0.4;
      bias.connectNetworks = false;
    } else if (id === "continuous") {
      addBlob(10, 8, 10, 11, 0.55);
      addRoot(randRange(rng, 6, 14), 0.4, randRange(rng, 6, 14));
      bias.horiz = 0.22;
      bias.vert = 0.18;
    } else if (id === "porosity") {
      addBlob(10, 8, 10, 9, 0.4);
      for (let i = 0; i < 3; i++) {
        bias.voids.push({
          x: randRange(rng, 5, 15),
          y: randRange(rng, 4, 14),
          z: randRange(rng, 5, 15),
          r: randRange(rng, 2.4, 3.6),
          w: -0.85,
        });
      }
      addRoot(randRange(rng, 4, 8), 0.5, randRange(rng, 4, 8));
      addRoot(randRange(rng, 12, 16), 1, randRange(rng, 12, 16));
      bias.connectNetworks = true;
    } else if (id === "stepped") {
      for (let i = 0; i < 4; i++) bias.zBands.push({ y: 2 + i * 4.2, h: 1.1, w: 1 });
      addRoot(randRange(rng, 5, 10), 1, randRange(rng, 5, 10));
      bias.horiz = 0.6;
      bias.vert = 0.05;
    } else if (id === "overlooking") {
      addBlob(randRange(rng, 7, 12), randRange(rng, 3, 6), randRange(rng, 7, 12), 5, 1);
      addBlob(randRange(rng, 8, 13), randRange(rng, 11, 15), randRange(rng, 8, 13), 4.5, 1);
      addRoot(10, 1, 10);
      addRoot(11, 12, 9);
      bias.connectNetworks = true;
      bias.vert = 0.2;
    } else if (id === "nesting") {
      const cx = randRange(rng, 8, 12);
      const cy = randRange(rng, 5, 10);
      const cz = randRange(rng, 8, 12);
      addBlob(cx, cy, cz, 8.5, 0.55);
      addBlob(cx + randRange(rng, -1.5, 1.5), cy, cz + randRange(rng, -1.5, 1.5), 3.2, 1.15);
      addRoot(cx - 4, 0.6, cz - 3);
      addRoot(cx, cy - 1, cz);
      bias.connectNetworks = true;
    } else if (id === "offset") {
      addBlob(randRange(rng, 4, 7), randRange(rng, 3, 7), randRange(rng, 4, 8), 5, 1);
      addBlob(randRange(rng, 12, 16), randRange(rng, 9, 14), randRange(rng, 11, 16), 5, 1);
      addRoot(5, 1, 6);
      addRoot(14, 8, 13);
      bias.connectNetworks = true;
    } else if (id === "vertical-porosity") {
      bias.voids.push({ x: randRange(rng, 8, 12), y: 10, z: randRange(rng, 8, 12), r: 3.2, w: -0.9, column: true });
      addBlob(7, 6, 7, 5, 0.7);
      addBlob(13, 10, 13, 5, 0.7);
      addRoot(6, 0.5, 6);
      addRoot(14, 2, 14);
      bias.connectNetworks = true;
      bias.vert = 0.25;
    } else if (id === "slope") {
      addBlob(5, 3, 6, 4.5, 0.8);
      addBlob(10, 8, 10, 4.5, 0.8);
      addBlob(15, 14, 14, 4.5, 0.8);
      addRoot(5, 0.5, 6);
      bias.vert = 0.28;
      bias.horiz = 0.25;
    } else {
      addRoot(10, 0.4, 10);
    }
    return bias;
  }

  function corridorW(x, y, z, c) {
    if (!c) return 0;
    const vx = c.bx - c.ax;
    const vy = c.by - c.ay;
    const vz = c.bz - c.az;
    const len2 = vx * vx + vy * vy + vz * vz || 1;
    const t = clamp(((x - c.ax) * vx + (y - c.ay) * vy + (z - c.az) * vz) / len2, 0, 1);
    const px = c.ax + vx * t;
    const py = c.ay + vy * t;
    const pz = c.az + vz * t;
    const d = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py) + (z - pz) * (z - pz));
    if (d > c.r * 1.8) return 0;
    const mid = 1 - Math.abs(t - 0.5) * 2;
    return (1 - d / (c.r * 1.8)) * mid * (c.w || -0.5);
  }

  function weightAt(x, y, z, bias) {
    if (!bias) return 1;
    let w = 0.18;
    for (let i = 0; i < bias.blobs.length; i++) {
      const b = bias.blobs[i];
      w += blob(x, y, z, b, b.r) * b.w;
    }
    for (let i = 0; i < bias.zBands.length; i++) {
      const band = bias.zBands[i];
      const d = Math.abs(y - band.y);
      if (d < band.h) w += (1 - d / band.h) * band.w;
    }
    for (let i = 0; i < bias.voids.length; i++) {
      const v = bias.voids[i];
      const dx = x - v.x;
      const dz = z - v.z;
      const dy = v.column ? 0 : y - v.y;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < v.r) w += (1 - d / v.r) * v.w;
    }
    w += corridorW(x, y, z, bias.corridor);
    return clamp(w, 0.02, 1.6);
  }

  function part(id, label, value) {
    return { id: id, label: label, value: Math.round(clamp(value, 0, 1) * 100) };
  }

  function weighted(parts, weights) {
    let s = 0;
    let w = 0;
    for (let i = 0; i < parts.length; i++) {
      const wt = weights[i] != null ? weights[i] : 1;
      s += (parts[i].value / 100) * wt;
      w += wt;
    }
    return Math.round(clamp(w ? s / w : 0, 0, 1) * 100);
  }

  function score(metrics, category, descriptor) {
    const m = metrics || {};
    const cat = String(category || "lobby").toLowerCase();
    const id = String(descriptor || "").toLowerCase();
    let parts = [];
    let weights = [];

    if (id === "interlocking") {
      parts = [
        part("overlap", "Cluster Overlap", m.clusterOverlap),
        part("links", "Inter-cluster Connections", clamp(m.interClusterLinks / 10, 0, 1)),
        part("junctions", "Shared Junctions", clamp(m.sharedJunctions * 8, 0, 1)),
        part("central", "Centralization (low-medium)", 1 - Math.abs((m.centralityDominance || 0) - 0.35) / 0.65),
      ];
      weights = [1.3, 1.1, 1.1, 0.6];
    } else if (id === "centralized") {
      parts = [
        part("dominance", "Centrality Dominance", m.centralityDominance),
        part("convergence", "Convergence", m.convergence),
        part("periph", "Peripheral Distribution", m.peripheralDistribution),
        part("clusters", "Cluster Count", 1 - Math.abs((m.clusterCount || 0) - 3.5) / 4),
      ];
      weights = [1.4, 1.15, 0.7, 0.55];
    } else if (id === "sequential") {
      const work = cat === "workspace";
      parts = [
        part("primary", work ? "Primary Path" : "Primary Path Dominance", work ? (m.primaryPathDominance || 0) * 0.85 + 0.1 : m.primaryPathDominance),
        part("order", work ? "Ordered Clusters" : "Cluster Ordering", m.clusterOrdering),
        part("shortcut", "Shortcut Penalty", 1 - clamp((m.pathMultiplicity || 0) * 0.9, 0, 1)),
        part("cont", "Directional Continuity", m.directionalContinuity),
      ];
      if (work) {
        parts.push(part("rhythm", "Repeated Spatial Rhythm", m.repeatedRhythm));
        weights = [0.9, 1.35, 1.0, 0.55, 1.1];
      } else weights = [1.4, 1.15, 1.1, 0.7];
    } else if (id === "terraced") {
      const gather = cat === "gathering";
      parts = [
        part("zclust", "Z Level Clustering", m.zLevelClustering),
        part("horiz", gather ? "Horizontal Extent" : "Horizontal Cluster Extent", gather ? m.horizClusterExtent : m.horizontalExtent),
        part("vconn", gather ? "Vertical Connectivity" : "Vertical Connections", clamp((m.verticalChange || 0) * 1.6, 0, 1) * (1 - (m.fragmentation || 0))),
      ];
      if (gather) {
        parts.push(part("size", "Cluster Size", m.adjacentClusterSize || clamp((m.clusters && m.clusters[0] ? m.clusters[0].importance : 0) * 1.4, 0, 1)));
        weights = [1.4, 1.1, 1.1, 1.05];
      } else weights = [1.45, 1.15, 0.95];
    } else if (id === "continuous") {
      parts = [
        part("conn", "Connectivity", m.connectivity),
        part("dead", "Dead-End Penalty", 1 - (m.deadEndRatio || 0)),
        part("dir", "Directional Continuity", m.directionalContinuity),
        part("frag", "Fragmentation Penalty", 1 - (m.fragmentation || 0)),
      ];
      weights = [1.35, 1.15, 1.1, 1.15];
    } else if (id === "porosity") {
      parts = [
        part("voids", "Void Distribution", clamp((m.voidCount || 0) / 5, 0, 1) * 0.55 + (m.voidSizeVariance || 0) * 0.45),
        part("open", "Open Volume Ratio", m.voidRatio),
        part("multi", "Path Multiplicity", m.pathMultiplicity),
        part("dense", "Excess Density Penalty", 1 - clamp((m.density || 0) * 1.6, 0, 1)),
      ];
      weights = [1.4, 1.15, 0.95, 1.1];
    } else if (id === "stepped") {
      parts = [
        part("discrete", "Discrete Z Changes", m.discreteZChanges),
        part("zclust", "Z Level Clustering", m.zLevelClustering),
        part("horiz", "Horizontal Segments", m.horizontalExtent),
        part("slope", "Continuous Slope Penalty", 1 - (m.continuousSlope || 0)),
      ];
      weights = [1.4, 1.15, 1.1, 0.75];
    } else if (id === "overlooking") {
      parts = [
        part("xy", "XY Overlap Across Z", m.xyOverlapAcrossZ),
        part("voff", "Vertical Offset", clamp((m.zSpan || 0) / 12, 0, 1)),
        part("vopen", "Vertical Openness", m.verticalVoidContinuity),
        part("imp", "Cluster Importance", m.adjacentClusterSize),
      ];
      weights = [1.45, 1.15, 1.1, 0.7];
    } else if (id === "compressed") {
      parts = [
        part("bottleneck", "Bottleneck", m.bottleneckRatio),
        part("contrast", "Open Region Contrast", m.openRegionContrast),
        part("conn", "Connectivity Through Bottleneck", m.throughBottleneck),
        part("clusters", "Adjacent Cluster Size", m.adjacentClusterSize),
      ];
      weights = [1.5, 1.4, 1.05, 1.05];
    } else if (id === "nesting") {
      parts = [
        part("contain", "Spatial Containment", m.spatialContainment),
        part("scale", "Cluster Scale Difference", m.clusterScaleDifference),
        part("links", "Inner/Outer Connections", m.innerOuterLinks),
      ];
      weights = [1.5, 1.15, 1.1];
    } else if (id === "offset") {
      parts = [
        part("offset", "Spatial Offset", m.spatialOffset),
        part("conn", "Connectivity", m.connectivity),
        part("align", "Alignment Penalty", 1 - (m.alignmentPenalty || 0)),
      ];
      weights = [1.45, 1.1, 1.15];
    } else if (id === "vertical-porosity") {
      parts = [
        part("vvoid", "Vertical Void Continuity", m.verticalVoidContinuity),
        part("zspan", "Z Span of Void", clamp((m.zSpan || 0) / 14, 0, 1)),
        part("surr", "Surrounding Network Connectivity", m.connectivity),
        part("xy", "XY Overlap Across Levels", m.xyOverlapAcrossZ),
      ];
      weights = [1.45, 1.1, 1.1, 1.05];
    } else if (id === "slope") {
      parts = [
        part("grad", "Continuous Z Gradient", m.continuousSlope),
        part("dir", "Directional Consistency", m.directionalContinuity),
        part("step", "Abrupt Step Penalty", 1 - (m.abruptStepRatio || 0)),
      ];
      weights = [1.5, 1.15, 1.15];
    } else {
      parts = [part("conn", "Connectivity", m.connectivity)];
      weights = [1];
    }

    return {
      overall: weighted(parts, weights),
      parts: parts,
    };
  }

  function visualization(metrics, category, descriptor) {
    const m = metrics || {};
    const id = String(descriptor || "").toLowerCase();
    const viz = { spheres: [], planes: [], boxes: [], lines: [] };
    const clusters = m.clusters || [];
    if (id === "compressed" && clusters.length >= 2) {
      viz.boxes.push({
        minx: clusters[0].extent.minx,
        maxx: clusters[0].extent.maxx,
        miny: clusters[0].extent.miny,
        maxy: clusters[0].extent.maxy,
        minz: clusters[0].extent.minz,
        maxz: clusters[0].extent.maxz,
        color: 0x9a9a9a,
        opacity: 0.16,
      });
      viz.boxes.push({
        minx: clusters[1].extent.minx,
        maxx: clusters[1].extent.maxx,
        miny: clusters[1].extent.miny,
        maxy: clusters[1].extent.maxy,
        minz: clusters[1].extent.minz,
        maxz: clusters[1].extent.maxz,
        color: 0x9a9a9a,
        opacity: 0.16,
      });
      viz.lines.push({
        ax: clusters[0].x,
        ay: clusters[0].y,
        az: clusters[0].z,
        bx: clusters[1].x,
        by: clusters[1].y,
        bz: clusters[1].z,
        color: 0xffffff,
      });
      viz.spheres.push({
        x: (clusters[0].x + clusters[1].x) * 0.5,
        y: (clusters[0].y + clusters[1].y) * 0.5,
        z: (clusters[0].z + clusters[1].z) * 0.5,
        r: 1.1,
        color: 0xff3344,
        opacity: 0.7,
      });
    } else if (id === "centralized") {
      if (m.hub) viz.spheres.push({ x: m.hub.x, y: m.hub.y, z: m.hub.z, r: 1.35, color: 0xff3344, opacity: 0.8 });
      for (let i = 0; i < clusters.length; i++) {
        if (m.hub && Math.hypot(clusters[i].x - m.hub.x, clusters[i].y - m.hub.y, clusters[i].z - m.hub.z) < 2) continue;
        viz.spheres.push({ x: clusters[i].x, y: clusters[i].y, z: clusters[i].z, r: Math.min(2.8, clusters[i].radius * 0.45), color: 0x888888, opacity: 0.22 });
      }
    } else if (id === "terraced") {
      const bands = m.zBands || [];
      for (let i = 0; i < bands.length; i++) {
        viz.planes.push({ y: (bands[i].y0 + bands[i].y1) * 0.5, color: 0xc8c2ae, opacity: 0.12 });
      }
      for (let i = 0; i < clusters.length; i++) {
        viz.spheres.push({ x: clusters[i].x, y: clusters[i].y, z: clusters[i].z, r: Math.min(3, clusters[i].radius * 0.4), color: 0x9aa0a8, opacity: 0.2 });
      }
      for (let i = 1; i < clusters.length; i++) {
        viz.lines.push({
          ax: clusters[i - 1].x,
          ay: clusters[i - 1].y,
          az: clusters[i - 1].z,
          bx: clusters[i].x,
          by: clusters[i].y,
          bz: clusters[i].z,
          color: 0xff3344,
        });
      }
    } else {
      for (let i = 0; i < clusters.length; i++) {
        viz.spheres.push({
          x: clusters[i].x,
          y: clusters[i].y,
          z: clusters[i].z,
          r: Math.min(3.2, clusters[i].radius * 0.42),
          color: i === 0 ? 0xff3344 : 0x8d8d8d,
          opacity: 0.2,
        });
      }
      const voids = m.voids || [];
      for (let i = 0; i < Math.min(3, voids.length); i++) {
        const v = voids[i];
        viz.boxes.push({ minx: v.minx, maxx: v.maxx, miny: v.miny, maxy: v.maxy, minz: v.minz, maxz: v.maxz, color: 0x6688aa, opacity: 0.08 });
      }
    }
    return viz;
  }

  global.D7DescriptorProfiles = {
    CATALOG,
    descriptorsFor,
    labelOf,
    buildBias,
    weightAt,
    score,
    visualization,
  };
})(window);

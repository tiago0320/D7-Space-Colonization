/**
 * Reusable 3D network analysis for Grid Growth descriptor scoring.
 * Operates on the actual XYZ graph inside the 20' cube (Y up). Not a 2D plan.
 */
(function (global) {
  const CUBE = 20;
  const CELL = 2;
  const BINS = Math.round(CUBE / CELL);

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function hypot3(dx, dy, dz) {
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function binOf(v) {
    return clamp(Math.floor(v / CELL), 0, BINS - 1);
  }

  function cellIndex(ix, iy, iz) {
    return ix + iy * BINS + iz * BINS * BINS;
  }

  function buildGraph(nodes, branches) {
    const byId = new Map();
    const adj = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      byId.set(n.id, n);
      adj.set(n.id, []);
    }
    const edges = [];
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      if (!byId.has(b.fromId) || !byId.has(b.toId)) continue;
      adj.get(b.fromId).push(b.toId);
      adj.get(b.toId).push(b.fromId);
      edges.push(b);
    }
    return { byId, adj, edges };
  }

  function occupancy(nodes) {
    const count = new Float32Array(BINS * BINS * BINS);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      count[cellIndex(binOf(n.x), binOf(n.y), binOf(n.z))] += 1;
    }
    return count;
  }

  function floodEmpty(occ, minNodes) {
    const visited = new Uint8Array(occ.length);
    const voids = [];
    const nxyz = BINS;
    function inb(x, y, z) {
      return x >= 0 && y >= 0 && z >= 0 && x < nxyz && y < nxyz && z < nxyz;
    }
    for (let iz = 0; iz < nxyz; iz++) {
      for (let iy = 0; iy < nxyz; iy++) {
        for (let ix = 0; ix < nxyz; ix++) {
          const i0 = cellIndex(ix, iy, iz);
          if (visited[i0] || occ[i0] >= minNodes) continue;
          const stack = [i0];
          visited[i0] = 1;
          let size = 0;
          let minx = ix;
          let maxx = ix;
          let miny = iy;
          let maxy = iy;
          let minz = iz;
          let maxz = iz;
          let touchesSkin = ix === 0 || iy === 0 || iz === 0 || ix === nxyz - 1 || iy === nxyz - 1 || iz === nxyz - 1;
          while (stack.length) {
            const i = stack.pop();
            size += 1;
            const x = i % nxyz;
            const y = Math.floor(i / nxyz) % nxyz;
            const z = Math.floor(i / (nxyz * nxyz));
            if (x < minx) minx = x;
            if (x > maxx) maxx = x;
            if (y < miny) miny = y;
            if (y > maxy) maxy = y;
            if (z < minz) minz = z;
            if (z > maxz) maxz = z;
            const neigh = [
              [x - 1, y, z],
              [x + 1, y, z],
              [x, y - 1, z],
              [x, y + 1, z],
              [x, y, z - 1],
              [x, y, z + 1],
            ];
            for (let k = 0; k < 6; k++) {
              const nx = neigh[k][0];
              const ny = neigh[k][1];
              const nz = neigh[k][2];
              if (!inb(nx, ny, nz)) {
                touchesSkin = true;
                continue;
              }
              const ni = cellIndex(nx, ny, nz);
              if (visited[ni] || occ[ni] >= minNodes) continue;
              visited[ni] = 1;
              stack.push(ni);
            }
          }
          voids.push({
            size: size,
            volume: size * CELL * CELL * CELL,
            interior: !touchesSkin,
            minx: minx * CELL,
            maxx: (maxx + 1) * CELL,
            miny: miny * CELL,
            maxy: (maxy + 1) * CELL,
            minz: minz * CELL,
            maxz: (maxz + 1) * CELL,
            cy: (miny + maxy + 1) * 0.5 * CELL,
            zSpan: (maxy - miny + 1) * CELL,
            xSpan: (maxx - minx + 1) * CELL,
            zDepth: (maxz - minz + 1) * CELL,
          });
        }
      }
    }
    voids.sort((a, b) => b.size - a.size);
    return voids;
  }

  function floodOccupied(occ, minNodes) {
    const visited = new Uint8Array(occ.length);
    const groups = [];
    const nxyz = BINS;
    function inb(x, y, z) {
      return x >= 0 && y >= 0 && z >= 0 && x < nxyz && y < nxyz && z < nxyz;
    }
    for (let iz = 0; iz < nxyz; iz++) {
      for (let iy = 0; iy < nxyz; iy++) {
        for (let ix = 0; ix < nxyz; ix++) {
          const i0 = cellIndex(ix, iy, iz);
          if (visited[i0] || occ[i0] < minNodes) continue;
          const stack = [i0];
          visited[i0] = 1;
          const cells = [];
          let nodes = 0;
          let sx = 0;
          let sy = 0;
          let sz = 0;
          let minx = ix;
          let maxx = ix;
          let miny = iy;
          let maxy = iy;
          let minz = iz;
          let maxz = iz;
          while (stack.length) {
            const i = stack.pop();
            cells.push(i);
            const x = i % nxyz;
            const y = Math.floor(i / nxyz) % nxyz;
            const z = Math.floor(i / (nxyz * nxyz));
            const w = occ[i];
            nodes += w;
            sx += (x + 0.5) * CELL * w;
            sy += (y + 0.5) * CELL * w;
            sz += (z + 0.5) * CELL * w;
            if (x < minx) minx = x;
            if (x > maxx) maxx = x;
            if (y < miny) miny = y;
            if (y > maxy) maxy = y;
            if (z < minz) minz = z;
            if (z > maxz) maxz = z;
            const neigh = [
              [x - 1, y, z],
              [x + 1, y, z],
              [x, y - 1, z],
              [x, y + 1, z],
              [x, y, z - 1],
              [x, y, z + 1],
            ];
            for (let k = 0; k < 6; k++) {
              const nx = neigh[k][0];
              const ny = neigh[k][1];
              const nz = neigh[k][2];
              if (!inb(nx, ny, nz)) continue;
              const ni = cellIndex(nx, ny, nz);
              if (visited[ni] || occ[ni] < minNodes) continue;
              visited[ni] = 1;
              stack.push(ni);
            }
          }
          const inv = nodes > 0 ? 1 / nodes : 1;
          groups.push({
            cells: cells,
            nodeCount: nodes,
            x: sx * inv,
            y: sy * inv,
            z: sz * inv,
            minx: minx * CELL,
            maxx: (maxx + 1) * CELL,
            miny: miny * CELL,
            maxy: (maxy + 1) * CELL,
            minz: minz * CELL,
            maxz: (maxz + 1) * CELL,
          });
        }
      }
    }
    groups.sort((a, b) => b.nodeCount - a.nodeCount);
    return groups;
  }

  function localCount(nodes, x, y, z, r) {
    const rSq = r * r;
    let n = 0;
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i];
      const dx = p.x - x;
      const dy = p.y - y;
      const dz = p.z - z;
      if (dx * dx + dy * dy + dz * dz <= rSq) n += 1;
    }
    return n;
  }

  function analyze(input) {
    const nodes = (input && input.nodes) || [];
    const branches = (input && input.branches) || [];
    const empty = {
      nodeCount: 0,
      edgeCount: 0,
      clusterCount: 0,
      clusters: [],
      density: 0,
      meanDegree: 0,
      maxDegree: 0,
      centralityDominance: 0,
      deadEndRatio: 1,
      connectivity: 0,
      fragmentation: 1,
      zMean: 0,
      zStd: 0,
      zSpan: 0,
      zLevelCount: 0,
      zLevelClustering: 0,
      horizontalExtent: 0,
      verticalChange: 0,
      abruptStepRatio: 0,
      continuousSlope: 0,
      xyOverlapAcrossZ: 0,
      bottleneckRatio: 0,
      openRegionContrast: 0,
      minBottleneckClearance: CUBE,
      averageClearance: CUBE,
      voidRatio: 1,
      voidCount: 0,
      voidSizeVariance: 0,
      verticalVoidContinuity: 0,
      clusterOverlap: 0,
      interClusterLinks: 0,
      sharedJunctions: 0,
      spatialOffset: 0,
      alignmentPenalty: 0,
      directionalContinuity: 0.5,
      primaryPathDominance: 0,
      clusterOrdering: 0,
      pathMultiplicity: 0,
      spatialContainment: 0,
      clusterScaleDifference: 0,
      innerOuterLinks: 0,
      convergence: 0,
      peripheralDistribution: 0,
      discreteZChanges: 0,
      repeatedRhythm: 0,
      debug: {},
    };
    if (nodes.length < 4) {
      empty.debug = { clusterCount: 0, dominantCentrality: 0, averageClearance: CUBE, minBottleneckClearance: CUBE, zClusterCount: 0, verticalSpan: 0, deadEndRatio: 1, voidRatio: 1, pathContinuity: 0.5 };
      return empty;
    }

    const g = buildGraph(nodes, branches);
    let leaf = 0;
    let sumDeg = 0;
    let maxDeg = 0;
    let hub = nodes[0];
    g.adj.forEach((list, id) => {
      const d = list.length;
      sumDeg += d;
      if (d <= 1) leaf += 1;
      if (d > maxDeg) {
        maxDeg = d;
        hub = g.byId.get(id);
      }
    });
    const meanDeg = sumDeg / nodes.length;
    const deadEndRatio = leaf / nodes.length;
    const centralityDominance = clamp((maxDeg - meanDeg) / Math.max(2, meanDeg * 2), 0, 1);

    const occ = occupancy(nodes);
    let occupied = 0;
    for (let i = 0; i < occ.length; i++) if (occ[i] > 0) occupied += 1;
    const density = occupied / occ.length;

    const groups = floodOccupied(occ, 1);
    const minKeep = Math.max(8, nodes.length * 0.045);
    const clusters = [];
    for (let i = 0; i < groups.length && clusters.length < 7; i++) {
      if (groups[i].nodeCount < minKeep && clusters.length >= 3) continue;
      if (groups[i].nodeCount < 6 && clusters.length) continue;
      const c = groups[i];
      const rx = (c.maxx - c.minx) * 0.5;
      const ry = (c.maxy - c.miny) * 0.5;
      const rz = (c.maxz - c.minz) * 0.5;
      const radius = Math.max(1.2, hypot3(rx, ry, rz));
      let links = 0;
      for (let e = 0; e < g.edges.length; e++) {
        const a = g.byId.get(g.edges[e].fromId);
        const b = g.byId.get(g.edges[e].toId);
        if (!a || !b) continue;
        const ia = hypot3(a.x - c.x, a.y - c.y, a.z - c.z) <= radius * 1.15;
        const ib = hypot3(b.x - c.x, b.y - c.y, b.z - c.z) <= radius * 1.15;
        if (ia && ib) links += 1;
      }
      clusters.push({
        id: clusters.length + 1,
        x: c.x,
        y: c.y,
        z: c.z,
        radius: radius,
        nodeCount: c.nodeCount,
        connectivity: links / Math.max(1, c.nodeCount),
        extent: { minx: c.minx, maxx: c.maxx, miny: c.miny, maxy: c.maxy, minz: c.minz, maxz: c.maxz },
        clearance: 0,
        importance: c.nodeCount / nodes.length,
        zLevel: c.y,
        horizSpan: Math.max(c.maxx - c.minx, c.maxz - c.minz),
      });
    }
    if (!clusters.length && groups.length) {
      const c = groups[0];
      clusters.push({
        id: 1,
        x: c.x,
        y: c.y,
        z: c.z,
        radius: 3,
        nodeCount: c.nodeCount,
        connectivity: meanDeg,
        extent: { minx: c.minx, maxx: c.maxx, miny: c.miny, maxy: c.maxy, minz: c.minz, maxz: c.maxz },
        clearance: 0,
        importance: 1,
        zLevel: c.y,
        horizSpan: 4,
      });
    }

    let sumY = 0;
    for (let i = 0; i < nodes.length; i++) sumY += nodes[i].y;
    const zMean = sumY / nodes.length;
    let varY = 0;
    let yMin = nodes[0].y;
    let yMax = nodes[0].y;
    for (let i = 0; i < nodes.length; i++) {
      const y = nodes[i].y;
      varY += (y - zMean) * (y - zMean);
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    const zStd = Math.sqrt(varY / nodes.length);
    const zSpan = yMax - yMin;

    const yBins = new Float32Array(BINS);
    for (let i = 0; i < nodes.length; i++) yBins[binOf(nodes[i].y)] += 1;
    const zBands = [];
    for (let i = 0; i < BINS; i++) {
      if (yBins[i] < nodes.length * 0.08) continue;
      const last = zBands[zBands.length - 1];
      if (last && i - last.iMax <= 1) {
        last.iMax = i;
        last.count += yBins[i];
      } else {
        zBands.push({ iMin: i, iMax: i, count: yBins[i] });
      }
    }
    const zLevelCount = zBands.length;
    const zLevelClustering = clamp((zLevelCount - 1) / 3, 0, 1) * (zStd > 2 ? 1 : zStd / 2);

    let horizLen = 0;
    let totalLen = 0;
    let vertAbs = 0;
    let abrupt = 0;
    let edgeN = 0;
    let turnCos = 0;
    let turnN = 0;
    const parentDir = new Map();
    for (let i = 0; i < g.edges.length; i++) {
      const a = g.byId.get(g.edges[i].fromId);
      const b = g.byId.get(g.edges[i].toId);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const len = hypot3(dx, dy, dz) || 1;
      totalLen += len;
      horizLen += Math.sqrt(dx * dx + dz * dz);
      vertAbs += Math.abs(dy);
      edgeN += 1;
      const slope = Math.abs(dy) / len;
      if (slope > 0.72) abrupt += 1;
      const d = { x: dx / len, y: dy / len, z: dz / len };
      const prev = parentDir.get(a.id);
      if (prev) {
        turnCos += prev.x * d.x + prev.y * d.y + prev.z * d.z;
        turnN += 1;
      }
      parentDir.set(b.id, d);
    }
    const verticalChange = totalLen > 1e-6 ? vertAbs / totalLen : 0;
    const abruptStepRatio = edgeN ? abrupt / edgeN : 0;
    const directionalContinuity = turnN ? clamp((turnCos / turnN + 1) * 0.5, 0, 1) : 0.5;
    const horizontalExtent = totalLen > 1e-6 ? clamp(horizLen / totalLen, 0, 1) : 0;
    const continuousSlope = clamp(verticalChange * 2.2 * (1 - abruptStepRatio), 0, 1);
    const discreteZChanges = clamp(abruptStepRatio * 1.4 * zLevelClustering, 0, 1);

    const xyAtY = [];
    for (let b = 0; b < zBands.length; b++) {
      const set = new Set();
      const y0 = zBands[b].iMin * CELL;
      const y1 = (zBands[b].iMax + 1) * CELL;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.y < y0 || n.y > y1) continue;
        set.add(binOf(n.x) + "," + binOf(n.z));
      }
      xyAtY.push(set);
    }
    let overlapPairs = 0;
    let overlapSum = 0;
    for (let i = 0; i < xyAtY.length; i++) {
      for (let j = i + 1; j < xyAtY.length; j++) {
        let inter = 0;
        xyAtY[i].forEach((k) => {
          if (xyAtY[j].has(k)) inter += 1;
        });
        const uni = xyAtY[i].size + xyAtY[j].size - inter || 1;
        overlapSum += inter / uni;
        overlapPairs += 1;
      }
    }
    const xyOverlapAcrossZ = overlapPairs ? overlapSum / overlapPairs : 0;

    let clusterOverlap = 0;
    let spatialOffset = 0;
    let alignmentPenalty = 0;
    let offsetPairs = 0;
    let interClusterLinks = 0;
    let sharedJunctions = 0;
    const junctionSet = new Set();
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i];
        const b = clusters[j];
        const d = hypot3(a.x - b.x, a.y - b.y, a.z - b.z);
        const overlap = clamp(1 - d / Math.max(1, a.radius + b.radius), 0, 1);
        clusterOverlap = Math.max(clusterOverlap, overlap);
        spatialOffset += Math.min(1, d / 12);
        const ax = Math.abs(a.x - b.x);
        const ay = Math.abs(a.y - b.y);
        const az = Math.abs(a.z - b.z);
        const aligned = (ax < 2.2 && az < 2.2) || (ax < 2.2 && ay < 2.2) || (az < 2.2 && ay < 2.2);
        if (aligned) alignmentPenalty += 1;
        offsetPairs += 1;
      }
    }
    if (offsetPairs) {
      spatialOffset /= offsetPairs;
      alignmentPenalty = clamp(alignmentPenalty / offsetPairs, 0, 1);
    }
    for (let e = 0; e < g.edges.length; e++) {
      const a = g.byId.get(g.edges[e].fromId);
      const b = g.byId.get(g.edges[e].toId);
      if (!a || !b) continue;
      let ca = -1;
      let cb = -1;
      for (let c = 0; c < clusters.length; c++) {
        const cl = clusters[c];
        if (hypot3(a.x - cl.x, a.y - cl.y, a.z - cl.z) <= cl.radius * 1.2) ca = c;
        if (hypot3(b.x - cl.x, b.y - cl.y, b.z - cl.z) <= cl.radius * 1.2) cb = c;
      }
      if (ca >= 0 && cb >= 0 && ca !== cb) {
        interClusterLinks += 1;
        junctionSet.add(g.edges[e].fromId);
        junctionSet.add(g.edges[e].toId);
      }
    }
    sharedJunctions = junctionSet.size / Math.max(1, nodes.length);

    function axisWaist(axis) {
      const bins = 10;
      const counts = new Array(bins).fill(0);
      for (let i = 0; i < nodes.length; i++) {
        const v = axis === "x" ? nodes[i].x : axis === "y" ? nodes[i].y : nodes[i].z;
        const bi = clamp(Math.floor(v / (CUBE / bins)), 0, bins - 1);
        counts[bi] += 1;
      }
      let lo = 0;
      let hi = bins - 1;
      while (lo < hi && counts[lo] < 3) lo += 1;
      while (hi > lo && counts[hi] < 3) hi -= 1;
      if (hi - lo < 3) return { ratio: 0, contrast: 0, mid: 0, end: 0 };
      const end = (counts[lo] + counts[lo + 1] + counts[hi] + counts[hi - 1]) * 0.25;
      let mid = counts[lo];
      for (let i = lo + 2; i <= hi - 2; i++) if (counts[i] < mid) mid = counts[i];
      const peak = Math.max(end, 1);
      const ratio = clamp((1 - mid / peak) * (end > mid * 1.35 ? 1 : 0.35), 0, 1);
      const contrast = clamp((end - mid) / Math.max(4, end), 0, 1);
      return { ratio: ratio, contrast: contrast, mid: mid, end: end };
    }
    const waistX = axisWaist("x");
    const waistZ = axisWaist("z");
    const waist = waistX.ratio >= waistZ.ratio ? waistX : waistZ;

    let bottleneckRatio = waist.ratio;
    let openRegionContrast = waist.contrast;
    let minBottleneckClearance = Math.max(0.4, 4.2 - waist.mid * 0.08);
    let throughConn = clamp(interClusterLinks / 8, 0, 1);
    if (clusters.length >= 2) {
      const a = clusters[0];
      const b = clusters[1];
      const samples = [];
      const steps = 10;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const z = a.z + (b.z - a.z) * t;
        samples.push(localCount(nodes, x, y, z, 2.6));
      }
      const end = (samples[0] + samples[1] + samples[samples.length - 1] + samples[samples.length - 2]) * 0.25;
      let mid = samples[0];
      for (let s = 3; s <= 7; s++) if (samples[s] < mid) mid = samples[s];
      const peak = Math.max(end, 1);
      const lineRatio = clamp(1 - mid / peak, 0, 1);
      const lineContrast = clamp((end - mid) / Math.max(6, end), 0, 1);
      if (lineRatio > bottleneckRatio) bottleneckRatio = lineRatio;
      if (lineContrast > openRegionContrast) openRegionContrast = lineContrast;
      minBottleneckClearance = Math.max(0.4, 4.2 - mid * 0.35);
      throughConn = Math.max(throughConn, clamp(interClusterLinks / 8, 0, 1));
    }

    const voids = floodEmpty(occ, 1);
    const interior = voids.filter((v) => v.interior && v.size >= 3);
    const useVoids = interior.length ? interior : voids.filter((v) => v.size >= 4).slice(0, 8);
    let voidVol = 0;
    let voidVar = 0;
    let maxVertVoid = 0;
    for (let i = 0; i < useVoids.length; i++) {
      voidVol += useVoids[i].volume;
      if (useVoids[i].zSpan > maxVertVoid) maxVertVoid = useVoids[i].zSpan;
    }
    const voidMean = useVoids.length ? voidVol / useVoids.length : 0;
    for (let i = 0; i < useVoids.length; i++) {
      const d = useVoids[i].volume - voidMean;
      voidVar += d * d;
    }
    const voidRatio = clamp(voidVol / (CUBE * CUBE * CUBE), 0, 1);
    const voidSizeVariance = useVoids.length > 1 ? clamp(Math.sqrt(voidVar / useVoids.length) / Math.max(8, voidMean), 0, 1) : 0;
    const verticalVoidContinuity = clamp(maxVertVoid / CUBE, 0, 1);

    let clearSum = 0;
    const sampleN = Math.min(nodes.length, 80);
    const step = Math.max(1, Math.floor(nodes.length / sampleN));
    let sn = 0;
    for (let i = 0; i < nodes.length; i += step) {
      const n = nodes[i];
      const nearby = localCount(nodes, n.x, n.y, n.z, 2.2);
      const clear = clamp(1 - nearby / 18, 0, 1) * 4;
      clearSum += clear;
      sn += 1;
      if (clusters.length) {
        for (let c = 0; c < clusters.length; c++) {
          if (hypot3(n.x - clusters[c].x, n.y - clusters[c].y, n.z - clusters[c].z) <= clusters[c].radius) {
            clusters[c].clearance += clear;
          }
        }
      }
    }
    const averageClearance = sn ? clearSum / sn : 2;
    for (let c = 0; c < clusters.length; c++) {
      clusters[c].clearance = clusters[c].nodeCount ? clusters[c].clearance / Math.max(1, clusters[c].nodeCount * 0.15) : averageClearance;
    }

    const components = groups.length;
    const fragmentation = clamp((components - 1) / 6, 0, 1);
    const connectivity = clamp(1 - deadEndRatio * 1.1 - fragmentation * 0.7, 0, 1) * clamp(meanDeg / 3.2, 0, 1);
    throughConn = Math.max(throughConn, clamp(connectivity * 0.7, 0, 1));

    let primaryLen = 0;
    const degCut = Math.max(3, meanDeg * 1.35);
    for (let i = 0; i < g.edges.length; i++) {
      const a = g.adj.get(g.edges[i].fromId) || [];
      const b = g.adj.get(g.edges[i].toId) || [];
      if (a.length >= degCut && b.length >= degCut) primaryLen += 1;
    }
    const primaryPathDominance = g.edges.length ? clamp(primaryLen / (g.edges.length * 0.35), 0, 1) : 0;
    const pathMultiplicity = clamp((meanDeg - 1.2) / 2.4, 0, 1);

    let orderScore = 0;
    if (clusters.length >= 2) {
      const along = clusters.slice().sort((a, b) => a.x + a.z - (b.x + b.z));
      let monotonic = 0;
      for (let i = 1; i < along.length; i++) {
        const d0 = along[i].x + along[i].z - (along[i - 1].x + along[i - 1].z);
        if (d0 > 0.6) monotonic += 1;
      }
      orderScore = monotonic / (along.length - 1);
    }
    const clusterOrdering = orderScore;
    const repeatedRhythm = clusters.length >= 3 ? clamp(1 - stdSizes(clusters) * 2, 0, 1) * clamp((clusters.length - 2) / 3, 0, 1) : 0;

    let containment = 0;
    let scaleDiff = 0;
    let innerOuter = 0;
    if (clusters.length >= 2) {
      const outer = clusters[0];
      let inner = clusters[1];
      for (let i = 1; i < clusters.length; i++) {
        if (clusters[i].nodeCount < inner.nodeCount) inner = clusters[i];
      }
      const d = hypot3(inner.x - outer.x, inner.y - outer.y, inner.z - outer.z);
      containment = clamp(1 - d / Math.max(2, outer.radius), 0, 1) * (inner.radius < outer.radius * 0.85 ? 1 : 0.4);
      scaleDiff = clamp((outer.nodeCount - inner.nodeCount) / Math.max(8, outer.nodeCount), 0, 1);
      innerOuter = clamp(interClusterLinks / 6, 0, 1);
    }

    const hubReach = hub ? localCount(nodes, hub.x, hub.y, hub.z, 5) / nodes.length : 0;
    const convergence = clamp(centralityDominance * 0.7 + hubReach * 0.6, 0, 1);
    const peripheralDistribution = clusters.length >= 2 ? clamp((clusters.length - 1) / 4, 0, 1) * (1 - clusterOverlap * 0.5) : 0;

    const horizCluster = clusters.length ? clusters.reduce((s, c) => s + clamp(c.horizSpan / 10, 0, 1), 0) / clusters.length : 0;

    const metrics = {
      nodeCount: nodes.length,
      edgeCount: g.edges.length,
      clusterCount: clusters.length,
      clusters: clusters,
      hub: hub ? { x: hub.x, y: hub.y, z: hub.z, degree: maxDeg } : null,
      density: density,
      meanDegree: meanDeg,
      maxDegree: maxDeg,
      centralityDominance: centralityDominance,
      deadEndRatio: deadEndRatio,
      connectivity: connectivity,
      fragmentation: fragmentation,
      zMean: zMean,
      zStd: zStd,
      zSpan: zSpan,
      zLevelCount: zLevelCount,
      zLevelClustering: zLevelClustering,
      zBands: zBands.map((b) => ({ y0: b.iMin * CELL, y1: (b.iMax + 1) * CELL, count: b.count })),
      horizontalExtent: horizontalExtent,
      horizClusterExtent: horizCluster,
      verticalChange: verticalChange,
      abruptStepRatio: abruptStepRatio,
      continuousSlope: continuousSlope,
      discreteZChanges: discreteZChanges,
      xyOverlapAcrossZ: xyOverlapAcrossZ,
      bottleneckRatio: bottleneckRatio,
      openRegionContrast: openRegionContrast,
      minBottleneckClearance: minBottleneckClearance,
      throughBottleneck: throughConn,
      averageClearance: averageClearance,
      voidRatio: voidRatio,
      voidCount: useVoids.length,
      voidSizeVariance: voidSizeVariance,
      voids: useVoids.slice(0, 6),
      verticalVoidContinuity: verticalVoidContinuity,
      clusterOverlap: clusterOverlap,
      interClusterLinks: interClusterLinks,
      sharedJunctions: sharedJunctions,
      spatialOffset: spatialOffset,
      alignmentPenalty: alignmentPenalty,
      directionalContinuity: directionalContinuity,
      primaryPathDominance: primaryPathDominance,
      clusterOrdering: clusterOrdering,
      pathMultiplicity: pathMultiplicity,
      spatialContainment: containment,
      clusterScaleDifference: scaleDiff,
      innerOuterLinks: innerOuter,
      convergence: convergence,
      peripheralDistribution: peripheralDistribution,
      repeatedRhythm: repeatedRhythm,
      adjacentClusterSize: clusters.length >= 2 ? clamp((clusters[0].nodeCount + clusters[1].nodeCount) / nodes.length, 0, 1) : 0,
    };
    metrics.debug = {
      clusterCount: clusters.length,
      dominantCentrality: Number(centralityDominance.toFixed(3)),
      averageClearance: Number(averageClearance.toFixed(3)),
      minBottleneckClearance: Number(minBottleneckClearance.toFixed(3)),
      zClusterCount: zLevelCount,
      verticalSpan: Number(zSpan.toFixed(3)),
      deadEndRatio: Number(deadEndRatio.toFixed(3)),
      voidRatio: Number(voidRatio.toFixed(3)),
      pathContinuity: Number(directionalContinuity.toFixed(3)),
      bottleneckRatio: Number(bottleneckRatio.toFixed(3)),
      xyOverlapAcrossZ: Number(xyOverlapAcrossZ.toFixed(3)),
    };
    return metrics;
  }

  function stdSizes(clusters) {
    const mean = clusters.reduce((s, c) => s + c.nodeCount, 0) / clusters.length;
    let v = 0;
    for (let i = 0; i < clusters.length; i++) {
      const d = clusters[i].nodeCount / Math.max(1, mean) - 1;
      v += d * d;
    }
    return Math.sqrt(v / clusters.length);
  }

  function drawNetworkThumb(canvas, nodes, branches) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, w, h);
    if (!nodes || !nodes.length || !branches || !branches.length) return;
    const byId = new Map();
    for (let i = 0; i < nodes.length; i++) byId.set(nodes[i].id, nodes[i]);
    function project(p) {
      const x = ((p.x - p.z) * 0.72 + CUBE) / (CUBE * 1.55);
      const y = 1 - (p.y * 0.62 + (p.x + p.z) * 0.18) / (CUBE * 1.15);
      return { x: 8 + x * (w - 16), y: 8 + y * (h - 16) };
    }
    ctx.strokeStyle = "rgba(236,236,236,0.92)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < branches.length; i++) {
      const a = byId.get(branches[i].fromId);
      const b = byId.get(branches[i].toId);
      if (!a || !b) continue;
      const pa = project(a);
      const pb = project(b);
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();
  }

  global.D7DescriptorMetrics = {
    CUBE,
    analyze,
    drawNetworkThumb,
  };
})(window);

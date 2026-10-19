/**
 * Spatial Translation.
 * Regions come from the branching organization, not from pipes or extrusion.
 * 1 unit = 1 foot. Y-up. Domain is the 20' cube.
 */
(function (global) {
  const CUBE = 20;

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function hypot3(x, y, z) {
    return Math.sqrt(x * x + y * y + z * z);
  }

  function aabbOf(nodes) {
    const box = { minx: CUBE, miny: CUBE, minz: CUBE, maxx: 0, maxy: 0, maxz: 0 };
    if (!nodes || !nodes.length) return box;
    box.minx = box.miny = box.minz = Infinity;
    box.maxx = box.maxy = box.maxz = -Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.x < box.minx) box.minx = n.x;
      if (n.y < box.miny) box.miny = n.y;
      if (n.z < box.minz) box.minz = n.z;
      if (n.x > box.maxx) box.maxx = n.x;
      if (n.y > box.maxy) box.maxy = n.y;
      if (n.z > box.maxz) box.maxz = n.z;
    }
    return box;
  }

  function centroidOf(nodes) {
    if (!nodes.length) return { x: 10, y: 10, z: 10 };
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < nodes.length; i++) {
      x += nodes[i].x;
      y += nodes[i].y;
      z += nodes[i].z;
    }
    const n = nodes.length;
    return { x: x / n, y: y / n, z: z / n };
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

  function principalAxis(nodes) {
    const box = aabbOf(nodes);
    const ex = box.maxx - box.minx;
    const ez = box.maxz - box.minz;
    return ex >= ez ? "x" : "z";
  }

  function filterAxis(nodes, axis, a, b) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return nodes.filter((n) => {
      const v = axis === "x" ? n.x : axis === "y" ? n.y : n.z;
      return v >= lo && v <= hi;
    });
  }

  function sizeFromNodes(nodes, importance, clearance, role) {
    const box = aabbOf(nodes);
    const cx = nodes.length ? (box.minx + box.maxx) * 0.5 : 10;
    const cy = nodes.length ? (box.miny + box.maxy) * 0.5 : 10;
    const cz = nodes.length ? (box.minz + box.maxz) * 0.5 : 10;
    const rawW = Math.max(2.4, box.maxx - box.minx);
    const rawH = Math.max(3.2, box.maxy - box.miny);
    const rawD = Math.max(2.4, box.maxz - box.minz);
    const dens = clamp(nodes.length / 28, 0.35, 1.4);
    const clear = clamp((clearance != null ? clearance : 2) / 3.2, 0.45, 1.35);
    const imp = 0.7 + clamp(importance, 0, 1) * 0.55;
    let w = rawW * 0.82 * dens * clear * imp;
    let h = rawH * 0.78 * dens * imp;
    let d = rawD * 0.82 * dens * clear * imp;
    if (role === "BOTTLENECK") {
      w = clamp(Math.min(w, rawW * 0.55), 1.8, 4.2);
      d = clamp(Math.min(d, rawD * 0.55), 1.8, 4.2);
      h = clamp(h * 0.9, 3.6, 8);
    } else if (role === "PRIMARY_CENTER") {
      w = clamp(w * 1.12, 5, 12.5);
      d = clamp(d * 1.12, 5, 12.5);
      h = clamp(h * 1.05, 5, 11);
    } else if (role === "SECONDARY_REGION") {
      w = clamp(w * 0.88, 3.2, 8.5);
      d = clamp(d * 0.88, 3.2, 8.5);
      h = clamp(h * 0.9, 4, 8.5);
    } else {
      w = clamp(w, 4.2, 12);
      d = clamp(d, 4.2, 12);
      h = clamp(h, 4.4, 10.5);
    }
    return { cx: cx, cy: cy, cz: cz, w: w, h: h, d: d };
  }

  function fitInsideCube(cx, cy, cz, w, h, d) {
    let rx = w * 0.5;
    let ry = h * 0.5;
    let rz = d * 0.5;
    const pad = 0.2;
    if (rx * 2 > CUBE - pad * 2) rx = (CUBE - pad * 2) * 0.5;
    if (ry * 2 > CUBE - pad * 2) ry = (CUBE - pad * 2) * 0.5;
    if (rz * 2 > CUBE - pad * 2) rz = (CUBE - pad * 2) * 0.5;
    return {
      x: clamp(cx, rx + pad, CUBE - rx - pad),
      y: clamp(cy, ry + pad, CUBE - ry - pad),
      z: clamp(cz, rz + pad, CUBE - rz - pad),
      width: rx * 2,
      height: ry * 2,
      depth: rz * 2,
    };
  }

  function makeRegion(id, nodes, role, importance, clearance, extra) {
    const sized = sizeFromNodes(nodes || [], importance, clearance, role);
    const fit = fitInsideCube(sized.cx, sized.cy, sized.cz, sized.w, sized.h, sized.d);
    return Object.assign(
      {
        id: id,
        center: { x: fit.x, y: fit.y, z: fit.z },
        width: fit.width,
        depth: fit.depth,
        height: fit.height,
        importance: clamp(importance, 0, 1),
        connectivity: 0,
        descriptorRole: role,
        connectedRegionIds: [],
        critical: role === "BOTTLENECK" || role === "PRIMARY_CENTER",
        major: role === "OPEN_REGION" || role === "PRIMARY_CENTER" || role === "LOWER_REGION" || role === "MIDDLE_REGION" || role === "UPPER_REGION",
        nodeCount: nodes ? nodes.length : 0,
      },
      extra || {}
    );
  }

  function fromCluster(id, cluster, role, totalNodes) {
    const ext = cluster.extent || {
      minx: cluster.x - cluster.radius,
      maxx: cluster.x + cluster.radius,
      miny: cluster.y - cluster.radius * 0.7,
      maxy: cluster.y + cluster.radius * 0.7,
      minz: cluster.z - cluster.radius,
      maxz: cluster.z + cluster.radius,
    };
    const fake = [
      { x: ext.minx, y: ext.miny, z: ext.minz },
      { x: ext.maxx, y: ext.maxy, z: ext.maxz },
      { x: cluster.x, y: cluster.y, z: cluster.z },
    ];
    const region = makeRegion(
      id,
      fake,
      role,
      cluster.importance != null ? cluster.importance : cluster.nodeCount / Math.max(1, totalNodes),
      cluster.clearance,
      { clusterId: cluster.id }
    );
    region.center = fitInsideCube(cluster.x, cluster.y, cluster.z, region.width, region.height, region.depth);
    region.width = region.center.width;
    region.height = region.center.height;
    region.depth = region.center.depth;
    region.center = { x: region.center.x, y: region.center.y, z: region.center.z };
    region.nodeCount = cluster.nodeCount || 0;
    return region;
  }

  function smoothCounts(counts) {
    const out = counts.slice();
    for (let i = 1; i < counts.length - 1; i++) {
      out[i] = counts[i - 1] * 0.25 + counts[i] * 0.5 + counts[i + 1] * 0.25;
    }
    return out;
  }

  function compressedRegions(nodes, metrics) {
    const axis = principalAxis(nodes);
    const bins = 12;
    const counts = new Array(bins).fill(0);
    for (let i = 0; i < nodes.length; i++) {
      const v = axis === "x" ? nodes[i].x : nodes[i].z;
      const bi = clamp(Math.floor((v / CUBE) * bins), 0, bins - 1);
      counts[bi] += 1;
    }
    const s = smoothCounts(counts);
    let lo = 0;
    let hi = bins - 1;
    while (lo < hi && s[lo] < 1.2) lo += 1;
    while (hi > lo && s[hi] < 1.2) hi -= 1;
    let peakL = lo;
    let peakR = hi;
    for (let i = lo; i <= Math.floor((lo + hi) * 0.45); i++) if (s[i] >= s[peakL]) peakL = i;
    for (let i = hi; i >= Math.ceil((lo + hi) * 0.55); i--) if (s[i] >= s[peakR]) peakR = i;
    let valley = peakL;
    let valleyVal = s[peakL];
    for (let i = peakL; i <= peakR; i++) {
      if (s[i] < valleyVal) {
        valleyVal = s[i];
        valley = i;
      }
    }
    const hasWaist = peakR - peakL >= 3 && valleyVal < Math.min(s[peakL], s[peakR]) * 0.78;
    const t0 = hasWaist ? (peakL + 0.5) / bins : (lo + 0.15 * (hi - lo + 1)) / bins;
    const t1 = hasWaist ? (valley + 0.15) / bins : (lo + 0.38 * (hi - lo + 1)) / bins;
    const t2 = hasWaist ? (valley + 0.85) / bins : (lo + 0.62 * (hi - lo + 1)) / bins;
    const t3 = hasWaist ? (peakR + 0.5) / bins : (lo + 0.85 * (hi - lo + 1)) / bins;
    const a0 = t0 * CUBE;
    const a1 = t1 * CUBE;
    const a2 = t2 * CUBE;
    const a3 = t3 * CUBE;
    const left = filterAxis(nodes, axis, a0 - 1.5, a1 + 0.4);
    const mid = filterAxis(nodes, axis, a1 - 0.2, a2 + 0.2);
    const right = filterAxis(nodes, axis, a2 - 0.4, a3 + 1.5);
    const clear = metrics && metrics.averageClearance != null ? metrics.averageClearance : 2.2;
    const waistClear = metrics && metrics.minBottleneckClearance != null ? metrics.minBottleneckClearance : 1.6;
    const openA = makeRegion("R1", left.length ? left : nodes.slice(0, Math.max(3, Math.floor(nodes.length / 3))), "OPEN_REGION", 0.85, clear);
    const bottle = makeRegion("R2", mid.length ? mid : nodes.slice(Math.floor(nodes.length / 3), Math.floor((nodes.length * 2) / 3)), "BOTTLENECK", 0.95, waistClear);
    const openB = makeRegion("R3", right.length ? right : nodes.slice(Math.floor((nodes.length * 2) / 3)), "OPEN_REGION", 0.8, clear);
    if (axis === "x") {
      bottle.width = clamp(Math.min(bottle.width, (a2 - a1) * 1.15, 3.6), 1.8, 3.8);
      const fitted = fitInsideCube(bottle.center.x, bottle.center.y, bottle.center.z, bottle.width, bottle.height, bottle.depth);
      bottle.center = { x: fitted.x, y: fitted.y, z: fitted.z };
      bottle.width = fitted.width;
      bottle.height = fitted.height;
      bottle.depth = fitted.depth;
    } else {
      bottle.depth = clamp(Math.min(bottle.depth, (a2 - a1) * 1.15, 3.6), 1.8, 3.8);
      const fitted = fitInsideCube(bottle.center.x, bottle.center.y, bottle.center.z, bottle.width, bottle.height, bottle.depth);
      bottle.center = { x: fitted.x, y: fitted.y, z: fitted.z };
      bottle.width = fitted.width;
      bottle.height = fitted.height;
      bottle.depth = fitted.depth;
    }
    openA.major = true;
    openB.major = true;
    bottle.major = false;
    bottle.critical = true;
    return [openA, bottle, openB];
  }

  function centralizedRegions(nodes, metrics) {
    const clusters = (metrics && metrics.clusters ? metrics.clusters.slice() : []).sort((a, b) => b.nodeCount - a.nodeCount);
    const total = nodes.length || 1;
    const out = [];
    if (metrics && metrics.hub) {
      out.push(
        makeRegion(
          "R1",
          [{ x: metrics.hub.x - 2, y: metrics.hub.y, z: metrics.hub.z - 2 }, { x: metrics.hub.x + 2, y: metrics.hub.y + 2, z: metrics.hub.z + 2 }],
          "PRIMARY_CENTER",
          1,
          metrics.averageClearance,
          { fromHub: true }
        )
      );
      const fitted = fitInsideCube(metrics.hub.x, metrics.hub.y, metrics.hub.z, Math.max(7, out[0].width), Math.max(6, out[0].height), Math.max(7, out[0].depth));
      out[0].center = { x: fitted.x, y: fitted.y, z: fitted.z };
      out[0].width = fitted.width;
      out[0].height = fitted.height;
      out[0].depth = fitted.depth;
      out[0].critical = true;
      out[0].major = true;
    } else if (clusters.length) {
      out.push(fromCluster("R1", clusters[0], "PRIMARY_CENTER", total));
      out[0].critical = true;
      out[0].major = true;
    }
    const rest = clusters.filter((_, i) => !(metrics && metrics.hub) || i >= 0);
    let n = out.length;
    for (let i = 0; i < rest.length && n < 7; i++) {
      if (metrics && metrics.hub) {
        const d = hypot3(rest[i].x - metrics.hub.x, rest[i].y - metrics.hub.y, rest[i].z - metrics.hub.z);
        if (d < 3.2) continue;
      } else if (i === 0 && out.length === 1) continue;
      n += 1;
      const r = fromCluster("R" + n, rest[i], "SECONDARY_REGION", total);
      r.major = false;
      out.push(r);
    }
    if (out.length < 2) {
      const box = aabbOf(nodes);
      out.push(
        makeRegion(
          "R" + (out.length + 1),
          [
            { x: box.minx, y: box.miny, z: box.minz },
            { x: box.minx + 2, y: box.maxy, z: box.minz + 2 },
          ],
          "SECONDARY_REGION",
          0.4,
          metrics && metrics.averageClearance
        )
      );
    }
    return out.slice(0, 7);
  }

  function terracedRegions(nodes, metrics) {
    const bands = metrics && metrics.zBands && metrics.zBands.length ? metrics.zBands.slice().sort((a, b) => a.y0 - b.y0) : [];
    const roles = ["LOWER_REGION", "MIDDLE_REGION", "UPPER_REGION"];
    const out = [];
    if (bands.length >= 2) {
      const take = bands.slice(0, 7);
      for (let i = 0; i < take.length; i++) {
        const band = take[i];
        const slice = nodes.filter((n) => n.y >= band.y0 - 0.4 && n.y <= band.y1 + 0.4);
        const role = take.length === 2 ? (i === 0 ? "LOWER_REGION" : "UPPER_REGION") : roles[Math.min(i, 2)];
        const r = makeRegion("R" + (i + 1), slice.length ? slice : nodes, role, 0.55 + (slice.length / Math.max(1, nodes.length)) * 0.4, metrics.averageClearance);
        r.major = true;
        r.critical = role !== "MIDDLE_REGION" ? i === 0 || i === take.length - 1 : false;
        out.push(r);
      }
      return out;
    }
    const sorted = nodes.slice().sort((a, b) => a.y - b.y);
    const third = Math.max(1, Math.floor(sorted.length / 3));
    const groups = [sorted.slice(0, third), sorted.slice(third, third * 2), sorted.slice(third * 2)];
    for (let i = 0; i < 3; i++) {
      if (!groups[i].length) continue;
      const r = makeRegion("R" + (i + 1), groups[i], roles[i], 0.7, metrics && metrics.averageClearance);
      r.major = true;
      out.push(r);
    }
    return out;
  }

  function genericRegions(nodes, metrics) {
    const clusters = (metrics && metrics.clusters ? metrics.clusters.slice() : []).sort((a, b) => b.nodeCount - a.nodeCount);
    const total = nodes.length || 1;
    let list = clusters.slice(0, 7);
    if (list.length < 3) {
      return compressedRegions(nodes, metrics).map((r, i) => {
        r.descriptorRole = i === 1 ? "BOTTLENECK" : "OPEN_REGION";
        return r;
      });
    }
    return list.map((c, i) => {
      const r = fromCluster("R" + (i + 1), c, i === 0 ? "OPEN_REGION" : "SECONDARY_REGION", total);
      r.major = i < 3;
      r.critical = i === 0;
      return r;
    });
  }

  function distSqRegions(a, b) {
    const dx = a.center.x - b.center.x;
    const dy = a.center.y - b.center.y;
    const dz = a.center.z - b.center.z;
    return dx * dx + dy * dy + dz * dz;
  }

  function connectRegions(regions, nodes, branches, descriptor) {
    const connections = [];
    if (regions.length < 2) return { regions: regions, connections: connections };
    if (descriptor === "compressed") {
      for (let i = 0; i < regions.length - 1; i++) {
        connections.push({
          id: "C" + (i + 1),
          fromId: regions[i].id,
          toId: regions[i + 1].id,
          critical: regions[i].descriptorRole === "BOTTLENECK" || regions[i + 1].descriptorRole === "BOTTLENECK",
        });
      }
    } else {
      const used = new Set();
      const remaining = regions.map((_, i) => i);
      const tree = [remaining.shift()];
      while (remaining.length) {
        let bestI = 0;
        let bestJ = 0;
        let bestD = Infinity;
        for (let t = 0; t < tree.length; t++) {
          for (let r = 0; r < remaining.length; r++) {
            const d = distSqRegions(regions[tree[t]], regions[remaining[r]]);
            if (d < bestD) {
              bestD = d;
              bestI = tree[t];
              bestJ = r;
            }
          }
        }
        const other = remaining.splice(bestJ, 1)[0];
        tree.push(other);
        const key = regions[bestI].id + ":" + regions[other].id;
        used.add(key);
        connections.push({
          id: "C" + connections.length + 1,
          fromId: regions[bestI].id,
          toId: regions[other].id,
          critical: regions[bestI].critical || regions[other].critical,
        });
      }
      if (descriptor === "centralized" && regions.length > 2) {
        const hub = regions[0];
        for (let i = 1; i < regions.length; i++) {
          const key = hub.id + ":" + regions[i].id;
          const alt = regions[i].id + ":" + hub.id;
          if (used.has(key) || used.has(alt)) continue;
          connections.push({ id: "C" + (connections.length + 1), fromId: hub.id, toId: regions[i].id, critical: true });
        }
      }
    }
    const byId = {};
    for (let i = 0; i < regions.length; i++) byId[regions[i].id] = regions[i];
    for (let i = 0; i < connections.length; i++) {
      const a = byId[connections[i].fromId];
      const b = byId[connections[i].toId];
      if (!a || !b) continue;
      if (a.connectedRegionIds.indexOf(b.id) < 0) a.connectedRegionIds.push(b.id);
      if (b.connectedRegionIds.indexOf(a.id) < 0) b.connectedRegionIds.push(a.id);
    }
    for (let i = 0; i < regions.length; i++) {
      if (regions[i].connectedRegionIds.length > 4) {
        regions[i].connectedRegionIds = regions[i].connectedRegionIds.slice(0, 4);
      }
      regions[i].connectivity = regions[i].connectedRegionIds.length;
    }
    const filtered = connections.filter((c) => {
      const a = byId[c.fromId];
      const b = byId[c.toId];
      return a && b && a.connectedRegionIds.indexOf(b.id) >= 0 && b.connectedRegionIds.indexOf(a.id) >= 0;
    });
    return { regions: regions, connections: filtered };
  }

  function translate(network, options) {
    const opts = options || {};
    const nodes = (network && network.nodes) || [];
    const branches = (network && network.branches) || [];
    if (nodes.length < 4) throw new Error("Load or grow a branching iteration first.");
    const metrics =
      opts.metrics ||
      (global.D7DescriptorMetrics && global.D7DescriptorMetrics.analyze
        ? global.D7DescriptorMetrics.analyze({ nodes: nodes, branches: branches })
        : { clusters: [], averageClearance: 2, minBottleneckClearance: 1.8 });
    const descriptor = String(opts.descriptor || "compressed").toLowerCase();
    const category = String(opts.category || "workspace").toLowerCase();
    let regions;
    if (descriptor === "compressed") regions = compressedRegions(nodes, metrics);
    else if (descriptor === "centralized") regions = centralizedRegions(nodes, metrics);
    else if (descriptor === "terraced") regions = terracedRegions(nodes, metrics);
    else regions = genericRegions(nodes, metrics);
    if (regions.length > 7) regions = regions.slice(0, 7);
    if (regions.length < 3 && descriptor === "compressed") {
      regions = compressedRegions(nodes, metrics);
    }
    const linked = connectRegions(regions, nodes, branches, descriptor);
    return {
      regions: linked.regions,
      connections: linked.connections,
      descriptor: descriptor,
      category: category,
      descriptorLabel: opts.descriptorLabel || descriptor,
    };
  }

  global.D7SpatialDevelop = {
    CUBE,
    translate,
  };
})(window);

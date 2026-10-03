/**
 * 3D Grid Growth: space colonization constrained to the built-in SVG lattice.
 * Loads default-3d-grid.svg, maps viewBox 0–902.8 onto 20' × 20' planes.
 * Horizontal: X–Z layers stacked in Y. Vertical: X–Y Front/Back planes stacked in Z.
 * Workspace: 20 ft cube. 1 world unit = 1 foot. Y is vertical.
 */
(function (global) {
  const CUBE = 20;
  const SVG_VB = 902.8;
  const SVG_SCALE = CUBE / SVG_VB;
  const DEFAULT_SPACING = 2;
  const MERGE_EPS = 0.03;
  const NODE_STEP = 0.5;
  const MAX_SEGMENTS = 12000;
  const DEFAULT_GRID_FILE = "default-3d-grid.svg";
  const DEFAULT_ATTRACTORS = 400;
  const DEFAULT_INFLUENCE = 4;
  const DEFAULT_KILL = 1;
  const DEFAULT_SPEED = 8;

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash32(n) {
    n = Math.imul(n ^ (n >>> 16), 2246822507);
    n = Math.imul(n ^ (n >>> 13), 3266489909);
    return (n ^ (n >>> 16)) >>> 0;
  }

  function dist2(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  function mergeKey(x, z) {
    return Math.round(x / MERGE_EPS) + "," + Math.round(z / MERGE_EPS);
  }

  function mergeKey3(x, y, z) {
    return Math.round(x / MERGE_EPS) + "," + Math.round(y / MERGE_EPS) + "," + Math.round(z / MERGE_EPS);
  }

  function edgeKey(a, b) {
    return a < b ? a + "|" + b : b + "|" + a;
  }

  function defaultGridUrl() {
    const script = document.querySelector('script[src*="spatial-grid-growth"]');
    const base = script && script.src ? script.src : window.location.href;
    return new URL(DEFAULT_GRID_FILE, base).href;
  }

  function svgToPlanar(sx, sy) {
    return {
      x: sx * SVG_SCALE,
      z: (SVG_VB - sy) * SVG_SCALE,
    };
  }

  function parsePathD(d) {
    if (!d) return [];
    const tokens = [];
    const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/g;
    let m;
    while ((m = re.exec(d))) {
      if (m[1]) tokens.push(m[1]);
      else tokens.push(parseFloat(m[2]));
    }
    const segs = [];
    let i = 0;
    let x = 0;
    let y = 0;
    let sx = 0;
    let sy = 0;
    let prev = "L";

    function isCmd(v) {
      return typeof v === "string";
    }
    function num() {
      const v = tokens[i++];
      if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("Malformed SVG path command.");
      return v;
    }

    while (i < tokens.length) {
      let cmd = tokens[i];
      if (isCmd(cmd)) i += 1;
      else {
        if (prev === "M") cmd = "L";
        else if (prev === "m") cmd = "l";
        else cmd = prev;
      }
      prev = cmd;
      const rel = cmd === cmd.toLowerCase();
      const c = cmd.toUpperCase();
      if (c === "Z") {
        if (Math.hypot(x - sx, y - sy) > 1e-8) segs.push({ x1: x, y1: y, x2: sx, y2: sy });
        x = sx;
        y = sy;
        continue;
      }
      if (c === "M") {
        const nx = num();
        const ny = num();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        sx = x;
        sy = y;
        prev = rel ? "l" : "L";
        continue;
      }
      if (c === "L") {
        const nx = num();
        const ny = num();
        const x2 = rel ? x + nx : nx;
        const y2 = rel ? y + ny : ny;
        if (Math.hypot(x2 - x, y2 - y) > 1e-8) segs.push({ x1: x, y1: y, x2, y2 });
        x = x2;
        y = y2;
        continue;
      }
      if (c === "H") {
        const nx = num();
        const x2 = rel ? x + nx : nx;
        if (Math.abs(x2 - x) > 1e-8) segs.push({ x1: x, y1: y, x2, y2: y });
        x = x2;
        continue;
      }
      if (c === "V") {
        const ny = num();
        const y2 = rel ? y + ny : ny;
        if (Math.abs(y2 - y) > 1e-8) segs.push({ x1: x, y1: y, x2: x, y2 });
        y = y2;
        continue;
      }
      throw new Error("SVG path uses unsupported command '" + cmd + "'.");
    }
    return segs;
  }

  function parseSvgLineSegments(text) {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const err = doc.querySelector("parsererror");
    if (err) throw new Error("SVG XML could not be parsed.");
    const svg = doc.querySelector("svg");
    if (!svg) throw new Error("SVG has no root element.");
    const vbAttr = svg.getAttribute("viewBox");
    let vbW = SVG_VB;
    let vbH = SVG_VB;
    if (vbAttr) {
      const parts = vbAttr.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        vbW = parts[2];
        vbH = parts[3];
      }
    }
    if (Math.abs(vbW - SVG_VB) > 0.6 || Math.abs(vbH - SVG_VB) > 0.6) {
      throw new Error("SVG viewBox must be 0 0 902.8 902.8 (found " + vbW + " × " + vbH + ").");
    }
    const raw = [];
    const paths = svg.querySelectorAll("path");
    if (!paths.length) throw new Error("SVG contains no <path> elements.");
    paths.forEach((el) => {
      const d = el.getAttribute("d");
      if (!d) return;
      const pieces = parsePathD(d);
      for (let i = 0; i < pieces.length; i++) raw.push(pieces[i]);
    });
    svg.querySelectorAll("line").forEach((el) => {
      raw.push({
        x1: parseFloat(el.getAttribute("x1")) || 0,
        y1: parseFloat(el.getAttribute("y1")) || 0,
        x2: parseFloat(el.getAttribute("x2")) || 0,
        y2: parseFloat(el.getAttribute("y2")) || 0,
      });
    });
    if (!raw.length) throw new Error("SVG paths produced no line segments.");
    const segs = [];
    const seen = new Set();
    for (let i = 0; i < raw.length && segs.length < MAX_SEGMENTS; i++) {
      const s = raw[i];
      const a = svgToPlanar(s.x1, s.y1);
      const b = svgToPlanar(s.x2, s.y2);
      let x1 = clamp(a.x, 0, CUBE);
      let z1 = clamp(a.z, 0, CUBE);
      let x2 = clamp(b.x, 0, CUBE);
      let z2 = clamp(b.z, 0, CUBE);
      if (dist2(x1, z1, x2, z2) < 1e-10) continue;
      if (x1 > x2 || (x1 === x2 && z1 > z2)) {
        const tx = x1;
        const tz = z1;
        x1 = x2;
        z1 = z2;
        x2 = tx;
        z2 = tz;
      }
      const key =
        x1.toFixed(4) + "," + z1.toFixed(4) + "|" + x2.toFixed(4) + "," + z2.toFixed(4);
      if (seen.has(key)) continue;
      seen.add(key);
      segs.push({ x1, z1, x2, z2 });
    }
    if (!segs.length) throw new Error("SVG geometry collapsed after scaling to 20'.");
    return segs;
  }

  function segmentIntersection(a, b) {
    const x1 = a.x1;
    const z1 = a.z1;
    const x2 = a.x2;
    const z2 = a.z2;
    const x3 = b.x1;
    const z3 = b.z1;
    const x4 = b.x2;
    const z4 = b.z2;
    const den = (x1 - x2) * (z3 - z4) - (z1 - z2) * (x3 - x4);
    if (Math.abs(den) < 1e-10) return null;
    const t = ((x1 - x3) * (z3 - z4) - (z1 - z3) * (x3 - x4)) / den;
    const u = ((x1 - x3) * (z1 - z2) - (z1 - z3) * (x1 - x2)) / den;
    if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
    return { x: x1 + t * (x2 - x1), z: z1 + t * (z2 - z1), t, u };
  }

  function pointOnSegmentT(px, pz, s) {
    const dx = s.x2 - s.x1;
    const dz = s.z2 - s.z1;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-12) return dist2(px, pz, s.x1, s.z1) < MERGE_EPS * MERGE_EPS ? 0 : null;
    const t = ((px - s.x1) * dx + (pz - s.z1) * dz) / len2;
    if (t < -0.02 || t > 1.02) return null;
    const qx = s.x1 + t * dx;
    const qz = s.z1 + t * dz;
    if (dist2(px, pz, qx, qz) > MERGE_EPS * MERGE_EPS * 4) return null;
    return clamp(t, 0, 1);
  }

  function splitSegments(segments) {
    const n = segments.length;
    const ts = new Array(n);
    const verts = [];
    for (let i = 0; i < n; i++) {
      ts[i] = [0, 1];
      const s = segments[i];
      verts.push({ x: s.x1, z: s.z1 }, { x: s.x2, z: s.z2 });
    }
    const cellSize = 1.25;
    const buckets = new Map();
    function addToCells(i, s) {
      const minx = Math.floor(Math.min(s.x1, s.x2) / cellSize);
      const maxx = Math.floor(Math.max(s.x1, s.x2) / cellSize);
      const minz = Math.floor(Math.min(s.z1, s.z2) / cellSize);
      const maxz = Math.floor(Math.max(s.z1, s.z2) / cellSize);
      for (let ix = minx; ix <= maxx; ix++) {
        for (let iz = minz; iz <= maxz; iz++) {
          const key = ix + "," + iz;
          let list = buckets.get(key);
          if (!list) {
            list = [];
            buckets.set(key, list);
          }
          list.push(i);
        }
      }
    }
    for (let i = 0; i < n; i++) addToCells(i, segments[i]);
    const seenPairs = new Set();
    buckets.forEach((list) => {
      for (let a = 0; a < list.length; a++) {
        for (let b = a + 1; b < list.length; b++) {
          const i = list[a];
          const j = list[b];
          if (i === j) continue;
          const pk = i < j ? i + "|" + j : j + "|" + i;
          if (seenPairs.has(pk)) continue;
          seenPairs.add(pk);
          const hit = segmentIntersection(segments[i], segments[j]);
          if (!hit) continue;
          ts[i].push(clamp(hit.t, 0, 1));
          ts[j].push(clamp(hit.u, 0, 1));
        }
      }
    });
    for (let i = 0; i < n; i++) {
      const s = segments[i];
      for (let v = 0; v < verts.length; v++) {
        const t = pointOnSegmentT(verts[v].x, verts[v].z, s);
        if (t == null) continue;
        if (t > 0.02 && t < 0.98) ts[i].push(t);
      }
    }
    const out = [];
    for (let i = 0; i < n && out.length < MAX_SEGMENTS; i++) {
      const s = segments[i];
      const uniq = Array.from(new Set(ts[i].map((t) => Math.round(t * 1e5) / 1e5))).sort((a, b) => a - b);
      for (let k = 0; k < uniq.length - 1; k++) {
        const t0 = uniq[k];
        const t1 = uniq[k + 1];
        if (t1 - t0 < 1e-5) continue;
        const a = { x: s.x1 + (s.x2 - s.x1) * t0, z: s.z1 + (s.z2 - s.z1) * t0 };
        const b = { x: s.x1 + (s.x2 - s.x1) * t1, z: s.z1 + (s.z2 - s.z1) * t1 };
        if (dist2(a.x, a.z, b.x, b.z) < 1e-8) continue;
        out.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z });
      }
    }
    return out;
  }

  function graphFromPieces(pieces) {
    const nodeMap = new Map();
    const nodes = [];
    function nodeAt(x, z) {
      const k = mergeKey(x, z);
      let id = nodeMap.get(k);
      if (id != null) return id;
      id = nodes.length;
      nodes.push({ id, x, z });
      nodeMap.set(k, id);
      return id;
    }
    const edgeSet = new Set();
    const edges = [];
    for (let i = 0; i < pieces.length; i++) {
      const s = pieces[i];
      const a = nodeAt(s.x1, s.z1);
      const b = nodeAt(s.x2, s.z2);
      if (a === b) continue;
      const ek = edgeKey(a, b);
      if (edgeSet.has(ek)) continue;
      edgeSet.add(ek);
      edges.push({ from: a, to: b });
    }
    return { nodes, edges };
  }

  function splitEdgesThroughNodes(nodes, edges) {
    const out = [];
    const seen = new Set();
    function add(a, b) {
      if (a === b) return;
      const ek = edgeKey(a, b);
      if (seen.has(ek)) return;
      seen.add(ek);
      out.push({ from: a, to: b });
    }
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const a = nodes[e.from];
      const b = nodes[e.to];
      if (!a || !b) continue;
      const hits = [{ t: 0, id: e.from }, { t: 1, id: e.to }];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz;
      if (len2 < 1e-12) continue;
      const len = Math.sqrt(len2);
      for (let n = 0; n < nodes.length; n++) {
        if (n === e.from || n === e.to) continue;
        const t = ((nodes[n].x - a.x) * dx + (nodes[n].z - a.z) * dz) / len2;
        if (t <= 0.02 || t >= 0.98) continue;
        const qx = a.x + t * dx;
        const qz = a.z + t * dz;
        if (Math.hypot(nodes[n].x - qx, nodes[n].z - qz) > MERGE_EPS * 2) continue;
        hits.push({ t, id: n });
      }
      hits.sort((p, q) => p.t - q.t);
      for (let k = 0; k < hits.length - 1; k++) add(hits[k].id, hits[k + 1].id);
    }
    return out;
  }

  function subdividePlanar(nodes, edges, step) {
    const spacing = Math.max(0.35, Number(step) || NODE_STEP);
    const outNodes = nodes.map((n, i) => ({ id: i, x: n.x, z: n.z }));
    const outEdges = [];
    const edgeSet = new Set();
    function addEdge(a, b) {
      if (a === b) return;
      const ek = edgeKey(a, b);
      if (edgeSet.has(ek)) return;
      edgeSet.add(ek);
      outEdges.push({ from: a, to: b });
    }
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const a = nodes[e.from];
      const b = nodes[e.to];
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const parts = Math.min(24, Math.max(1, Math.round(len / spacing)));
      let prev = e.from;
      for (let k = 1; k < parts; k++) {
        const t = k / parts;
        const id = outNodes.length;
        outNodes.push({
          id,
          x: a.x + (b.x - a.x) * t,
          z: a.z + (b.z - a.z) * t,
        });
        addEdge(prev, id);
        prev = id;
      }
      addEdge(prev, e.to);
    }
    outNodes.forEach((n, i) => {
      n.id = i;
    });
    return { nodes: outNodes, edges: outEdges };
  }

  function countComponents(nodeCount, edges) {
    const parent = new Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) parent[i] = i;
    function find(i) {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    }
    const deg = new Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) deg[i] = 0;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (e.from < 0 || e.to < 0 || e.from >= nodeCount || e.to >= nodeCount) continue;
      deg[e.from] += 1;
      deg[e.to] += 1;
      const a = find(e.from);
      const b = find(e.to);
      if (a !== b) parent[a] = b;
    }
    const roots = new Set();
    for (let i = 0; i < nodeCount; i++) {
      if (deg[i] === 0) continue;
      roots.add(find(i));
    }
    return roots.size;
  }

  function layerValues(spacing) {
    const s = clamp(Number(spacing) || DEFAULT_SPACING, 1, 10);
    const out = [];
    for (let v = 0; v <= CUBE + 1e-6; v += s) out.push(Math.min(CUBE, Number(v.toFixed(6))));
    if (out[out.length - 1] < CUBE - 1e-6) out.push(CUBE);
    return out;
  }

  function instantiateHorizontal(planar, layers, withStruts) {
    const nodes = [];
    const edges = [];
    const layerNodeIds = [];
    for (let li = 0; li < layers.length; li++) {
      const y = layers[li];
      const row = [];
      for (let pi = 0; pi < planar.nodes.length; pi++) {
        const p = planar.nodes[pi];
        const id = nodes.length;
        nodes.push({ id, x: p.x, y, z: p.z });
        row.push(id);
      }
      layerNodeIds.push(row);
    }
    for (let li = 0; li < layers.length; li++) {
      for (let ei = 0; ei < planar.edges.length; ei++) {
        const e = planar.edges[ei];
        edges.push({ from: layerNodeIds[li][e.from], to: layerNodeIds[li][e.to], orient: "h" });
      }
    }
    if (withStruts) {
      for (let li = 0; li < layers.length - 1; li++) {
        for (let pi = 0; pi < planar.nodes.length; pi++) {
          edges.push({ from: layerNodeIds[li][pi], to: layerNodeIds[li + 1][pi], orient: "h" });
        }
      }
    }
    return { nodes, edges };
  }

  function instantiateVertical(planar, layers, withStruts) {
    const nodes = [];
    const edges = [];
    const layerNodeIds = [];
    for (let li = 0; li < layers.length; li++) {
      const z = layers[li];
      const row = [];
      for (let pi = 0; pi < planar.nodes.length; pi++) {
        const p = planar.nodes[pi];
        const id = nodes.length;
        nodes.push({ id, x: p.x, y: p.z, z });
        row.push(id);
      }
      layerNodeIds.push(row);
    }
    for (let li = 0; li < layers.length; li++) {
      for (let ei = 0; ei < planar.edges.length; ei++) {
        const e = planar.edges[ei];
        edges.push({ from: layerNodeIds[li][e.from], to: layerNodeIds[li][e.to], orient: "v" });
      }
    }
    if (withStruts) {
      for (let li = 0; li < layers.length - 1; li++) {
        for (let pi = 0; pi < planar.nodes.length; pi++) {
          edges.push({ from: layerNodeIds[li][pi], to: layerNodeIds[li + 1][pi], orient: "v" });
        }
      }
    }
    return { nodes, edges };
  }

  function mergeGraphs3D(parts) {
    const nodeMap = new Map();
    const nodes = [];
    function nodeAt(x, y, z) {
      const k = mergeKey3(x, y, z);
      let id = nodeMap.get(k);
      if (id != null) return id;
      id = nodes.length;
      nodes.push({ id, x, y, z });
      nodeMap.set(k, id);
      return id;
    }
    const edges = [];
    const seen = new Set();
    for (let p = 0; p < parts.length; p++) {
      const g = parts[p];
      const remap = new Array(g.nodes.length);
      for (let i = 0; i < g.nodes.length; i++) {
        const n = g.nodes[i];
        remap[i] = nodeAt(n.x, n.y, n.z);
      }
      for (let i = 0; i < g.edges.length; i++) {
        const e = g.edges[i];
        const a = remap[e.from];
        const b = remap[e.to];
        if (a == null || b == null || a === b) continue;
        const ek = edgeKey(a, b) + ":" + (e.orient || "");
        if (seen.has(ek)) continue;
        seen.add(ek);
        edges.push({ from: a, to: b, orient: e.orient || "h" });
      }
    }
    return { nodes, edges, nodeAt };
  }

  function groupEdgesByCoord(nodes, edges, coord) {
    const map = new Map();
    for (let i = 0; i < edges.length; i++) {
      const a = nodes[edges[i].from];
      const b = nodes[edges[i].to];
      if (!a || !b) continue;
      const c = (a[coord] + b[coord]) * 0.5;
      const key = Math.round(c / MERGE_EPS);
      let list = map.get(key);
      if (!list) {
        list = [];
        map.set(key, list);
      }
      list.push(i);
    }
    return map;
  }

  function weaveHorizontalVertical(hGraph, vGraph) {
    const merged = mergeGraphs3D([hGraph, vGraph]);
    const nodes = merged.nodes;
    const hEdges = [];
    const vEdges = [];
    for (let i = 0; i < merged.edges.length; i++) {
      if (merged.edges[i].orient === "v") vEdges.push(merged.edges[i]);
      else hEdges.push(merged.edges[i]);
    }
    const hHits = new Array(hEdges.length);
    const vHits = new Array(vEdges.length);
    for (let i = 0; i < hEdges.length; i++) hHits[i] = [];
    for (let i = 0; i < vEdges.length; i++) vHits[i] = [];

    const hByY = groupEdgesByCoord(nodes, hEdges, "y");
    const vByZ = groupEdgesByCoord(nodes, vEdges, "z");

    hByY.forEach((hList) => {
      if (!hList.length) return;
      const ha = nodes[hEdges[hList[0]].from];
      const yH = ha ? ha.y : 0;
      vByZ.forEach((vList) => {
        if (!vList.length) return;
        const va = nodes[vEdges[vList[0]].from];
        const zV = va ? va.z : 0;
        const hPts = [];
        const hSegs = [];
        for (let hi = 0; hi < hList.length; hi++) {
          const ei = hList[hi];
          const e = hEdges[ei];
          const a = nodes[e.from];
          const b = nodes[e.to];
          const dz = b.z - a.z;
          if (Math.abs(dz) < 1e-8) {
            if (Math.abs(a.z - zV) > MERGE_EPS) continue;
            hSegs.push({ ei, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), a, b });
          } else {
            const t = (zV - a.z) / dz;
            if (t < -0.02 || t > 1.02) continue;
            hPts.push({ ei, t: clamp(t, 0, 1), x: a.x + t * (b.x - a.x) });
          }
        }
        const vPts = [];
        const vSegs = [];
        for (let vi = 0; vi < vList.length; vi++) {
          const ei = vList[vi];
          const e = vEdges[ei];
          const a = nodes[e.from];
          const b = nodes[e.to];
          const dy = b.y - a.y;
          if (Math.abs(dy) < 1e-8) {
            if (Math.abs(a.y - yH) > MERGE_EPS) continue;
            vSegs.push({ ei, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), a, b });
          } else {
            const u = (yH - a.y) / dy;
            if (u < -0.02 || u > 1.02) continue;
            vPts.push({ ei, t: clamp(u, 0, 1), x: a.x + u * (b.x - a.x) });
          }
        }
        hPts.sort((p, q) => p.x - q.x);
        vPts.sort((p, q) => p.x - q.x);
        let i = 0;
        let j = 0;
        while (i < hPts.length && j < vPts.length) {
          const dx = hPts[i].x - vPts[j].x;
          if (dx < -MERGE_EPS * 2) i += 1;
          else if (dx > MERGE_EPS * 2) j += 1;
          else {
            const x = (hPts[i].x + vPts[j].x) * 0.5;
            hHits[hPts[i].ei].push({ t: hPts[i].t, x, y: yH, z: zV });
            vHits[vPts[j].ei].push({ t: vPts[j].t, x, y: yH, z: zV });
            i += 1;
            j += 1;
          }
        }
        for (let s = 0; s < hSegs.length; s++) {
          const seg = hSegs[s];
          for (let p = 0; p < vPts.length; p++) {
            if (vPts[p].x < seg.x0 - MERGE_EPS || vPts[p].x > seg.x1 + MERGE_EPS) continue;
            const span = seg.b.x - seg.a.x;
            const t = Math.abs(span) < 1e-8 ? 0 : clamp((vPts[p].x - seg.a.x) / span, 0, 1);
            hHits[seg.ei].push({ t, x: vPts[p].x, y: yH, z: zV });
            vHits[vPts[p].ei].push({ t: vPts[p].t, x: vPts[p].x, y: yH, z: zV });
          }
        }
        for (let s = 0; s < vSegs.length; s++) {
          const seg = vSegs[s];
          for (let p = 0; p < hPts.length; p++) {
            if (hPts[p].x < seg.x0 - MERGE_EPS || hPts[p].x > seg.x1 + MERGE_EPS) continue;
            const span = seg.b.x - seg.a.x;
            const u = Math.abs(span) < 1e-8 ? 0 : clamp((hPts[p].x - seg.a.x) / span, 0, 1);
            vHits[seg.ei].push({ t: u, x: hPts[p].x, y: yH, z: zV });
            hHits[hPts[p].ei].push({ t: hPts[p].t, x: hPts[p].x, y: yH, z: zV });
          }
        }
        for (let hs = 0; hs < hSegs.length; hs++) {
          for (let vs = 0; vs < vSegs.length; vs++) {
            const a0 = Math.max(hSegs[hs].x0, vSegs[vs].x0);
            const a1 = Math.min(hSegs[hs].x1, vSegs[vs].x1);
            if (a1 - a0 < MERGE_EPS) continue;
            const xs = [a0, a1];
            for (let k = 0; k < xs.length; k++) {
              const x = xs[k];
              const hspan = hSegs[hs].b.x - hSegs[hs].a.x;
              const vspan = vSegs[vs].b.x - vSegs[vs].a.x;
              const t = Math.abs(hspan) < 1e-8 ? 0 : clamp((x - hSegs[hs].a.x) / hspan, 0, 1);
              const u = Math.abs(vspan) < 1e-8 ? 0 : clamp((x - vSegs[vs].a.x) / vspan, 0, 1);
              hHits[hSegs[hs].ei].push({ t, x, y: yH, z: zV });
              vHits[vSegs[vs].ei].push({ t: u, x, y: yH, z: zV });
            }
          }
        }
      });
    });

    function splitList(srcEdges, hits, orient) {
      const out = [];
      for (let i = 0; i < srcEdges.length; i++) {
        const e = srcEdges[i];
        const a = nodes[e.from];
        const b = nodes[e.to];
        if (!a || !b) continue;
        const pts = [{ t: 0, id: e.from }, { t: 1, id: e.to }];
        const list = hits[i] || [];
        for (let k = 0; k < list.length; k++) {
          const hit = list[k];
          pts.push({ t: hit.t, id: merged.nodeAt(hit.x, hit.y, hit.z) });
        }
        pts.sort((p, q) => p.t - q.t);
        for (let k = 0; k < pts.length - 1; k++) {
          if (pts[k].id === pts[k + 1].id) continue;
          if (pts[k + 1].t - pts[k].t < 1e-5) continue;
          out.push({ from: pts[k].id, to: pts[k + 1].id, orient });
        }
      }
      return out;
    }

    const splitH = splitList(hEdges, hHits, "h");
    const splitV = splitList(vEdges, vHits, "v");
    const all = [];
    const seen = new Set();
    function add(e) {
      if (e.from === e.to) return;
      const ek = edgeKey(e.from, e.to) + ":" + e.orient;
      if (seen.has(ek)) return;
      seen.add(ek);
      all.push(e);
    }
    for (let i = 0; i < splitH.length; i++) add(splitH[i]);
    for (let i = 0; i < splitV.length; i++) add(splitV[i]);
    return { nodes, edges: all };
  }

  function splitEdgesThroughNodes3D(nodes, edges) {
    const cell = 1;
    const buckets = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const key = Math.floor(n.x / cell) + "," + Math.floor(n.y / cell) + "," + Math.floor(n.z / cell);
      let list = buckets.get(key);
      if (!list) {
        list = [];
        buckets.set(key, list);
      }
      list.push(i);
    }
    function nearby(a, b) {
      const minx = Math.floor(Math.min(a.x, b.x) / cell);
      const maxx = Math.floor(Math.max(a.x, b.x) / cell);
      const miny = Math.floor(Math.min(a.y, b.y) / cell);
      const maxy = Math.floor(Math.max(a.y, b.y) / cell);
      const minz = Math.floor(Math.min(a.z, b.z) / cell);
      const maxz = Math.floor(Math.max(a.z, b.z) / cell);
      const ids = [];
      const seenN = new Set();
      for (let ix = minx; ix <= maxx; ix++) {
        for (let iy = miny; iy <= maxy; iy++) {
          for (let iz = minz; iz <= maxz; iz++) {
            const list = buckets.get(ix + "," + iy + "," + iz);
            if (!list) continue;
            for (let k = 0; k < list.length; k++) {
              if (seenN.has(list[k])) continue;
              seenN.add(list[k]);
              ids.push(list[k]);
            }
          }
        }
      }
      return ids;
    }
    const out = [];
    const seenE = new Set();
    function add(a, b, orient) {
      if (a === b) return;
      const ek = edgeKey(a, b) + ":" + orient;
      if (seenE.has(ek)) return;
      seenE.add(ek);
      out.push({ from: a, to: b, orient });
    }
    const tol2 = (MERGE_EPS * 2) * (MERGE_EPS * 2);
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const a = nodes[e.from];
      const b = nodes[e.to];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const len2 = dx * dx + dy * dy + dz * dz;
      if (len2 < 1e-12) continue;
      const hits = [{ t: 0, id: e.from }, { t: 1, id: e.to }];
      const cand = nearby(a, b);
      for (let c = 0; c < cand.length; c++) {
        const id = cand[c];
        if (id === e.from || id === e.to) continue;
        const n = nodes[id];
        const t = ((n.x - a.x) * dx + (n.y - a.y) * dy + (n.z - a.z) * dz) / len2;
        if (t <= 0.02 || t >= 0.98) continue;
        const qx = a.x + t * dx - n.x;
        const qy = a.y + t * dy - n.y;
        const qz = a.z + t * dz - n.z;
        if (qx * qx + qy * qy + qz * qz > tol2) continue;
        hits.push({ t, id });
      }
      hits.sort((p, q) => p.t - q.t);
      for (let k = 0; k < hits.length - 1; k++) add(hits[k].id, hits[k + 1].id, e.orient || "h");
    }
    return out;
  }

  function subdivide3D(nodes, edges, step) {
    const spacing = Math.max(0.35, Number(step) || NODE_STEP);
    const outNodes = nodes.map((n, i) => ({ id: i, x: n.x, y: n.y, z: n.z }));
    const outEdges = [];
    const seen = new Set();
    function add(a, b, orient) {
      if (a === b) return;
      const ek = edgeKey(a, b) + ":" + orient;
      if (seen.has(ek)) return;
      seen.add(ek);
      outEdges.push({ from: a, to: b, orient });
    }
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const a = nodes[e.from];
      const b = nodes[e.to];
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      const parts = Math.min(24, Math.max(1, Math.round(len / spacing)));
      let prev = e.from;
      for (let k = 1; k < parts; k++) {
        const t = k / parts;
        const id = outNodes.length;
        outNodes.push({
          id,
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          z: a.z + (b.z - a.z) * t,
        });
        add(prev, id, e.orient);
        prev = id;
      }
      add(prev, e.to, e.orient);
    }
    outNodes.forEach((n, i) => {
      n.id = i;
    });
    return { nodes: outNodes, edges: outEdges };
  }

  function finalizeGrid(nodes, edges, meta) {
    const adj = new Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) adj[i] = [];
    const compact = [];
    const seen = new Set();
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (e.from === e.to) continue;
      const ek = edgeKey(e.from, e.to);
      if (seen.has(ek)) continue;
      seen.add(ek);
      compact.push({ from: e.from, to: e.to, orient: e.orient || "h" });
      adj[e.from].push(e.to);
      adj[e.to].push(e.from);
    }
    for (let i = 0; i < adj.length; i++) adj[i] = Array.from(new Set(adj[i]));
    let diag = 0;
    let ortho = 0;
    let vert = 0;
    let hCount = 0;
    let vCount = 0;
    for (let i = 0; i < compact.length; i++) {
      const e = compact[i];
      if (e.orient === "v") vCount += 1;
      else hCount += 1;
      const a = nodes[e.from];
      const b = nodes[e.to];
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      const dz = Math.abs(a.z - b.z);
      if (dy > 1e-4 && dx < 1e-4 && dz < 1e-4) vert += 1;
      else if (dx > 1e-4 && dz > 1e-4 && dy < 1e-4) diag += 1;
      else if (dx > 1e-4 && dy > 1e-4 && dz < 1e-4) diag += 1;
      else ortho += 1;
    }
    const grid = {
      nodes,
      edges: compact,
      adj,
      orientation: meta.orientation,
      spacing: meta.spacing,
      layerCount: meta.layerCount,
      planarNodeCount: meta.planarNodeCount,
      planarEdgeCount: meta.planarEdgeCount,
      components: countComponents(nodes.length, compact),
      diag,
      ortho,
      vert,
      hCount,
      vCount,
    };
    grid.index = buildGridIndex(grid);
    return grid;
  }

  function parsePlanarFromSvg(text) {
    const rawSegs = parseSvgLineSegments(text);
    const split = splitSegments(rawSegs);
    const merged = graphFromPieces(split);
    if (merged.nodes.length < 8 || merged.edges.length < 8) {
      throw new Error("SVG graph is too sparse to use as a growth lattice.");
    }
    const through = splitEdgesThroughNodes(merged.nodes, merged.edges);
    const planar = subdividePlanar(merged.nodes, through, NODE_STEP);
    let diag = 0;
    for (let i = 0; i < planar.edges.length; i++) {
      const a = planar.nodes[planar.edges[i].from];
      const b = planar.nodes[planar.edges[i].to];
      if (Math.abs(a.x - b.x) > 1e-4 && Math.abs(a.z - b.z) > 1e-4) diag += 1;
    }
    if (!diag) throw new Error("SVG graph lost its diagonal paths after conversion.");
    return planar;
  }

  function assembleGrid(planar, orientation, spacing) {
    const orient = orientation === "horizontal" || orientation === "vertical" ? orientation : "both";
    const layers = layerValues(spacing);
    const parts = [];
    if (orient === "horizontal" || orient === "both") {
      parts.push(instantiateHorizontal(planar, layers, orient === "horizontal"));
    }
    if (orient === "vertical" || orient === "both") {
      parts.push(instantiateVertical(planar, layers, orient === "vertical"));
    }
    let combined;
    if (orient === "both") combined = weaveHorizontalVertical(parts[0], parts[1]);
    else combined = parts[0];
    const through = splitEdgesThroughNodes3D(combined.nodes, combined.edges);
    const subdivided = subdivide3D(combined.nodes, through, NODE_STEP);
    return finalizeGrid(subdivided.nodes, subdivided.edges, {
      orientation: orient,
      spacing: layers.length > 1 ? layers[1] - layers[0] : DEFAULT_SPACING,
      layerCount: layers.length,
      planarNodeCount: planar.nodes.length,
      planarEdgeCount: planar.edges.length,
    });
  }

  function buildGridFromSvg(text, options) {
    const planar = parsePlanarFromSvg(text);
    const opts = options || {};
    return assembleGrid(planar, opts.orientation || "both", opts.spacing != null ? opts.spacing : DEFAULT_SPACING);
  }

  function buildGridIndex(grid) {
    const cell = 1;
    const map = new Map();
    for (let i = 0; i < grid.nodes.length; i++) {
      const n = grid.nodes[i];
      const key = Math.floor(n.x / cell) + "," + Math.floor(n.y / cell) + "," + Math.floor(n.z / cell);
      let bucket = map.get(key);
      if (!bucket) {
        bucket = [];
        map.set(key, bucket);
      }
      bucket.push(i);
    }
    return { map, cell };
  }

  function nearestGridNodeId(grid, x, y, z, requireDegree) {
    if (!grid || !grid.nodes.length) return -1;
    const index = grid.index || buildGridIndex(grid);
    const cell = index.cell;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    let best = -1;
    let bestSq = Infinity;
    for (let r = 0; r <= 8 && best < 0; r++) {
      bestSq = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (r > 0 && Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
            const bucket = index.map.get(cx + dx + "," + (cy + dy) + "," + (cz + dz));
            if (!bucket) continue;
            for (let i = 0; i < bucket.length; i++) {
              const id = bucket[i];
              if (requireDegree && !(grid.adj[id] && grid.adj[id].length)) continue;
              const n = grid.nodes[id];
              const dSq = (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y) + (n.z - z) * (n.z - z);
              if (dSq < bestSq) {
                bestSq = dSq;
                best = id;
              }
            }
          }
        }
      }
    }
    if (best >= 0) return best;
    for (let i = 0; i < grid.nodes.length; i++) {
      if (requireDegree && !(grid.adj[i] && grid.adj[i].length)) continue;
      const n = grid.nodes[i];
      const dSq = (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y) + (n.z - z) * (n.z - z);
      if (dSq < bestSq) {
        bestSq = dSq;
        best = i;
      }
    }
    return best;
  }

  function createSim(options) {
    const seed = (options.seed >>> 0) || 1;
    return {
      seed,
      influence: options.influence != null ? options.influence : DEFAULT_INFLUENCE,
      kill: options.kill != null ? options.kill : DEFAULT_KILL,
      attractorTarget: options.attractorCount != null ? options.attractorCount : DEFAULT_ATTRACTORS,
      iteration: 0,
      nextNodeId: 1,
      nextBranchId: 1,
      nextRootIndex: 1,
      nodes: [],
      nodeById: new Map(),
      branches: [],
      roots: [],
      attractors: [],
      alive: [],
      done: false,
      grid: options.grid || null,
      gridToSim: new Map(),
      usedEdges: new Set(),
    };
  }

  function occupyGridNode(sim, gridId, parentSimId, asRoot) {
    if (gridId < 0 || !sim.grid) return null;
    if (sim.gridToSim.has(gridId)) return sim.nodeById.get(sim.gridToSim.get(gridId));
    const g = sim.grid.nodes[gridId];
    if (!g) return null;
    const node = {
      id: sim.nextNodeId++,
      x: g.x,
      y: g.y,
      z: g.z,
      gridId,
      parentId: parentSimId,
      order: 1,
      rootIndex: asRoot ? sim.nextRootIndex++ : 0,
      isRoot: !!asRoot,
    };
    if (parentSimId != null) {
      const parent = sim.nodeById.get(parentSimId);
      node.order = parent ? (parent.order || 1) + 1 : 1;
    }
    sim.nodes.push(node);
    sim.nodeById.set(node.id, node);
    sim.gridToSim.set(gridId, node.id);
    if (asRoot) sim.roots.push(node.id);
    return node;
  }

  function addRootAt(sim, x, y, z) {
    if (!sim.grid) return null;
    const gid = nearestGridNodeId(sim.grid, x, y, z, true);
    if (gid < 0) return null;
    if (sim.gridToSim.has(gid)) return null;
    return occupyGridNode(sim, gid, null, true);
  }

  function defaultRootPosition(grid) {
    if (!grid) return { x: 10, y: 0, z: 10 };
    const gid = nearestGridNodeId(grid, 10, 0, 10, true);
    if (gid < 0) return { x: 10, y: 0, z: 10 };
    const n = grid.nodes[gid];
    return { x: n.x, y: n.y, z: n.z };
  }

  function ensureDefaultRoot(sim) {
    if (sim.roots.length) return sim.nodeById.get(sim.roots[0]);
    const p = defaultRootPosition(sim.grid);
    return addRootAt(sim, p.x, p.y, p.z);
  }

  function generateAttractors(sim) {
    sim.attractors = [];
    sim.alive = [];
    if (!sim.grid) return;
    const want = clamp(Math.round(sim.attractorTarget), 1, 4000);
    const rng = mulberry32(sim.seed);
    const blocked = [];
    for (const id of sim.roots) {
      const node = sim.nodeById.get(id);
      if (node) blocked.push(node);
    }
    const minSep = Math.max(0.15, sim.kill * 0.25);
    const used = new Set();
    const attractors = [];
    const n = sim.grid.nodes.length;
    let guard = 0;
    while (attractors.length < want && guard < want * 80 + 800) {
      guard += 1;
      const gid = Math.floor(rng() * n);
      if (used.has(gid)) continue;
      used.add(gid);
      const g = sim.grid.nodes[gid];
      if (!sim.grid.adj[gid] || !sim.grid.adj[gid].length) continue;
      let ok = true;
      for (let i = 0; i < blocked.length; i++) {
        if (Math.hypot(blocked[i].x - g.x, blocked[i].y - g.y, blocked[i].z - g.z) < minSep) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      attractors.push({ x: g.x, y: g.y, z: g.z, gridId: gid });
    }
    sim.attractors = attractors;
    sim.alive = new Uint8Array(attractors.length);
    sim.alive.fill(1);
    killNearNetwork(sim);
  }

  function buildNodeIndex(sim) {
    const cell = Math.max(0.5, sim.influence * 0.5);
    const map = new Map();
    for (let i = 0; i < sim.nodes.length; i++) {
      const node = sim.nodes[i];
      const cx = Math.floor(node.x / cell);
      const cy = Math.floor(node.y / cell);
      const cz = Math.floor(node.z / cell);
      const key = cx + "," + cy + "," + cz;
      let bucket = map.get(key);
      if (!bucket) {
        bucket = [];
        map.set(key, bucket);
      }
      bucket.push(node);
    }
    return { map, cell };
  }

  function nearestNode(index, x, y, z, maxDist) {
    const maxSq = maxDist * maxDist;
    const r = Math.max(1, Math.ceil(maxDist / index.cell));
    const cx = Math.floor(x / index.cell);
    const cy = Math.floor(y / index.cell);
    const cz = Math.floor(z / index.cell);
    let best = null;
    let bestSq = maxSq;
    for (let dz = -r; dz <= r; dz++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const bucket = index.map.get(cx + dx + "," + (cy + dy) + "," + (cz + dz));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const node = bucket[i];
            const ddx = node.x - x;
            const ddy = node.y - y;
            const ddz = node.z - z;
            const dSq = ddx * ddx + ddy * ddy + ddz * ddz;
            if (dSq <= bestSq) {
              bestSq = dSq;
              best = node;
            }
          }
        }
      }
    }
    return best;
  }

  function anyNodeWithin(index, x, y, z, maxDist) {
    return !!nearestNode(index, x, y, z, maxDist);
  }

  function killNearNetwork(sim) {
    if (!sim.attractors.length || !sim.nodes.length) return;
    const index = buildNodeIndex(sim);
    const kill = Math.max(1e-6, sim.kill);
    for (let i = 0; i < sim.attractors.length; i++) {
      if (!sim.alive[i]) continue;
      const a = sim.attractors[i];
      if (anyNodeWithin(index, a.x, a.y, a.z, kill)) sim.alive[i] = 0;
    }
  }

  function aliveCount(sim) {
    let n = 0;
    for (let i = 0; i < sim.alive.length; i++) if (sim.alive[i]) n += 1;
    return n;
  }

  function pickGraphNeighbor(sim, node, pull) {
    const gid = node.gridId;
    const neigh = sim.grid.adj[gid] || [];
    const plen = Math.hypot(pull.x, pull.y, pull.z);
    if (plen < 1e-8) return -1;
    const px = pull.x / plen;
    const py = pull.y / plen;
    const pz = pull.z / plen;
    let best = -1;
    let bestDot = 0.04;
    for (let i = 0; i < neigh.length; i++) {
      const toId = neigh[i];
      const ek = edgeKey(gid, toId);
      if (sim.usedEdges.has(ek)) continue;
      const to = sim.grid.nodes[toId];
      const dx = to.x - node.x;
      const dy = to.y - node.y;
      const dz = to.z - node.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const dot = (dx / len) * px + (dy / len) * py + (dz / len) * pz;
      if (dot > bestDot) {
        bestDot = dot;
        best = toId;
      }
    }
    return best;
  }

  function growAlongEdge(sim, fromNode, toGridId) {
    const ek = edgeKey(fromNode.gridId, toGridId);
    if (sim.usedEdges.has(ek)) return false;
    sim.usedEdges.add(ek);
    let child = null;
    if (sim.gridToSim.has(toGridId)) {
      child = sim.nodeById.get(sim.gridToSim.get(toGridId));
    } else {
      child = occupyGridNode(sim, toGridId, fromNode.id, false);
    }
    if (!child) return false;
    sim.branches.push({
      id: sim.nextBranchId++,
      fromId: fromNode.id,
      toId: child.id,
      order: child.order,
    });
    return true;
  }

  function growStep(sim) {
    if (sim.done) return false;
    if (!sim.grid) {
      sim.done = true;
      return false;
    }
    if (!sim.roots.length) ensureDefaultRoot(sim);
    if (!sim.attractors.length) generateAttractors(sim);
    if (!aliveCount(sim)) {
      sim.done = true;
      return false;
    }
    const index = buildNodeIndex(sim);
    const influence = Math.max(NODE_STEP * 1.1, sim.influence);
    const pulls = new Map();
    for (let i = 0; i < sim.attractors.length; i++) {
      if (!sim.alive[i]) continue;
      const a = sim.attractors[i];
      const node = nearestNode(index, a.x, a.y, a.z, influence);
      if (!node) continue;
      let pull = pulls.get(node.id);
      if (!pull) {
        pull = { x: 0, y: 0, z: 0 };
        pulls.set(node.id, pull);
      }
      pull.x += a.x - node.x;
      pull.y += a.y - node.y;
      pull.z += a.z - node.z;
    }
    if (!pulls.size) {
      sim.done = true;
      return false;
    }
    const ids = Array.from(pulls.keys()).sort((a, b) => a - b);
    let grew = 0;
    for (let i = 0; i < ids.length; i++) {
      const node = sim.nodeById.get(ids[i]);
      if (!node) continue;
      const next = pickGraphNeighbor(sim, node, pulls.get(ids[i]));
      if (next < 0) continue;
      if (growAlongEdge(sim, node, next)) grew += 1;
    }
    sim.iteration += 1;
    killNearNetwork(sim);
    if (!grew || !aliveCount(sim)) sim.done = true;
    return grew > 0;
  }

  function resetGrowth(sim) {
    const rootNodes = sim.roots.map((id) => sim.nodeById.get(id)).filter(Boolean);
    sim.nodes = [];
    sim.nodeById = new Map();
    sim.branches = [];
    sim.iteration = 0;
    sim.done = false;
    sim.nextNodeId = 1;
    sim.nextBranchId = 1;
    sim.gridToSim = new Map();
    sim.usedEdges = new Set();
    sim.roots = [];
    const kept = [];
    for (let i = 0; i < rootNodes.length; i++) {
      const old = rootNodes[i];
      const gid = old.gridId != null ? old.gridId : nearestGridNodeId(sim.grid, old.x, old.y, old.z, true);
      const node = occupyGridNode(sim, gid, null, true);
      if (!node) continue;
      node.rootIndex = old.rootIndex;
      kept.push(node.id);
    }
    sim.roots = kept;
    sim.nextRootIndex = kept.length + 1;
    if (sim.alive && sim.alive.length === sim.attractors.length) sim.alive.fill(1);
    killNearNetwork(sim);
  }

  function deleteRoot(sim, nodeId) {
    const root = sim.nodeById.get(nodeId);
    if (!root || !root.isRoot) return false;
    const drop = new Set();
    function walk(id) {
      drop.add(id);
      for (let i = 0; i < sim.nodes.length; i++) {
        if (sim.nodes[i].parentId === id) walk(sim.nodes[i].id);
      }
    }
    walk(nodeId);
    sim.nodes = sim.nodes.filter((n) => !drop.has(n.id));
    sim.branches = sim.branches.filter((b) => !drop.has(b.fromId) && !drop.has(b.toId));
    sim.roots = sim.roots.filter((id) => id !== nodeId);
    sim.nodeById = new Map();
    sim.gridToSim = new Map();
    for (let i = 0; i < sim.nodes.length; i++) {
      sim.nodeById.set(sim.nodes[i].id, sim.nodes[i]);
      if (sim.nodes[i].gridId != null) sim.gridToSim.set(sim.nodes[i].gridId, sim.nodes[i].id);
    }
    sim.usedEdges = new Set();
    for (let i = 0; i < sim.branches.length; i++) {
      const a = sim.nodeById.get(sim.branches[i].fromId);
      const b = sim.nodeById.get(sim.branches[i].toId);
      if (a && b && a.gridId != null && b.gridId != null) sim.usedEdges.add(edgeKey(a.gridId, b.gridId));
    }
    return true;
  }

  function snapshot(sim) {
    return {
      version: 3,
      cube: CUBE,
      units: "feet",
      upAxis: "Y",
      grid: "default-3d-grid.svg",
      seed: sim.seed,
      attractorCount: sim.attractorTarget,
      influence: sim.influence,
      kill: sim.kill,
      iteration: sim.iteration,
      roots: sim.roots.map((id) => {
        const n = sim.nodeById.get(id);
        return n ? { id: n.id, x: n.x, y: n.y, z: n.z, rootIndex: n.rootIndex, gridId: n.gridId } : null;
      }).filter(Boolean),
      nodes: sim.nodes.map((n) => ({
        id: n.id,
        x: n.x,
        y: n.y,
        z: n.z,
        parentId: n.parentId,
        order: n.order,
        isRoot: !!n.isRoot,
        gridId: n.gridId,
      })),
      branches: sim.branches.map((b) => ({
        id: b.id,
        fromId: b.fromId,
        toId: b.toId,
        order: b.order,
      })),
      attractors: sim.attractors.map((a, i) => ({
        x: a.x,
        y: a.y,
        z: a.z,
        alive: !!sim.alive[i],
      })),
    };
  }

  function cubeWire(THREE, size) {
    const g = new THREE.BufferGeometry();
    const p = [];
    const c = [
      [0, 0, 0],
      [size, 0, 0],
      [size, size, 0],
      [0, size, 0],
      [0, 0, size],
      [size, 0, size],
      [size, size, size],
      [0, size, size],
    ];
    const e = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ];
    for (let i = 0; i < e.length; i++) {
      const a = c[e[i][0]];
      const b = c[e[i][1]];
      p.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    return g;
  }

  function createViewer(container) {
    const THREE = global.THREE;
    if (!THREE || !container) return null;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const workspaceCenter = new THREE.Vector3(CUBE * 0.5, CUBE * 0.5, CUBE * 0.5);
    const perspectiveCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    let activeCamera = perspectiveCamera;
    let viewMode = "perspective";
    const viewDirections = {
      front: new THREE.Vector3(0, 0, 1),
      back: new THREE.Vector3(0, 0, -1),
      right: new THREE.Vector3(1, 0, 0),
      left: new THREE.Vector3(-1, 0, 0),
      top: new THREE.Vector3(0, 1, 0),
      bottom: new THREE.Vector3(0, -1, 0),
      isometric: new THREE.Vector3(1, 1, 1),
    };

    function usesOrtho(mode) {
      return mode && mode !== "perspective";
    }

    function viewDirection(mode) {
      const d = viewDirections[mode];
      return d ? d.clone().normalize() : viewDirections.isometric.clone().normalize();
    }

    function setCameraUpForDirection(cam, dir) {
      const d = dir.clone().normalize();
      if (Math.abs(d.y) > 0.95) cam.up.set(0, 0, d.y > 0 ? -1 : 1);
      else cam.up.set(0, 1, 0);
    }

    function frameOrthoToWorkspace(cam, dir, aspect, margin) {
      const m = margin != null ? margin : 1.08;
      const a = Math.max(1e-6, aspect);
      const d = dir.clone().normalize();
      cam.position.copy(workspaceCenter).addScaledVector(d, CUBE * 3.5);
      setCameraUpForDirection(cam, d);
      cam.lookAt(workspaceCenter);
      cam.updateMatrixWorld(true);
      const inv = cam.matrixWorldInverse;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let xi = 0; xi <= 1; xi++) {
        for (let yi = 0; yi <= 1; yi++) {
          for (let zi = 0; zi <= 1; zi++) {
            const p = new THREE.Vector3(xi ? CUBE : 0, yi ? CUBE : 0, zi ? CUBE : 0).applyMatrix4(inv);
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
            minZ = Math.min(minZ, p.z);
            maxZ = Math.max(maxZ, p.z);
          }
        }
      }
      const cx = (minX + maxX) * 0.5;
      const cy = (minY + maxY) * 0.5;
      let halfW = ((maxX - minX) * m) / 2;
      let halfH = ((maxY - minY) * m) / 2;
      if (halfW / Math.max(halfH, 1e-6) > a) halfH = halfW / a;
      else halfW = halfH * a;
      cam.left = cx - halfW;
      cam.right = cx + halfW;
      cam.top = cy + halfH;
      cam.bottom = cy - halfH;
      cam.near = Math.max(0.1, -maxZ - CUBE);
      cam.far = Math.max(cam.near + 1, -minZ + CUBE * 4);
      cam.zoom = 1;
      cam.updateProjectionMatrix();
    }

    const controls = THREE.OrbitControls ? new THREE.OrbitControls(perspectiveCamera, renderer.domElement) : null;
    if (controls) {
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = true;
      controls.screenSpacePanning = true;
      controls.minDistance = 8;
      controls.maxDistance = 90;
      if (THREE.MOUSE) {
        controls.mouseButtons = {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        };
      }
    }

    function flushOrbitDeltas() {
      if (!controls) return;
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = damping;
    }

    function applyOrbitPolicy(mode) {
      if (!controls) return;
      controls.enablePan = true;
      controls.enableZoom = true;
      controls.screenSpacePanning = true;
      if (usesOrtho(mode)) {
        controls.enableRotate = false;
        controls.enableDamping = false;
        controls.minDistance = 0;
        controls.maxDistance = Infinity;
      } else {
        controls.enableRotate = true;
        controls.enableDamping = true;
        controls.minDistance = 8;
        controls.maxDistance = 90;
      }
    }

    function syncControlsCamera() {
      if (controls) {
        controls.object = activeCamera;
        controls.target.copy(workspaceCenter);
        controls.update();
      }
    }

    function applyViewMode(mode, options) {
      const reset = !options || options.reset !== false;
      if (!mode || (mode !== "perspective" && !viewDirections[mode])) mode = "perspective";
      flushOrbitDeltas();
      viewMode = mode;
      if (mode === "perspective") {
        activeCamera = perspectiveCamera;
        if (reset) {
          perspectiveCamera.up.set(0, 1, 0);
          perspectiveCamera.position.set(32, 24, 32);
          perspectiveCamera.lookAt(workspaceCenter);
        }
      } else {
        activeCamera = orthoCamera;
        if (reset) {
          const w = Math.max(8, container.clientWidth);
          const h = Math.max(8, container.clientHeight);
          frameOrthoToWorkspace(orthoCamera, viewDirection(mode), w / h);
        }
      }
      applyOrbitPolicy(mode);
      syncControlsCamera();
    }

    const cube = new THREE.LineSegments(
      cubeWire(THREE, CUBE),
      new THREE.LineBasicMaterial({ color: 0x8a8a8a, transparent: true, opacity: 0.45 })
    );
    scene.add(cube);

    let hLines = null;
    let vLines = null;
    let showH = true;
    let showV = true;
    let showAttractors = true;

    const attrGeom = new THREE.BufferGeometry();
    attrGeom.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    const attractors = new THREE.Points(
      attrGeom,
      new THREE.PointsMaterial({
        color: 0xff1a1a,
        size: 0.18,
        sizeAttenuation: true,
        depthWrite: false,
      })
    );
    scene.add(attractors);

    const MAX_SEGS = 28000;
    const branchPos = new Float32Array(MAX_SEGS * 6);
    const branchGeom = new THREE.BufferGeometry();
    branchGeom.setAttribute("position", new THREE.BufferAttribute(branchPos, 3));
    branchGeom.setDrawRange(0, 0);
    const branches = new THREE.LineSegments(
      branchGeom,
      new THREE.LineBasicMaterial({ color: 0xffffff })
    );
    scene.add(branches);

    const rootsGroup = new THREE.Group();
    scene.add(rootsGroup);
    const SphereGeom = THREE.SphereBufferGeometry || THREE.SphereGeometry;
    const rootGeom = new SphereGeom(0.16, 10, 8);
    const rootMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const rootSelMat = new THREE.MeshBasicMaterial({ color: 0xd4c48a });

    let raf = 0;
    let running = false;

    function resize() {
      const w = Math.max(8, container.clientWidth);
      const h = Math.max(8, container.clientHeight);
      renderer.setSize(w, h, false);
      const aspect = w / h;
      perspectiveCamera.aspect = aspect;
      perspectiveCamera.updateProjectionMatrix();
      if (usesOrtho(viewMode)) frameOrthoToWorkspace(orthoCamera, viewDirection(viewMode), aspect);
      else {
        orthoCamera.left = -10 * aspect;
        orthoCamera.right = 10 * aspect;
        orthoCamera.top = 10;
        orthoCamera.bottom = -10;
        orthoCamera.updateProjectionMatrix();
      }
    }

    function disposeLines(obj) {
      if (!obj) return;
      scene.remove(obj);
      obj.geometry.dispose();
      obj.material.dispose();
    }

    function makeGridLines(graph, orient) {
      const list = [];
      if (!graph || !graph.edges) return null;
      for (let i = 0; i < graph.edges.length; i++) {
        const e = graph.edges[i];
        if ((e.orient || "h") !== orient) continue;
        const a = graph.nodes[e.from];
        const b = graph.nodes[e.to];
        if (!a || !b) continue;
        list.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      if (!list.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(list, 3));
      return new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({
          color: 0x6a6a6a,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        })
      );
    }

    function setGrid(graph) {
      disposeLines(hLines);
      disposeLines(vLines);
      hLines = null;
      vLines = null;
      hLines = makeGridLines(graph, "h");
      vLines = makeGridLines(graph, "v");
      if (hLines) {
        hLines.visible = showH;
        scene.add(hLines);
      }
      if (vLines) {
        vLines.visible = showV;
        scene.add(vLines);
      }
    }

    function setShowHorizontal(on) {
      showH = !!on;
      if (hLines) hLines.visible = showH;
    }

    function setShowVertical(on) {
      showV = !!on;
      if (vLines) vLines.visible = showV;
    }

    function setShowAttractors(on) {
      showAttractors = !!on;
      attractors.visible = showAttractors && attrGeom.attributes.position && attrGeom.attributes.position.count > 0;
    }

    function setAttractors(list) {
      const pos = new Float32Array(list.length * 3);
      for (let i = 0; i < list.length; i++) {
        pos[i * 3] = list[i].x;
        pos[i * 3 + 1] = list[i].y;
        pos[i * 3 + 2] = list[i].z;
      }
      attrGeom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      attrGeom.computeBoundingSphere();
      attractors.visible = showAttractors && list.length > 0;
    }

    function setBranches(list, nodesById) {
      const count = Math.min(list.length, MAX_SEGS);
      for (let i = 0; i < count; i++) {
        const b = list[i];
        const a = nodesById.get(b.fromId);
        const c = nodesById.get(b.toId);
        const o = i * 6;
        if (!a || !c) {
          branchPos[o] = branchPos[o + 1] = branchPos[o + 2] = 0;
          branchPos[o + 3] = branchPos[o + 4] = branchPos[o + 5] = 0;
          continue;
        }
        branchPos[o] = a.x;
        branchPos[o + 1] = a.y;
        branchPos[o + 2] = a.z;
        branchPos[o + 3] = c.x;
        branchPos[o + 4] = c.y;
        branchPos[o + 5] = c.z;
      }
      branchGeom.attributes.position.needsUpdate = true;
      branchGeom.setDrawRange(0, count * 2);
      branchGeom.computeBoundingSphere();
    }

    function setRoots(list, selectedId) {
      while (rootsGroup.children.length) {
        const child = rootsGroup.children[0];
        rootsGroup.remove(child);
      }
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        const mesh = new THREE.Mesh(rootGeom, n.id === selectedId ? rootSelMat : rootMat);
        mesh.position.set(n.x, n.y, n.z);
        mesh.userData.rootId = n.id;
        rootsGroup.add(mesh);
      }
    }

    function pickRoot(clientX, clientY) {
      if (!rootsGroup.children.length) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, activeCamera);
      const hits = raycaster.intersectObjects(rootsGroup.children, false);
      if (!hits.length) return null;
      return hits[0].object.userData.rootId || null;
    }

    function tick() {
      if (controls && viewMode === "perspective") controls.update();
      renderer.render(scene, activeCamera);
      raf = requestAnimationFrame(tick);
    }

    applyViewMode("perspective", { reset: true });
    resize();

    return {
      resize,
      start() {
        if (running) return;
        running = true;
        resize();
        raf = requestAnimationFrame(tick);
      },
      stop() {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      },
      setViewMode(mode) {
        applyViewMode(mode, { reset: true });
        resize();
      },
      getViewMode() {
        return viewMode;
      },
      setGrid,
      setShowHorizontal,
      setShowVertical,
      setShowAttractors,
      setAttractors,
      setBranches,
      setRoots,
      pickRoot,
    };
  }

  function mount() {
    const stage = document.getElementById("grid3dStage");
    if (!stage) return null;
    const els = {
      status: document.getElementById("grid3dStatus"),
      gridStats: document.getElementById("grid3dGridStats"),
      attractorStats: document.getElementById("grid3dAttractorStats"),
      showH: document.getElementById("grid3dShowH"),
      showV: document.getElementById("grid3dShowV"),
      showAttractors: document.getElementById("grid3dShowAttractors"),
      orientation: document.getElementById("grid3dOrientation"),
      spacing: document.getElementById("grid3dSpacing"),
      spacingVal: document.getElementById("grid3dSpacingVal"),
      attractorCount: document.getElementById("grid3dAttractorCount"),
      attractorCountVal: document.getElementById("grid3dAttractorCountVal"),
      influence: document.getElementById("grid3dInfluence"),
      influenceVal: document.getElementById("grid3dInfluenceVal"),
      kill: document.getElementById("grid3dKill"),
      killVal: document.getElementById("grid3dKillVal"),
      speed: document.getElementById("grid3dSpeed"),
      speedVal: document.getElementById("grid3dSpeedVal"),
      generate: document.getElementById("grid3dGenerate"),
      addRoot: document.getElementById("grid3dAddRoot"),
      start: document.getElementById("grid3dStart"),
      pause: document.getElementById("grid3dPause"),
      reset: document.getElementById("grid3dReset"),
      variation: document.getElementById("grid3dVariation"),
      rootX: document.getElementById("grid3dRootX"),
      rootY: document.getElementById("grid3dRootY"),
      rootZ: document.getElementById("grid3dRootZ"),
      deleteRoot: document.getElementById("grid3dDeleteRoot"),
      rootList: document.getElementById("grid3dRootList"),
      readout: document.getElementById("grid3dReadout"),
      hint: document.getElementById("grid3dViewHint"),
    };

    let viewer = null;
    let sim = createSim({ seed: 20261003 });
    let selectedRootId = null;
    let playing = false;
    let acc = 0;
    let lastTs = 0;
    let growRaf = 0;
    let planarSource = null;
    let orientation = "both";
    let spacing = DEFAULT_SPACING;
    let gridError = null;

    function setStatus(message, kind) {
      if (!els.status) return;
      els.status.textContent = message;
      els.status.classList.toggle("active", kind === "active");
      els.status.classList.toggle("error", kind === "error");
    }

    function paintGridStats() {
      const g = sim.grid;
      if (els.gridStats) {
        if (!g) {
          els.gridStats.textContent = "Grid Nodes: — · Grid Edges: — · Connected Components: —";
        } else {
          els.gridStats.textContent =
            "Grid Nodes: " +
            g.nodes.length +
            " · Grid Edges: " +
            g.edges.length +
            " · Connected Components: " +
            g.components;
        }
      }
      if (els.attractorStats) {
        els.attractorStats.textContent = "Active Attractors: " + aliveCount(sim) + " / " + sim.attractors.length;
      }
    }

    function paintViewButtons() {
      const mode = viewer && viewer.getViewMode ? viewer.getViewMode() : "perspective";
      document.querySelectorAll("#grid3dViewBar .grid3d-view-btn").forEach((btn) => {
        const on = btn.dataset.view === mode;
        btn.classList.toggle("active", on);
        btn.classList.toggle("primary", on);
        btn.classList.toggle("ghost", !on);
      });
      if (els.hint) {
        els.hint.textContent = mode === "perspective"
          ? "Left-drag orbit · Right-drag pan · Scroll zoom"
          : "Rotation locked · Right-drag pan · Scroll zoom";
      }
    }

    function paintReadout() {
      if (els.readout) {
        const ori = sim.grid && sim.grid.orientation ? sim.grid.orientation : orientation;
        els.readout.textContent =
          "Workspace: 20' W × 20' D × 20' H · Y up · SVG " + ori + " @ " + Number(spacing).toFixed(0) + "'";
      }
    }

    function paintRoots() {
      if (!els.rootList) return;
      els.rootList.innerHTML = "";
      for (let i = 0; i < sim.roots.length; i++) {
        const node = sim.nodeById.get(sim.roots[i]);
        if (!node) continue;
        const li = document.createElement("li");
        if (node.id === selectedRootId) li.classList.add("selected");
        li.textContent = `R${node.rootIndex} · ${node.x.toFixed(1)}, ${node.y.toFixed(1)}, ${node.z.toFixed(1)}`;
        li.addEventListener("click", () => {
          selectedRootId = node.id;
          paintRoots();
          syncViewer();
        });
        els.rootList.appendChild(li);
      }
      if (els.deleteRoot) els.deleteRoot.disabled = !selectedRootId;
    }

    function paintButtons() {
      const ready = !!sim.grid && !gridError;
      if (els.start) els.start.disabled = playing || !ready;
      if (els.pause) els.pause.disabled = !playing;
      if (els.generate) els.generate.disabled = !ready;
      if (els.variation) els.variation.disabled = !ready;
      if (els.addRoot) els.addRoot.disabled = !ready;
    }

    function aliveAttractors() {
      const out = [];
      for (let i = 0; i < sim.attractors.length; i++) {
        if (sim.alive[i]) out.push(sim.attractors[i]);
      }
      return out;
    }

    function syncViewer() {
      if (viewer) {
        viewer.setAttractors(aliveAttractors());
        viewer.setBranches(sim.branches, sim.nodeById);
        const roots = sim.roots.map((id) => sim.nodeById.get(id)).filter(Boolean);
        viewer.setRoots(roots, selectedRootId);
      }
      paintReadout();
      paintGridStats();
    }

    function paintStatus() {
      if (gridError) {
        setStatus(gridError, "error");
        paintGridStats();
        return;
      }
      if (!sim.grid) {
        setStatus("Loading grid…");
        return;
      }
      const remain = aliveCount(sim);
      const segs = sim.branches.length;
      setStatus(
        `Iter ${sim.iteration} · nodes ${sim.nodes.length} · branches ${segs} · attractors ${remain}/${sim.attractors.length} · seed ${sim.seed}` +
          (sim.done ? " · complete" : playing ? " · growing" : ""),
        sim.done ? "active" : playing ? "active" : undefined
      );
      paintGridStats();
    }

    function readRootFields() {
      return {
        x: clamp(Number(els.rootX?.value ?? 10), 0, CUBE),
        y: clamp(Number(els.rootY?.value ?? 0), 0, CUBE),
        z: clamp(Number(els.rootZ?.value ?? 10), 0, CUBE),
      };
    }

    function readParamsIntoSim() {
      sim.attractorTarget = Number(els.attractorCount?.value ?? DEFAULT_ATTRACTORS);
      sim.influence = Number(els.influence?.value ?? DEFAULT_INFLUENCE);
      sim.kill = Number(els.kill?.value ?? DEFAULT_KILL);
    }

    function growLoop(ts) {
      if (!playing) return;
      if (!lastTs) lastTs = ts;
      const dt = Math.min(0.08, (ts - lastTs) / 1000);
      lastTs = ts;
      const speed = Number(els.speed?.value ?? DEFAULT_SPEED);
      acc += dt * Math.max(0.2, speed);
      let steps = 0;
      while (acc >= 1 && steps < 1) {
        acc -= 1;
        steps += 1;
        const grew = growStep(sim);
        if (!grew) {
          playing = false;
          paintButtons();
          break;
        }
      }
      if (steps) {
        syncViewer();
        paintStatus();
      }
      if (playing) growRaf = requestAnimationFrame(growLoop);
    }

    function startGrowth() {
      if (!sim.grid) {
        setStatus(gridError || "SVG grid is not loaded.", "error");
        return;
      }
      readParamsIntoSim();
      if (!sim.roots.length) {
        const node = ensureDefaultRoot(sim);
        selectedRootId = node ? node.id : null;
        paintRoots();
      }
      if (!sim.attractors.length) generateAttractors(sim);
      if (sim.done && !aliveCount(sim)) {
        setStatus("No remaining attractors. Reset Simulation or New Variation.", "error");
        return;
      }
      sim.done = false;
      playing = true;
      acc = 0;
      lastTs = 0;
      paintButtons();
      paintStatus();
      syncViewer();
      if (growRaf) cancelAnimationFrame(growRaf);
      growRaf = requestAnimationFrame(growLoop);
    }

    function pauseGrowth() {
      playing = false;
      if (growRaf) cancelAnimationFrame(growRaf);
      growRaf = 0;
      paintButtons();
      paintStatus();
    }

    function applyLoadedGrid(grid, keepRoots) {
      const rootTargets = keepRoots
        ? sim.roots.map((id) => sim.nodeById.get(id)).filter(Boolean)
        : [];
      sim.grid = grid;
      gridError = null;
      sim.nodes = [];
      sim.nodeById = new Map();
      sim.branches = [];
      sim.roots = [];
      sim.gridToSim = new Map();
      sim.usedEdges = new Set();
      sim.iteration = 0;
      sim.done = false;
      sim.nextNodeId = 1;
      sim.nextBranchId = 1;
      sim.nextRootIndex = 1;
      if (viewer) viewer.setGrid(grid);
      if (rootTargets.length) {
        for (let i = 0; i < rootTargets.length; i++) {
          addRootAt(sim, rootTargets[i].x, rootTargets[i].y, rootTargets[i].z);
        }
      }
      if (!sim.roots.length) {
        const def = defaultRootPosition(grid);
        if (els.rootX) els.rootX.value = def.x.toFixed(1);
        if (els.rootY) els.rootY.value = def.y.toFixed(1);
        if (els.rootZ) els.rootZ.value = def.z.toFixed(1);
        ensureDefaultRoot(sim);
      }
      selectedRootId = sim.roots[0] || null;
      generateAttractors(sim);
      paintRoots();
      paintButtons();
      syncViewer();
      const ori = grid.orientation || orientation;
      setStatus(
        "SVG grid · " +
          ori +
          " · " +
          grid.layerCount +
          " planes @ " +
          Number(grid.spacing).toFixed(0) +
          "' · H " +
          (grid.hCount || 0) +
          " · V " +
          (grid.vCount || 0) +
          " · " +
          grid.components +
          " component" +
          (grid.components === 1 ? "" : "s"),
        "active"
      );
    }

    function rebuildAssembledGrid(keepRoots) {
      if (!planarSource) {
        setStatus(gridError || "SVG grid is not loaded.", "error");
        return;
      }
      pauseGrowth();
      try {
        const grid = assembleGrid(planarSource, orientation, spacing);
        applyLoadedGrid(grid, keepRoots);
      } catch (err) {
        gridError = "SVG grid failed: " + (err && err.message ? err.message : String(err));
        sim.grid = null;
        paintButtons();
        paintGridStats();
        setStatus(gridError, "error");
      }
    }

    async function loadDefaultGrid() {
      setStatus("Loading default-3d-grid.svg…");
      try {
        const url = defaultGridUrl();
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) throw new Error("Could not load default-3d-grid.svg (" + res.status + ").");
        const text = await res.text();
        if (!/<svg[\s>]/i.test(text)) throw new Error("default-3d-grid.svg is not a valid SVG file.");
        planarSource = parsePlanarFromSvg(text);
        const grid = assembleGrid(planarSource, orientation, spacing);
        applyLoadedGrid(grid, false);
      } catch (err) {
        gridError = "SVG grid failed: " + (err && err.message ? err.message : String(err));
        sim.grid = null;
        sim.attractors = [];
        sim.alive = [];
        paintButtons();
        paintGridStats();
        setStatus(gridError, "error");
      }
    }

    function ensureViewer() {
      if (viewer) return viewer;
      viewer = createViewer(stage);
      if (!viewer) {
        setStatus("Three.js did not load — 3D Grid Growth cannot start.", "error");
        return null;
      }
      if (sim.grid) viewer.setGrid(sim.grid);
      if (els.showH) viewer.setShowHorizontal(els.showH.checked);
      if (els.showV) viewer.setShowVertical(els.showV.checked);
      if (els.showAttractors) viewer.setShowAttractors(els.showAttractors.checked);
      stage.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        const id = viewer.pickRoot(event.clientX, event.clientY);
        if (id == null) return;
        selectedRootId = id;
        paintRoots();
        syncViewer();
      });
      return viewer;
    }

    function bindVal(input, label, fmt) {
      if (!input || !label) return;
      const paint = () => {
        label.textContent = fmt(input.value);
      };
      input.addEventListener("input", paint);
      paint();
    }

    bindVal(els.attractorCount, els.attractorCountVal, (v) => String(Math.round(Number(v))));
    bindVal(els.influence, els.influenceVal, (v) => `${Number(v).toFixed(1)}'`);
    bindVal(els.kill, els.killVal, (v) => `${Number(v).toFixed(1)}'`);
    bindVal(els.speed, els.speedVal, (v) => `${Math.round(Number(v))}/s`);
    bindVal(els.spacing, els.spacingVal, (v) => `${Number(v).toFixed(1)}'`);

    if (els.showH) {
      els.showH.addEventListener("change", () => {
        if (viewer) viewer.setShowHorizontal(els.showH.checked);
      });
    }
    if (els.showV) {
      els.showV.addEventListener("change", () => {
        if (viewer) viewer.setShowVertical(els.showV.checked);
      });
    }
    if (els.showAttractors) {
      els.showAttractors.addEventListener("change", () => {
        if (viewer) viewer.setShowAttractors(els.showAttractors.checked);
      });
    }
    if (els.orientation) {
      els.orientation.addEventListener("change", () => {
        orientation = els.orientation.value || "both";
        rebuildAssembledGrid(true);
      });
    }
    if (els.spacing) {
      els.spacing.addEventListener("change", () => {
        spacing = Number(els.spacing.value) || DEFAULT_SPACING;
        rebuildAssembledGrid(true);
      });
    }
    if (els.generate) {
      els.generate.addEventListener("click", () => {
        if (!sim.grid) {
          setStatus(gridError || "SVG grid is not loaded.", "error");
          return;
        }
        readParamsIntoSim();
        generateAttractors(sim);
        sim.done = false;
        syncViewer();
        paintStatus();
      });
    }
    if (els.addRoot) {
      els.addRoot.addEventListener("click", () => {
        if (!sim.grid) {
          setStatus(gridError || "SVG grid is not loaded.", "error");
          return;
        }
        const p = readRootFields();
        const node = addRootAt(sim, p.x, p.y, p.z);
        if (!node) {
          setStatus("That grid node already has a root.", "error");
          return;
        }
        selectedRootId = node.id;
        if (els.rootX) els.rootX.value = node.x.toFixed(1);
        if (els.rootY) els.rootY.value = node.y.toFixed(1);
        if (els.rootZ) els.rootZ.value = node.z.toFixed(1);
        killNearNetwork(sim);
        paintRoots();
        syncViewer();
        paintStatus();
      });
    }
    if (els.deleteRoot) {
      els.deleteRoot.addEventListener("click", () => {
        if (!selectedRootId) return;
        if (sim.roots.length <= 1 && sim.branches.length === 0) {
          setStatus("Keep at least one root, or Reset Simulation first.", "error");
          return;
        }
        deleteRoot(sim, selectedRootId);
        selectedRootId = sim.roots[0] || null;
        paintRoots();
        syncViewer();
        paintStatus();
      });
    }
    if (els.start) els.start.addEventListener("click", startGrowth);
    if (els.pause) els.pause.addEventListener("click", pauseGrowth);
    if (els.reset) {
      els.reset.addEventListener("click", () => {
        pauseGrowth();
        resetGrowth(sim);
        selectedRootId = sim.roots[0] || null;
        paintRoots();
        syncViewer();
        paintStatus();
        setStatus("Network cleared. Attractors, roots, and SVG grid remain.", "active");
      });
    }
    if (els.variation) {
      els.variation.addEventListener("click", () => {
        if (!sim.grid) {
          setStatus(gridError || "SVG grid is not loaded.", "error");
          return;
        }
        pauseGrowth();
        sim.seed = hash32(sim.seed + 7919) || 1;
        readParamsIntoSim();
        resetGrowth(sim);
        generateAttractors(sim);
        selectedRootId = sim.roots[0] || null;
        paintRoots();
        syncViewer();
        paintStatus();
      });
    }
    if (els.influence) {
      els.influence.addEventListener("change", () => {
        sim.influence = Number(els.influence.value);
      });
    }
    if (els.kill) {
      els.kill.addEventListener("change", () => {
        sim.kill = Number(els.kill.value);
      });
    }
    if (els.attractorCount) {
      els.attractorCount.addEventListener("change", () => {
        sim.attractorTarget = Number(els.attractorCount.value);
      });
    }

    document.querySelectorAll("#grid3dViewBar .grid3d-view-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!viewer) return;
        viewer.setViewMode(btn.dataset.view);
        paintViewButtons();
      });
    });

    paintButtons();
    paintReadout();
    paintGridStats();
    loadDefaultGrid();

    return {
      show() {
        const v = ensureViewer();
        if (!v) return;
        v.start();
        v.resize();
        if (sim.grid) v.setGrid(sim.grid);
        if (els.showH) v.setShowHorizontal(els.showH.checked);
        if (els.showV) v.setShowVertical(els.showV.checked);
        if (els.showAttractors) v.setShowAttractors(els.showAttractors.checked);
        syncViewer();
        paintViewButtons();
      },
      hide() {
        pauseGrowth();
        if (viewer) viewer.stop();
      },
      resize() {
        if (viewer) viewer.resize();
      },
      getSnapshot() {
        return snapshot(sim);
      },
    };
  }

  global.D7GridGrowth = {
    CUBE,
    mount,
    snapshot,
    buildGridFromSvg,
  };
})(window);

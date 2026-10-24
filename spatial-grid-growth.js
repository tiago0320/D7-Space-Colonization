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
  const DEFAULT_CONNECT = false;
  const DEFAULT_CONNECT_DIST = 1;
  const DEFAULT_CONNECT_BIAS = 50;
  const DEFAULT_MIN_SEG = 6;
  const DEFAULT_MIN_BEND = 90;
  const CONNECT_HIGHLIGHT_MS = 1000;

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

  function resolveMinSegmentLength(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_MIN_SEG;
    return clamp(n, 1, 8);
  }

  function currentMinSegmentLength(sim) {
    return resolveMinSegmentLength(sim && sim.minSegmentLength);
  }

  function resolveMinBendAngle(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_MIN_BEND;
    return clamp(n, 60, 180);
  }

  function currentMinBendAngle(sim) {
    return resolveMinBendAngle(sim && sim.minBendAngle);
  }

  function internalBendDeg(fromPt, atPt, toPt) {
    if (!fromPt || !atPt || !toPt) return 0;
    const bax = fromPt.x - atPt.x;
    const bay = fromPt.y - atPt.y;
    const baz = fromPt.z - atPt.z;
    const bcx = toPt.x - atPt.x;
    const bcy = toPt.y - atPt.y;
    const bcz = toPt.z - atPt.z;
    const la = Math.hypot(bax, bay, baz);
    const lc = Math.hypot(bcx, bcy, bcz);
    if (la < 1e-9 || lc < 1e-9) return 0;
    const dot = (bax * bcx + bay * bcy + baz * bcz) / (la * lc);
    return Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
  }

  function bendOk(fromPt, atPt, toPt, minBend) {
    return internalBendDeg(fromPt, atPt, toPt) + 1e-6 >= minBend;
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

  function rayAabbInterval(ox, oy, oz, dx, dy, dz, min, max) {
    let t0 = 0;
    let t1 = 1e6;
    function slab(o, d, a, b) {
      if (Math.abs(d) < 1e-10) return o >= a && o <= b;
      let tA = (a - o) / d;
      let tB = (b - o) / d;
      if (tA > tB) {
        const t = tA;
        tA = tB;
        tB = t;
      }
      t0 = Math.max(t0, tA);
      t1 = Math.min(t1, tB);
      return t0 <= t1;
    }
    if (!slab(ox, dx, min, max) || !slab(oy, dy, min, max) || !slab(oz, dz, min, max)) return null;
    return { t0, t1 };
  }

  function pointToRaySq(px, py, pz, origin, dir) {
    const vx = px - origin.x;
    const vy = py - origin.y;
    const vz = pz - origin.z;
    const t = Math.max(0, vx * dir.x + vy * dir.y + vz * dir.z);
    const qx = origin.x + dir.x * t - px;
    const qy = origin.y + dir.y * t - py;
    const qz = origin.z + dir.z * t - pz;
    return qx * qx + qy * qy + qz * qz;
  }

  function nearestGridNodeToRay(grid, origin, dir, maxDist) {
    if (!grid || !grid.nodes.length || !origin || !dir) return -1;
    const hit = rayAabbInterval(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 0, CUBE);
    if (!hit) return -1;
    const limit = maxDist != null ? maxDist : 1.35;
    const maxSq = limit * limit;
    let best = -1;
    let bestSq = maxSq;
    const step = 0.4;
    const seen = new Set();
    for (let t = hit.t0; t <= hit.t1 + 1e-6; t += step) {
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      const gid = nearestGridNodeId(grid, x, y, z, true);
      if (gid < 0 || seen.has(gid)) continue;
      seen.add(gid);
      const n = grid.nodes[gid];
      const dSq = pointToRaySq(n.x, n.y, n.z, origin, dir);
      if (dSq < bestSq) {
        bestSq = dSq;
        best = gid;
      }
    }
    return best;
  }

  function nearbyGridNodes(grid, x, y, z, radius, limit) {
    if (!grid || !grid.nodes.length) return [];
    const index = grid.index || buildGridIndex(grid);
    const cell = index.cell;
    const r = radius != null ? radius : 2.2;
    const cap = limit != null ? limit : 48;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    const reach = Math.max(1, Math.ceil(r / cell));
    const rSq = r * r;
    const hits = [];
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const bucket = index.map.get(cx + dx + "," + (cy + dy) + "," + (cz + dz));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const id = bucket[i];
            if (!(grid.adj[id] && grid.adj[id].length)) continue;
            const n = grid.nodes[id];
            const dSq = (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y) + (n.z - z) * (n.z - z);
            if (dSq <= rSq) hits.push({ id, dSq, x: n.x, y: n.y, z: n.z });
          }
        }
      }
    }
    hits.sort((a, b) => a.dSq - b.dSq);
    const out = [];
    const seen = new Set();
    for (let i = 0; i < hits.length && out.length < cap; i++) {
      if (seen.has(hits[i].id)) continue;
      seen.add(hits[i].id);
      out.push(hits[i]);
    }
    return out;
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
      nextNetworkId: 1,
      netParent: new Map(),
      networkRoots: new Map(),
      connectNetworks: options.connectNetworks != null ? !!options.connectNetworks : DEFAULT_CONNECT,
      connectDistance: options.connectDistance != null ? options.connectDistance : DEFAULT_CONNECT_DIST,
      connectBias: options.connectBias != null ? options.connectBias : DEFAULT_CONNECT_BIAS,
      minSegmentLength: resolveMinSegmentLength(options.minSegmentLength),
      minBendAngle: resolveMinBendAngle(options.minBendAngle),
      reservedGrid: new Set(),
      legacyGraph: false,
      freshConnections: [],
      descriptorBias: options.descriptorBias || null,
    };
  }

  function findNetwork(sim, id) {
    if (id == null || !sim.netParent) return id;
    let cur = id;
    const seen = [];
    while (sim.netParent.has(cur) && sim.netParent.get(cur) !== cur) {
      seen.push(cur);
      cur = sim.netParent.get(cur);
      if (seen.length > 64) break;
    }
    if (!sim.netParent.has(cur)) sim.netParent.set(cur, cur);
    for (let i = 0; i < seen.length; i++) sim.netParent.set(seen[i], cur);
    return cur;
  }

  function allocNetwork(sim, rootIndex) {
    if (!sim.netParent) sim.netParent = new Map();
    if (!sim.networkRoots) sim.networkRoots = new Map();
    const id = sim.nextNetworkId != null ? sim.nextNetworkId++ : 1;
    if (sim.nextNetworkId == null) sim.nextNetworkId = id + 1;
    sim.netParent.set(id, id);
    sim.networkRoots.set(id, new Set(rootIndex ? [rootIndex] : []));
    return id;
  }

  function mergeNetworks(sim, a, b) {
    const pa = findNetwork(sim, a);
    const pb = findNetwork(sim, b);
    if (pa == null || pb == null || pa === pb) return pa != null ? pa : pb;
    const keep = pa < pb ? pa : pb;
    const drop = pa < pb ? pb : pa;
    sim.netParent.set(drop, keep);
    sim.netParent.set(keep, keep);
    if (!sim.networkRoots) sim.networkRoots = new Map();
    const rootsKeep = sim.networkRoots.get(keep) || new Set();
    const rootsDrop = sim.networkRoots.get(drop) || new Set();
    rootsDrop.forEach((r) => rootsKeep.add(r));
    sim.networkRoots.set(keep, rootsKeep);
    sim.networkRoots.delete(drop);
    for (let i = 0; i < sim.nodes.length; i++) {
      const n = sim.nodes[i];
      if (findNetwork(sim, n.networkId) === keep) n.networkId = keep;
    }
    return keep;
  }

  function connectedNetworkSummary(sim) {
    const groups = new Map();
    const roots = sim.roots || [];
    for (let i = 0; i < roots.length; i++) {
      const n = sim.nodeById.get(roots[i]);
      if (!n) continue;
      const nid = findNetwork(sim, n.networkId != null ? n.networkId : n.rootIndex);
      if (!groups.has(nid)) groups.set(nid, []);
      groups.get(nid).push(n.rootIndex);
    }
    const out = [];
    groups.forEach((list, id) => {
      list.sort((a, b) => a - b);
      out.push({ id, roots: list });
    });
    out.sort((a, b) => (a.roots[0] || 0) - (b.roots[0] || 0));
    for (let k = 0; k < out.length; k++) {
      out[k].name = "Connected Network " + String(k + 1).padStart(2, "0");
    }
    return out;
  }

  function pushFreshConnection(sim, fromNode, toNode) {
    if (!fromNode || !toNode) return;
    if (!sim.freshConnections) sim.freshConnections = [];
    sim.freshConnections.push({
      ax: fromNode.x,
      ay: fromNode.y,
      az: fromNode.z,
      bx: toNode.x,
      by: toNode.y,
      bz: toNode.z,
    });
  }

  function occupyGridNode(sim, gridId, parentSimId, asRoot) {
    if (gridId < 0 || !sim.grid) return null;
    if (sim.gridToSim.has(gridId)) return sim.nodeById.get(sim.gridToSim.get(gridId));
    const g = sim.grid.nodes[gridId];
    if (!g) return null;
    const parent = parentSimId != null ? sim.nodeById.get(parentSimId) : null;
    const node = {
      id: sim.nextNodeId++,
      x: g.x,
      y: g.y,
      z: g.z,
      gridId,
      parentId: parentSimId,
      order: 1,
      rootIndex: asRoot ? sim.nextRootIndex++ : 0,
      originRootIndex: 0,
      networkId: 0,
      isRoot: !!asRoot,
    };
    if (asRoot) {
      node.originRootIndex = node.rootIndex;
      node.networkId = allocNetwork(sim, node.rootIndex);
    } else if (parent) {
      node.order = parent.order ? parent.order + 1 : 1;
      node.originRootIndex = parent.originRootIndex || parent.rootIndex || 0;
      node.networkId = parent.networkId;
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

  function moveRootNode(sim, nodeId, gridId) {
    const root = sim.nodeById.get(nodeId);
    if (!root || !root.isRoot || !sim.grid) return null;
    if (gridId < 0 || !sim.grid.nodes[gridId]) return null;
    if (root.gridId === gridId) return root;
    const occ = sim.gridToSim.get(gridId);
    if (occ != null && occ !== root.id) return null;
    if (root.gridId != null) sim.gridToSim.delete(root.gridId);
    const g = sim.grid.nodes[gridId];
    root.gridId = gridId;
    root.x = g.x;
    root.y = g.y;
    root.z = g.z;
    sim.gridToSim.set(gridId, root.id);
    return root;
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
      const bias = sim.descriptorBias;
      const t = bias && bias.influence != null ? clamp(Number(bias.influence), 0, 1) : 0;
      if (t > 0 && global.D7DescriptorProfiles && typeof global.D7DescriptorProfiles.weightAt === "function") {
        const w = (1 - t) + t * global.D7DescriptorProfiles.weightAt(g.x, g.y, g.z, bias);
        if (rng() > clamp(w, 0.03, 1.2)) continue;
      }
      attractors.push({ x: g.x, y: g.y, z: g.z, gridId: gid });
    }
    for (let r = 0; r < sim.roots.length; r++) {
      const root = sim.nodeById.get(sim.roots[r]);
      if (!root) continue;
      const near = nearbyGridNodes(sim.grid, root.x, root.y, root.z, Math.max(2.5, sim.influence), 28);
      for (let i = 0; i < near.length && attractors.length < want; i++) {
        const hit = near[i];
        if (used.has(hit.id)) continue;
        used.add(hit.id);
        attractors.push({ x: hit.x, y: hit.y, z: hit.z, gridId: hit.id });
      }
    }
    if (attractors.length < want) {
      for (let gid = 0; gid < n && attractors.length < want; gid++) {
        if (used.has(gid)) continue;
        const g = sim.grid.nodes[gid];
        if (!g || !sim.grid.adj[gid] || !sim.grid.adj[gid].length) continue;
        attractors.push({ x: g.x, y: g.y, z: g.z, gridId: gid });
      }
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

  function nodesWithin(index, x, y, z, maxDist, cap) {
    const maxSq = maxDist * maxDist;
    const limit = cap != null ? cap : 24;
    const r = Math.max(1, Math.ceil(maxDist / index.cell));
    const cx = Math.floor(x / index.cell);
    const cy = Math.floor(y / index.cell);
    const cz = Math.floor(z / index.cell);
    const hits = [];
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
            if (dSq <= maxSq) hits.push(node);
          }
        }
      }
    }
    if (hits.length <= limit) return hits;
    hits.sort((a, b) => {
      const da = (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y) + (a.z - z) * (a.z - z);
      const db = (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) + (b.z - z) * (b.z - z);
      return da - db;
    });
    return hits.slice(0, limit);
  }

  function nearestForeignNode(sim, index, node, maxDist) {
    const hits = nodesWithin(index, node.x, node.y, node.z, maxDist, 16);
    const net = findNetwork(sim, node.networkId);
    let best = null;
    let bestSq = maxDist * maxDist;
    for (let i = 0; i < hits.length; i++) {
      const other = hits[i];
      if (other.id === node.id) continue;
      if (findNetwork(sim, other.networkId) === net) continue;
      const dSq =
        (other.x - node.x) * (other.x - node.x) +
        (other.y - node.y) * (other.y - node.y) +
        (other.z - node.z) * (other.z - node.z);
      if (dSq <= bestSq) {
        bestSq = dSq;
        best = other;
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

  function occupantAtGrid(sim, gridId) {
    if (!sim.gridToSim.has(gridId)) return null;
    return sim.nodeById.get(sim.gridToSim.get(gridId)) || null;
  }

  function rankGraphNeighbors(sim, node, pull, extraUsed, blockedNodes) {
    const gid = node.gridId;
    const neigh = sim.grid.adj[gid] || [];
    const plen = Math.hypot(pull.x, pull.y, pull.z);
    if (plen < 1e-8) return [];
    const px = pull.x / plen;
    const py = pull.y / plen;
    const pz = pull.z / plen;
    const fromNet = findNetwork(sim, node.networkId);
    const bias = sim.descriptorBias;
    const hb = bias ? Number(bias.horiz) || 0 : 0;
    const vb = bias ? Number(bias.vert) || 0 : 0;
    const ranked = [];
    for (let i = 0; i < neigh.length; i++) {
      const toId = neigh[i];
      const ek = edgeKey(gid, toId);
      if (sim.usedEdges.has(ek) || (extraUsed && extraUsed.has(ek))) continue;
      if (blockedNodes && blockedNodes.has(toId)) continue;
      if (sim.reservedGrid && sim.reservedGrid.has(toId) && !occupantAtGrid(sim, toId)) continue;
      const occ = occupantAtGrid(sim, toId);
      if (occ && findNetwork(sim, occ.networkId) !== fromNet && !sim.connectNetworks) continue;
      const to = sim.grid.nodes[toId];
      if (!to) continue;
      const dx = to.x - node.x;
      const dy = to.y - node.y;
      const dz = to.z - node.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-9) continue;
      let score = (dx / len) * px + (dy / len) * py + (dz / len) * pz;
      if (hb || vb) {
        const horiz = 1 - Math.abs(dy) / len;
        const vert = Math.abs(dy) / len;
        score += hb * horiz * 0.35 + vb * vert * 0.35;
      }
      if (score <= 0.04) continue;
      ranked.push({
        id: toId,
        score,
        x: to.x,
        y: to.y,
        z: to.z,
        len,
      });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  function pickGraphNeighbor(sim, node, pull, extraUsed, blockedNodes) {
    const ranked = rankGraphNeighbors(sim, node, pull, extraUsed, blockedNodes);
    return ranked.length ? ranked[0].id : -1;
  }

  function armPointForBranchAtNode(sim, branch, node) {
    if (!sim || !branch || !node) return null;
    const pts = branch.pathPts;
    if (branch.toId === node.id) {
      if (pts && pts.length >= 2) {
        const p = pts[pts.length - 2];
        return { x: p.x, y: p.y, z: p.z };
      }
      const from = sim.nodeById.get(branch.fromId);
      return from ? { x: from.x, y: from.y, z: from.z } : null;
    }
    if (branch.fromId === node.id) {
      if (pts && pts.length >= 2) {
        const p = pts[1];
        return { x: p.x, y: p.y, z: p.z };
      }
      const to = sim.nodeById.get(branch.toId);
      return to ? { x: to.x, y: to.y, z: to.z } : null;
    }
    return null;
  }

  function existingArmPoints(sim, node) {
    const arms = [];
    if (!sim || !node) return arms;
    for (let i = 0; i < sim.branches.length; i++) {
      const p = armPointForBranchAtNode(sim, sim.branches[i], node);
      if (p) arms.push(p);
    }
    return arms;
  }

  function junctionClearOfArms(atPt, proposedPts, arms, minBend) {
    if (!arms || !arms.length) return true;
    if (!proposedPts || !proposedPts.length) return false;
    for (let i = 0; i < arms.length; i++) {
      for (let j = 0; j < proposedPts.length; j++) {
        if (!bendOk(arms[i], atPt, proposedPts[j], minBend)) return false;
      }
    }
    return true;
  }

  function pathBendOk(sim, fromNode, gridPath, minBend) {
    if (!sim || !sim.grid || !fromNode || !gridPath || gridPath.length < 2) return false;
    const nodes = sim.grid.nodes;
    const startPt = { x: fromNode.x, y: fromNode.y, z: fromNode.z };
    const first = nodes[gridPath[1]];
    const end = nodes[gridPath[gridPath.length - 1]];
    if (!first || !end) return false;
    if (!junctionClearOfArms(startPt, [first, end], existingArmPoints(sim, fromNode), minBend)) return false;
    for (let i = 1; i < gridPath.length - 1; i++) {
      const a = nodes[gridPath[i - 1]];
      const b = nodes[gridPath[i]];
      const c = nodes[gridPath[i + 1]];
      if (!a || !b || !c) return false;
      if (!bendOk(a, b, c, minBend)) return false;
    }
    const occ = occupantAtGrid(sim, gridPath[gridPath.length - 1]);
    if (occ && occ.id !== fromNode.id) {
      const arrive = nodes[gridPath[gridPath.length - 2]];
      if (!arrive) return false;
      if (!junctionClearOfArms(occ, [arrive, startPt], existingArmPoints(sim, occ), minBend)) return false;
    }
    return true;
  }

  function growAlongEdge(sim, fromNode, toGridId, asConnection) {
    if (!fromNode || fromNode.gridId == null || toGridId == null || !sim.grid) return false;
    const a = sim.grid.nodes[fromNode.gridId];
    const b = sim.grid.nodes[toGridId];
    if (!a || !b) return false;
    const len = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    return commitVisibleSegment(sim, fromNode, toGridId, [fromNode.gridId, toGridId], len, asConnection);
  }

  function pathPointsFromGrid(sim, gridPath) {
    const pts = [];
    if (!sim.grid || !gridPath) return pts;
    for (let i = 0; i < gridPath.length; i++) {
      const g = sim.grid.nodes[gridPath[i]];
      if (g) pts.push({ x: g.x, y: g.y, z: g.z });
    }
    return pts;
  }

  function polylineLength(pts) {
    if (!pts || pts.length < 2) return 0;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const c = pts[i];
      acc += Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z);
    }
    return acc;
  }

  function gridPathLength(sim, path) {
    if (!sim.grid || !path || path.length < 2) return 0;
    let acc = 0;
    for (let i = 1; i < path.length; i++) {
      const a = sim.grid.nodes[path[i - 1]];
      const c = sim.grid.nodes[path[i]];
      if (!a || !c) return 0;
      acc += Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z);
    }
    return acc;
  }

  function commitGridWalk(sim, path) {
    if (!sim.reservedGrid) sim.reservedGrid = new Set();
    if (!path || path.length < 2) return;
    for (let i = 1; i < path.length; i++) {
      sim.usedEdges.add(edgeKey(path[i - 1], path[i]));
    }
    for (let i = 1; i < path.length - 1; i++) {
      const gid = path[i];
      if (!sim.gridToSim.has(gid)) sim.reservedGrid.add(gid);
    }
  }

  function rebuildWalkState(sim) {
    sim.usedEdges = new Set();
    sim.reservedGrid = new Set();
    for (let i = 0; i < sim.branches.length; i++) {
      const b = sim.branches[i];
      if (b.gridPath && b.gridPath.length >= 2) {
        commitGridWalk(sim, b.gridPath);
        continue;
      }
      const a = sim.nodeById.get(b.fromId);
      const c = sim.nodeById.get(b.toId);
      if (a && c && a.gridId != null && c.gridId != null) sim.usedEdges.add(edgeKey(a.gridId, c.gridId));
    }
  }

  function killNearPoints(sim, pts) {
    if (!pts || !pts.length || !sim.attractors.length) return;
    const kill = Math.max(1e-6, sim.kill);
    const killSq = kill * kill;
    for (let i = 0; i < sim.attractors.length; i++) {
      if (!sim.alive[i]) continue;
      const a = sim.attractors[i];
      for (let p = 0; p < pts.length; p++) {
        const dx = a.x - pts[p].x;
        const dy = a.y - pts[p].y;
        const dz = a.z - pts[p].z;
        if (dx * dx + dy * dy + dz * dz <= killSq) {
          sim.alive[i] = 0;
          break;
        }
      }
    }
  }

  function commitVisibleSegment(sim, fromNode, toGridId, gridPath, pathLen, asConnection) {
    const minLen = currentMinSegmentLength(sim);
    const minBend = currentMinBendAngle(sim);
    if (!fromNode || toGridId == null || !gridPath || gridPath.length < 2) return false;
    const pts = pathPointsFromGrid(sim, gridPath);
    let len = Number(pathLen);
    if (!Number.isFinite(len) || len <= 0) len = polylineLength(pts);
    if (!(len + 1e-6 >= minLen)) return false;
    if (!pathBendOk(sim, fromNode, gridPath, minBend)) return false;
    if (sim.reservedGrid) sim.reservedGrid.delete(toGridId);
    let child = occupantAtGrid(sim, toGridId);
    if (child && findNetwork(sim, child.networkId) !== findNetwork(sim, fromNode.networkId) && !sim.connectNetworks) {
      return false;
    }
    if (!child) child = occupyGridNode(sim, toGridId, fromNode.id, false);
    if (!child) return false;
    const joined = findNetwork(sim, child.networkId) !== findNetwork(sim, fromNode.networkId);
    if (joined) mergeNetworks(sim, fromNode.networkId, child.networkId);
    commitGridWalk(sim, gridPath);
    sim.branches.push({
      id: sim.nextBranchId++,
      fromId: fromNode.id,
      toId: child.id,
      order: child.order,
      connection: !!(asConnection || joined),
      gridPath: gridPath.slice(),
      pathPts: pts,
      pathLength: len,
    });
    if (asConnection || joined) pushFreshConnection(sim, fromNode, child);
    killNearPoints(sim, pts);
    return true;
  }

  function growMinSegment(sim, fromNode, pull) {
    if (!fromNode || fromNode.gridId == null || !sim.grid) return false;
    const minLen = currentMinSegmentLength(sim);
    const minBend = currentMinBendAngle(sim);
    const fromNet = findNetwork(sim, fromNode.networkId);
    const firsts = rankGraphNeighbors(sim, fromNode, pull, null, new Set([fromNode.gridId]));
    const maxHops = 96;

    function tryFirstHop(first) {
      const arms = existingArmPoints(sim, fromNode);
      if (arms.length && !junctionClearOfArms(fromNode, [first], arms, minBend)) return false;
      const extraUsed = new Set([edgeKey(fromNode.gridId, first.id)]);
      const walked = new Set([fromNode.gridId, first.id]);
      const path = [fromNode.gridId, first.id];
      let acc = first.len;
      const cursor = {
        gridId: first.id,
        x: first.x,
        y: first.y,
        z: first.z,
        networkId: fromNode.networkId,
      };
      let prevGrid = fromNode.gridId;
      const occ0 = occupantAtGrid(sim, first.id);
      if (occ0) {
        if (occ0.id === fromNode.id) return false;
        const sameNet = findNetwork(sim, occ0.networkId) === fromNet;
        if (!sameNet && !sim.connectNetworks) return false;
        if (acc + 1e-6 < minLen) return false;
        return commitVisibleSegment(sim, fromNode, first.id, path, acc, !sameNet);
      }
      for (let hop = 0; hop < maxHops; hop++) {
        if (acc + 1e-6 >= minLen) {
          return commitVisibleSegment(sim, fromNode, cursor.gridId, path, acc, false);
        }
        const ranked = rankGraphNeighbors(sim, cursor, pull, extraUsed, walked);
        let advanced = false;
        for (let i = 0; i < ranked.length; i++) {
          const cand = ranked[i];
          extraUsed.add(edgeKey(cursor.gridId, cand.id));
          const fromPt = sim.grid.nodes[prevGrid];
          const atPt = sim.grid.nodes[cursor.gridId];
          if (!fromPt || !atPt || !bendOk(fromPt, atPt, cand, minBend)) continue;
          const occ = occupantAtGrid(sim, cand.id);
          if (occ) {
            if (occ.id === fromNode.id) continue;
            const sameNet = findNetwork(sim, occ.networkId) === fromNet;
            if (!sameNet && !sim.connectNetworks) continue;
            if (acc + cand.len + 1e-6 < minLen) continue;
            const trial = path.concat(cand.id);
            if (commitVisibleSegment(sim, fromNode, cand.id, trial, acc + cand.len, !sameNet)) return true;
            continue;
          }
          path.push(cand.id);
          walked.add(cand.id);
          acc += cand.len;
          prevGrid = cursor.gridId;
          cursor.gridId = cand.id;
          cursor.x = cand.x;
          cursor.y = cand.y;
          cursor.z = cand.z;
          advanced = true;
          break;
        }
        if (!advanced) return false;
      }
      return false;
    }

    for (let f = 0; f < firsts.length; f++) {
      if (tryFirstHop(firsts[f])) return true;
    }
    return false;
  }

  function visibleSegmentLength(sim, b) {
    if (b.pathLength != null && Number.isFinite(Number(b.pathLength))) return Number(b.pathLength);
    if (b.pathPts && b.pathPts.length >= 2) return polylineLength(b.pathPts);
    if (b.gridPath && b.gridPath.length >= 2) return polylineLength(pathPointsFromGrid(sim, b.gridPath));
    const a = sim.nodeById.get(b.fromId);
    const c = sim.nodeById.get(b.toId);
    if (!a || !c) return 0;
    return Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z);
  }

  function logMinSegmentValidation(sim) {
    if (!sim || sim.legacyGraph || sim.quietValidation) return;
    const minLen = currentMinSegmentLength(sim);
    const minBend = currentMinBendAngle(sim);
    let short = 0;
    let acute = 0;
    let n = 0;
    let minSeen = Infinity;
    let minAngle = Infinity;
    for (let i = 0; i < sim.branches.length; i++) {
      const b = sim.branches[i];
      n += 1;
      const d = visibleSegmentLength(sim, b);
      if (d < minSeen) minSeen = d;
      if (d + 1e-6 < minLen) {
        short += 1;
        console.error("[3D Grid Growth] undersized branch", {
          branchId: b.id,
          parentNodeId: b.fromId,
          childNodeId: b.toId,
          actualPathLength: d,
          minimumSegmentLength: minLen,
          connection: !!b.connection,
        });
      }
      const from = sim.nodeById.get(b.fromId);
      const to = sim.nodeById.get(b.toId);
      if (from && to) {
        const arms = existingArmPoints(sim, from);
        for (let a = 0; a < arms.length; a++) {
          const other = armPointForBranchAtNode(sim, b, from);
          if (!other) continue;
          if (Math.hypot(arms[a].x - other.x, arms[a].y - other.y, arms[a].z - other.z) < 1e-6) continue;
          const ang = internalBendDeg(arms[a], from, other);
          if (ang < minAngle) minAngle = ang;
          if (ang + 1e-6 < minBend) {
            acute += 1;
            console.error("[3D Grid Growth] acute branch bend", {
              branchId: b.id,
              parentNodeId: b.fromId,
              childNodeId: b.toId,
              bendAngle: ang,
              minimumBendAngle: minBend,
              connection: !!b.connection,
            });
          }
        }
      }
      const pts = b.pathPts && b.pathPts.length >= 3 ? b.pathPts : null;
      if (pts) {
        for (let p = 1; p < pts.length - 1; p++) {
          const ang = internalBendDeg(pts[p - 1], pts[p], pts[p + 1]);
          if (ang < minAngle) minAngle = ang;
          if (ang + 1e-6 < minBend) {
            acute += 1;
            console.error("[3D Grid Growth] acute interior bend", {
              branchId: b.id,
              vertex: p,
              bendAngle: ang,
              minimumBendAngle: minBend,
            });
          }
        }
      }
    }
    if (!n) return;
    if (short) {
      console.error(
        "[3D Grid Growth] min segment " +
          minLen.toFixed(1) +
          " ft: " +
          short +
          "/" +
          n +
          " committed branches are shorter (shortest " +
          minSeen.toFixed(3) +
          " ft)."
      );
    } else {
      console.log(
        "[3D Grid Growth] min segment " +
          minLen.toFixed(1) +
          " ft: " +
          n +
          " committed branches, shortest " +
          minSeen.toFixed(3) +
          " ft."
      );
    }
    if (acute) {
      console.error(
        "[3D Grid Growth] min bend " +
          minBend.toFixed(0) +
          "°: " +
          acute +
          " acute turns (sharpest " +
          (Number.isFinite(minAngle) ? minAngle.toFixed(1) : "?") +
          "°)."
      );
    } else {
      console.log(
        "[3D Grid Growth] min bend " +
          minBend.toFixed(0) +
          "°: " +
          n +
          " committed branches" +
          (Number.isFinite(minAngle) ? ", sharpest " + minAngle.toFixed(1) + "°." : ", no continuation bends.")
      );
    }
  }

  function shortestGridPath(sim, start, goal, maxLen) {
    if (start === goal) return [start];
    if (!sim.grid || start < 0 || goal < 0) return null;
    const grid = sim.grid;
    const minBend = currentMinBendAngle(sim);
    const dist = new Map();
    const prev = new Map();
    const heap = [start];
    dist.set(start, 0);
    let visited = 0;
    while (heap.length && visited < 420) {
      let bestI = 0;
      let bestD = dist.get(heap[0]);
      for (let i = 1; i < heap.length; i++) {
        const d = dist.get(heap[i]);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      const cur = heap.splice(bestI, 1)[0];
      visited += 1;
      if (cur === goal) break;
      const d0 = dist.get(cur);
      if (d0 > maxLen) continue;
      const neigh = grid.adj[cur] || [];
      const back = prev.get(cur);
      const backPt = back != null ? grid.nodes[back] : null;
      const curPt = grid.nodes[cur];
      for (let i = 0; i < neigh.length; i++) {
        const nb = neigh[i];
        const ek = edgeKey(cur, nb);
        if (sim.usedEdges.has(ek)) continue;
        if (sim.reservedGrid && sim.reservedGrid.has(nb) && nb !== goal) continue;
        const a = grid.nodes[cur];
        const b = grid.nodes[nb];
        if (backPt && curPt && b && !bendOk(backPt, curPt, b, minBend)) continue;
        const step = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        const nd = d0 + step;
        if (nd > maxLen + 1e-6) continue;
        if (dist.has(nb) && dist.get(nb) <= nd + 1e-9) continue;
        dist.set(nb, nd);
        prev.set(nb, cur);
        heap.push(nb);
      }
    }
    if (!prev.has(goal) && start !== goal) return null;
    const path = [goal];
    let cur = goal;
    while (cur !== start) {
      cur = prev.get(cur);
      if (cur == null) return null;
      path.push(cur);
      if (path.length > 80) return null;
    }
    path.reverse();
    return path;
  }

  function materializeGridPath(sim, path, asConnection) {
    if (!path || path.length < 2) return 0;
    const minLen = currentMinSegmentLength(sim);
    const len = gridPathLength(sim, path);
    if (len + 1e-6 < minLen) return 0;
    const from = occupantAtGrid(sim, path[0]);
    if (!from) return 0;
    const toGridId = path[path.length - 1];
    return commitVisibleSegment(sim, from, toGridId, path, len, !!asConnection) ? 1 : 0;
  }

  function tryConnectNetworks(sim) {
    if (!sim.connectNetworks || !sim.grid || sim.nodes.length < 2) return 0;
    const minLen = currentMinSegmentLength(sim);
    const maxDist = Math.max(0.25, Math.min(4, Number(sim.connectDistance) || DEFAULT_CONNECT_DIST));
    const searchDist = Math.max(maxDist, minLen);
    const index = buildNodeIndex(sim);
    const nodes = sim.nodes.slice();
    const seen = new Set();
    let linked = 0;
    for (let i = 0; i < nodes.length && linked < 6; i++) {
      const node = nodes[i];
      if (node.gridId == null) continue;
      const net = findNetwork(sim, node.networkId);
      const near = nodesWithin(index, node.x, node.y, node.z, searchDist, 12);
      for (let j = 0; j < near.length && linked < 6; j++) {
        const other = near[j];
        if (other.id === node.id || other.gridId == null) continue;
        if (findNetwork(sim, other.networkId) === net) continue;
        const pair = node.id < other.id ? node.id + ":" + other.id : other.id + ":" + node.id;
        if (seen.has(pair)) continue;
        seen.add(pair);
        const path = shortestGridPath(sim, node.gridId, other.gridId, searchDist);
        if (!path || path.length < 2) continue;
        const len = gridPathLength(sim, path);
        if (len + 1e-6 < minLen) continue;
        const added = materializeGridPath(sim, path, true);
        if (added) linked += 1;
      }
    }
    return linked;
  }

  function mixConnectionBias(sim, index, node, pull) {
    const bias = clamp(Number(sim.connectBias) || 0, 0, 100) / 100;
    if (!sim.connectNetworks || bias <= 1e-6) return pull;
    const reach = Math.max(sim.connectDistance * 3, Math.min(Number(sim.influence) || DEFAULT_INFLUENCE, 8));
    const foreign = nearestForeignNode(sim, index, node, reach);
    if (!foreign) return pull;
    const al = Math.hypot(pull.x, pull.y, pull.z);
    const fx = foreign.x - node.x;
    const fy = foreign.y - node.y;
    const fz = foreign.z - node.z;
    const fl = Math.hypot(fx, fy, fz);
    if (fl < 1e-8) return pull;
    const ax = al > 1e-8 ? pull.x / al : 0;
    const ay = al > 1e-8 ? pull.y / al : 0;
    const az = al > 1e-8 ? pull.z / al : 0;
    return {
      x: ax * (1 - bias) + (fx / fl) * bias,
      y: ay * (1 - bias) + (fy / fl) * bias,
      z: az * (1 - bias) + (fz / fl) * bias,
    };
  }

  function growStep(sim) {
    if (sim.done) return false;
    if (!sim.grid) {
      sim.done = true;
      return false;
    }
    if (!sim.roots.length) ensureDefaultRoot(sim);
    if (!sim.attractors.length) generateAttractors(sim);
    if (!sim.freshConnections) sim.freshConnections = [];
    sim.freshConnections.length = 0;
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
    let grew = 0;
    if (pulls.size) {
      const ids = Array.from(pulls.keys()).sort((a, b) => a - b);
      for (let i = 0; i < ids.length; i++) {
        const node = sim.nodeById.get(ids[i]);
        if (!node) continue;
        const pull = mixConnectionBias(sim, index, node, pulls.get(ids[i]));
        if (growMinSegment(sim, node, pull)) grew += 1;
      }
    }
    grew += tryConnectNetworks(sim);
    sim.iteration += 1;
    killNearNetwork(sim);
    if (!grew || !aliveCount(sim)) {
      sim.done = true;
      logMinSegmentValidation(sim);
    }
    return grew > 0;
  }

  function resetGrowth(sim, specs) {
    const rootNodes = specs && specs.length
      ? specs
      : sim.roots.map((id) => sim.nodeById.get(id)).filter(Boolean);
    sim.nodes = [];
    sim.nodeById = new Map();
    sim.branches = [];
    sim.iteration = 0;
    sim.done = false;
    sim.nextNodeId = 1;
    sim.nextBranchId = 1;
    sim.gridToSim = new Map();
    sim.usedEdges = new Set();
    sim.reservedGrid = new Set();
    sim.legacyGraph = false;
    sim.roots = [];
    sim.nextNetworkId = 1;
    sim.netParent = new Map();
    sim.networkRoots = new Map();
    sim.freshConnections = [];
    sim.nextRootIndex = 1;
    const kept = [];
    let maxIndex = 0;
    for (let i = 0; i < rootNodes.length; i++) {
      const old = rootNodes[i];
      if (!old) continue;
      let gid = old.gridId != null ? old.gridId : -1;
      if (gid < 0 || !sim.grid || !sim.grid.nodes[gid]) {
        gid = nearestGridNodeId(sim.grid, old.x, old.y, old.z, true);
      }
      if (gid < 0 || sim.gridToSim.has(gid)) continue;
      const node = occupyGridNode(sim, gid, null, true);
      if (!node) continue;
      if (old.rootIndex) node.rootIndex = old.rootIndex;
      node.originRootIndex = old.originRootIndex || node.rootIndex;
      const nid = node.networkId;
      if (nid) sim.networkRoots.set(nid, new Set([node.rootIndex]));
      if (old.uid != null) node.uid = old.uid;
      maxIndex = Math.max(maxIndex, node.rootIndex || 0);
      kept.push(node.id);
    }
    sim.roots = kept;
    sim.nextRootIndex = maxIndex + 1;
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
    rebuildWalkState(sim);
    sim.networkRoots = new Map();
    for (let i = 0; i < sim.roots.length; i++) {
      const n = sim.nodeById.get(sim.roots[i]);
      if (!n) continue;
      const nid = findNetwork(sim, n.networkId != null ? n.networkId : n.rootIndex);
      n.networkId = nid;
      if (!sim.networkRoots.has(nid)) sim.networkRoots.set(nid, new Set());
      sim.networkRoots.get(nid).add(n.rootIndex);
    }
    return true;
  }

  function snapshot(sim) {
    return {
      version: 4,
      cube: CUBE,
      units: "feet",
      upAxis: "Y",
      grid: "default-3d-grid.svg",
      seed: sim.seed,
      attractorCount: sim.attractorTarget,
      influence: sim.influence,
      kill: sim.kill,
      iteration: sim.iteration,
      connectNetworks: !!sim.connectNetworks,
      connectDistance: sim.connectDistance != null ? sim.connectDistance : DEFAULT_CONNECT_DIST,
      connectBias: sim.connectBias != null ? sim.connectBias : DEFAULT_CONNECT_BIAS,
      minSegmentLength: resolveMinSegmentLength(sim.minSegmentLength),
      minimumSegmentLength: resolveMinSegmentLength(sim.minSegmentLength),
      minBendAngle: resolveMinBendAngle(sim.minBendAngle),
      minimumBendAngle: resolveMinBendAngle(sim.minBendAngle),
      connectedNetworks: connectedNetworkSummary(sim),
      roots: (sim.rootDrafts && sim.rootDrafts.length ? sim.rootDrafts : sim.roots.map((id) => sim.nodeById.get(id)).filter(Boolean)).map((n) => ({
        id: n.simId != null ? n.simId : n.id,
        uid: n.uid != null ? n.uid : n.id,
        x: n.x,
        y: n.y,
        z: n.z,
        rootIndex: n.rootIndex,
        originRootIndex: n.originRootIndex != null ? n.originRootIndex : n.rootIndex,
        networkId: n.networkId,
        gridId: n.gridId,
      })),
      nodes: sim.nodes.map((n) => ({
        id: n.id,
        x: n.x,
        y: n.y,
        z: n.z,
        parentId: n.parentId,
        order: n.order,
        isRoot: !!n.isRoot,
        gridId: n.gridId,
        rootIndex: n.rootIndex,
        originRootIndex: n.originRootIndex != null ? n.originRootIndex : n.rootIndex,
        networkId: n.networkId,
      })),
      branches: sim.branches.map((b) => ({
        id: b.id,
        fromId: b.fromId,
        toId: b.toId,
        order: b.order,
        connection: !!b.connection,
        gridPath: b.gridPath ? b.gridPath.slice() : null,
        pathPts: b.pathPts
          ? b.pathPts.map((p) => ({ x: p.x, y: p.y, z: p.z }))
          : null,
        pathLength: b.pathLength != null ? b.pathLength : null,
      })),
      attractors: sim.attractors.map((a, i) => ({
        x: a.x,
        y: a.y,
        z: a.z,
        alive: !!sim.alive[i],
      })),
    };
  }

  function runHeadless(grid, options) {
    const opts = options || {};
    const seed = (opts.seed >>> 0) || 1;
    const bias = opts.bias || null;
    const t = bias && bias.influence != null ? Number(bias.influence) : 0;
    const useBias = !!(bias && t > 0.001);
    const sim = createSim({
      seed,
      grid,
      influence: opts.influence != null ? opts.influence : DEFAULT_INFLUENCE,
      kill: opts.kill != null ? opts.kill : DEFAULT_KILL,
      attractorCount: opts.attractorCount != null ? opts.attractorCount : DEFAULT_ATTRACTORS,
      connectNetworks: useBias && bias.connectNetworks ? true : !!opts.connectNetworks,
      connectDistance: opts.connectDistance != null ? opts.connectDistance : DEFAULT_CONNECT_DIST,
      connectBias: opts.connectBias != null ? opts.connectBias : DEFAULT_CONNECT_BIAS,
      minSegmentLength: resolveMinSegmentLength(opts.minSegmentLength),
      minBendAngle: resolveMinBendAngle(opts.minBendAngle),
      descriptorBias: useBias ? bias : null,
    });
    sim.quietValidation = true;
    const roots = useBias && bias.roots ? bias.roots : [];
    for (let i = 0; i < roots.length; i++) addRootAt(sim, roots[i].x, roots[i].y, roots[i].z);
    if (!sim.roots.length) ensureDefaultRoot(sim);
    generateAttractors(sim);
    const cap = opts.maxSteps != null ? opts.maxSteps : 640;
    for (let i = 0; i < cap; i++) {
      if (!growStep(sim)) break;
    }
    return snapshot(sim);
  }

  function restoreGraph(sim, data) {
    sim.nodes = [];
    sim.nodeById = new Map();
    sim.gridToSim = new Map();
    sim.branches = [];
    sim.usedEdges = new Set();
    sim.reservedGrid = new Set();
    sim.legacyGraph = false;
    sim.roots = [];
    sim.netParent = new Map();
    sim.networkRoots = new Map();
    sim.freshConnections = [];
    let maxNode = 0;
    let maxBranch = 0;
    let maxRoot = 0;
    let maxNet = 0;
    const nodes = data.nodes || [];
    for (let i = 0; i < nodes.length; i++) {
      const src = nodes[i];
      const node = {
        id: src.id,
        x: src.x,
        y: src.y,
        z: src.z,
        parentId: src.parentId,
        order: src.order || 1,
        isRoot: !!src.isRoot,
        gridId: src.gridId,
        rootIndex: src.rootIndex || 0,
        originRootIndex: src.originRootIndex != null ? src.originRootIndex : src.rootIndex || 0,
        networkId: src.networkId != null ? src.networkId : src.originRootIndex || src.rootIndex || 0,
      };
      if (src.uid != null) node.uid = src.uid;
      sim.nodes.push(node);
      sim.nodeById.set(node.id, node);
      if (node.gridId != null) sim.gridToSim.set(node.gridId, node.id);
      if (node.isRoot) sim.roots.push(node.id);
      maxNode = Math.max(maxNode, node.id || 0);
      maxRoot = Math.max(maxRoot, node.rootIndex || 0);
      maxNet = Math.max(maxNet, node.networkId || 0);
      const nid = node.networkId;
      if (nid && !sim.netParent.has(nid)) sim.netParent.set(nid, nid);
      if (node.isRoot) {
        if (!sim.networkRoots.has(nid)) sim.networkRoots.set(nid, new Set());
        sim.networkRoots.get(nid).add(node.rootIndex);
      }
    }
    const branches = data.branches || [];
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      const gridPath = Array.isArray(b.gridPath) ? b.gridPath.slice() : null;
      const pathPts = Array.isArray(b.pathPts)
        ? b.pathPts.map((p) => ({ x: p.x, y: p.y, z: p.z }))
        : null;
      sim.branches.push({
        id: b.id,
        fromId: b.fromId,
        toId: b.toId,
        order: b.order,
        connection: !!b.connection,
        gridPath,
        pathPts,
        pathLength: b.pathLength != null ? Number(b.pathLength) : null,
      });
      maxBranch = Math.max(maxBranch, b.id || 0);
      if (!b.connection && !gridPath) sim.legacyGraph = true;
    }
    rebuildWalkState(sim);
    sim.nextNodeId = maxNode + 1;
    sim.nextBranchId = maxBranch + 1;
    sim.nextRootIndex = maxRoot + 1;
    sim.nextNetworkId = maxNet + 1;
    sim.iteration = data.iteration || 0;
    sim.done = !!data.done;
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

  const HUMAN_SCALE_H = 6;
  const HUMAN_SCALE_DEPTH = 0.08;
  const HUMAN_SCALE_INSET = 2;

  function makeHumanScaleMesh(THREE) {
    // Traced from a standing-person silhouette (hands in pockets). Units = feet.
    const outline = [
      [-0.609, 0], [-0.701, 0.023], [-0.678, 0.138], [-0.563, 0.276], [-0.621, 0.494],
      [-0.586, 1.31], [-0.609, 2.736], [-0.667, 2.885], [-0.747, 2.885], [-0.736, 2.943],
      [-0.77, 2.977], [-0.862, 3.31], [-0.931, 3.425], [-1, 3.701], [-0.92, 3.966],
      [-0.862, 4.46], [-0.782, 4.747], [-0.736, 4.828], [-0.31, 4.966], [-0.161, 5.103],
      [-0.138, 5.276], [-0.149, 5.345], [-0.241, 5.437], [-0.253, 5.517], [-0.218, 5.552],
      [-0.241, 5.759], [-0.161, 5.862], [-0.103, 5.931], [-0.08, 5.977], [-0.023, 5.966],
      [0.057, 6], [0.241, 5.943], [0.379, 5.782], [0.379, 5.437], [0.31, 5.356],
      [0.276, 5.253], [0.287, 5.069], [0.379, 4.977], [0.805, 4.828], [0.828, 4.793],
      [0.908, 4.402], [0.897, 4.333], [0.954, 4.08], [0.966, 3.862], [1, 3.782],
      [1, 3.667], [0.943, 3.494], [0.736, 3.034], [0.69, 2.851], [0.644, 2.839],
      [0.621, 2.782], [0.598, 2.414], [0.471, 1.839], [0.46, 1.517], [0.425, 1.425],
      [0.379, 0.989], [0.402, 0.667], [0.333, 0.483], [0.379, 0.402], [0.379, 0.31],
      [0.471, 0.207], [0.632, 0.149], [0.655, 0.057], [0.586, 0.011], [0.356, 0.011],
      [0.011, 0.092], [0.034, 0.471], [0.011, 1.115], [0.046, 1.632], [0.023, 1.69],
      [0.034, 2.046], [-0.023, 2.379], [-0.08, 2.207], [-0.115, 1.828], [-0.207, 1.391],
      [-0.241, 0.448], [-0.287, 0.31], [-0.276, 0.057], [-0.345, 0.057], [-0.414, 0],
      [-0.598, 0],
    ];
    let pts = outline.map((p) => [p[0], p[1]]);
    for (let pass = 0; pass < 2; pass++) {
      const n = pts.length;
      const next = [];
      for (let i = 0; i < n; i++) {
        const pr = pts[(i + n - 1) % n];
        const cu = pts[i];
        const nx = pts[(i + 1) % n];
        next.push([cu[0] * 0.5 + (pr[0] + nx[0]) * 0.25, cu[1] * 0.5 + (pr[1] + nx[1]) * 0.25]);
      }
      pts = next;
    }
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
    shape.closePath();
    const Extrude = THREE.ExtrudeBufferGeometry || THREE.ExtrudeGeometry;
    const geom = new Extrude(shape, {
      depth: HUMAN_SCALE_DEPTH,
      bevelEnabled: false,
      curveSegments: 20,
      steps: 1,
    });
    geom.computeBoundingBox();
    const box = geom.boundingBox;
    const h = box.max.y - box.min.y;
    geom.scale(1, HUMAN_SCALE_H / Math.max(1e-6, h), 1);
    geom.computeBoundingBox();
    const b2 = geom.boundingBox;
    geom.translate(-(b2.min.x + b2.max.x) * 0.5, -b2.min.y, -(b2.min.z + b2.max.z) * 0.5);
    geom.computeVertexNormals();
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({
      color: 0x9a9a9a,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = "humanScale";
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.matrixAutoUpdate = true;
    return mesh;
  }

  function createViewer(container) {
    const THREE = global.THREE;
    if (!THREE || !container) return null;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", "3D Grid Growth viewport");
    renderer.domElement.style.outline = "none";
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
      if (controls.enableKeys != null) controls.enableKeys = false;
      if (THREE.MOUSE) {
        controls.mouseButtons = {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        };
      }
    }

    let gizmo = null;
    let rootGizmo = null;
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
      if (gizmo) gizmo.camera = activeCamera;
      if (rootGizmo) rootGizmo.camera = activeCamera;
    }

    const cube = new THREE.LineSegments(
      cubeWire(THREE, CUBE),
      new THREE.LineBasicMaterial({ color: 0x8a8a8a, transparent: true, opacity: 0.45 })
    );
    scene.add(cube);

    scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6a6a6a, 0.38));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.82);
    keyLight.position.set(18, 28, 14);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.45);
    fillLight.position.set(-16, 10, -18);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.28);
    rimLight.position.set(0, -12, 8);
    scene.add(rimLight);

    renderer.localClippingEnabled = true;
    const selClipPlanes = [
      new THREE.Plane(),
      new THREE.Plane(),
      new THREE.Plane(),
      new THREE.Plane(),
      new THREE.Plane(),
      new THREE.Plane(),
    ];
    let hideOutside = false;

    const selGeom = new THREE.BoxGeometry(1, 1, 1);
    const selFill = new THREE.Mesh(
      selGeom,
      new THREE.MeshBasicMaterial({
        color: 0x7ec8e3,
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    const selWire = new THREE.LineSegments(
      new THREE.EdgesGeometry(selGeom),
      new THREE.LineBasicMaterial({ color: 0x7ec8e3, transparent: true, opacity: 0.9 })
    );
    const selBox = new THREE.Group();
    selBox.add(selFill);
    selBox.add(selWire);
    selBox.position.set(CUBE * 0.5, CUBE * 0.5, CUBE * 0.5);
    selBox.scale.set(CUBE, CUBE, CUBE);
    scene.add(selBox);

    const humanScaleMesh = makeHumanScaleMesh(THREE);
    selBox.add(humanScaleMesh);
    let showHumanScale = false;
    let humanInsetX = HUMAN_SCALE_INSET;
    let humanInsetZ = HUMAN_SCALE_INSET;

    let gizmoMode = "translate";
    if (THREE.TransformControls) {
      gizmo = new THREE.TransformControls(activeCamera, renderer.domElement);
      gizmo.setMode("translate");
      gizmo.setSize(0.55);
      gizmo.attach(selBox);
      gizmo.addEventListener("dragging-changed", (event) => {
        if (controls) controls.enabled = !event.value;
        if (!event.value && typeof onSelectionEnd === "function") onSelectionEnd();
      });
      gizmo.addEventListener("objectChange", () => {
        clampSelection();
        if (typeof onSelectionChange === "function") onSelectionChange();
      });
      scene.add(gizmo);
    }

    const rootHandle = new THREE.Object3D();
    scene.add(rootHandle);
    if (THREE.TransformControls) {
      rootGizmo = new THREE.TransformControls(activeCamera, renderer.domElement);
      rootGizmo.setMode("translate");
      rootGizmo.setSize(0.72);
      if (rootGizmo.setSpace) rootGizmo.setSpace("world");
      rootGizmo.enabled = false;
      rootGizmo.visible = false;
      rootGizmo.attach(rootHandle);
      rootGizmo.addEventListener("dragging-changed", (event) => {
        if (controls) {
          if (event.value) controls.enabled = false;
          else {
            applyOrbitPolicy(viewMode);
            controls.enabled = true;
          }
        }
        if (!event.value && typeof onRootGizmoEnd === "function") {
          onRootGizmoEnd({
            x: rootHandle.position.x,
            y: rootHandle.position.y,
            z: rootHandle.position.z,
          });
        }
      });
      rootGizmo.addEventListener("objectChange", () => {
        if (typeof onRootGizmoChange === "function") {
          onRootGizmoChange({
            x: rootHandle.position.x,
            y: rootHandle.position.y,
            z: rootHandle.position.z,
          });
        }
      });
      scene.add(rootGizmo);
    }

    let onSelectionChange = null;
    let onSelectionEnd = null;
    let onRootGizmoChange = null;
    let onRootGizmoEnd = null;
    let showSelBox = true;
    let boxGizmoLocked = false;
    let showRoots = true;
    function clampSelection() {
      const sx = clamp(Math.abs(selBox.scale.x), 3, CUBE);
      const sy = clamp(Math.abs(selBox.scale.y), 3, CUBE);
      const sz = clamp(Math.abs(selBox.scale.z), 3, CUBE);
      selBox.scale.set(sx, sy, sz);
      selBox.rotation.set(0, 0, 0);
      selBox.position.x = clamp(selBox.position.x, sx * 0.5, CUBE - sx * 0.5);
      selBox.position.y = clamp(selBox.position.y, sy * 0.5, CUBE - sy * 0.5);
      selBox.position.z = clamp(selBox.position.z, sz * 0.5, CUBE - sz * 0.5);
      if (hideOutside) applySceneClip();
      placeHumanScale();
    }
    clampSelection();

    function selectionBoxBounds() {
      const hx = Math.abs(selBox.scale.x) * 0.5;
      const hy = Math.abs(selBox.scale.y) * 0.5;
      const hz = Math.abs(selBox.scale.z) * 0.5;
      return {
        minx: selBox.position.x - hx,
        maxx: selBox.position.x + hx,
        miny: selBox.position.y - hy,
        maxy: selBox.position.y + hy,
        minz: selBox.position.z - hz,
        maxz: selBox.position.z + hz,
      };
    }

    function snapSelectionToModule() {
      selBox.rotation.set(0, 0, 0);
      selBox.scale.set(CUBE, CUBE, CUBE);
      selBox.position.set(CUBE * 0.5, CUBE * 0.5, CUBE * 0.5);
      placeHumanScale();
      if (hideOutside) applySceneClip();
      if (typeof onSelectionChange === "function") onSelectionChange(selectionBoxBounds());
      return selectionBoxBounds();
    }

    function placeHumanScale() {
      if (!humanScaleMesh) return;
      const inv = 1 / CUBE;
      humanScaleMesh.scale.set(inv, inv, inv);
      humanScaleMesh.rotation.set(0, 0, 0);
      const bb = humanScaleMesh.geometry && humanScaleMesh.geometry.boundingBox;
      const halfW = bb ? Math.max(0.08, (bb.max.x - bb.min.x) * 0.5) : 0.5;
      const halfD = bb ? Math.max(0.04, (bb.max.z - bb.min.z) * 0.5) : HUMAN_SCALE_DEPTH * 0.5;
      const minX = halfW + 0.06;
      const minZ = halfD + 0.06;
      const maxX = Math.max(minX, CUBE - minX);
      const maxZ = Math.max(minZ, CUBE - minZ);
      const xFt = clamp(humanInsetX, minX, maxX);
      const zFt = clamp(humanInsetZ, minZ, maxZ);
      humanScaleMesh.position.set(-0.5 + xFt * inv, -0.5, -0.5 + zFt * inv);
      humanScaleMesh.visible = !!showHumanScale;
    }

    function setShowHumanScale(on) {
      showHumanScale = !!on;
      placeHumanScale();
      return showHumanScale;
    }

    function getHumanScaleState() {
      if (humanScaleMesh) humanScaleMesh.updateMatrixWorld(true);
      const wp = humanScaleMesh ? humanScaleMesh.getWorldPosition(new THREE.Vector3()) : { x: 0, y: 0, z: 0 };
      const b = selectionBoxBounds();
      const boxH = Math.max(1e-9, b.maxy - b.miny);
      return {
        show: !!showHumanScale,
        insetX: humanInsetX,
        insetZ: humanInsetZ,
        x: wp.x,
        y: wp.y,
        z: wp.z,
        height: HUMAN_SCALE_H,
        boxHeight: CUBE,
        visualBoxHeight: boxH,
        visualHumanHeight: HUMAN_SCALE_H * (boxH / CUBE),
        ratio: HUMAN_SCALE_H / CUBE,
      };
    }

    function validateHumanScale() {
      const st = getHumanScaleState();
      const ratio = st.visualHumanHeight / st.visualBoxHeight;
      return {
        boxArchitectural: CUBE,
        humanArchitectural: HUMAN_SCALE_H,
        visualBoxHeight: st.visualBoxHeight,
        visualHumanHeight: st.visualHumanHeight,
        ratio,
        ok: Math.abs(ratio - HUMAN_SCALE_H / CUBE) < 0.01 && Math.abs(st.height - HUMAN_SCALE_H) < 1e-6,
      };
    }

    function setHumanScaleState(state) {
      if (!state) return getHumanScaleState();
      if (state.insetX != null) humanInsetX = Number(state.insetX);
      if (state.insetZ != null) humanInsetZ = Number(state.insetZ);
      if (state.show != null) showHumanScale = !!state.show;
      else if (state.visible != null) showHumanScale = !!state.visible;
      if (!Number.isFinite(humanInsetX)) humanInsetX = HUMAN_SCALE_INSET;
      if (!Number.isFinite(humanInsetZ)) humanInsetZ = HUMAN_SCALE_INSET;
      placeHumanScale();
      return getHumanScaleState();
    }

    let lastLiveBranchSegs = [];
    let showBranches = true;

    const pickGeom = new THREE.BufferGeometry();
    pickGeom.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    const pickLines = new THREE.LineSegments(
      pickGeom,
      new THREE.LineBasicMaterial({ color: 0x9ad8ee, transparent: true, opacity: 0.95 })
    );
    pickLines.visible = false;
    scene.add(pickLines);

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

    const connectHighlightPos = new Float32Array(256 * 6);
    const connectHighlightGeom = new THREE.BufferGeometry();
    connectHighlightGeom.setAttribute("position", new THREE.BufferAttribute(connectHighlightPos, 3));
    connectHighlightGeom.setDrawRange(0, 0);
    const connectHighlightMat = new THREE.LineBasicMaterial({
      color: 0xffe14a,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const connectHighlight = new THREE.LineSegments(connectHighlightGeom, connectHighlightMat);
    connectHighlight.visible = false;
    scene.add(connectHighlight);
    let highlightUntil = 0;

    const analysisGroup = new THREE.Group();
    analysisGroup.visible = false;
    scene.add(analysisGroup);

    function disposeAnalysis() {
      while (analysisGroup.children.length) {
        const ch = analysisGroup.children[0];
        analysisGroup.remove(ch);
        if (ch.geometry) ch.geometry.dispose();
        if (ch.material) {
          if (Array.isArray(ch.material)) ch.material.forEach((m) => m.dispose && m.dispose());
          else if (ch.material.dispose) ch.material.dispose();
        }
      }
    }

    function setDescriptorOverlay(viz, on) {
      disposeAnalysis();
      analysisGroup.visible = !!(on && viz);
      if (!viz || !on) return;
      const sphereSrc = THREE.SphereBufferGeometry || THREE.SphereGeometry;
      const spheres = viz.spheres || [];
      for (let i = 0; i < spheres.length; i++) {
        const s = spheres[i];
        const mesh = new THREE.Mesh(
          new sphereSrc(Math.max(0.4, Number(s.r) || 1), 14, 10),
          new THREE.MeshBasicMaterial({
            color: s.color != null ? s.color : 0x888888,
            transparent: true,
            opacity: s.opacity != null ? s.opacity : 0.22,
            depthWrite: false,
          })
        );
        mesh.position.set(s.x, s.y, s.z);
        analysisGroup.add(mesh);
      }
      const boxes = viz.boxes || [];
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        const sx = Math.max(0.4, b.maxx - b.minx);
        const sy = Math.max(0.4, b.maxy - b.miny);
        const sz = Math.max(0.4, b.maxz - b.minz);
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(sx, sy, sz),
          new THREE.MeshBasicMaterial({
            color: b.color != null ? b.color : 0x999999,
            transparent: true,
            opacity: b.opacity != null ? b.opacity : 0.14,
            depthWrite: false,
            side: THREE.DoubleSide,
          })
        );
        mesh.position.set((b.minx + b.maxx) * 0.5, (b.miny + b.maxy) * 0.5, (b.minz + b.maxz) * 0.5);
        analysisGroup.add(mesh);
      }
      const planes = viz.planes || [];
      for (let i = 0; i < planes.length; i++) {
        const p = planes[i];
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(CUBE, CUBE),
          new THREE.MeshBasicMaterial({
            color: p.color != null ? p.color : 0xc8c2ae,
            transparent: true,
            opacity: p.opacity != null ? p.opacity : 0.12,
            depthWrite: false,
            side: THREE.DoubleSide,
          })
        );
        mesh.rotation.x = -Math.PI * 0.5;
        mesh.position.set(CUBE * 0.5, p.y, CUBE * 0.5);
        analysisGroup.add(mesh);
      }
      const segs = viz.lines || [];
      if (segs.length) {
        const pos = new Float32Array(segs.length * 6);
        for (let i = 0; i < segs.length; i++) {
          const ln = segs[i];
          const o = i * 6;
          pos[o] = ln.ax;
          pos[o + 1] = ln.ay;
          pos[o + 2] = ln.az;
          pos[o + 3] = ln.bx;
          pos[o + 4] = ln.by;
          pos[o + 5] = ln.bz;
        }
        const lg = new THREE.BufferGeometry();
        lg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        analysisGroup.add(
          new THREE.LineSegments(
            lg,
            new THREE.LineBasicMaterial({
              color: segs[0].color != null ? segs[0].color : 0xffffff,
              transparent: true,
              opacity: 0.95,
              depthWrite: false,
            })
          )
        );
      }
    }

    const rootsGroup = new THREE.Group();
    scene.add(rootsGroup);
    const SphereGeom = THREE.SphereBufferGeometry || THREE.SphereGeometry;
    const rootGeom = new SphereGeom(0.22, 12, 10);
    const rootMat = new THREE.MeshBasicMaterial({ color: 0xe8c200 });
    const rootSelMat = new THREE.MeshBasicMaterial({ color: 0xfff4a8 });
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0xf0c400,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const snapGhost = new THREE.Mesh(rootGeom, ghostMat);
    snapGhost.visible = false;
    snapGhost.scale.setScalar(1.25);
    scene.add(snapGhost);
    const snapPtsGeom = new THREE.BufferGeometry();
    snapPtsGeom.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    const snapPts = new THREE.Points(
      snapPtsGeom,
      new THREE.PointsMaterial({
        color: 0xf0c400,
        size: 0.11,
        sizeAttenuation: true,
        depthWrite: false,
        transparent: true,
        opacity: 0.9,
      })
    );
    snapPts.visible = false;
    scene.add(snapPts);

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
      applySceneClip();
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
      lastLiveBranchSegs = [];
      let seg = 0;
      for (let i = 0; i < list.length && seg < MAX_SEGS; i++) {
        const b = list[i];
        const a = nodesById.get(b.fromId);
        const c = nodesById.get(b.toId);
        const pts = b.pathPts && b.pathPts.length >= 2 ? b.pathPts : null;
        if (pts) {
          for (let p = 1; p < pts.length && seg < MAX_SEGS; p++) {
            const p0 = pts[p - 1];
            const p1 = pts[p];
            const o = seg * 6;
            branchPos[o] = p0.x;
            branchPos[o + 1] = p0.y;
            branchPos[o + 2] = p0.z;
            branchPos[o + 3] = p1.x;
            branchPos[o + 4] = p1.y;
            branchPos[o + 5] = p1.z;
            seg += 1;
          }
        } else if (a && c) {
          const o = seg * 6;
          branchPos[o] = a.x;
          branchPos[o + 1] = a.y;
          branchPos[o + 2] = a.z;
          branchPos[o + 3] = c.x;
          branchPos[o + 4] = c.y;
          branchPos[o + 5] = c.z;
          seg += 1;
        } else {
          continue;
        }
        lastLiveBranchSegs.push({
          id: b.id != null ? "branch_" + padStable(b.id) : "branch_" + padStable(i + 1),
          originalId: b.id,
          startNodeId: b.fromId,
          endNodeId: b.toId,
          ax: a ? a.x : pts[0].x,
          ay: a ? a.y : pts[0].y,
          az: a ? a.z : pts[0].z,
          bx: c ? c.x : pts[pts.length - 1].x,
          by: c ? c.y : pts[pts.length - 1].y,
          bz: c ? c.z : pts[pts.length - 1].z,
          networkId: a && a.networkId != null ? a.networkId : c && c.networkId,
          connection: !!b.connection,
        });
      }
      branchGeom.attributes.position.needsUpdate = true;
      branchGeom.setDrawRange(0, seg * 2);
      branchGeom.computeBoundingSphere();
      applySpatialVis();
    }

    function highlightConnections(list) {
      const segs = list || [];
      const count = Math.min(segs.length, 256);
      for (let i = 0; i < count; i++) {
        const s = segs[i];
        const o = i * 6;
        connectHighlightPos[o] = s.ax;
        connectHighlightPos[o + 1] = s.ay;
        connectHighlightPos[o + 2] = s.az;
        connectHighlightPos[o + 3] = s.bx;
        connectHighlightPos[o + 4] = s.by;
        connectHighlightPos[o + 5] = s.bz;
      }
      connectHighlightGeom.attributes.position.needsUpdate = true;
      connectHighlightGeom.setDrawRange(0, count * 2);
      if (count) connectHighlightGeom.computeBoundingSphere();
      if (count) {
        highlightUntil = (typeof performance !== "undefined" ? performance.now() : Date.now()) + CONNECT_HIGHLIGHT_MS;
        connectHighlightMat.opacity = 1;
        connectHighlight.visible = showBranches;
      }
    }

    function fadeConnectionHighlight(now) {
      if (!highlightUntil) {
        if (connectHighlight.visible) connectHighlight.visible = false;
        return;
      }
      const t = (highlightUntil - now) / CONNECT_HIGHLIGHT_MS;
      if (t <= 0) {
        highlightUntil = 0;
        connectHighlight.visible = false;
        connectHighlightMat.opacity = 1;
        return;
      }
      connectHighlightMat.opacity = Math.max(0, Math.min(1, t));
      connectHighlight.visible = showBranches;
    }

    function setShowBranches(on) {
      showBranches = !!on;
      applySpatialVis();
    }

    function setSelectionPreview() {
      pickGeom.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
      pickLines.visible = false;
    }

    function applySelBoxVisible() {
      selFill.visible = showSelBox;
      selWire.visible = showSelBox;
      if (gizmo) {
        gizmo.visible = showSelBox && !boxGizmoLocked;
        gizmo.enabled = showSelBox && !boxGizmoLocked;
      }
    }

    function setShowSelectionBox(on) {
      showSelBox = !!on;
      applySelBoxVisible();
    }
    applySelBoxVisible();

    function applySpatialVis() {
      branches.visible = showBranches;
      pickLines.visible = false;
    }

    function syncSelClipPlanes() {
      const b = selectionBoxBounds();
      // r128 clips the negative half-space (vClipPosition = -mvPosition), so
      // normals must point inward: keep n·x + c >= 0 inside the AABB.
      selClipPlanes[0].setFromNormalAndCoplanarPoint(new THREE.Vector3(1, 0, 0), new THREE.Vector3(b.minx, 0, 0));
      selClipPlanes[1].setFromNormalAndCoplanarPoint(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(b.maxx, 0, 0));
      selClipPlanes[2].setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, b.miny, 0));
      selClipPlanes[3].setFromNormalAndCoplanarPoint(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, b.maxy, 0));
      selClipPlanes[4].setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, b.minz));
      selClipPlanes[5].setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, b.maxz));
    }

    function applySceneClip() {
      syncSelClipPlanes();
      const planes = hideOutside ? selClipPlanes : [];
      const mats = [
        cube.material,
        branches.material,
        connectHighlightMat,
        attractors.material,
        pickLines.material,
        rootMat,
        rootSelMat,
        ghostMat,
        snapPts.material,
      ];
      if (hLines) mats.push(hLines.material);
      if (vLines) mats.push(vLines.material);
      const solidMats = [humanScaleMesh.material];
      for (let i = 0; i < solidMats.length; i++) {
        if (!solidMats[i]) continue;
        solidMats[i].clippingPlanes = [];
        solidMats[i].needsUpdate = true;
      }
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (!m) continue;
        m.clippingPlanes = planes;
        m.needsUpdate = true;
      }
    }

    function setHideOutsideSelection(on) {
      hideOutside = !!on;
      applySceneClip();
    }

    function padStable(n) {
      return String(n).padStart(3, "0");
    }

    function captureDisplayedBranches() {
      return lastLiveBranchSegs.slice();
    }

    function captureDisplayedRoots() {
      const out = [];
      for (let i = 0; i < rootsGroup.children.length; i++) {
        const mesh = rootsGroup.children[i];
        mesh.updateMatrixWorld(true);
        const p = mesh.getWorldPosition(new THREE.Vector3());
        out.push({
          id: mesh.userData.rootId,
          stableId: "root_" + padStable(i + 1),
          x: p.x,
          y: p.y,
          z: p.z,
        });
      }
      return out;
    }

    function captureDisplayGeometry() {
      scene.updateMatrixWorld(true);
      const branches = captureDisplayedBranches();
      const roots = captureDisplayedRoots();
      const payload = {
        branches,
        roots,
        sourceBranches: branches,
        guides: branches,
      };
      const lib = global.D7SpatialExport;
      payload.hash = lib && lib.hashGeometryState ? lib.hashGeometryState(payload) : "";
      return payload;
    }

    function setGizmoMode(mode) {
      gizmoMode = mode === "scale" ? "scale" : "translate";
      if (gizmo) gizmo.setMode(gizmoMode);
      return gizmoMode;
    }

    function toggleGizmoMode() {
      return setGizmoMode(gizmoMode === "translate" ? "scale" : "translate");
    }

    function gizmoBusy() {
      return (
        !!(gizmo && (gizmo.dragging || gizmo.axis)) ||
        !!(rootGizmo && (rootGizmo.dragging || rootGizmo.axis))
      );
    }

    function rootGizmoBusy() {
      return !!(rootGizmo && (rootGizmo.dragging || rootGizmo.axis));
    }

    function setBoxGizmoLocked(on) {
      boxGizmoLocked = !!on;
      applySelBoxVisible();
    }

    function setShowRoots(on) {
      showRoots = !!on;
      rootsGroup.visible = showRoots;
      if (!showRoots) {
        snapGhost.visible = false;
        snapPts.visible = false;
        if (rootGizmo) {
          rootGizmo.visible = false;
          rootGizmo.enabled = false;
        }
      }
    }

    function setPlacePreview(ghost, nearby) {
      if (ghost) {
        snapGhost.position.set(ghost.x, ghost.y, ghost.z);
        ghostMat.color.set(ghost.occupied ? 0xff5555 : 0xf0c400);
        snapGhost.visible = showRoots;
      } else {
        snapGhost.visible = false;
      }
      const list = nearby || [];
      const pos = new Float32Array(list.length * 3);
      for (let i = 0; i < list.length; i++) {
        pos[i * 3] = list[i].x;
        pos[i * 3 + 1] = list[i].y;
        pos[i * 3 + 2] = list[i].z;
      }
      snapPtsGeom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      snapPtsGeom.computeBoundingSphere();
      snapPts.visible = showRoots && list.length > 0;
    }

    function setRootGizmo(pos) {
      if (!rootGizmo) return;
      if (!pos || !showRoots) {
        rootGizmo.enabled = false;
        rootGizmo.visible = false;
        return;
      }
      rootHandle.position.set(pos.x, pos.y, pos.z);
      rootGizmo.enabled = true;
      rootGizmo.visible = true;
    }

    function getPointerRay(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, activeCamera);
      return {
        origin: raycaster.ray.origin.clone(),
        dir: raycaster.ray.direction.clone(),
      };
    }

    function setRoots(list, selectedId) {
      while (rootsGroup.children.length) {
        const child = rootsGroup.children[0];
        rootsGroup.remove(child);
      }
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        const id = n.uid != null ? n.uid : n.id;
        const selected = id === selectedId;
        const mesh = new THREE.Mesh(rootGeom, selected ? rootSelMat : rootMat);
        mesh.position.set(n.x, n.y, n.z);
        mesh.scale.setScalar(selected ? 1.18 : 1);
        mesh.userData.rootId = id;
        rootsGroup.add(mesh);
      }
      rootsGroup.visible = showRoots;
    }

    function pickRoot(clientX, clientY) {
      if (!showRoots || !rootsGroup.children.length) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.params.Points = raycaster.params.Points || {};
      raycaster.params.Line = raycaster.params.Line || {};
      raycaster.setFromCamera(pointer, activeCamera);
      const hits = raycaster.intersectObjects(rootsGroup.children, false);
      if (hits.length) return hits[0].object.userData.rootId || null;
      const ray = raycaster.ray;
      let best = null;
      let bestSq = 0.42 * 0.42;
      for (let i = 0; i < rootsGroup.children.length; i++) {
        const mesh = rootsGroup.children[i];
        const dSq = pointToRaySq(mesh.position.x, mesh.position.y, mesh.position.z, ray.origin, ray.direction);
        if (dSq < bestSq) {
          bestSq = dSq;
          best = mesh.userData.rootId;
        }
      }
      return best;
    }

    function tick() {
      if (controls && viewMode === "perspective") controls.update();
      fadeConnectionHighlight(typeof performance !== "undefined" ? performance.now() : Date.now());
      renderer.render(scene, activeCamera);
      raf = requestAnimationFrame(tick);
    }

    function getSelectionState() {
      selBox.updateMatrixWorld(true);
      const b = selectionBoxBounds();
      return {
        cx: selBox.position.x,
        cy: selBox.position.y,
        cz: selBox.position.z,
        sx: selBox.scale.x,
        sy: selBox.scale.y,
        sz: selBox.scale.z,
        rx: selBox.rotation.x,
        ry: selBox.rotation.y,
        rz: selBox.rotation.z,
        bounds: b,
        width: CUBE,
        height: CUBE,
        depth: CUBE,
        units: "feet",
        worldUnit: 1,
        matrixWorld: selBox.matrixWorld.toArray(),
        localX: { x: 1, y: 0, z: 0 },
        localY: { x: 0, y: 1, z: 0 },
        localZ: { x: 0, y: 0, z: 1 },
      };
    }

    function setSelectionBox(state) {
      if (!state) return selectionBoxBounds();
      if (state.cx != null && state.cy != null && state.cz != null) {
        selBox.position.set(Number(state.cx), Number(state.cy), Number(state.cz));
      } else if (state.minx != null) {
        selBox.position.set(
          (Number(state.minx) + Number(state.maxx)) * 0.5,
          (Number(state.miny) + Number(state.maxy)) * 0.5,
          (Number(state.minz) + Number(state.maxz)) * 0.5
        );
        selBox.scale.set(
          Math.max(0.25, Number(state.maxx) - Number(state.minx)),
          Math.max(0.25, Number(state.maxy) - Number(state.miny)),
          Math.max(0.25, Number(state.maxz) - Number(state.minz))
        );
      }
      if (state.sx != null && state.sy != null && state.sz != null) {
        selBox.scale.set(Number(state.sx), Number(state.sy), Number(state.sz));
      }
      if (state.rx != null || state.ry != null || state.rz != null) {
        selBox.rotation.set(Number(state.rx) || 0, Number(state.ry) || 0, Number(state.rz) || 0);
      }
      clampSelection();
      applySelBoxVisible();
      if (hideOutside) applySceneClip();
      if (typeof onSelectionChange === "function") onSelectionChange(selectionBoxBounds());
      return selectionBoxBounds();
    }

    function getCameraState() {
      const cam = activeCamera;
      const target = controls ? controls.target : workspaceCenter;
      return {
        viewMode,
        position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
        target: { x: target.x, y: target.y, z: target.z },
        up: { x: cam.up.x, y: cam.up.y, z: cam.up.z },
      };
    }

    function setCameraState(state) {
      if (!state) return;
      const mode = state.viewMode || "perspective";
      applyViewMode(mode, { reset: false });
      const cam = activeCamera;
      if (state.up) cam.up.set(Number(state.up.x), Number(state.up.y), Number(state.up.z));
      if (state.position) cam.position.set(Number(state.position.x), Number(state.position.y), Number(state.position.z));
      if (state.target && controls) {
        controls.target.set(Number(state.target.x), Number(state.target.y), Number(state.target.z));
        cam.lookAt(controls.target);
        controls.update();
      }
      syncControlsCamera();
      if (gizmo) gizmo.camera = activeCamera;
      if (rootGizmo) rootGizmo.camera = activeCamera;
    }

    function captureThumbnail() {
      const savedCam = getCameraState();
      const hide = [cube, attractors, rootsGroup, hLines, vLines, snapPts, snapGhost, pickLines, branches, connectHighlight, analysisGroup];
      const prevVis = hide.map((obj) => (obj ? obj.visible : false));
      const gizmoPrev = gizmo ? { vis: gizmo.visible, en: gizmo.enabled } : null;
      const rootPrev = rootGizmo ? { vis: rootGizmo.visible, en: rootGizmo.enabled } : null;
      try {
        applyViewMode("isometric", { reset: true });
        resize();
        for (let i = 0; i < hide.length; i++) if (hide[i]) hide[i].visible = false;
        if (gizmo) {
          gizmo.visible = false;
          gizmo.enabled = false;
        }
        if (rootGizmo) {
          rootGizmo.visible = false;
          rootGizmo.enabled = false;
        }
        renderer.setClearColor(0x000000, 1);
        renderer.render(scene, activeCamera);
        const src = renderer.domElement;
        const canvas = document.createElement("canvas");
        canvas.width = 240;
        canvas.height = 160;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, 240, 160);
        const sw = src.width;
        const sh = src.height;
        if (sw && sh) {
          const tr = 240 / 160;
          const sr = sw / sh;
          let sx = 0;
          let sy = 0;
          let cw = sw;
          let ch = sh;
          if (sr > tr) {
            cw = sh * tr;
            sx = (sw - cw) * 0.5;
          } else {
            ch = sw / tr;
            sy = (sh - ch) * 0.5;
          }
          ctx.drawImage(src, sx, sy, cw, ch, 0, 0, 240, 160);
        }
        return canvas.toDataURL("image/png");
      } catch (err) {
        return "";
      } finally {
        for (let i = 0; i < hide.length; i++) if (hide[i]) hide[i].visible = prevVis[i];
        if (gizmo && gizmoPrev) {
          gizmo.visible = gizmoPrev.vis;
          gizmo.enabled = gizmoPrev.en;
        }
        if (rootGizmo && rootPrev) {
          rootGizmo.visible = rootPrev.vis;
          rootGizmo.enabled = rootPrev.en;
        }
        setCameraState(savedCam);
        applySelBoxVisible();
        applySpatialVis();
        renderer.setClearColor(0x000000, 1);
      }
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
      highlightConnections,
      setShowBranches,
      setSelectionPreview,
      setShowSelectionBox,
      setHideOutsideSelection,
      captureDisplayGeometry,
      captureDisplayedBranches,
      captureDisplayedRoots,
      getSelectionBox: selectionBoxBounds,
      getSelectionState,
      setSelectionBox,
      getCameraState,
      setCameraState,
      captureThumbnail,
      setShowHumanScale,
      getHumanScaleState,
      setHumanScaleState,
      validateHumanScale,
      snapSelectionToModule,
      setOnSelectionChange(fn) {
        onSelectionChange = fn;
      },
      setOnSelectionEnd(fn) {
        onSelectionEnd = fn;
      },
      toggleGizmoMode,
      setGizmoMode,
      gizmoBusy,
      rootGizmoBusy,
      getGizmoMode() {
        return gizmoMode;
      },
      setRoots,
      pickRoot,
      setShowRoots,
      setPlacePreview,
      setRootGizmo,
      setBoxGizmoLocked,
      getPointerRay,
      setOnRootGizmoChange(fn) {
        onRootGizmoChange = fn;
      },
      setOnRootGizmoEnd(fn) {
        onRootGizmoEnd = fn;
      },
      setDescriptorOverlay,
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
      minSeg: document.getElementById("grid3dMinSeg"),
      minSegVal: document.getElementById("grid3dMinSegVal"),
      minBend: document.getElementById("grid3dMinBend"),
      minBendVal: document.getElementById("grid3dMinBendVal"),
      generate: document.getElementById("grid3dGenerate"),
      addRoot: document.getElementById("grid3dAddRoot"),
      moveRoot: document.getElementById("grid3dMoveRoot"),
      showRoots: document.getElementById("grid3dShowRoots"),
      start: document.getElementById("grid3dStart"),
      pause: document.getElementById("grid3dPause"),
      reset: document.getElementById("grid3dReset"),
      variation: document.getElementById("grid3dVariation"),
      rootX: document.getElementById("grid3dRootX"),
      rootY: document.getElementById("grid3dRootY"),
      rootZ: document.getElementById("grid3dRootZ"),
      deleteRoot: document.getElementById("grid3dDeleteRoot"),
      rootList: document.getElementById("grid3dRootList"),
      connectNetworks: document.getElementById("grid3dConnectNetworks"),
      connectDist: document.getElementById("grid3dConnectDist"),
      connectDistVal: document.getElementById("grid3dConnectDistVal"),
      connectBias: document.getElementById("grid3dConnectBias"),
      connectBiasVal: document.getElementById("grid3dConnectBiasVal"),
      connectStatus: document.getElementById("grid3dConnectStatus"),
      readout: document.getElementById("grid3dReadout"),
      hint: document.getElementById("grid3dViewHint"),
      boxMove: document.getElementById("grid3dBoxMove"),
      boxScale: document.getElementById("grid3dBoxScale"),
      showBranches: document.getElementById("grid3dShowBranches"),
      showSelBox: document.getElementById("grid3dShowSelBox"),
      showHumanScale: document.getElementById("grid3dShowHumanScale"),
      hideOutside: document.getElementById("grid3dHideOutside"),
      exportBranches: document.getElementById("grid3dExportBranches"),
      exportBranchesSvg: document.getElementById("grid3dExportBranchesSvg"),
      sendPlank: document.getElementById("grid3dSendPlank"),
      savedIterStatus: document.getElementById("grid3dSavedIterStatus"),
      saveIter: document.getElementById("grid3dSaveIter"),
      saveIterUpdate: document.getElementById("grid3dSaveIterUpdate"),
      saveIterAs: document.getElementById("grid3dSaveIterAs"),
      saveIterPanel: document.getElementById("grid3dSaveIterPanel"),
      saveIterName: document.getElementById("grid3dSaveIterName"),
      saveIterConfirm: document.getElementById("grid3dSaveIterConfirm"),
      saveIterCancel: document.getElementById("grid3dSaveIterCancel"),
      savedIterList: document.getElementById("grid3dSavedIterList"),
      deleteIterDialog: document.getElementById("grid3dDeleteIterDialog"),
      deleteIterCancel: document.getElementById("grid3dDeleteIterCancel"),
      deleteIterConfirm: document.getElementById("grid3dDeleteIterConfirm"),
      descMode: document.getElementById("grid3dDescMode"),
      descTools: document.getElementById("grid3dDescTools"),
      descCat: document.getElementById("grid3dDescCat"),
      descWord: document.getElementById("grid3dDescWord"),
      descInfl: document.getElementById("grid3dDescInfl"),
      descInflVal: document.getElementById("grid3dDescInflVal"),
      descCount: document.getElementById("grid3dDescCount"),
      descGenerate: document.getElementById("grid3dDescGenerate"),
      descStatus: document.getElementById("grid3dDescStatus"),
      descCards: document.getElementById("grid3dDescCards"),
      descLoad: document.getElementById("grid3dDescLoad"),
      descSave: document.getElementById("grid3dDescSave"),
      descOverlay: document.getElementById("grid3dDescOverlay"),
      descDebug: document.getElementById("grid3dDescDebug"),
      descDebugPanel: document.getElementById("grid3dDescDebugPanel"),
      descSavedList: document.getElementById("grid3dDescSavedList"),
    };

    let viewer = null;
    let sim = createSim({ seed: 20261003 });
    let selectedRootId = null;
    let rootPlacements = [];
    let nextPlacementUid = 1;
    let editMode = "idle";
    let networkOutdated = false;
    let applyingFields = false;
    let placeHover = null;
    let ptrDown = null;
    let playing = false;
    let acc = 0;
    let lastTs = 0;
    let growRaf = 0;
    let planarSource = null;
    let orientation = "both";
    let spacing = DEFAULT_SPACING;
    let gridError = null;
    let descModeOn = false;
    let descBusy = false;
    let descCandidates = [];
    let descSelectedId = null;
    let descLoaded = null;
    let descAnalysis = null;
    let openedIterationId = null;
    let openedIterationName = "";
    let iterationDirty = false;
    let saveIterMode = "create";
    let renameIterId = null;
    let pendingDeleteIterId = null;
    let savedIterRecords = [];
    let iterationLoadLock = false;

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
        if (editMode === "place") {
          els.hint.textContent = "Click a grid node to place a root · Esc cancel";
        } else if (editMode === "move") {
          els.hint.textContent = "Drag the yellow gizmo in X, Y, or Z · snaps to the grid · Esc done";
        } else {
          const move = viewer && viewer.getGizmoMode ? viewer.getGizmoMode() : "translate";
          const gizmoHint = " · Box " + (move === "scale" ? "Scale" : "Move");
          els.hint.textContent =
            (mode === "perspective"
              ? "Left-drag orbit · Right-drag pan · Scroll zoom"
              : "Rotation locked · Right-drag pan · Scroll zoom") + gizmoHint;
        }
      }
      paintBoxMode();
    }

    function paintBoxMode() {
      const mode = viewer && viewer.getGizmoMode ? viewer.getGizmoMode() : "translate";
      function mark(btn, on) {
        if (!btn) return;
        btn.classList.toggle("active", on);
        btn.classList.toggle("primary", on);
        btn.classList.toggle("ghost", !on);
      }
      mark(els.boxMove, mode === "translate");
      mark(els.boxScale, mode === "scale");
    }

    function setBoxMode(mode) {
      if (editMode !== "idle") setEditMode("idle");
      if (!viewer) ensureViewer();
      if (viewer && viewer.setGizmoMode) viewer.setGizmoMode(mode);
      paintBoxMode();
      paintViewButtons();
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
      for (let i = 0; i < rootPlacements.length; i++) {
        const node = rootPlacements[i];
        const li = document.createElement("li");
        if (node.uid === selectedRootId) li.classList.add("selected");
        li.textContent = `R${node.rootIndex} · ${node.x.toFixed(1)}, ${node.y.toFixed(1)}, ${node.z.toFixed(1)}`;
        li.addEventListener("click", () => {
          selectRoot(node.uid, true);
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
      if (els.addRoot) {
        els.addRoot.disabled = !ready;
        els.addRoot.classList.toggle("active", editMode === "place");
        els.addRoot.classList.toggle("primary", editMode === "place");
        els.addRoot.classList.toggle("ghost", editMode !== "place");
      }
      if (els.moveRoot) {
        els.moveRoot.disabled = !ready;
        els.moveRoot.classList.toggle("active", editMode === "move");
        els.moveRoot.classList.toggle("primary", editMode === "move");
        els.moveRoot.classList.toggle("ghost", editMode !== "move");
      }
      const clipped = currentClippedGraph();
      const noSegs = !clipped.segs.length;
      if (els.exportBranchesSvg) els.exportBranchesSvg.disabled = noSegs;
      if (els.exportBranches) els.exportBranches.disabled = noSegs;
      if (els.sendPlank) els.sendPlank.disabled = !sim.branches.length;
      paintSavedIterButtons();
      paintConnectControls();
    }

    function paintConnectControls() {
      const on = !!(els.connectNetworks && els.connectNetworks.checked);
      if (els.connectDist) els.connectDist.disabled = !on;
      if (els.connectBias) els.connectBias.disabled = !on;
      if (!els.connectStatus) return;
      if (!on) {
        els.connectStatus.textContent = "Independent networks.";
        return;
      }
      const groups = connectedNetworkSummary(sim);
      const merged = groups.filter((g) => g.roots.length > 1);
      if (!merged.length) {
        els.connectStatus.textContent = "Waiting to connect on the grid.";
        return;
      }
      els.connectStatus.textContent = merged
        .map((g) => g.name + " · " + g.roots.map((r) => "R" + r).join(" + "))
        .join(" · ");
    }

    function setSpaceStatus(message, kind) {
      setStatus(message, kind);
    }

    function currentClippedGraph() {
      if (!viewer || !global.D7GridSpaces) return { nodes: [], segs: [] };
      return global.D7GridSpaces.clipGraph(sim.nodes, sim.branches, viewer.getSelectionBox());
    }

    function paintSelection() {
      if (!viewer || !global.D7GridSpaces) return;
      const clipped = currentClippedGraph();
      if (viewer.setSelectionPreview) viewer.setSelectionPreview([]);
      const noSegs = !clipped.segs.length;
      if (els.exportBranchesSvg) els.exportBranchesSvg.disabled = noSegs;
      if (els.exportBranches) els.exportBranches.disabled = noSegs;
      if (!sim.branches.length) {
        setSpaceStatus("Grow branches inside the 20' × 20' × 20' module.");
      } else if (!clipped.segs.length) {
        setSpaceStatus("Move the 20' module onto grown branches.");
      } else {
        setSpaceStatus("Selection: " + clipped.segs.length + " segments · " + clipped.nodes.length + " nodes.");
      }
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
        if (viewer.highlightConnections && sim.freshConnections && sim.freshConnections.length) {
          viewer.highlightConnections(sim.freshConnections);
          sim.freshConnections = [];
        }
        if (!(viewer.rootGizmoBusy && viewer.rootGizmoBusy())) {
          viewer.setRoots(rootPlacements, selectedRootId);
          updateRootGizmo();
        }
        paintSelection();
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
      if (networkOutdated) {
        setStatus(
          "Roots changed. Previous branch network is outdated. Attractors kept. Start to grow from the new roots.",
          "active"
        );
        paintGridStats();
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
      paintConnectControls();
    }

    function readRootFields() {
      return {
        x: clamp(Number(els.rootX?.value ?? 10), 0, CUBE),
        y: clamp(Number(els.rootY?.value ?? 0), 0, CUBE),
        z: clamp(Number(els.rootZ?.value ?? 10), 0, CUBE),
      };
    }

    function hasNetwork() {
      return sim.branches.length > 0 || sim.iteration > 0;
    }

    function selectedPlacement() {
      for (let i = 0; i < rootPlacements.length; i++) {
        if (rootPlacements[i].uid === selectedRootId) return rootPlacements[i];
      }
      return null;
    }

    function usedGridIds(exceptUid) {
      const used = new Set();
      for (let i = 0; i < rootPlacements.length; i++) {
        const p = rootPlacements[i];
        if (exceptUid != null && p.uid === exceptUid) continue;
        if (p.gridId != null) used.add(p.gridId);
      }
      return used;
    }

    function snapFreeAt(x, y, z, exceptUid) {
      if (!sim.grid) return null;
      const used = usedGridIds(exceptUid);
      const nearby = nearbyGridNodes(sim.grid, x, y, z, 3.4, 90);
      const gid0 = nearestGridNodeId(sim.grid, x, y, z, true);
      if (gid0 >= 0) {
        const n = sim.grid.nodes[gid0];
        nearby.unshift({ id: gid0, dSq: 0, x: n.x, y: n.y, z: n.z });
      }
      const seen = new Set();
      for (let i = 0; i < nearby.length; i++) {
        const n = nearby[i];
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        if (used.has(n.id)) continue;
        return { gridId: n.id, x: n.x, y: n.y, z: n.z };
      }
      return null;
    }

    function writeRootFields(p) {
      if (!p) return;
      applyingFields = true;
      if (els.rootX) els.rootX.value = Number(p.x).toFixed(1);
      if (els.rootY) els.rootY.value = Number(p.y).toFixed(1);
      if (els.rootZ) els.rootZ.value = Number(p.z).toFixed(1);
      applyingFields = false;
    }

    function writeMinSegToHud(value) {
      const v = resolveMinSegmentLength(value);
      if (els.minSeg) {
        els.minSeg.value = String(v);
        if (els.minSegVal) els.minSegVal.textContent = v.toFixed(1) + "'";
      }
      sim.minSegmentLength = v;
    }

    function writeMinBendToHud(value) {
      const v = resolveMinBendAngle(value);
      if (els.minBend) {
        els.minBend.value = String(v);
        if (els.minBendVal) els.minBendVal.textContent = Math.round(v) + "°";
      }
      sim.minBendAngle = v;
    }

    function writeConnectToHud(data) {
      if (!data) return;
      if (els.connectNetworks && data.connectNetworks != null) {
        els.connectNetworks.checked = !!data.connectNetworks;
      }
      if (els.connectDist && data.connectDistance != null) {
        els.connectDist.value = String(data.connectDistance);
        if (els.connectDistVal) els.connectDistVal.textContent = Number(data.connectDistance).toFixed(2) + "'";
      }
      if (els.connectBias && data.connectBias != null) {
        els.connectBias.value = String(data.connectBias);
        if (els.connectBiasVal) els.connectBiasVal.textContent = String(Math.round(Number(data.connectBias)));
      }
      sim.connectNetworks = !!(els.connectNetworks && els.connectNetworks.checked);
      sim.connectDistance = clamp(Number(els.connectDist?.value ?? DEFAULT_CONNECT_DIST), 0.25, 4);
      sim.connectBias = clamp(Number(els.connectBias?.value ?? DEFAULT_CONNECT_BIAS), 0, 100);
      paintConnectControls();
    }

    function syncPlacementsFromSim() {
      rootPlacements = [];
      for (let i = 0; i < sim.roots.length; i++) {
        const n = sim.nodeById.get(sim.roots[i]);
        if (!n) continue;
        if (n.uid == null) n.uid = nextPlacementUid++;
        rootPlacements.push({
          uid: n.uid,
          simId: n.id,
          rootIndex: n.rootIndex,
          x: n.x,
          y: n.y,
          z: n.z,
          gridId: n.gridId,
        });
      }
      sim.rootDrafts = rootPlacements;
      let maxIndex = 0;
      for (let i = 0; i < rootPlacements.length; i++) {
        maxIndex = Math.max(maxIndex, rootPlacements[i].rootIndex || 0);
      }
      sim.nextRootIndex = maxIndex + 1;
    }

    function applyPlacementsToSim() {
      resetGrowth(sim, rootPlacements);
      syncPlacementsFromSim();
      networkOutdated = false;
    }

    function updateRootGizmo() {
      if (!viewer || !viewer.setRootGizmo) return;
      const p = selectedPlacement();
      const show = !els.showRoots || els.showRoots.checked;
      if (editMode === "move" && p && show) viewer.setRootGizmo(p);
      else viewer.setRootGizmo(null);
    }

    function setEditMode(mode) {
      const next = mode === "place" || mode === "move" ? mode : "idle";
      if (next !== "idle" && !sim.grid) {
        setStatus(gridError || "SVG grid is not loaded.", "error");
        return;
      }
      if (next === "move" && !selectedPlacement()) {
        setStatus("Select a root, then click Move Root — or click a yellow root in the viewport.", "error");
        editMode = "idle";
      } else {
        editMode = next;
      }
      stage.classList.toggle("root-place", editMode === "place");
      stage.classList.toggle("root-move", editMode === "move");
      if (viewer) {
        viewer.setBoxGizmoLocked(editMode !== "idle");
        if (editMode !== "place") {
          placeHover = null;
          viewer.setPlacePreview(null, []);
        }
        updateRootGizmo();
      }
      paintButtons();
      paintViewButtons();
    }

    function selectRoot(uid, enterMove) {
      selectedRootId = uid;
      const p = selectedPlacement();
      if (p) writeRootFields(p);
      if (enterMove && uid) setEditMode("move");
      paintRoots();
      syncViewer();
    }

    function addRootAtSnap(x, y, z) {
      const snap = snapFreeAt(x, y, z, null);
      if (!snap) {
        setStatus("No free grid node there. Pick another location.", "error");
        return null;
      }
      if (hasNetwork()) {
        pauseGrowth();
        networkOutdated = true;
        const p = {
          uid: nextPlacementUid++,
          simId: null,
          rootIndex: sim.nextRootIndex++,
          x: snap.x,
          y: snap.y,
          z: snap.z,
          gridId: snap.gridId,
        };
        rootPlacements.push(p);
        sim.rootDrafts = rootPlacements;
        return p;
      }
      const node = occupyGridNode(sim, snap.gridId, null, true);
      if (!node) {
        setStatus("That grid node already has a root.", "error");
        return null;
      }
      node.uid = nextPlacementUid++;
      killNearNetwork(sim);
      syncPlacementsFromSim();
      for (let i = 0; i < rootPlacements.length; i++) {
        if (rootPlacements[i].simId === node.id) return rootPlacements[i];
      }
      return rootPlacements[rootPlacements.length - 1] || null;
    }

    function moveSelectedTo(x, y, z) {
      const p = selectedPlacement();
      if (!p || !sim.grid) return null;
      const snap = snapFreeAt(x, y, z, p.uid);
      if (!snap) {
        writeRootFields(p);
        setStatus("No free grid node at those coordinates.", "error");
        return null;
      }
      if (snap.gridId === p.gridId) {
        writeRootFields(p);
        return p;
      }
      if (hasNetwork()) {
        pauseGrowth();
        networkOutdated = true;
        p.x = snap.x;
        p.y = snap.y;
        p.z = snap.z;
        p.gridId = snap.gridId;
        sim.rootDrafts = rootPlacements;
        writeRootFields(p);
        return p;
      }
      const moved = moveRootNode(sim, p.simId, snap.gridId);
      if (!moved) {
        writeRootFields(p);
        setStatus("That grid node already has a root.", "error");
        return null;
      }
      killNearNetwork(sim);
      syncPlacementsFromSim();
      selectedRootId = moved.uid;
      const cur = selectedPlacement();
      writeRootFields(cur);
      return cur;
    }

    function removeSelectedRoot() {
      const p = selectedPlacement();
      if (!p) return;
      if (hasNetwork()) {
        pauseGrowth();
        networkOutdated = true;
        rootPlacements = rootPlacements.filter((r) => r.uid !== p.uid);
        sim.rootDrafts = rootPlacements;
      } else if (p.simId != null) {
        deleteRoot(sim, p.simId);
        syncPlacementsFromSim();
      } else {
        rootPlacements = rootPlacements.filter((r) => r.uid !== p.uid);
        sim.rootDrafts = rootPlacements;
      }
      selectedRootId = rootPlacements[0] ? rootPlacements[0].uid : null;
      if (selectedRootId) writeRootFields(selectedPlacement());
      if (!selectedRootId && editMode === "move") setEditMode("idle");
      paintRoots();
      syncViewer();
      paintStatus();
    }

    function updatePlaceHover(clientX, clientY) {
      if (editMode !== "place" || !viewer || !sim.grid) return;
      const ray = viewer.getPointerRay(clientX, clientY);
      if (!ray) return;
      const gid = nearestGridNodeToRay(sim.grid, ray.origin, ray.dir, 1.45);
      if (gid < 0) {
        placeHover = null;
        viewer.setPlacePreview(null, []);
        return;
      }
      const n = sim.grid.nodes[gid];
      const occupied = usedGridIds(null).has(gid);
      placeHover = { gridId: gid, x: n.x, y: n.y, z: n.z, occupied };
      viewer.setPlacePreview(placeHover, nearbyGridNodes(sim.grid, n.x, n.y, n.z, 2.3, 42));
    }

    function readParamsIntoSim() {
      sim.attractorTarget = Number(els.attractorCount?.value ?? DEFAULT_ATTRACTORS);
      sim.influence = Number(els.influence?.value ?? DEFAULT_INFLUENCE);
      sim.kill = Number(els.kill?.value ?? DEFAULT_KILL);
      sim.connectNetworks = !!(els.connectNetworks && els.connectNetworks.checked);
      sim.connectDistance = clamp(Number(els.connectDist?.value ?? DEFAULT_CONNECT_DIST), 0.25, 4);
      sim.connectBias = clamp(Number(els.connectBias?.value ?? DEFAULT_CONNECT_BIAS), 0, 100);
      sim.minSegmentLength = resolveMinSegmentLength(els.minSeg?.value ?? DEFAULT_MIN_SEG);
      sim.minBendAngle = resolveMinBendAngle(els.minBend?.value ?? DEFAULT_MIN_BEND);
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
      if (!rootPlacements.length) {
        setStatus("Add at least one root before growing.", "error");
        return;
      }
      readParamsIntoSim();
      if (networkOutdated || !sim.roots.length) {
        applyPlacementsToSim();
        paintRoots();
      }
      if (!sim.attractors.length) generateAttractors(sim);
      if (sim.done && !aliveCount(sim)) {
        setStatus("No remaining attractors. Reset Simulation or New Variation.", "error");
        return;
      }
      setEditMode("idle");
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

    function clonePlain(value) {
      if (value == null || typeof value !== "object") return value;
      if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) return Array.from(value);
      if (Array.isArray(value)) {
        const out = new Array(value.length);
        for (let i = 0; i < value.length; i++) out[i] = clonePlain(value[i]);
        return out;
      }
      const out = {};
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) out[key] = clonePlain(value[key]);
      }
      return out;
    }

    function savedIterStore() {
      return global.D7SavedGridIterations || null;
    }

    function markIterationDirty() {
      if (iterationLoadLock) return;
      iterationDirty = true;
      paintSavedIterButtons();
    }

    function formatSavedIterDate(ts) {
      const n = Number(ts);
      if (!n) return "";
      try {
        return new Date(n).toLocaleString();
      } catch (err) {
        return "";
      }
    }

    function setSavedIterStatus(message, kind) {
      if (!els.savedIterStatus) return;
      els.savedIterStatus.textContent = message;
      els.savedIterStatus.classList.toggle("active", kind === "active");
      els.savedIterStatus.classList.toggle("error", kind === "error");
      els.savedIterStatus.classList.toggle("space3d-saved-unsaved", kind === "unsaved");
    }

    function paintSavedIterButtons() {
      const store = savedIterStore();
      if (els.saveIter) els.saveIter.disabled = !store;
      if (els.saveIterUpdate) els.saveIterUpdate.disabled = !store || !openedIterationId || !iterationDirty;
      if (els.saveIterAs) els.saveIterAs.disabled = !store || !openedIterationId;
      if (!store) {
        setSavedIterStatus("Saved Iterations need IndexedDB in this browser.", "error");
      } else if (openedIterationId && iterationDirty) {
        setSavedIterStatus("Unsaved Changes · " + (openedIterationName || "Iteration"), "unsaved");
      } else if (openedIterationId) {
        setSavedIterStatus("Opened · " + (openedIterationName || "Iteration"), "active");
      } else {
        setSavedIterStatus("No iteration opened.");
      }
    }

    function padId(n) {
      return String(n).padStart(3, "0");
    }

    function geometryHash(payload) {
      const lib = global.D7SpatialExport;
      if (lib && typeof lib.hashGeometryState === "function") return lib.hashGeometryState(payload);
      return "";
    }

    function capturePlankNetwork() {
      return {
        cube: CUBE,
        unit: "ft",
        nodes: sim.nodes.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          z: n.z,
          parentId: n.parentId,
          isRoot: !!n.isRoot,
          networkId: n.networkId,
          rootIndex: n.rootIndex,
        })),
        branches: sim.branches.map((b) => ({
          id: b.id,
          fromId: b.fromId,
          toId: b.toId,
          order: b.order,
          connection: !!b.connection,
        })),
      };
    }

    function sendToPlankBuilder() {
      if (!sim.branches.length) {
        setSpaceStatus("Grow branches first, then send to Plank Builder.", "error");
        return;
      }
      const payload = capturePlankNetwork();
      const api = global.D7PlankBuilder && global.D7PlankBuilder.instance;
      if (!api || typeof api.receive !== "function") {
        setSpaceStatus("Plank Builder did not load.", "error");
        return;
      }
      api.receive(payload);
      const tab = document.getElementById("tabPlank");
      if (tab) tab.click();
      else setSpaceStatus("Sent " + payload.branches.length + " branches to Plank Builder.", "active");
    }

    function captureSourceBranches() {
      if (viewer && viewer.captureDisplayedBranches) {
        const shown = viewer.captureDisplayedBranches();
        if (shown && shown.length) return clonePlain(shown);
      }
      return sim.branches.map((b, i) => {
        const a = sim.nodeById.get(b.fromId);
        const c = sim.nodeById.get(b.toId);
        return {
          id: b.id != null ? "branch_" + padId(b.id) : "branch_" + padId(i + 1),
          originalId: b.id,
          startNodeId: b.fromId,
          endNodeId: b.toId,
          ax: a ? a.x : 0,
          ay: a ? a.y : 0,
          az: a ? a.z : 0,
          bx: c ? c.x : 0,
          by: c ? c.y : 0,
          bz: c ? c.z : 0,
          networkId: a && a.networkId != null ? a.networkId : c && c.networkId,
          connection: !!b.connection,
        };
      });
    }

    function captureBranchNodes() {
      return sim.nodes.map((n) => ({
        id: n.id,
        stableId: "node_" + padId(n.id),
        x: n.x,
        y: n.y,
        z: n.z,
        parentId: n.parentId,
        isRoot: !!n.isRoot,
        networkId: n.networkId,
        rootIndex: n.rootIndex,
        originRootIndex: n.originRootIndex,
        gridId: n.gridId,
      }));
    }

    function captureRootsCanonical() {
      if (viewer && viewer.captureDisplayedRoots) {
        const shown = viewer.captureDisplayedRoots();
        if (shown && shown.length) return shown;
      }
      const list = rootPlacements.length
        ? rootPlacements
        : sim.roots.map((id) => sim.nodeById.get(id)).filter(Boolean);
      return list.map((n, i) => ({
        id: n.uid != null ? n.uid : n.id,
        stableId: "root_" + padId(i + 1),
        x: n.x,
        y: n.y,
        z: n.z,
        rootIndex: n.rootIndex,
        originRootIndex: n.originRootIndex != null ? n.originRootIndex : n.rootIndex,
        networkId: n.networkId,
        gridId: n.gridId,
      }));
    }

    function captureWorkingSnapshot() {
      sim.rootDrafts = rootPlacements;
      const display = viewer && viewer.captureDisplayGeometry ? viewer.captureDisplayGeometry() : null;
      const sourceBranches = captureSourceBranches();
      const branchNodes = captureBranchNodes();
      const roots = captureRootsCanonical();
      const selectionBox = viewer && viewer.getSelectionState ? viewer.getSelectionState() : null;
      if (selectionBox) {
        selectionBox.normalization = { scale: 1, ox: 0, oy: 0, oz: 0, cube: CUBE };
      }
      const canonical = {
        schemaVersion: 4,
        version: 4,
        id: openedIterationId || null,
        selectionBox,
        sourceBranches,
        branchNodes,
        displayGeometry: display,
        roots,
        attractors: sim.attractors.map((a, i) => ({
          x: a.x,
          y: a.y,
          z: a.z,
          alive: sim.alive[i] !== 0,
          gridId: a.gridId,
        })),
        parameters: {
          connectNetworks: !!(els.connectNetworks && els.connectNetworks.checked),
          connectDistance: clamp(Number(els.connectDist?.value ?? DEFAULT_CONNECT_DIST), 0.25, 4),
          connectBias: clamp(Number(els.connectBias?.value ?? DEFAULT_CONNECT_BIAS), 0, 100),
          minimumSegmentLength: resolveMinSegmentLength(els.minSeg?.value ?? sim.minSegmentLength),
          minSegmentLength: resolveMinSegmentLength(els.minSeg?.value ?? sim.minSegmentLength),
          minimumBendAngle: resolveMinBendAngle(els.minBend?.value ?? sim.minBendAngle),
          minBendAngle: resolveMinBendAngle(els.minBend?.value ?? sim.minBendAngle),
        },
        displayState: {
          showBranches: !!(els.showBranches && els.showBranches.checked),
          showSelBox: !(els.showSelBox) || !!els.showSelBox.checked,
          showHumanScale: !!(els.showHumanScale && els.showHumanScale.checked),
          hideOutside: !!(els.hideOutside && els.hideOutside.checked),
        },
        cameraState: viewer && viewer.getCameraState ? viewer.getCameraState() : null,
        randomSeed: sim.seed,
        humanScale: viewer && viewer.getHumanScaleState ? viewer.getHumanScaleState() : null,
        camera: viewer && viewer.getCameraState ? viewer.getCameraState() : null,
        connectNetworks: !!(els.connectNetworks && els.connectNetworks.checked),
        connectDistance: clamp(Number(els.connectDist?.value ?? DEFAULT_CONNECT_DIST), 0.25, 4),
        connectBias: clamp(Number(els.connectBias?.value ?? DEFAULT_CONNECT_BIAS), 0, 100),
        minimumSegmentLength: resolveMinSegmentLength(els.minSeg?.value ?? sim.minSegmentLength),
        minSegmentLength: resolveMinSegmentLength(els.minSeg?.value ?? sim.minSegmentLength),
        minimumBendAngle: resolveMinBendAngle(els.minBend?.value ?? sim.minBendAngle),
        minBendAngle: resolveMinBendAngle(els.minBend?.value ?? sim.minBendAngle),
        growthSnapshot: snapshot(sim),
        showBranches: !!(els.showBranches && els.showBranches.checked),
        showSelBox: !(els.showSelBox) || !!els.showSelBox.checked,
        showHumanScale: !!(els.showHumanScale && els.showHumanScale.checked),
        hideOutside: !!(els.hideOutside && els.hideOutside.checked),
      };
      canonical.geometryStateHash = geometryHash({
        sourceBranches,
        guides: sourceBranches,
        roots,
        box: selectionBox && selectionBox.bounds,
        displayGeometry: display,
      });
      return canonical;
    }

    function applyWorkingSnapshot(snapshot) {
      if (!snapshot) return;
      iterationLoadLock = true;
      try {
        pauseGrowth();
        ensureViewer();
        if (snapshot.selectionBox && viewer && viewer.setSelectionBox) {
          viewer.setSelectionBox(snapshot.selectionBox);
        }
        const displayState = snapshot.displayState || snapshot;
        if (els.showBranches) {
          const hadGeneratedGeom = !!(snapshot.generatedBoxes || snapshot.spaceResult || snapshot.surfaceGeometry);
          els.showBranches.checked = hadGeneratedGeom ? true : displayState.showBranches !== false;
          if (viewer) viewer.setShowBranches(els.showBranches.checked);
        }
        if (els.showSelBox) {
          els.showSelBox.checked = displayState.showSelBox !== false;
          if (viewer && viewer.setShowSelectionBox) viewer.setShowSelectionBox(els.showSelBox.checked);
        }
        if (els.showHumanScale) {
          const hs = snapshot.humanScale || {};
          const showHs = displayState.showHumanScale != null ? !!displayState.showHumanScale : !!hs.show;
          els.showHumanScale.checked = showHs;
          if (viewer && viewer.setHumanScaleState) {
            viewer.setHumanScaleState({
              show: showHs,
              insetX: hs.insetX != null ? hs.insetX : HUMAN_SCALE_INSET,
              insetZ: hs.insetZ != null ? hs.insetZ : HUMAN_SCALE_INSET,
            });
          } else if (viewer && viewer.setShowHumanScale) {
            viewer.setShowHumanScale(showHs);
          }
        }
        if (els.hideOutside) {
          els.hideOutside.checked = !!displayState.hideOutside;
          if (viewer && viewer.setHideOutsideSelection) viewer.setHideOutsideSelection(els.hideOutside.checked);
        }
        writeConnectToHud(snapshot.parameters || snapshot);
        writeMinSegToHud(
          (snapshot.parameters && (snapshot.parameters.minimumSegmentLength ?? snapshot.parameters.minSegmentLength)) ??
            snapshot.minimumSegmentLength ??
            snapshot.minSegmentLength ??
            (snapshot.growthSnapshot &&
              (snapshot.growthSnapshot.minimumSegmentLength ?? snapshot.growthSnapshot.minSegmentLength))
        );
        writeMinBendToHud(
          (snapshot.parameters && (snapshot.parameters.minimumBendAngle ?? snapshot.parameters.minBendAngle)) ??
            snapshot.minimumBendAngle ??
            snapshot.minBendAngle ??
            (snapshot.growthSnapshot &&
              (snapshot.growthSnapshot.minimumBendAngle ?? snapshot.growthSnapshot.minBendAngle))
        );
        if (snapshot.randomSeed != null) sim.seed = snapshot.randomSeed >>> 0;
        if (snapshot.growthSnapshot && snapshot.growthSnapshot.nodes && snapshot.growthSnapshot.nodes.length) {
          applyGrowthSnapshot(snapshot.growthSnapshot);
          syncViewer();
        } else if (snapshot.roots && snapshot.roots.length && (!snapshot.growthSnapshot || !snapshot.growthSnapshot.nodes)) {
          applyGrowthSnapshot({ roots: snapshot.roots, attractors: snapshot.attractors, seed: snapshot.randomSeed });
          syncViewer();
        }
        const cam = snapshot.cameraState || snapshot.camera;
        if (cam && viewer && viewer.setCameraState) viewer.setCameraState(cam);
        paintSelection();
        paintViewButtons();
      } finally {
        iterationLoadLock = false;
      }
    }

    function closeSaveIterPanel() {
      if (els.saveIterPanel) els.saveIterPanel.classList.add("hidden");
      saveIterMode = "create";
      renameIterId = null;
    }

    function openSaveIterPanel(mode, presetName) {
      saveIterMode = mode || "create";
      if (!els.saveIterPanel) return;
      els.saveIterPanel.classList.remove("hidden");
      if (els.saveIterName) {
        els.saveIterName.value = presetName || "";
        els.saveIterName.focus();
        els.saveIterName.select();
      }
      if (els.saveIterConfirm) {
        els.saveIterConfirm.textContent = mode === "rename" ? "Rename" : "Save";
      }
    }

    function closeDeleteIterDialog() {
      pendingDeleteIterId = null;
      if (els.deleteIterDialog) els.deleteIterDialog.classList.add("hidden");
    }

    function openDeleteIterDialog(id) {
      pendingDeleteIterId = id;
      if (els.deleteIterDialog) els.deleteIterDialog.classList.remove("hidden");
      if (els.deleteIterCancel) els.deleteIterCancel.focus();
    }

    function renderSavedIterList() {
      const list = els.savedIterList;
      if (!list) return;
      list.innerHTML = "";
      for (const record of savedIterRecords) {
        const item = document.createElement("li");
        if (record.id === openedIterationId) item.className = "active";
        if (record.thumbnail) {
          const img = document.createElement("img");
          img.alt = "";
          img.width = 72;
          img.height = 72;
          img.src = record.thumbnail;
          item.appendChild(img);
        }
        const body = document.createElement("div");
        body.className = "saved-sim-card-body";
        const title = document.createElement("strong");
        title.className = "saved-sim-card-title";
        title.textContent = record.name || "Untitled";
        const meta = document.createElement("div");
        meta.className = "saved-sim-card-meta";
        const created = formatSavedIterDate(record.createdAt);
        const updated = formatSavedIterDate(record.updatedAt);
        meta.innerHTML = created
          ? "Created " + created + (updated && updated !== created ? "<br>Modified " + updated : "")
          : "";
        const actions = document.createElement("div");
        actions.className = "saved-sim-card-actions";
        const loadBtn = document.createElement("button");
        loadBtn.type = "button";
        loadBtn.textContent = "Load";
        loadBtn.addEventListener("click", () => loadSavedIteration(record.id));
        const dupBtn = document.createElement("button");
        dupBtn.type = "button";
        dupBtn.textContent = "Duplicate";
        dupBtn.addEventListener("click", () => duplicateSavedIteration(record.id));
        const renameBtn = document.createElement("button");
        renameBtn.type = "button";
        renameBtn.textContent = "Rename";
        renameBtn.addEventListener("click", () => {
          renameIterId = record.id;
          openSaveIterPanel("rename", record.name || "");
        });
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.textContent = "Delete";
        delBtn.addEventListener("click", () => openDeleteIterDialog(record.id));
        actions.appendChild(loadBtn);
        actions.appendChild(dupBtn);
        actions.appendChild(renameBtn);
        actions.appendChild(delBtn);
        body.appendChild(title);
        body.appendChild(meta);
        body.appendChild(actions);
        item.appendChild(body);
        list.appendChild(item);
      }
    }

    async function refreshSavedIterList() {
      const store = savedIterStore();
      if (!store) {
        setSavedIterStatus("Saved Iterations need IndexedDB in this browser.", "error");
        return;
      }
      try {
        savedIterRecords = await store.list();
        renderSavedIterList();
        paintSavedIterButtons();
      } catch (err) {
        setSavedIterStatus(err && err.message ? err.message : "Could not read saved iterations.", "error");
      }
    }

    async function persistSavedIteration(record) {
      const store = savedIterStore();
      if (!store) throw new Error("Saved Iterations need IndexedDB in this browser.");
      return store.put(record);
    }

    async function createSavedIteration(name) {
      const store = savedIterStore();
      if (!store) throw new Error("Saved Iterations need IndexedDB in this browser.");
      ensureViewer();
      const thumbnail = viewer && viewer.captureThumbnail ? viewer.captureThumbnail() : "";
      const now = Date.now();
      const snap = captureWorkingSnapshot();
      const record = {
        id: store.createId(),
        name: String(name || store.nextDefaultName(savedIterRecords)).trim() || store.nextDefaultName(savedIterRecords),
        createdAt: now,
        updatedAt: now,
        thumbnail: thumbnail || "",
        version: 4,
        schemaVersion: 4,
        geometryStateHash: snap.geometryStateHash,
        snapshot: snap,
      };
      await persistSavedIteration(record);
      openedIterationId = record.id;
      openedIterationName = record.name;
      iterationDirty = false;
      await refreshSavedIterList();
      setSavedIterStatus(
        "Saved · " + record.name + (snap.geometryStateHash ? " · hash " + snap.geometryStateHash : ""),
        "active"
      );
    }

    async function overwriteOpenedIteration() {
      const store = savedIterStore();
      if (!store || !openedIterationId) return;
      ensureViewer();
      const existing = await store.get(openedIterationId);
      if (!existing) throw new Error("That saved iteration is no longer in this browser.");
      const thumbnail = viewer && viewer.captureThumbnail ? viewer.captureThumbnail() : existing.thumbnail;
      const snap = captureWorkingSnapshot();
      existing.updatedAt = Date.now();
      existing.thumbnail = thumbnail || existing.thumbnail || "";
      existing.version = 4;
      existing.schemaVersion = 4;
      existing.geometryStateHash = snap.geometryStateHash;
      existing.snapshot = snap;
      await persistSavedIteration(existing);
      openedIterationName = existing.name;
      iterationDirty = false;
      await refreshSavedIterList();
      setSavedIterStatus(
        "Saved changes · " + existing.name + (snap.geometryStateHash ? " · hash " + snap.geometryStateHash : ""),
        "active"
      );
    }

    async function loadSavedIteration(id) {
      const store = savedIterStore();
      if (!store) return;
      const record = await store.get(id);
      if (!record || !record.snapshot) {
        setSavedIterStatus("Could not load that iteration.", "error");
        return;
      }
      applyWorkingSnapshot(clonePlain(record.snapshot));
      openedIterationId = record.id;
      openedIterationName = record.name || "";
      iterationDirty = false;
      renderSavedIterList();
      const live = captureWorkingSnapshot();
      iterationDirty = false;
      paintSavedIterButtons();
      const savedHash = record.snapshot.geometryStateHash || record.geometryStateHash || "";
      const liveHash = live.geometryStateHash || "";
      const match = savedHash && liveHash && savedHash === liveHash;
      setSavedIterStatus(
        "Loaded · " +
          (record.name || "iteration") +
          (liveHash ? " · Viewport " + liveHash : "") +
          (savedHash ? " · Saved " + savedHash : "") +
          (savedHash && liveHash ? (match ? " · match" : " · MISMATCH") : ""),
        match || !savedHash ? "active" : "error"
      );
    }

    async function duplicateSavedIteration(id) {
      const store = savedIterStore();
      if (!store) return;
      const record = await store.get(id);
      if (!record) return;
      const now = Date.now();
      const copy = {
        id: store.createId(),
        name: store.duplicateName(record.name),
        createdAt: now,
        updatedAt: now,
        thumbnail: record.thumbnail || "",
        snapshot: clonePlain(record.snapshot),
        version: 4,
        schemaVersion: 4,
        geometryStateHash: record.snapshot && record.snapshot.geometryStateHash,
      };
      await persistSavedIteration(copy);
      await refreshSavedIterList();
      setSavedIterStatus("Duplicated · " + copy.name, "active");
    }

    async function renameSavedIteration(id, name) {
      const store = savedIterStore();
      if (!store) return;
      const record = await store.get(id);
      if (!record) return;
      record.name = String(name || "").trim() || record.name;
      record.updatedAt = Date.now();
      await persistSavedIteration(record);
      if (openedIterationId === id) openedIterationName = record.name;
      await refreshSavedIterList();
      setSavedIterStatus("Renamed · " + record.name, "active");
    }

    async function deleteSavedIteration(id) {
      const store = savedIterStore();
      if (!store || !id) return;
      await store.remove(id);
      if (openedIterationId === id) {
        openedIterationId = null;
        openedIterationName = "";
        iterationDirty = !!(sim.branches && sim.branches.length);
      }
      await refreshSavedIterList();
      setSavedIterStatus("Deleted iteration. Working growth was not reset.");
    }

    function applyLoadedGrid(grid, keepRoots) {
      const rootTargets = keepRoots
        ? (rootPlacements.length
            ? rootPlacements.slice()
            : sim.roots.map((id) => sim.nodeById.get(id)).filter(Boolean))
        : [];
      sim.grid = grid;
      gridError = null;
      sim.nodes = [];
      sim.nodeById = new Map();
      sim.branches = [];
      sim.roots = [];
      sim.gridToSim = new Map();
      sim.usedEdges = new Set();
      sim.reservedGrid = new Set();
      sim.legacyGraph = false;
      sim.iteration = 0;
      sim.done = false;
      sim.nextNodeId = 1;
      sim.nextBranchId = 1;
      sim.nextRootIndex = 1;
      networkOutdated = false;
      if (viewer) viewer.setGrid(grid);
      if (rootTargets.length) {
        for (let i = 0; i < rootTargets.length; i++) {
          const node = addRootAt(sim, rootTargets[i].x, rootTargets[i].y, rootTargets[i].z);
          if (!node) continue;
          if (rootTargets[i].uid != null) node.uid = rootTargets[i].uid;
          if (rootTargets[i].rootIndex) node.rootIndex = rootTargets[i].rootIndex;
        }
      }
      if (!sim.roots.length) {
        const def = defaultRootPosition(grid);
        writeRootFields(def);
        ensureDefaultRoot(sim);
      }
      syncPlacementsFromSim();
      selectedRootId = rootPlacements[0] ? rootPlacements[0].uid : null;
      if (selectedRootId) writeRootFields(selectedPlacement());
      generateAttractors(sim);
      setEditMode("idle");
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
      if (els.showRoots && viewer.setShowRoots) viewer.setShowRoots(els.showRoots.checked);
      if (els.showSelBox && viewer.setShowSelectionBox) viewer.setShowSelectionBox(els.showSelBox.checked);
      if (els.showHumanScale && viewer.setShowHumanScale) viewer.setShowHumanScale(els.showHumanScale.checked);
      viewer.setBoxGizmoLocked(editMode !== "idle");
      stage.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        const ae = document.activeElement;
        if (ae && ae !== document.body && !stage.contains(ae) && typeof ae.blur === "function") ae.blur();
        const canvas = stage.querySelector("canvas");
        if (canvas && typeof canvas.focus === "function") canvas.focus({ preventScroll: true });
        ptrDown = {
          x: event.clientX,
          y: event.clientY,
          gizmo: !!(viewer.gizmoBusy && viewer.gizmoBusy()),
        };
      });
      stage.addEventListener("pointermove", (event) => {
        if (editMode === "place") updatePlaceHover(event.clientX, event.clientY);
      });
      stage.addEventListener("pointerup", (event) => {
        if (event.button !== 0) return;
        const start = ptrDown;
        ptrDown = null;
        if (!start) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
        if (start.gizmo) return;
        if (editMode === "place") {
          updatePlaceHover(event.clientX, event.clientY);
          if (!placeHover || placeHover.occupied) {
            setStatus("Pick a free grid node.", "error");
            return;
          }
          const added = addRootAtSnap(placeHover.x, placeHover.y, placeHover.z);
          if (!added) return;
          selectedRootId = added.uid;
          writeRootFields(added);
          paintRoots();
          syncViewer();
          paintStatus();
          setStatus(
            networkOutdated
              ? "Root added. Previous branch network is outdated. Attractors kept. Click another node or Start to grow."
              : "Root R" + added.rootIndex + " placed. Click to add another, or Move Root.",
            "active"
          );
          return;
        }
        const id = viewer.pickRoot(event.clientX, event.clientY);
        if (id == null) return;
        selectRoot(id, true);
      });
      stage.addEventListener("dblclick", () => {
        if (editMode !== "idle") return;
        viewer.toggleGizmoMode();
        paintBoxMode();
        paintViewButtons();
      });
      viewer.setOnSelectionChange(() => {
        paintSelection();
      });
      if (viewer.setOnSelectionEnd) {
        viewer.setOnSelectionEnd(() => {
          paintSelection();
          markIterationDirty();
          setSpaceStatus("Selection box moved. Saved iterations are unchanged until you Save Changes.", "active");
        });
      }
      if (viewer.setOnRootGizmoChange) {
        viewer.setOnRootGizmoChange((pos) => {
          if (hasNetwork()) {
            pauseGrowth();
            networkOutdated = true;
          }
          if (!sim.grid) return;
          const snap = snapFreeAt(pos.x, pos.y, pos.z, selectedRootId);
          if (snap) {
            viewer.setPlacePreview(
              { x: snap.x, y: snap.y, z: snap.z, occupied: false },
              nearbyGridNodes(sim.grid, snap.x, snap.y, snap.z, 2.3, 36)
            );
            writeRootFields(snap);
          }
        });
      }
      if (viewer.setOnRootGizmoEnd) {
        viewer.setOnRootGizmoEnd((pos) => {
          if (viewer.setPlacePreview) viewer.setPlacePreview(null, []);
          const moved = moveSelectedTo(pos.x, pos.y, pos.z);
          paintRoots();
          syncViewer();
          paintStatus();
          if (moved) {
            setStatus(
              networkOutdated
                ? "Root moved. Previous branch network is outdated. Attractors kept. Start to grow from the new roots."
                : "Root R" +
                    moved.rootIndex +
                    " · " +
                    moved.x.toFixed(1) +
                    ", " +
                    moved.y.toFixed(1) +
                    ", " +
                    moved.z.toFixed(1),
              "active"
            );
          }
        });
      }
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
    bindVal(els.connectDist, els.connectDistVal, (v) => `${Number(v).toFixed(2)}'`);
    bindVal(els.connectBias, els.connectBiasVal, (v) => String(Math.round(Number(v))));
    bindVal(els.speed, els.speedVal, (v) => `${Math.round(Number(v))}/s`);
    bindVal(els.minSeg, els.minSegVal, (v) => `${Number(v).toFixed(1)}'`);
    bindVal(els.minBend, els.minBendVal, (v) => `${Math.round(Number(v))}°`);
    bindVal(els.spacing, els.spacingVal, (v) => `${Number(v).toFixed(1)}'`);
    if (els.minSeg) {
      els.minSeg.addEventListener("input", () => {
        sim.minSegmentLength = resolveMinSegmentLength(els.minSeg.value);
      });
    }
    if (els.minBend) {
      els.minBend.addEventListener("input", () => {
        sim.minBendAngle = resolveMinBendAngle(els.minBend.value);
      });
    }

    const GRID_SLIDER_BOUNDS = [
      { slider: "grid3dSpacing", min: "grid3dSpacingMin", max: "grid3dSpacingMax", hardMin: 0.5, hardMax: 20 },
      { slider: "grid3dAttractorCount", min: "grid3dAttractorCountMin", max: "grid3dAttractorCountMax", hardMin: 1, hardMax: 20000 },
      { slider: "grid3dInfluence", min: "grid3dInfluenceMin", max: "grid3dInfluenceMax", hardMin: 0.1, hardMax: 40 },
      { slider: "grid3dKill", min: "grid3dKillMin", max: "grid3dKillMax", hardMin: 0.1, hardMax: 40 },
      { slider: "grid3dConnectDist", min: "grid3dConnectDistMin", max: "grid3dConnectDistMax", hardMin: 0.25, hardMax: 8 },
      { slider: "grid3dConnectBias", min: "grid3dConnectBiasMin", max: "grid3dConnectBiasMax", hardMin: 0, hardMax: 100 },
      { slider: "grid3dSpeed", min: "grid3dSpeedMin", max: "grid3dSpeedMax", hardMin: 1, hardMax: 120 },
      { slider: "grid3dMinSeg", min: "grid3dMinSegMin", max: "grid3dMinSegMax", hardMin: 1, hardMax: 8 },
      { slider: "grid3dMinBend", min: "grid3dMinBendMin", max: "grid3dMinBendMax", hardMin: 60, hardMax: 180 }
    ];

    function saveGridSliderBounds() {
      const stored = {};
      for (let i = 0; i < GRID_SLIDER_BOUNDS.length; i++) {
        const item = GRID_SLIDER_BOUNDS[i];
        const slider = document.getElementById(item.slider);
        if (!slider) continue;
        stored[item.slider] = { min: slider.min, max: slider.max };
      }
      try {
        localStorage.setItem("d7-grid3d-slider-bounds", JSON.stringify(stored));
      } catch (_) {
        /* ignore quota */
      }
    }

    function applyGridSliderBound(item, silent) {
      const slider = document.getElementById(item.slider);
      const minEl = document.getElementById(item.min);
      const maxEl = document.getElementById(item.max);
      if (!slider || !minEl || !maxEl) return;
      const prev = Number(slider.value);
      let min = Number(minEl.value);
      let max = Number(maxEl.value);
      if (!Number.isFinite(min)) min = Number(slider.min);
      if (!Number.isFinite(max)) max = Number(slider.max);
      min = Math.max(item.hardMin, min);
      max = Math.min(item.hardMax, max);
      if (max <= min) max = min + (Number(slider.step) || 0.05);
      minEl.value = String(min);
      maxEl.value = String(max);
      slider.min = String(min);
      slider.max = String(max);
      let value = Number(slider.value);
      if (value < min) value = min;
      if (value > max) value = max;
      slider.value = String(value);
      saveGridSliderBounds();
      if (value !== prev) slider.dispatchEvent(new Event("input", { bubbles: true }));
      if (!silent && value !== prev) slider.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function descCategory() {
      return String(els.descCat && els.descCat.value ? els.descCat.value : "workspace").toLowerCase();
    }

    function descWord() {
      return String(els.descWord && els.descWord.value ? els.descWord.value : "compressed").toLowerCase();
    }

    function descInfluence() {
      return clamp(Number(els.descInfl && els.descInfl.value != null ? els.descInfl.value : 65), 0, 100);
    }

    function fillDescriptorOptions() {
      if (!els.descWord || !global.D7DescriptorProfiles) return;
      const list = global.D7DescriptorProfiles.descriptorsFor(descCategory());
      const prev = els.descWord.value;
      els.descWord.innerHTML = "";
      for (let i = 0; i < list.length; i++) {
        const opt = document.createElement("option");
        opt.value = list[i].id;
        opt.textContent = list[i].label;
        els.descWord.appendChild(opt);
      }
      const keep = list.some((d) => d.id === prev);
      if (keep) els.descWord.value = prev;
      else if (descCategory() === "workspace" && list.some((d) => d.id === "compressed")) els.descWord.value = "compressed";
      else if (descCategory() === "lobby" && list.some((d) => d.id === "centralized")) els.descWord.value = "centralized";
      else if (descCategory() === "gathering" && list.some((d) => d.id === "terraced")) els.descWord.value = "terraced";
      else els.descWord.value = list[0] ? list[0].id : "";
    }

    function setDescStatus(msg, kind) {
      if (!els.descStatus) return;
      els.descStatus.textContent = msg;
      els.descStatus.classList.toggle("error", kind === "error");
      els.descStatus.classList.toggle("active", kind === "active");
    }

    function paintDescMode() {
      descModeOn = !!(els.descMode && els.descMode.checked);
      if (els.descTools) els.descTools.classList.toggle("hidden", !descModeOn);
      if (!descModeOn) {
        if (els.descOverlay) els.descOverlay.checked = false;
        applyDescOverlay();
      }
    }

    function currentDescViz() {
      if (!descAnalysis || !global.D7DescriptorProfiles) return null;
      return global.D7DescriptorProfiles.visualization(descAnalysis, descCategory(), descWord());
    }

    function applyDescOverlay() {
      if (!viewer || !viewer.setDescriptorOverlay) return;
      const on = descModeOn && !!(els.descOverlay && els.descOverlay.checked);
      viewer.setDescriptorOverlay(on ? currentDescViz() : null, on);
    }

    function paintDescDebug() {
      if (!els.descDebugPanel) return;
      const show = descModeOn && !!(els.descDebug && els.descDebug.checked);
      els.descDebugPanel.classList.toggle("hidden", !show);
      if (!show) return;
      const d = descAnalysis && descAnalysis.debug ? descAnalysis.debug : null;
      if (!d) {
        els.descDebugPanel.textContent = "Load a candidate to inspect metrics.";
        return;
      }
      const lines = [
        "Cluster Count: " + d.clusterCount,
        "Dominant Centrality: " + d.dominantCentrality,
        "Average Clearance: " + d.averageClearance,
        "Min Bottleneck Clearance: " + d.minBottleneckClearance,
        "Z Cluster Count: " + d.zClusterCount,
        "Vertical Span: " + d.verticalSpan,
        "Dead-End Ratio: " + d.deadEndRatio,
        "Void Ratio: " + d.voidRatio,
        "Path Continuity: " + d.pathContinuity,
        "Bottleneck Ratio: " + d.bottleneckRatio,
        "XY Overlap Across Z: " + d.xyOverlapAcrossZ,
      ];
      if (descLoaded && descLoaded.score != null) {
        lines.unshift("Overall Score: " + descLoaded.score);
        const parts = descLoaded.parts || [];
        for (let i = 0; i < parts.length; i++) lines.push(parts[i].label + ": " + parts[i].value);
      }
      els.descDebugPanel.textContent = lines.join("\n");
    }

    function packCandidateRecord(cand, extra) {
      const rec = Object.assign(
        {
          version: 1,
          category: cand.category,
          descriptor: cand.descriptor,
          descriptorLabel: cand.descriptorLabel,
          influence: cand.influence,
          seed: cand.seed,
          score: cand.score,
          parts: cand.parts,
          metrics: cand.metrics,
          clusters: cand.clusters,
          growthSnapshot: cand.growthSnapshot,
          thumb: cand.thumb || "",
        },
        extra || {}
      );
      return rec;
    }

    function paintDescCards() {
      if (!els.descCards) return;
      els.descCards.innerHTML = "";
      const top = descCandidates.slice(0, 6);
      for (let i = 0; i < top.length; i++) {
        const cand = top[i];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "grid3d-desc-card" + (cand.id === descSelectedId ? " active" : "");
        btn.dataset.id = cand.id;
        const canvas = document.createElement("canvas");
        canvas.width = 220;
        canvas.height = 96;
        if (global.D7DescriptorMetrics) {
          global.D7DescriptorMetrics.drawNetworkThumb(canvas, cand.growthSnapshot.nodes, cand.growthSnapshot.branches);
        }
        const title = document.createElement("strong");
        title.textContent = "Candidate " + String(i + 1).padStart(2, "0");
        const score = document.createElement("span");
        score.textContent = "Score: " + cand.score;
        btn.appendChild(canvas);
        btn.appendChild(title);
        btn.appendChild(score);
        btn.addEventListener("click", () => {
          descSelectedId = cand.id;
          paintDescCards();
          if (els.descLoad) els.descLoad.disabled = false;
          if (els.descSave) els.descSave.disabled = false;
          loadCandidateExact(cand);
        });
        els.descCards.appendChild(btn);
      }
      if (els.descLoad) els.descLoad.disabled = !descSelectedId;
      if (els.descSave) els.descSave.disabled = !(descSelectedId || descLoaded);
    }

    function selectedCandidate() {
      if (descLoaded && descLoaded.id === descSelectedId) return descLoaded;
      for (let i = 0; i < descCandidates.length; i++) if (descCandidates[i].id === descSelectedId) return descCandidates[i];
      return descLoaded;
    }

    function loadCandidateExact(cand) {
      if (!cand || !cand.growthSnapshot) return false;
      pauseGrowth();
      const ok = applyGrowthSnapshot(cand.growthSnapshot);
      if (!ok) return false;
      descLoaded = cand;
      descSelectedId = cand.id;
      descAnalysis = cand.metrics;
      if (els.showBranches) {
        els.showBranches.checked = true;
        if (viewer) viewer.setShowBranches(true);
      }
      syncViewer();
      paintStatus();
      paintButtons();
      paintDescCards();
      applyDescOverlay();
      paintDescDebug();
      const parts = (cand.parts || []).map((p) => p.label + " " + p.value).join(" · ");
      setDescStatus(
        (cand.descriptorLabel || cand.descriptor) + " · overall " + cand.score + (parts ? " · " + parts : "") + " · loaded exactly (not regenerated)",
        "active"
      );
      return true;
    }

    async function generateDescriptorCandidates() {
      if (descBusy) return;
      if (!sim.grid) {
        setDescStatus("SVG grid is not loaded yet.", "error");
        return;
      }
      if (!global.D7DescriptorProfiles || !global.D7DescriptorMetrics) {
        setDescStatus("Descriptor modules failed to load.", "error");
        return;
      }
      const count = clamp(Number(els.descCount && els.descCount.value ? els.descCount.value : 25), 10, 50);
      const category = descCategory();
      const word = descWord();
      const infl = descInfluence();
      const label = global.D7DescriptorProfiles.labelOf(category, word);
      descBusy = true;
      if (els.descGenerate) els.descGenerate.disabled = true;
      setDescStatus("Generating " + count + " " + label + " candidates…", "active");
      const base = hash32((sim.seed || 1) ^ hash32(category.length * 31 + word.length * 17 + Math.round(infl)));
      const batch = [];
      try {
        for (let i = 0; i < count; i++) {
          const seed = hash32(base + (i + 1) * 7919 + word.charCodeAt(0) * 13);
          const rng = mulberry32(seed);
          const bias = global.D7DescriptorProfiles.buildBias(category, word, infl, rng);
          const snap = runHeadless(sim.grid, {
            seed,
            bias,
            influence: Number(els.influence && els.influence.value != null ? els.influence.value : DEFAULT_INFLUENCE),
            kill: Number(els.kill && els.kill.value != null ? els.kill.value : DEFAULT_KILL),
            attractorCount: Number(els.attractorCount && els.attractorCount.value != null ? els.attractorCount.value : DEFAULT_ATTRACTORS),
            connectNetworks: !!(els.connectNetworks && els.connectNetworks.checked),
            connectDistance: clamp(Number(els.connectDist && els.connectDist.value != null ? els.connectDist.value : DEFAULT_CONNECT_DIST), 0.25, 4),
            connectBias: clamp(Number(els.connectBias && els.connectBias.value != null ? els.connectBias.value : DEFAULT_CONNECT_BIAS), 0, 100),
            minSegmentLength: resolveMinSegmentLength(els.minSeg && els.minSeg.value != null ? els.minSeg.value : sim.minSegmentLength),
            minBendAngle: resolveMinBendAngle(els.minBend && els.minBend.value != null ? els.minBend.value : sim.minBendAngle),
            maxSteps: 560,
          });
          const metrics = global.D7DescriptorMetrics.analyze(snap);
          const scored = global.D7DescriptorProfiles.score(metrics, category, word);
          batch.push({
            id: "cand-" + String(i + 1).padStart(2, "0") + "-" + seed.toString(16),
            index: i,
            category,
            descriptor: word,
            descriptorLabel: label,
            influence: infl,
            seed,
            score: scored.overall,
            parts: scored.parts,
            metrics,
            clusters: metrics.clusters || [],
            growthSnapshot: snap,
          });
          if (i % 2 === 1) {
            setDescStatus("Generating " + (i + 1) + " / " + count + "…", "active");
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        batch.sort((a, b) => b.score - a.score || a.seed - b.seed);
        descCandidates = batch;
        descSelectedId = batch[0] ? batch[0].id : null;
        descLoaded = null;
        descAnalysis = batch[0] ? batch[0].metrics : null;
        paintDescCards();
        paintDescDebug();
        const top = batch.slice(0, 3).map((c, i) => String(i + 1).padStart(2, "0") + "=" + c.score);
        setDescStatus("Top " + Math.min(6, batch.length) + " of " + count + " · " + top.join(" · ") + ". Select one and Load Candidate.", "active");
      } catch (err) {
        setDescStatus("Candidate generation failed.", "error");
      } finally {
        descBusy = false;
        if (els.descGenerate) els.descGenerate.disabled = false;
      }
    }

    async function saveSelectedCandidate() {
      const cand = selectedCandidate();
      if (!cand || !global.D7SavedDescriptorCandidates) return;
      try {
        const rec = packCandidateRecord(cand, {
          id: global.D7SavedDescriptorCandidates.createId(),
          name: (cand.descriptorLabel || cand.descriptor) + " " + cand.score,
        });
        await global.D7SavedDescriptorCandidates.put(rec);
        await refreshSavedDescList();
        setDescStatus("Saved " + rec.name + ".", "active");
      } catch (_) {
        setDescStatus("Could not save candidate.", "error");
      }
    }

    async function refreshSavedDescList() {
      if (!els.descSavedList || !global.D7SavedDescriptorCandidates) return;
      let records = [];
      try {
        records = await global.D7SavedDescriptorCandidates.list();
      } catch (_) {
        records = [];
      }
      els.descSavedList.innerHTML = "";
      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = (rec.name || rec.descriptorLabel || "Candidate") + " · " + rec.score;
        const row = document.createElement("div");
        row.className = "row";
        const loadBtn = document.createElement("button");
        loadBtn.type = "button";
        loadBtn.className = "ghost";
        loadBtn.textContent = "Load";
        loadBtn.addEventListener("click", () => loadCandidateExact(rec));
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "ghost";
        delBtn.textContent = "Delete";
        delBtn.addEventListener("click", async () => {
          await global.D7SavedDescriptorCandidates.remove(rec.id);
          refreshSavedDescList();
        });
        row.appendChild(loadBtn);
        row.appendChild(delBtn);
        li.appendChild(name);
        li.appendChild(row);
        els.descSavedList.appendChild(li);
      }
    }

    function bindDescriptorUi() {
      fillDescriptorOptions();
      if (els.descInflVal) els.descInflVal.textContent = String(descInfluence());
      paintDescMode();
      if (els.descMode) els.descMode.addEventListener("change", paintDescMode);
      if (els.descCat) {
        els.descCat.addEventListener("change", () => {
          fillDescriptorOptions();
        });
      }
      if (els.descInfl) {
        els.descInfl.addEventListener("input", () => {
          if (els.descInflVal) els.descInflVal.textContent = String(descInfluence());
        });
      }
      if (els.descGenerate) els.descGenerate.addEventListener("click", () => generateDescriptorCandidates());
      if (els.descLoad) els.descLoad.addEventListener("click", () => loadCandidateExact(selectedCandidate()));
      if (els.descSave) els.descSave.addEventListener("click", () => saveSelectedCandidate());
      if (els.descOverlay) els.descOverlay.addEventListener("change", applyDescOverlay);
      if (els.descDebug) els.descDebug.addEventListener("change", paintDescDebug);
      refreshSavedDescList();
    }

    function initGridSliderBounds() {
      let stored = {};
      try {
        stored = JSON.parse(localStorage.getItem("d7-grid3d-slider-bounds") || "{}");
      } catch (_) {
        stored = {};
      }
      for (let i = 0; i < GRID_SLIDER_BOUNDS.length; i++) {
        const item = GRID_SLIDER_BOUNDS[i];
        const slider = document.getElementById(item.slider);
        const minEl = document.getElementById(item.min);
        const maxEl = document.getElementById(item.max);
        if (!slider || !minEl || !maxEl) continue;
        const saved = stored[item.slider];
        if (saved) {
          minEl.value = saved.min;
          maxEl.value = saved.max;
        } else {
          minEl.value = slider.min;
          maxEl.value = slider.max;
        }
        applyGridSliderBound(item, true);
        minEl.addEventListener("change", () => applyGridSliderBound(item, false));
        maxEl.addEventListener("change", () => applyGridSliderBound(item, false));
      }
    }

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
    if (els.showRoots) {
      els.showRoots.addEventListener("change", () => {
        if (viewer && viewer.setShowRoots) viewer.setShowRoots(els.showRoots.checked);
        updateRootGizmo();
      });
    }
    if (els.showBranches) {
      els.showBranches.addEventListener("change", () => {
        if (viewer) viewer.setShowBranches(els.showBranches.checked);
      });
    }
    if (els.showSelBox) {
      els.showSelBox.addEventListener("change", () => {
        if (viewer) viewer.setShowSelectionBox(els.showSelBox.checked);
      });
    }
    if (els.showHumanScale) {
      els.showHumanScale.addEventListener("change", () => {
        if (viewer && viewer.setShowHumanScale) viewer.setShowHumanScale(els.showHumanScale.checked);
        markIterationDirty();
      });
    }
    if (els.hideOutside) {
      els.hideOutside.addEventListener("change", () => {
        if (viewer && viewer.setHideOutsideSelection) viewer.setHideOutsideSelection(els.hideOutside.checked);
      });
    }
    if (els.boxMove) {
      els.boxMove.addEventListener("click", () => setBoxMode("translate"));
    }
    if (els.boxScale) {
      els.boxScale.addEventListener("click", () => setBoxMode("scale"));
    }

    async function exportBranches() {
      const lib = global.D7SpatialExport;
      if (!lib || !lib.exportGridBranches3dm) {
        setSpaceStatus("Exporter did not load.", "error");
        return;
      }
      ensureViewer();
      const clipped = currentClippedGraph();
      if (!clipped.segs.length) {
        setSpaceStatus("No branches inside the cyan box. Grow inside the module, or move the box.", "error");
        return;
      }
      const display = viewer && viewer.captureDisplayGeometry ? viewer.captureDisplayGeometry() : null;
      const payload = {
        sourceBranches: clipped.segs,
        guides: clipped.segs,
        roots: display && display.roots ? display.roots : captureRootsCanonical(),
        box: viewer && viewer.getSelectionBox ? viewer.getSelectionBox() : clipped.box,
      };
      try {
        setSpaceStatus("Writing Rhino 3DM…");
        const out = await lib.exportGridBranches3dm(payload, "D7_Grid_Branches.3dm");
        setSpaceStatus(
          "Exported " +
            ((out && out.filename) || "D7_Grid_Branches.3dm") +
            " · Feet · SOURCE_BRANCHES · SELECTION_BOX · ROOT_POINTS" +
            (out && out.branchCount ? " · " + out.branchCount + " branches" : "") +
            (out && out.rootCount ? " · " + out.rootCount + " roots" : ""),
          "active"
        );
      } catch (err) {
        setSpaceStatus("Export failed: " + (err && err.message ? err.message : String(err)), "error");
      }
    }
    if (els.sendPlank) els.sendPlank.addEventListener("click", () => { sendToPlankBuilder(); });
    if (els.exportBranches) els.exportBranches.addEventListener("click", () => { exportBranches(); });
    if (els.exportBranchesSvg) {
      els.exportBranchesSvg.addEventListener("click", () => {
        const lib = global.D7SpatialExport;
        if (!lib || !lib.exportClippedBranchesSvg) {
          setSpaceStatus("SVG export is not available.", "error");
          return;
        }
        ensureViewer();
        const clipped = currentClippedGraph();
        if (!clipped.segs.length) {
          setSpaceStatus("No branches inside the cyan box. Grow inside the module, or move the box.", "error");
          return;
        }
        try {
          const view = viewer && viewer.getViewMode ? viewer.getViewMode() : "front";
          const viewName = view === "perspective" ? "ISO" : String(view).toUpperCase();
          const filename = "D7_Grid_Branches_" + viewName + ".svg";
          const out = lib.exportClippedBranchesSvg(clipped, filename, { view });
          setSpaceStatus(
            "Exported " +
              (out && out.filename ? out.filename : filename) +
              " · " +
              clipped.segs.length +
              " segments · 1 unit = 1 foot · view " +
              (out && out.view ? out.view : view),
            "active"
          );
        } catch (err) {
          setSpaceStatus("SVG export failed: " + (err && err.message ? err.message : String(err)), "error");
        }
      });
    }

    if (els.saveIter) {
      els.saveIter.addEventListener("click", () => {
        const store = savedIterStore();
        if (!store) {
          setSavedIterStatus("Saved Iterations need IndexedDB in this browser.", "error");
          return;
        }
        openSaveIterPanel("create", store.nextDefaultName(savedIterRecords));
      });
    }
    if (els.saveIterUpdate) {
      els.saveIterUpdate.addEventListener("click", () => {
        overwriteOpenedIteration().catch((err) => {
          setSavedIterStatus(err && err.message ? err.message : "Could not save changes.", "error");
        });
      });
    }
    if (els.saveIterAs) {
      els.saveIterAs.addEventListener("click", () => {
        const store = savedIterStore();
        if (!store) return;
        openSaveIterPanel("create", store.nextDefaultName(savedIterRecords));
      });
    }
    if (els.saveIterCancel) els.saveIterCancel.addEventListener("click", closeSaveIterPanel);
    if (els.saveIterConfirm) {
      els.saveIterConfirm.addEventListener("click", () => {
        const name = els.saveIterName ? els.saveIterName.value.trim() : "";
        const store = savedIterStore();
        if (!store) return;
        const finish = async () => {
          if (saveIterMode === "rename" && renameIterId) {
            await renameSavedIteration(renameIterId, name || "Iteration");
          } else {
            await createSavedIteration(name || store.nextDefaultName(savedIterRecords));
          }
          closeSaveIterPanel();
        };
        finish().catch((err) => {
          setSavedIterStatus(err && err.message ? err.message : "Could not save iteration.", "error");
        });
      });
    }
    if (els.saveIterName) {
      els.saveIterName.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (els.saveIterConfirm) els.saveIterConfirm.click();
        } else if (event.key === "Escape") {
          closeSaveIterPanel();
        }
      });
    }
    if (els.deleteIterCancel) els.deleteIterCancel.addEventListener("click", closeDeleteIterDialog);
    if (els.deleteIterConfirm) {
      els.deleteIterConfirm.addEventListener("click", () => {
        const id = pendingDeleteIterId;
        closeDeleteIterDialog();
        if (!id) return;
        deleteSavedIteration(id).catch((err) => {
          setSavedIterStatus(err && err.message ? err.message : "Could not delete iteration.", "error");
        });
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
        if (editMode === "place") {
          setEditMode("idle");
          setStatus("Root placement off.");
          return;
        }
        setEditMode("place");
        setStatus("Click a snap point on the 3D grid to add a root. Esc cancel.", "active");
      });
    }
    if (els.moveRoot) {
      els.moveRoot.addEventListener("click", () => {
        if (!sim.grid) {
          setStatus(gridError || "SVG grid is not loaded.", "error");
          return;
        }
        if (editMode === "move") {
          setEditMode("idle");
          return;
        }
        if (!selectedPlacement()) {
          setStatus("Select a root, then click Move Root — or click a yellow root in the viewport.", "error");
          return;
        }
        setEditMode("move");
        setStatus("Drag the gizmo in X, Y, and Z. The root snaps to the nearest grid node.", "active");
      });
    }
    if (els.deleteRoot) {
      els.deleteRoot.addEventListener("click", () => {
        if (!selectedRootId) return;
        removeSelectedRoot();
      });
    }
    function onRootCoordinateChange() {
      if (applyingFields) return;
      if (!selectedPlacement()) return;
      const p = readRootFields();
      const moved = moveSelectedTo(p.x, p.y, p.z);
      paintRoots();
      syncViewer();
      paintStatus();
      if (moved) {
        setStatus(
          networkOutdated
            ? "Root moved. Previous branch network is outdated. Attractors kept. Start to grow from the new roots."
            : "Root R" +
                moved.rootIndex +
                " · " +
                moved.x.toFixed(1) +
                ", " +
                moved.y.toFixed(1) +
                ", " +
                moved.z.toFixed(1),
          "active"
        );
      }
    }
    [els.rootX, els.rootY, els.rootZ].forEach((input) => {
      if (!input) return;
      input.addEventListener("change", onRootCoordinateChange);
    });
    function isTextField(el) {
      if (!el || el === document.body || el === document.documentElement) return false;
      if (el.isContentEditable) return true;
      const tag = String(el.tagName || "").toLowerCase();
      if (tag === "textarea" || tag === "select") return true;
      if (tag !== "input") return false;
      const type = String(el.type || "text").toLowerCase();
      return (
        type === "text" ||
        type === "number" ||
        type === "search" ||
        type === "password" ||
        type === "email" ||
        type === "url" ||
        type === ""
      );
    }

    window.addEventListener(
      "keydown",
      (event) => {
        const view = document.getElementById("grid3dView");
        if (!view || view.classList.contains("hidden")) return;
        if (event.key === "Escape") {
          if (editMode !== "idle") {
            setEditMode("idle");
            setStatus("Root editing off.");
            event.preventDefault();
          }
          return;
        }
        const typing = isTextField(event.target) || isTextField(document.activeElement);
        const wantDelete =
          event.key === "Delete" || event.key === "Del" || event.code === "Delete";
        if (wantDelete && !typing && selectedRootId) {
          event.preventDefault();
          event.stopPropagation();
          removeSelectedRoot();
        }
      },
      true
    );
    if (els.start) els.start.addEventListener("click", startGrowth);
    if (els.pause) els.pause.addEventListener("click", pauseGrowth);
    if (els.reset) {
      els.reset.addEventListener("click", () => {
        pauseGrowth();
        applyPlacementsToSim();
        selectedRootId = rootPlacements[0] ? rootPlacements[0].uid : null;
        if (selectedRootId) writeRootFields(selectedPlacement());
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
        applyPlacementsToSim();
        generateAttractors(sim);
        selectedRootId = rootPlacements[0] ? rootPlacements[0].uid : null;
        if (selectedRootId) writeRootFields(selectedPlacement());
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
    if (els.connectNetworks) {
      els.connectNetworks.addEventListener("change", () => {
        readParamsIntoSim();
        paintConnectControls();
      });
    }
    if (els.connectDist) {
      els.connectDist.addEventListener("input", () => {
        sim.connectDistance = clamp(Number(els.connectDist.value), 0.25, 4);
      });
    }
    if (els.connectBias) {
      els.connectBias.addEventListener("input", () => {
        sim.connectBias = clamp(Number(els.connectBias.value), 0, 100);
      });
    }
    initGridSliderBounds();

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
    bindDescriptorUi();
    loadDefaultGrid();
    refreshSavedIterList();

    function applyGrowthSnapshot(data) {
      if (!data || !sim.grid) return false;
      pauseGrowth();
      if (data.seed) sim.seed = data.seed >>> 0;
      if (data.attractorCount != null) sim.attractorTarget = data.attractorCount;
      if (data.influence != null) sim.influence = data.influence;
      if (data.kill != null) sim.kill = data.kill;
      sim.connectNetworks = data.connectNetworks != null ? !!data.connectNetworks : sim.connectNetworks;
      sim.connectDistance =
        data.connectDistance != null ? clamp(Number(data.connectDistance), 0.25, 4) : sim.connectDistance;
      sim.connectBias =
        data.connectBias != null ? clamp(Number(data.connectBias), 0, 100) : sim.connectBias;
      writeMinSegToHud(data.minimumSegmentLength ?? data.minSegmentLength);
      writeMinBendToHud(data.minimumBendAngle ?? data.minBendAngle);
      writeConnectToHud({
        connectNetworks: sim.connectNetworks,
        connectDistance: sim.connectDistance,
        connectBias: sim.connectBias,
      });
      if (data.nodes && data.nodes.length && data.branches) {
        restoreGraph(sim, data);
        const rootSrc = data.roots || [];
        for (let i = 0; i < sim.roots.length && i < rootSrc.length; i++) {
          const n = sim.nodeById.get(sim.roots[i]);
          if (n && rootSrc[i].uid != null) n.uid = rootSrc[i].uid;
        }
        syncPlacementsFromSim();
      } else if (data.roots && data.roots.length) {
        resetGrowth(sim, data.roots);
        for (let i = 0; i < sim.roots.length && i < data.roots.length; i++) {
          const n = sim.nodeById.get(sim.roots[i]);
          if (n && data.roots[i].uid != null) n.uid = data.roots[i].uid;
        }
        syncPlacementsFromSim();
      }
      if (data.attractors && data.attractors.length) {
        sim.attractors = data.attractors.map((a) => ({ x: a.x, y: a.y, z: a.z, gridId: a.gridId }));
        sim.alive = data.attractors.map((a) => (a.alive === false ? 0 : 1));
      }
      networkOutdated = false;
      selectedRootId = rootPlacements[0] ? rootPlacements[0].uid : null;
      if (selectedRootId) writeRootFields(selectedPlacement());
      paintRoots();
      return true;
    }

    const api = {
      show() {
        const v = ensureViewer();
        if (!v) return;
        v.start();
        v.resize();
        if (sim.grid) v.setGrid(sim.grid);
        if (els.showH) v.setShowHorizontal(els.showH.checked);
        if (els.showV) v.setShowVertical(els.showV.checked);
        if (els.showAttractors) v.setShowAttractors(els.showAttractors.checked);
        if (els.showRoots && v.setShowRoots) v.setShowRoots(els.showRoots.checked);
        if (els.showBranches) v.setShowBranches(els.showBranches.checked);
        if (els.showSelBox && v.setShowSelectionBox) v.setShowSelectionBox(els.showSelBox.checked);
        if (els.showHumanScale && v.setShowHumanScale) v.setShowHumanScale(els.showHumanScale.checked);
        if (els.hideOutside && v.setHideOutsideSelection) v.setHideOutsideSelection(els.hideOutside.checked);
        v.setBoxGizmoLocked(editMode !== "idle");
        updateRootGizmo();
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
        sim.rootDrafts = rootPlacements;
        return snapshot(sim);
      },
      applySnapshot(data) {
        const ok = applyGrowthSnapshot(data);
        if (!ok) return false;
        syncViewer();
        paintStatus();
        paintButtons();
        return true;
      },
      getConnectedNetworks() {
        return connectedNetworkSummary(sim);
      },
      getConnectState() {
        return {
          connectNetworks: !!sim.connectNetworks,
          connectDistance: sim.connectDistance,
          connectBias: sim.connectBias,
          networks: connectedNetworkSummary(sim),
          roots: sim.roots.map((id) => {
            const n = sim.nodeById.get(id);
            return n
              ? {
                  id: n.id,
                  rootIndex: n.rootIndex,
                  originRootIndex: n.originRootIndex,
                  networkId: findNetwork(sim, n.networkId),
                }
              : null;
          }),
        };
      },
      getCanonicalState() {
        return captureWorkingSnapshot();
      },
      getGeometryHash() {
        const snap = captureWorkingSnapshot();
        return snap && snap.geometryStateHash ? snap.geometryStateHash : "";
      },
      compareGeometryHash(savedHash) {
        const live = captureWorkingSnapshot();
        const viewport = live.geometryStateHash || "";
        const saved = String(savedHash || live.geometryStateHash || "");
        return { viewport, saved, match: !!(viewport && saved && viewport === saved) };
      },
      getHumanScaleState() {
        return viewer && viewer.getHumanScaleState ? viewer.getHumanScaleState() : null;
      },
      validateHumanScale() {
        return viewer && viewer.validateHumanScale ? viewer.validateHumanScale() : null;
      },
      getSelectionBox() {
        return viewer && viewer.getSelectionBox ? viewer.getSelectionBox() : null;
      },
      getPlankNetwork() {
        return capturePlankNetwork();
      },
      sendToPlankBuilder,
      growSteps(n) {
        if (!sim.grid) return 0;
        readParamsIntoSim();
        if (networkOutdated) applyPlacementsToSim();
        if (!sim.roots.length) {
          if (rootPlacements.length) applyPlacementsToSim();
          else {
            ensureDefaultRoot(sim);
            syncPlacementsFromSim();
          }
        }
        if (!sim.attractors.length) generateAttractors(sim);
        const max = Math.max(1, Math.min(400, n || 120));
        let steps = 0;
        for (let i = 0; i < max; i++) {
          if (!growStep(sim)) break;
          steps += 1;
        }
        syncViewer();
        paintStatus();
        paintButtons();
        return steps;
      },
    };
    global.D7GridGrowth.instance = api;
    return api;
  }

  global.D7GridGrowth = {
    CUBE,
    mount,
    snapshot,
    connectedNetworkSummary,
    buildGridFromSvg,
    runHeadless,
  };
})(window);

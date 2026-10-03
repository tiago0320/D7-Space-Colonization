/**
 * Shared custom reference grid: import SVG/PNG/JPG, build graph, extrude to 3D, persist default.
 * Planar pattern fits 20' × 20' in X–Z; Y is vertical. 1 unit = 1 foot.
 */
(function (global) {
  const CUBE = 20;
  const MERGE_EPS = 0.08;
  const MAX_SEGMENTS = 8000;
  const MAX_RASTER_DIM = 720;
  const NODE_STEP = 0.5;

  const listeners = new Set();
  let showGrid = true;
  let active = null;
  let pending = null;
  let revision = 0;

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function dist2(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  function mergeKey(x, z) {
    const qx = Math.round(x / MERGE_EPS);
    const qz = Math.round(z / MERGE_EPS);
    return qx + "," + qz;
  }

  function notify() {
    listeners.forEach((fn) => {
      try {
        fn(getState());
      } catch (e) {
        console.warn("D7CustomGrid listener", e);
      }
    });
  }

  function getState() {
    return {
      mode: active ? "custom" : "builtin",
      showGrid,
      active,
      pending,
    };
  }

  function dedupeSegments(segments) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < segments.length && out.length < MAX_SEGMENTS; i++) {
      const s = segments[i];
      let x1 = s.x1;
      let z1 = s.z1;
      let x2 = s.x2;
      let z2 = s.z2;
      if (dist2(x1, z1, x2, z2) < 1e-8) continue;
      if (dist2(x1, z1, x2, z2) < dist2(x2, z2, x1, z1)) {
        const tx = x1;
        const tz = z1;
        x1 = x2;
        z1 = z2;
        x2 = tx;
        z2 = tz;
      }
      const key =
        x1.toFixed(4) +
        "," +
        z1.toFixed(4) +
        "|" +
        x2.toFixed(4) +
        "," +
        z2.toFixed(4);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x1, z1, x2, z2 });
    }
    return out;
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

  function pointOnSegment(px, pz, s) {
    const dx = s.x2 - s.x1;
    const dz = s.z2 - s.z1;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-12) return dist2(px, pz, s.x1, s.z1) < MERGE_EPS * MERGE_EPS;
    const t = ((px - s.x1) * dx + (pz - s.z1) * dz) / len2;
    if (t < -0.02 || t > 1.02) return false;
    const qx = s.x1 + t * dx;
    const qz = s.z1 + t * dz;
    return dist2(px, pz, qx, qz) <= MERGE_EPS * MERGE_EPS * 4;
  }

  function splitSegmentsAtIntersections(segments) {
    const n = segments.length;
    if (!n) return [];
    const ts = new Array(n);
    for (let i = 0; i < n; i++) ts[i] = [0, 1];
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
      const ek = a < b ? a + "|" + b : b + "|" + a;
      if (edgeSet.has(ek)) continue;
      edgeSet.add(ek);
      edges.push({ from: a, to: b });
    }
    return { nodes, edges };
  }

  function subdividePlanar(nodes, edges, step) {
    const spacing = Math.max(0.35, Number(step) || NODE_STEP);
    const outNodes = nodes.map((n, i) => ({ id: i, x: n.x, z: n.z }));
    const outEdges = [];
    const edgeSet = new Set();
    function addEdge(a, b) {
      if (a === b) return;
      const ek = a < b ? a + "|" + b : b + "|" + a;
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

  function planarDegrees(nodeCount, edges) {
    const deg = new Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) deg[i] = 0;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (e.from >= 0 && e.from < nodeCount) deg[e.from] += 1;
      if (e.to >= 0 && e.to < nodeCount) deg[e.to] += 1;
    }
    return deg;
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
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (e.from < 0 || e.to < 0 || e.from >= nodeCount || e.to >= nodeCount) continue;
      const a = find(e.from);
      const b = find(e.to);
      if (a !== b) parent[a] = b;
    }
    const roots = new Set();
    let isolated = 0;
    const deg = planarDegrees(nodeCount, edges);
    for (let i = 0; i < nodeCount; i++) {
      if (deg[i] === 0) {
        isolated += 1;
        continue;
      }
      roots.add(find(i));
    }
    return Math.max(0, roots.size);
  }

  function fitPlanarToWorkspace(nodes) {
    if (!nodes.length) return { nodes: [], transform: { scale: 1, ox: 0, oz: 0 } };
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minZ = Math.min(minZ, n.z);
      maxZ = Math.max(maxZ, n.z);
    }
    const w = Math.max(1e-6, maxX - minX);
    const h = Math.max(1e-6, maxZ - minZ);
    const scale = Math.min(CUBE / w, CUBE / h);
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const ox = CUBE * 0.5 - cx * scale;
    const oz = CUBE * 0.5 - cz * scale;
    const fitted = nodes.map((n) => ({
      id: n.id,
      x: clamp(n.x * scale + ox, 0, CUBE),
      z: clamp(n.z * scale + oz, 0, CUBE),
    }));
    return {
      nodes: fitted,
      transform: { scale, ox, oz, sourceW: w, sourceH: h },
    };
  }

  function extrudeTo3D(planar, verticalSpacing) {
    const vSpace = Math.max(0.25, Number(verticalSpacing) || 1);
    const layers = [];
    for (let y = 0; y <= CUBE + 1e-6; y += vSpace) layers.push(Math.min(CUBE, y));
    const last = layers[layers.length - 1];
    if (last < CUBE - 1e-6) layers.push(CUBE);

    const planarNodes = planar.nodes;
    const planarEdges = planar.edges;
    const nodes = [];
    const edges = [];
    const layerNodeIds = [];
    const byPlanar = [];

    for (let li = 0; li < layers.length; li++) {
      const y = layers[li];
      const row = [];
      for (let pi = 0; pi < planarNodes.length; pi++) {
        const p = planarNodes[pi];
        const id = nodes.length;
        nodes.push({ id, x: p.x, y, z: p.z, layer: li, planarId: pi });
        row.push(id);
      }
      layerNodeIds.push(row);
    }

    for (let li = 0; li < layers.length; li++) {
      for (let ei = 0; ei < planarEdges.length; ei++) {
        const e = planarEdges[ei];
        const a = layerNodeIds[li][e.from];
        const b = layerNodeIds[li][e.to];
        if (a == null || b == null) continue;
        edges.push({ from: a, to: b });
      }
    }
    for (let li = 0; li < layers.length - 1; li++) {
      for (let pi = 0; pi < planarNodes.length; pi++) {
        const a = layerNodeIds[li][pi];
        const b = layerNodeIds[li + 1][pi];
        edges.push({ from: a, to: b });
      }
    }

    const adj = new Map();
    for (let i = 0; i < nodes.length; i++) adj.set(i, []);
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      adj.get(e.from).push(e.to);
      adj.get(e.to).push(e.from);
    }
    for (const [id, list] of adj) {
      adj.set(id, Array.from(new Set(list)));
    }

    return {
      nodes,
      edges,
      adj,
      verticalSpacing: vSpace,
      layerCount: layers.length,
      planarNodeCount: planarNodes.length,
    };
  }

  function parseSvgSegments(text) {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg) throw new Error("SVG has no root element.");
    const holder = document.createElement("div");
    holder.style.cssText = "position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;";
    const clone = svg.cloneNode(true);
    if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    holder.appendChild(clone);
    document.body.appendChild(holder);
    const segs = [];
    try {
      const vb = clone.viewBox && clone.viewBox.baseVal;
      let w = parseFloat(clone.getAttribute("width")) || (vb ? vb.width : 100);
      let h = parseFloat(clone.getAttribute("height")) || (vb ? vb.height : 100);
      if (vb && vb.width > 0 && vb.height > 0) {
        w = vb.width;
        h = vb.height;
        clone.setAttribute("width", String(w));
        clone.setAttribute("height", String(h));
      }

      function xform(el, x, y) {
        const ctm = el.getCTM && el.getCTM();
        if (!ctm) return { x, y };
        return { x: ctm.a * x + ctm.c * y + ctm.e, y: ctm.b * x + ctm.d * y + ctm.f };
      }

      function pushPts(el, x1, y1, x2, y2) {
        const a = xform(el, x1, y1);
        const b = xform(el, x2, y2);
        if (dist2(a.x, a.y, b.x, b.y) < 1e-8) return;
        segs.push({ x1: a.x, z1: a.y, x2: b.x, z2: b.y });
      }

      clone.querySelectorAll("line").forEach((el) => {
        pushPts(
          el,
          parseFloat(el.getAttribute("x1")) || 0,
          parseFloat(el.getAttribute("y1")) || 0,
          parseFloat(el.getAttribute("x2")) || 0,
          parseFloat(el.getAttribute("y2")) || 0
        );
      });
      clone.querySelectorAll("rect").forEach((el) => {
        const x = parseFloat(el.getAttribute("x")) || 0;
        const y = parseFloat(el.getAttribute("y")) || 0;
        const rw = parseFloat(el.getAttribute("width")) || 0;
        const rh = parseFloat(el.getAttribute("height")) || 0;
        if (rw <= 0 || rh <= 0) return;
        pushPts(el, x, y, x + rw, y);
        pushPts(el, x + rw, y, x + rw, y + rh);
        pushPts(el, x + rw, y + rh, x, y + rh);
        pushPts(el, x, y + rh, x, y);
      });
      clone.querySelectorAll("polyline, polygon").forEach((el) => {
        const pts = (el.getAttribute("points") || "")
          .trim()
          .split(/[\s,]+/)
          .map(Number)
          .filter((n) => !Number.isNaN(n));
        for (let i = 0; i + 3 < pts.length; i += 2) {
          pushPts(el, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
        }
        if (el.tagName.toLowerCase() === "polygon" && pts.length >= 4) {
          pushPts(el, pts[pts.length - 2], pts[pts.length - 1], pts[0], pts[1]);
        }
      });
      clone.querySelectorAll("path").forEach((el) => {
        const d = el.getAttribute("d");
        if (!d || !el.getTotalLength || !el.getPointAtLength) return;
        try {
          const len = el.getTotalLength();
          if (!(len > 0)) return;
          const steps = clamp(Math.ceil(len / 3), 12, 240);
          let prev = null;
          for (let i = 0; i <= steps; i++) {
            const pt = el.getPointAtLength((i / steps) * len);
            const p = xform(el, pt.x, pt.y);
            if (prev) segs.push({ x1: prev.x, z1: prev.y, x2: p.x, z2: p.y });
            prev = p;
          }
        } catch (e) {
          /* skip bad path */
        }
      });
      return { segments: dedupeSegments(segs), sourceWidth: w, sourceHeight: h };
    } finally {
      document.body.removeChild(holder);
    }
  }

  function extractLuminance(imageData, width, height) {
    const data = imageData.data;
    const lum = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const a = data[i + 3] / 255;
      const raw = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      lum[p] = clamp(Math.round(raw * a + 255 * (1 - a)), 0, 255);
    }
    return lum;
  }

  function otsuThreshold(lum) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < lum.length; i++) hist[lum[i]] += 1;
    const total = lum.length;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0;
    let wB = 0;
    let max = 0;
    let thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > max) {
        max = between;
        thr = t;
      }
    }
    return clamp(thr, 8, 247);
  }

  function binarizeLines(lum, width, height, threshold, invert) {
    const out = new Uint8Array(width * height);
    const thr = clamp(Number(threshold) || 128, 1, 254);
    for (let i = 0; i < lum.length; i++) {
      const isDark = lum[i] < thr;
      out[i] = invert ? (isDark ? 0 : 1) : isDark ? 1 : 0;
    }
    return out;
  }

  function fillRatio(mask) {
    let n = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) n += 1;
    return n / Math.max(1, mask.length);
  }

  function removeSmallBlobs(mask, width, height, minSize) {
    const seen = new Uint8Array(mask.length);
    const out = new Uint8Array(mask.length);
    const stack = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || seen[i]) continue;
      stack.length = 0;
      stack.push(i);
      seen[i] = 1;
      const blob = [i];
      while (stack.length) {
        const p = stack.pop();
        const x = p % width;
        const y = (p / width) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = ny * width + nx;
            if (!mask[ni] || seen[ni]) continue;
            seen[ni] = 1;
            stack.push(ni);
            blob.push(ni);
          }
        }
      }
      if (blob.length >= minSize) {
        for (let b = 0; b < blob.length; b++) out[blob[b]] = 1;
      }
    }
    return out;
  }

  function sobelEdges(lum, width, height, magScale) {
    const out = new Uint8Array(width * height);
    const scale = magScale != null ? magScale : 48;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const a = lum[i - width - 1];
        const b = lum[i - width];
        const c = lum[i - width + 1];
        const d = lum[i - 1];
        const f = lum[i + 1];
        const g = lum[i + width - 1];
        const h = lum[i + width];
        const j = lum[i + width + 1];
        const gx = -a + c - 2 * d + 2 * f - g + j;
        const gy = -a - 2 * b - c + g + 2 * h + j;
        out[i] = Math.abs(gx) + Math.abs(gy) >= scale ? 1 : 0;
      }
    }
    return out;
  }

  function zhangSuenThin(mask, width, height) {
    const A = mask;
    function pix(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return 0;
      return A[y * width + x];
    }
    let changed = true;
    let guard = 0;
    while (changed && guard < 64) {
      changed = false;
      guard += 1;
      for (let step = 0; step < 2; step++) {
        const del = [];
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const i = y * width + x;
            if (!A[i]) continue;
            const p2 = pix(x, y - 1);
            const p3 = pix(x + 1, y - 1);
            const p4 = pix(x + 1, y);
            const p5 = pix(x + 1, y + 1);
            const p6 = pix(x, y + 1);
            const p7 = pix(x - 1, y + 1);
            const p8 = pix(x - 1, y);
            const p9 = pix(x - 1, y - 1);
            const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if (B < 2 || B > 6) continue;
            const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
            let trans = 0;
            for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) trans += 1;
            if (trans !== 1) continue;
            if (step === 0) {
              if (p2 * p4 * p6 !== 0) continue;
              if (p4 * p6 * p8 !== 0) continue;
            } else {
              if (p2 * p4 * p8 !== 0) continue;
              if (p2 * p6 * p8 !== 0) continue;
            }
            del.push(i);
          }
        }
        if (del.length) changed = true;
        for (let d = 0; d < del.length; d++) A[del[d]] = 0;
      }
    }
    return A;
  }

  function neighbors8(x, y, width, height, mask) {
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (mask[ny * width + nx]) out.push(nx, ny);
      }
    }
    return out;
  }

  function degree8(x, y, width, height, mask) {
    return neighbors8(x, y, width, height, mask).length / 2;
  }

  function rdpSimplify(points, eps) {
    if (points.length < 3) return points;
    const x1 = points[0];
    const y1 = points[1];
    const x2 = points[points.length - 2];
    const y2 = points[points.length - 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let maxI = 0;
    for (let i = 2; i < points.length - 2; i += 2) {
      const px = points[i];
      const py = points[i + 1];
      let dist;
      if (len2 < 1e-8) dist = Math.hypot(px - x1, py - y1);
      else {
        const t = clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
        dist = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
      }
      if (dist > maxD) {
        maxD = dist;
        maxI = i;
      }
    }
    if (maxD < eps) return [x1, y1, x2, y2];
    const left = rdpSimplify(points.slice(0, maxI + 2), eps);
    const right = rdpSimplify(points.slice(maxI), eps);
    return left.slice(0, -2).concat(right);
  }

  function traceSkeleton(mask, width, height) {
    const used = new Uint8Array(width * height);
    const polylines = [];

    function walk(sx, sy, fromx, fromy) {
      const pts = [sx, sy];
      let x = sx;
      let y = sy;
      let px = fromx;
      let py = fromy;
      for (let guard = 0; guard < width * height; guard++) {
        const i = y * width + x;
        const deg = degree8(x, y, width, height, mask);
        if (deg !== 2 && pts.length > 2) break;
        const nbs = neighbors8(x, y, width, height, mask);
        let nx = -1;
        let ny = -1;
        for (let k = 0; k < nbs.length; k += 2) {
          const cx = nbs[k];
          const cy = nbs[k + 1];
          if (cx === px && cy === py) continue;
          const ci = cy * width + cx;
          if (used[ci] && degree8(cx, cy, width, height, mask) === 2) continue;
          nx = cx;
          ny = cy;
          break;
        }
        if (nx < 0) break;
        if (deg === 2) used[i] = 1;
        pts.push(nx, ny);
        px = x;
        py = y;
        x = nx;
        y = ny;
        if (degree8(x, y, width, height, mask) !== 2) break;
      }
      return pts;
    }

    const starts = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!mask[y * width + x]) continue;
        const deg = degree8(x, y, width, height, mask);
        if (deg === 1 || deg >= 3) starts.push(x, y);
      }
    }
    for (let s = 0; s < starts.length; s += 2) {
      const x = starts[s];
      const y = starts[s + 1];
      const nbs = neighbors8(x, y, width, height, mask);
      for (let k = 0; k < nbs.length; k += 2) {
        const nx = nbs[k];
        const ny = nbs[k + 1];
        const ni = ny * width + nx;
        if (used[ni] && degree8(nx, ny, width, height, mask) === 2) continue;
        const pts = walk(nx, ny, x, y);
        if (pts.length >= 2) polylines.push([x, y].concat(pts));
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!mask[i] || used[i]) continue;
        if (degree8(x, y, width, height, mask) !== 2) continue;
        const pts = walk(x, y, x, y);
        if (pts.length >= 4) polylines.push(pts);
      }
    }
    return polylines;
  }

  function polylinesToSegments(polylines) {
    const segs = [];
    for (let i = 0; i < polylines.length; i++) {
      const simple = rdpSimplify(polylines[i], 1.6);
      for (let k = 0; k + 3 < simple.length; k += 2) {
        const x1 = simple[k];
        const z1 = simple[k + 1];
        const x2 = simple[k + 2];
        const z2 = simple[k + 3];
        if (Math.hypot(x2 - x1, z2 - z1) < 2) continue;
        segs.push({ x1, z1, x2, z2 });
      }
    }
    return segs;
  }

  function axisAlignedRuns(mask, width, height, minRun) {
    const segs = [];
    const need = minRun != null ? minRun : 4;
    for (let y = 0; y < height; y++) {
      let run = 0;
      let start = 0;
      for (let x = 0; x < width; x++) {
        if (mask[y * width + x]) {
          if (!run) start = x;
          run += 1;
        } else if (run >= need) {
          segs.push({ x1: start, z1: y, x2: x - 1, z2: y });
          run = 0;
        } else run = 0;
      }
      if (run >= need) segs.push({ x1: start, z1: y, x2: width - 1, z2: y });
    }
    for (let x = 0; x < width; x++) {
      let run = 0;
      let start = 0;
      for (let y = 0; y < height; y++) {
        if (mask[y * width + x]) {
          if (!run) start = y;
          run += 1;
        } else if (run >= need) {
          segs.push({ x1: x, z1: start, x2: x, z2: y - 1 });
          run = 0;
        } else run = 0;
      }
      if (run >= need) segs.push({ x1: x, z1: start, x2: x, z2: height - 1 });
    }
    return segs;
  }

  function detectRasterSegments(imageData, width, height, threshold) {
    const lum = extractLuminance(imageData, width, height);
    const auto = otsuThreshold(lum);
    const thr = threshold != null ? threshold : auto;
    let darkCount = 0;
    for (let i = 0; i < lum.length; i++) if (lum[i] < thr) darkCount += 1;
    const invert = darkCount > lum.length * 0.5;
    let mask = binarizeLines(lum, width, height, thr, invert);
    let ratio = fillRatio(mask);
    if (ratio > 0.28 || ratio < 0.004) {
      mask = sobelEdges(lum, width, height, invert ? 36 : 42);
      ratio = fillRatio(mask);
    }
    if (ratio > 0.35) {
      mask = sobelEdges(lum, width, height, 64);
    }
    mask = removeSmallBlobs(mask, width, height, 8);
    const thin = zhangSuenThin(new Uint8Array(mask), width, height);
    let segs = polylinesToSegments(traceSkeleton(thin, width, height));
    if (segs.length < 8) {
      const fallback = axisAlignedRuns(thin, width, height, 6);
      if (fallback.length > segs.length) segs = fallback;
    }
    if (segs.length < 4) {
      const raw = axisAlignedRuns(mask, width, height, 8);
      if (raw.length > segs.length) segs = raw;
    }
    const out = dedupeSegments(segs);
    out.otsu = auto;
    out.invert = invert;
    return out;
  }

  function segmentsToGraph(segments, sourceW, sourceH) {
    const sw = Math.max(1e-6, Number(sourceW) || 1);
    const sh = Math.max(1e-6, Number(sourceH) || 1);
    const raw = (segments || []).map((s) => ({
      x1: s.x1,
      z1: s.z1,
      x2: s.x2,
      z2: s.z2,
    }));
    const pts = [];
    for (let i = 0; i < raw.length; i++) {
      pts.push(raw[i].x1, raw[i].z1, raw[i].x2, raw[i].z2);
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i]);
      maxX = Math.max(maxX, pts[i]);
      minZ = Math.min(minZ, pts[i + 1]);
      maxZ = Math.max(maxZ, pts[i + 1]);
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      maxX = sw;
      minZ = 0;
      maxZ = sh;
    }
    const w = Math.max(1e-6, maxX - minX);
    const h = Math.max(1e-6, maxZ - minZ);
    const scale = Math.min(CUBE / w, CUBE / h);
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const ox = CUBE * 0.5 - cx * scale;
    const oz = CUBE * 0.5 - cz * scale;
    const fittedSegs = raw.map((s) => ({
      x1: clamp(s.x1 * scale + ox, 0, CUBE),
      z1: clamp(s.z1 * scale + oz, 0, CUBE),
      x2: clamp(s.x2 * scale + ox, 0, CUBE),
      z2: clamp(s.z2 * scale + oz, 0, CUBE),
    }));
    const cleaned = dedupeSegments(fittedSegs);
    const split = splitSegmentsAtIntersections(cleaned);
    const base = graphFromPieces(split.length ? split : cleaned);
    const dense = subdividePlanar(base.nodes, base.edges, NODE_STEP);
    const deg = planarDegrees(dense.nodes.length, dense.edges);
    const intersections = [];
    for (let i = 0; i < deg.length; i++) {
      if (deg[i] >= 3) intersections.push(i);
    }
    const components = countComponents(dense.nodes.length, dense.edges);
    return {
      nodes: dense.nodes,
      edges: dense.edges,
      transform: { scale, ox, oz, sourceW: w, sourceH: h },
      segmentCount: cleaned.length,
      intersections,
      components,
      paths: cleaned,
    };
  }

  function graphStatus(planar, graph3d) {
    const edges = (graph3d && graph3d.edges) || (planar && planar.edges) || [];
    const nodes = (graph3d && graph3d.nodes) || (planar && planar.nodes) || [];
    if (!edges.length || nodes.length < 2) return "needs_review";
    return "valid";
  }

  function buildRecord(meta, planar, verticalSpacing) {
    const graph3d = extrudeTo3D(planar, verticalSpacing);
    const status = graphStatus(planar, graph3d);
    return {
      name: meta.name || "Custom grid",
      source: meta.source,
      verticalSpacing: graph3d.verticalSpacing,
      transform: planar.transform,
      planar: {
        nodes: planar.nodes,
        edges: planar.edges,
        intersections: planar.intersections || [],
      },
      paths: planar.paths || null,
      graph3d: {
        nodes: graph3d.nodes,
        edges: graph3d.edges,
      },
      stats: {
        planarNodes: planar.nodes.length,
        planarEdges: planar.edges.length,
        nodes3d: graph3d.nodes.length,
        edges3d: graph3d.edges.length,
        layers: graph3d.layerCount,
        intersections: (planar.intersections || []).length,
        components: planar.components != null ? planar.components : countComponents(planar.nodes.length, planar.edges),
        status,
      },
    };
  }

  function compileAdjacency(record) {
    const adj = new Map();
    const nodes = record.graph3d.nodes;
    for (let i = 0; i < nodes.length; i++) adj.set(i, []);
    for (let i = 0; i < record.graph3d.edges.length; i++) {
      const e = record.graph3d.edges[i];
      adj.get(e.from).push(e.to);
      adj.get(e.to).push(e.from);
    }
    for (const [id, list] of adj) adj.set(id, Array.from(new Set(list)));
    return adj;
  }

  function activateRecord(record) {
    active = Object.assign({}, record, { adj: compileAdjacency(record) });
    revision += 1;
    notify();
    return active;
  }

  function linePositionsFromRecord(record) {
    const pos = [];
    const nodes = record.graph3d.nodes;
    const seen = new Set();
    for (let i = 0; i < record.graph3d.edges.length; i++) {
      const e = record.graph3d.edges[i];
      const k = e.from < e.to ? e.from + "|" + e.to : e.to + "|" + e.from;
      if (seen.has(k)) continue;
      seen.add(k);
      const a = nodes[e.from];
      const b = nodes[e.to];
      if (!a || !b) continue;
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    return pos;
  }

  async function loadImageToCanvas(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Could not read image."));
        el.src = url;
      });
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      const scale = Math.min(1, MAX_RASTER_DIM / Math.max(w, h));
      w = Math.max(8, Math.round(w * scale));
      h = Math.max(8, Math.round(h * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return { canvas, ctx, width: w, height: h };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const api = {
    CUBE,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getState,
    isCustom() {
      return !!active;
    },
    getActive() {
      if (active && !active.adj && active.graph3d && active.graph3d.edges) {
        active.adj = compileAdjacency(active);
      }
      return active;
    },
    getSnapRadius() {
      if (!active || !active.graph3d) return 1.5;
      const nodes = active.graph3d.nodes;
      const edges = active.graph3d.edges;
      let minLen = Infinity;
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        const a = nodes[e.from];
        const b = nodes[e.to];
        if (!a || !b) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        if (d > 1e-6) minLen = Math.min(minLen, d);
      }
      const v = active.verticalSpacing || 1;
      const edge = Number.isFinite(minLen) ? minLen : v;
      return Math.max(0.75, edge * 0.55, v * 0.45);
    },
    getPending() {
      return pending;
    },
    setShowGrid(on) {
      showGrid = !!on;
      notify();
    },
    getShowGrid() {
      return showGrid;
    },
    getRevision() {
      return revision;
    },
    getDisplayName() {
      return active && active.name ? active.name : "None";
    },
    isValid() {
      return !!(active && active.graph3d && active.graph3d.edges && active.graph3d.edges.length);
    },
    getDiagnostics() {
      if (!active) {
        return {
          nodes: 0,
          edges: 0,
          intersections: 0,
          components: 0,
          layers: 0,
          status: "needs_review",
          name: "None",
        };
      }
      const stats = active.stats || {};
      return {
        nodes: stats.nodes3d || (active.graph3d && active.graph3d.nodes.length) || 0,
        edges: stats.edges3d || (active.graph3d && active.graph3d.edges.length) || 0,
        intersections: stats.intersections || 0,
        components: stats.components || 0,
        layers: stats.layers || 0,
        planarNodes: stats.planarNodes || 0,
        planarEdges: stats.planarEdges || 0,
        status: stats.status || (api.isValid() ? "valid" : "needs_review"),
        name: active.name || "Custom grid",
      };
    },
    nodePositions() {
      if (!active) return [];
      return active.graph3d.nodes;
    },
    intersectionNodeIds() {
      if (!active || !active.planar) return [];
      const planarHits = new Set(active.planar.intersections || []);
      const ids = [];
      const nodes = active.graph3d.nodes;
      for (let i = 0; i < nodes.length; i++) {
        if (planarHits.has(nodes[i].planarId)) ids.push(i);
      }
      return ids;
    },
    linePositions() {
      if (!active) return null;
      return linePositionsFromRecord(active);
    },
    nearestGridNode(x, y, z, maxDist) {
      if (!active) return null;
      const maxSq = maxDist * maxDist;
      let best = null;
      let bestSq = maxSq;
      const nodes = active.graph3d.nodes;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const d = (n.x - x) ** 2 + (n.y - y) ** 2 + (n.z - z) ** 2;
        if (d <= bestSq) {
          bestSq = d;
          best = n;
        }
      }
      return best;
    },
    snapToNearestNode(x, y, z, maxDist) {
      const r = maxDist != null ? maxDist : api.getSnapRadius();
      const n = api.nearestGridNode(x, y, z, r);
      return n ? { x: n.x, y: n.y, z: n.z, gridNodeId: n.id } : null;
    },
    async init() {
      if (api._inited) return active;
      api._inited = true;
      const store = global.D7SavedCustomGrid;
      if (!store) return null;
      try {
        const saved = await store.loadDefault();
        if (saved && saved.graph3d && saved.planar) {
          activateRecord(saved);
        }
      } catch (e) {
        console.warn("Custom grid load failed", e);
      }
      return active;
    },
    async importFile(file) {
      if (!file) throw new Error("No file selected.");
      const name = file.name || "Custom grid";
      const lower = name.toLowerCase();
      const source = { fileName: name, mime: file.type || "" };
      if (lower.endsWith(".svg")) {
        const text = await file.text();
        const parsed = parseSvgSegments(text);
        if (!parsed.segments.length) throw new Error("No lines found in SVG.");
        const planar = segmentsToGraph(parsed.segments, parsed.sourceWidth, parsed.sourceHeight);
        if (!planar.edges.length) {
          throw new Error("SVG was read, but no connected grid edges were found.");
        }
        planar.paths = parsed.segments;
        const record = buildRecord({ name, source: Object.assign({ kind: "svg" }, source) }, planar, 1);
        pending = { kind: "ready", record, preview: null };
        notify();
        return pending;
      }
      if (/\.(png|jpe?g)$/i.test(lower)) {
        const { canvas, ctx, width, height } = await loadImageToCanvas(file);
        pending = {
          kind: "raster",
          name,
          source: Object.assign({ kind: "raster" }, source),
          canvas,
          ctx,
          width,
          height,
          threshold: 128,
          segments: null,
          previewUrl: canvas.toDataURL("image/png"),
        };
        const img = ctx.getImageData(0, 0, width, height);
        const auto = otsuThreshold(extractLuminance(img, width, height));
        pending.threshold = auto;
        api.refreshPendingRaster();
        notify();
        return pending;
      }
      throw new Error("Use SVG, PNG, or JPG.");
    },
    refreshPendingRaster() {
      if (!pending || pending.kind !== "raster") return null;
      const img = pending.ctx.getImageData(0, 0, pending.width, pending.height);
      pending.segments = detectRasterSegments(img, pending.width, pending.height, pending.threshold);
      notify();
      return pending.segments;
    },
    setPendingThreshold(t) {
      if (!pending || pending.kind !== "raster") return;
      pending.threshold = clamp(Number(t) || 128, 1, 254);
      api.refreshPendingRaster();
    },
    confirmPending(verticalSpacing) {
      if (!pending) throw new Error("Nothing to confirm.");
      let record;
      if (pending.kind === "ready") {
        record = buildRecord(
          { name: pending.record.name, source: pending.record.source },
          {
            nodes: pending.record.planar.nodes,
            edges: pending.record.planar.edges,
            transform: pending.record.transform,
            paths: pending.record.paths,
          },
          verticalSpacing
        );
      } else if (pending.kind === "raster") {
        if (!pending.segments || !pending.segments.length) {
          throw new Error("No grid lines detected. Adjust Detection Sensitivity and try again.");
        }
        const planar = segmentsToGraph(pending.segments, pending.width, pending.height);
        if (!planar.edges.length) {
          throw new Error("Detected pixels, but no connected grid edges. Adjust Detection Sensitivity.");
        }
        record = buildRecord(
          { name: pending.name, source: pending.source },
          planar,
          verticalSpacing
        );
      } else throw new Error("Unknown pending state.");
      pending = { kind: "ready", record, preview: pending.previewUrl || null };
      notify();
      return record;
    },
    getPendingRecord() {
      return pending && pending.kind === "ready" ? pending.record : null;
    },
    async setAsDefault(record) {
      const rec = record || (pending && pending.kind === "ready" ? pending.record : null) || active;
      if (!rec) throw new Error("Import a grid first.");
      const store = global.D7SavedCustomGrid;
      if (!store) throw new Error("IndexedDB is not available.");
      const toSave = JSON.parse(JSON.stringify(rec));
      delete toSave.adj;
      await store.saveDefault(toSave);
      activateRecord(toSave);
      pending = null;
      return active;
    },
    async importAndActivate(file, verticalSpacing) {
      await api.importFile(file);
      const v = verticalSpacing != null ? verticalSpacing : active ? active.verticalSpacing : 1;
      if (pending && pending.kind === "ready") {
        const record = api.confirmPending(v);
        if (!record.graph3d.edges.length) {
          throw new Error("No connected grid edges were found. The generic lattice was not used.");
        }
        return api.setAsDefault(record);
      }
      return pending;
    },
    async importSvgTextAndActivate(svgText, name, verticalSpacing) {
      if (!svgText) return null;
      const parsed = parseSvgSegments(svgText);
      if (!parsed.segments.length) return null;
      const planar = segmentsToGraph(parsed.segments, parsed.sourceWidth, parsed.sourceHeight);
      if (!planar.edges.length) return null;
      planar.paths = parsed.segments;
      const record = buildRecord(
        { name: name || "Custom grid", source: { kind: "svg", fileName: name || "grid.svg" } },
        planar,
        verticalSpacing != null ? verticalSpacing : 1
      );
      return api.setAsDefault(record);
    },
    async confirmRasterAndActivate(verticalSpacing) {
      const record = api.confirmPending(verticalSpacing != null ? verticalSpacing : 1);
      return api.setAsDefault(record);
    },
    async replaceWithFile(file, verticalSpacing) {
      return api.importAndActivate(file, verticalSpacing);
    },
    async resetBuiltIn() {
      const store = global.D7SavedCustomGrid;
      if (store) {
        try {
          await store.clearDefault();
        } catch (e) {
          console.warn(e);
        }
      }
      active = null;
      pending = null;
      revision += 1;
      notify();
    },
    replaceFromPending(verticalSpacing) {
      const record = api.confirmPending(verticalSpacing);
      return api.setAsDefault(record);
    },
    rebuildActiveVerticalSpacing(verticalSpacing) {
      if (!active) return null;
      const planar = {
        nodes: active.planar.nodes,
        edges: active.planar.edges,
        transform: active.transform,
        intersections: active.planar.intersections || [],
      };
      const record = buildRecord(
        { name: active.name, source: active.source },
        planar,
        verticalSpacing
      );
      activateRecord(record);
      return active;
    },
    async saveActiveVerticalSpacing(verticalSpacing) {
      const rec = api.rebuildActiveVerticalSpacing(verticalSpacing);
      if (!rec) return null;
      const store = global.D7SavedCustomGrid;
      if (store) {
        const toSave = JSON.parse(JSON.stringify(rec));
        delete toSave.adj;
        await store.saveDefault(toSave);
      }
      notify();
      return rec;
    },
    renderPreviewOverlay(ctx, width, height) {
      if (!pending || pending.kind !== "raster" || !pending.segments) return;
      ctx.strokeStyle = "rgba(255, 40, 40, 0.95)";
      ctx.lineWidth = 2;
      const sx = width / pending.width;
      const sy = height / pending.height;
      for (let i = 0; i < pending.segments.length; i++) {
        const s = pending.segments[i];
        ctx.beginPath();
        ctx.moveTo(s.x1 * sx, s.z1 * sy);
        ctx.lineTo(s.x2 * sx, s.z2 * sy);
        ctx.stroke();
      }
    },
  };

  global.D7CustomGrid = api;
})(window);

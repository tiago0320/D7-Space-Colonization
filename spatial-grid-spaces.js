/**
 * Connected rectangular solids from a selected 3D Grid Growth chunk.
 * One prism per straight run. Junction masses connect turns and forks.
 * Workspace: 20 ft cube. 1 unit = 1 foot. Y is vertical.
 */
(function (global) {
  const CUBE = 20;
  const MERGE_EPS = 0.04;
  const WELD_EPS = 0.001;
  const AREA_MIN = 1e-6;
  const VOL_MIN = 1e-8;
  const ON_EPS = 1e-6;
  const COLLINEAR_DOT = 0.96;
  const DIM_MIN = 0.05;
  const DIM_MAX = 40;
  const DEFAULTS = { width: 2, thickness: 2, junction: 2 };

  function dim(n, fallback) {
    const v = Number(n);
    return clamp(Number.isFinite(v) ? v : fallback, DIM_MIN, DIM_MAX);
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function v(x, y, z) {
    return { x: x, y: y, z: z };
  }

  function add(a, b) {
    return v(a.x + b.x, a.y + b.y, a.z + b.z);
  }

  function sub(a, b) {
    return v(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  function scale(a, s) {
    return v(a.x * s, a.y * s, a.z * s);
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  function cross(a, b) {
    return v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }

  function len(a) {
    return Math.hypot(a.x, a.y, a.z);
  }

  function norm(a) {
    const L = len(a);
    if (L < 1e-12) return v(0, 0, 0);
    return scale(a, 1 / L);
  }

  function lerpV(a, b, t) {
    return v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }

  function triArea(a, b, c) {
    return len(cross(sub(b, a), sub(c, a))) * 0.5;
  }

  function clipSegToBox(ax, ay, az, bx, by, bz, box) {
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    function clip(p, q) {
      if (Math.abs(p) < 1e-12) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    }
    if (!clip(-dx, ax - box.minx) || !clip(dx, box.maxx - ax)) return null;
    if (!clip(-dy, ay - box.miny) || !clip(dy, box.maxy - ay)) return null;
    if (!clip(-dz, az - box.minz) || !clip(dz, box.maxz - az)) return null;
    if (t1 - t0 < 1e-5) return null;
    return {
      ax: ax + dx * t0,
      ay: ay + dy * t0,
      az: az + dz * t0,
      bx: ax + dx * t1,
      by: ay + dy * t1,
      bz: az + dz * t1,
    };
  }

  function key3(x, y, z) {
    return Math.round(x / MERGE_EPS) + "," + Math.round(y / MERGE_EPS) + "," + Math.round(z / MERGE_EPS);
  }

  function weldKey(x, y, z) {
    return Math.round(x / WELD_EPS) + "," + Math.round(y / WELD_EPS) + "," + Math.round(z / WELD_EPS);
  }

  function normalizeBox(box) {
    if (!box) return { minx: 0, maxx: CUBE, miny: 0, maxy: CUBE, minz: 0, maxz: CUBE };
    return {
      minx: clamp(Math.min(box.minx, box.maxx), 0, CUBE),
      maxx: clamp(Math.max(box.minx, box.maxx), 0, CUBE),
      miny: clamp(Math.min(box.miny, box.maxy), 0, CUBE),
      maxy: clamp(Math.max(box.miny, box.maxy), 0, CUBE),
      minz: clamp(Math.min(box.minz, box.maxz), 0, CUBE),
      maxz: clamp(Math.max(box.minz, box.maxz), 0, CUBE),
    };
  }

  function clipGraph(nodes, branches, box) {
    const b = normalizeBox(box);
    const byId = new Map();
    for (let i = 0; i < (nodes || []).length; i++) byId.set(nodes[i].id, nodes[i]);
    const nodeMap = new Map();
    const outNodes = [];
    function nodeAt(x, y, z, order, isRoot) {
      const k = key3(x, y, z);
      let id = nodeMap.get(k);
      if (id != null) {
        const n = outNodes[id];
        if (order != null && (n.order == null || order < n.order)) n.order = order;
        if (isRoot) n.isRoot = true;
        return id;
      }
      id = outNodes.length;
      nodeMap.set(k, id);
      outNodes.push({
        id,
        x: clamp(x, b.minx, b.maxx),
        y: clamp(y, b.miny, b.maxy),
        z: clamp(z, b.minz, b.maxz),
        order: order || 1,
        isRoot: !!isRoot,
        degree: 0,
      });
      return id;
    }
    const segs = [];
    const seen = new Set();
    for (let i = 0; i < (branches || []).length; i++) {
      const br = branches[i];
      const a = byId.get(br.fromId);
      const c = byId.get(br.toId);
      if (!a || !c) continue;
      const clipped = clipSegToBox(a.x, a.y, a.z, c.x, c.y, c.z, b);
      if (!clipped) continue;
      const aid = nodeAt(clipped.ax, clipped.ay, clipped.az, a.order, a.isRoot);
      const bid = nodeAt(clipped.bx, clipped.by, clipped.bz, c.order, c.isRoot);
      if (aid === bid) continue;
      const ek = aid < bid ? aid + "|" + bid : bid + "|" + aid;
      if (seen.has(ek)) continue;
      seen.add(ek);
      const dx = clipped.bx - clipped.ax;
      const dy = clipped.by - clipped.ay;
      const dz = clipped.bz - clipped.az;
      const L = Math.hypot(dx, dy, dz);
      if (L < MERGE_EPS) continue;
      segs.push({
        a: aid,
        b: bid,
        ax: clipped.ax,
        ay: clipped.ay,
        az: clipped.az,
        bx: clipped.bx,
        by: clipped.by,
        bz: clipped.bz,
        dx: dx / L,
        dy: dy / L,
        dz: dz / L,
        len: L,
        order: br.order || 1,
      });
      outNodes[aid].degree += 1;
      outNodes[bid].degree += 1;
    }
    const graph = { nodes: outNodes, segs, box: b };
    graph.runs = extractRuns(graph);
    return graph;
  }

  function extractRuns(graph) {
    const segs = graph.segs || [];
    const nodes = graph.nodes || [];
    const adj = [];
    for (let i = 0; i < nodes.length; i++) adj.push([]);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      adj[s.a].push({ si: i, other: s.b });
      adj[s.b].push({ si: i, other: s.a });
    }
    const used = new Array(segs.length).fill(false);

    function arriveDir(si, node) {
      const s = segs[si];
      return node === s.b ? v(s.dx, s.dy, s.dz) : v(-s.dx, -s.dy, -s.dz);
    }
    function leaveDir(si, node) {
      const s = segs[si];
      return node === s.a ? v(s.dx, s.dy, s.dz) : v(-s.dx, -s.dy, -s.dz);
    }
    function nextThrough(node, inSi) {
      const n = nodes[node];
      if (!n || n.degree !== 2) return null;
      const links = adj[node];
      if (!links || links.length !== 2) return null;
      const nxt = links[0].si === inSi ? links[1] : links[0];
      if (used[nxt.si]) return null;
      if (dot(arriveDir(inSi, node), leaveDir(nxt.si, node)) < COLLINEAR_DOT) return null;
      return nxt;
    }
    function walk(si, towardNode) {
      const path = [];
      let cur = si;
      let at = towardNode;
      const seen = new Set();
      while (true) {
        if (seen.has(cur)) break;
        seen.add(cur);
        path.push(cur);
        const nxt = nextThrough(at, cur);
        if (!nxt) break;
        cur = nxt.si;
        at = nxt.other;
      }
      return path;
    }
    function farNode(si, nextSi) {
      const s = segs[si];
      if (nextSi == null) return s.a;
      const n = segs[nextSi];
      const shared = s.a === n.a || s.a === n.b ? s.a : s.b;
      return shared === s.a ? s.b : s.a;
    }
    function ptAt(si, node) {
      const s = segs[si];
      return node === s.a ? v(s.ax, s.ay, s.az) : v(s.bx, s.by, s.bz);
    }

    const runs = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      const towardA = walk(i, segs[i].a);
      const towardB = walk(i, segs[i].b);
      const ordered = towardA.slice(1).reverse().concat([i], towardB.slice(1));
      for (let k = 0; k < ordered.length; k++) used[ordered[k]] = true;
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      const nodeA = farNode(first, ordered.length > 1 ? ordered[1] : null);
      const nodeB = ordered.length === 1 ? segs[first].b : farNode(last, ordered[ordered.length - 2]);
      const pa = ptAt(first, nodeA);
      const pb = ptAt(last, nodeB);
      const d = sub(pb, pa);
      const L = len(d);
      if (L < MERGE_EPS) continue;
      const dir = scale(d, 1 / L);
      runs.push({
        segs: ordered.slice(),
        a: nodeA,
        b: nodeB,
        ax: pa.x,
        ay: pa.y,
        az: pa.z,
        bx: pb.x,
        by: pb.y,
        bz: pb.z,
        dx: dir.x,
        dy: dir.y,
        dz: dir.z,
        len: L,
      });
    }
    return runs;
  }

  function lineClosestPoint(p, d, q, e) {
    const w0 = sub(p, q);
    const a = dot(d, d);
    const b = dot(d, e);
    const c = dot(e, e);
    const dp = dot(d, w0);
    const ep = dot(e, w0);
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-14) return null;
    const t = (b * ep - c * dp) / denom;
    return add(p, scale(d, t));
  }

  function limitMiter(corner, origin, maxL) {
    if (!corner) return null;
    const d = sub(corner, origin);
    const L = len(d);
    if (L <= maxL || L < 1e-12) return corner;
    return add(origin, scale(d, maxL / L));
  }

  function nextStripLeft(d0, n0, d1) {
    const T = cross(d0, n0);
    let n = cross(T, d1);
    if (len(n) < 1e-8) {
      n = sub(n0, scale(d1, dot(n0, d1)));
      if (len(n) < 1e-8) n = frameForDir(d1).W;
    }
    n = norm(n);
    if (len(n) < 1e-8) return n0;
    if (dot(n, n0) < -1e-6) n = scale(n, -1);
    return n;
  }

  function extractSurfaceChains(graph) {
    const segs = graph.segs || [];
    const nodes = graph.nodes || [];
    const adj = [];
    for (let i = 0; i < nodes.length; i++) adj.push([]);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      adj[s.a].push({ si: i, other: s.b });
      adj[s.b].push({ si: i, other: s.a });
    }
    const used = new Array(segs.length).fill(false);
    const throughUsed = new Array(nodes.length).fill(false);

    function arriveDir(si, node) {
      const s = segs[si];
      return node === s.b ? v(s.dx, s.dy, s.dz) : v(-s.dx, -s.dy, -s.dz);
    }
    function leaveDir(si, node) {
      const s = segs[si];
      return node === s.a ? v(s.dx, s.dy, s.dz) : v(-s.dx, -s.dy, -s.dz);
    }
    function nextAlong(node, inSi) {
      const n = nodes[node];
      const links = adj[node];
      if (!n || !links || !links.length) return null;
      if (n.degree === 2 && links.length === 2) {
        const nxt = links[0].si === inSi ? links[1] : links[0];
        if (used[nxt.si]) return null;
        return nxt;
      }
      if (throughUsed[node]) return null;
      const arrive = arriveDir(inSi, node);
      let best = null;
      let bestDot = COLLINEAR_DOT;
      for (let i = 0; i < links.length; i++) {
        const ln = links[i];
        if (ln.si === inSi || used[ln.si]) continue;
        const d = dot(arrive, leaveDir(ln.si, node));
        if (d > bestDot) {
          bestDot = d;
          best = ln;
        }
      }
      if (best) throughUsed[node] = true;
      return best;
    }
    function walk(si, towardNode) {
      const path = [];
      let cur = si;
      let at = towardNode;
      const seen = new Set();
      while (true) {
        if (seen.has(cur)) break;
        seen.add(cur);
        path.push(cur);
        const nxt = nextAlong(at, cur);
        if (!nxt) break;
        cur = nxt.si;
        at = nxt.other;
      }
      return path;
    }
    function farNode(si, nextSi) {
      const s = segs[si];
      if (nextSi == null) return s.a;
      const n = segs[nextSi];
      const shared = s.a === n.a || s.a === n.b ? s.a : s.b;
      return shared === s.a ? s.b : s.a;
    }
    function otherNode(si, node) {
      const s = segs[si];
      return s.a === node ? s.b : s.a;
    }

    const chains = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      const towardA = walk(i, segs[i].a);
      const towardB = walk(i, segs[i].b);
      let ordered = towardA.slice(1).reverse().concat([i], towardB.slice(1));
      const seenOrd = new Set();
      const uniq = [];
      for (let k = 0; k < ordered.length; k++) {
        if (seenOrd.has(ordered[k])) continue;
        seenOrd.add(ordered[k]);
        uniq.push(ordered[k]);
      }
      ordered = uniq;
      for (let k = 0; k < ordered.length; k++) used[ordered[k]] = true;
      const first = ordered[0];
      const nodeA = farNode(first, ordered.length > 1 ? ordered[1] : null);
      let at = nodeA;
      const nodeIds = [nodeA];
      const points = [v(nodes[nodeA].x, nodes[nodeA].y, nodes[nodeA].z)];
      for (let k = 0; k < ordered.length; k++) {
        const nxt = otherNode(ordered[k], at);
        nodeIds.push(nxt);
        points.push(v(nodes[nxt].x, nodes[nxt].y, nodes[nxt].z));
        at = nxt;
      }
      let closed = false;
      if (points.length >= 3) {
        if (nodeIds[0] === nodeIds[nodeIds.length - 1]) {
          closed = true;
          nodeIds.pop();
          points.pop();
        } else {
          let allDeg2 = true;
          for (let k = 0; k < nodeIds.length; k++) {
            if (!nodes[nodeIds[k]] || nodes[nodeIds[k]].degree !== 2) {
              allDeg2 = false;
              break;
            }
          }
          if (allDeg2 && nodeIds.length >= 3) closed = true;
        }
      }
      if (points.length < 2) continue;
      chains.push({ segs: ordered, nodeIds, points, closed });
    }
    return chains;
  }

  function planeDist(p, nx, ny, nz, d) {
    return nx * p.x + ny * p.y + nz * p.z - d;
  }

  function projectPlane(p, nx, ny, nz, d) {
    const dist = planeDist(p, nx, ny, nz, d);
    return v(p.x - nx * dist, p.y - ny * dist, p.z - nz * dist);
  }

  function intersectPlane(a, b, nx, ny, nz, d) {
    const ad = nx * a.x + ny * a.y + nz * a.z;
    const bd = nx * b.x + ny * b.y + nz * b.z;
    const denom = bd - ad;
    const t = Math.abs(denom) < 1e-14 ? 0.5 : (d - ad) / denom;
    return projectPlane(lerpV(a, b, clamp(t, 0, 1)), nx, ny, nz, d);
  }

  function snapToBox(p, box) {
    return v(clamp(p.x, box.minx, box.maxx), clamp(p.y, box.miny, box.maxy), clamp(p.z, box.minz, box.maxz));
  }

  function clipPolyTracked(pts, nx, ny, nz, d) {
    if (!pts || pts.length < 3) return { pts: [], cut: null };
    const n = pts.length;
    let allOn = true;
    let anyIn = false;
    let anyOut = false;
    const inside = [];
    for (let i = 0; i < n; i++) {
      const dist = planeDist(pts[i], nx, ny, nz, d);
      const on = Math.abs(dist) <= ON_EPS;
      const inn = dist >= -ON_EPS;
      if (!on) allOn = false;
      if (inn) anyIn = true;
      else anyOut = true;
      inside.push(inn);
    }
    if (allOn || !anyOut) return { pts: pts.slice(), cut: null };
    if (!anyIn) return { pts: [], cut: null };
    const out = [];
    const cut = [];
    for (let i = 0; i < n; i++) {
      const cur = pts[i];
      const prev = pts[(i + n - 1) % n];
      const cin = inside[i];
      const pin = inside[(i + n - 1) % n];
      if (cin) {
        if (!pin) {
          const ip = intersectPlane(prev, cur, nx, ny, nz, d);
          out.push(ip);
          cut.push(ip);
        }
        out.push(cur);
      } else if (pin) {
        const ip = intersectPlane(prev, cur, nx, ny, nz, d);
        out.push(ip);
        cut.push(ip);
      }
    }
    return { pts: out, cut: cut.length === 2 ? cut : null };
  }

  function chainCutLoop(cuts) {
    if (!cuts || cuts.length < 3) return [];
    const used = new Array(cuts.length).fill(false);
    const loop = [cuts[0][0], cuts[0][1]];
    used[0] = true;
    let guard = 0;
    while (loop.length < cuts.length + 1 && guard++ < 64) {
      const last = loop[loop.length - 1];
      const lk = weldKey(last.x, last.y, last.z);
      let found = false;
      for (let i = 0; i < cuts.length; i++) {
        if (used[i]) continue;
        const a = cuts[i][0];
        const b = cuts[i][1];
        if (weldKey(a.x, a.y, a.z) === lk) {
          loop.push(b);
          used[i] = true;
          found = true;
          break;
        }
        if (weldKey(b.x, b.y, b.z) === lk) {
          loop.push(a);
          used[i] = true;
          found = true;
          break;
        }
      }
      if (!found) break;
    }
    if (loop.length >= 2) {
      const a = loop[0];
      const b = loop[loop.length - 1];
      if (weldKey(a.x, a.y, a.z) === weldKey(b.x, b.y, b.z)) loop.pop();
    }
    return uniquePts(loop);
  }

  function uniquePts(pts) {
    const map = new Map();
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const k = weldKey(p.x, p.y, p.z);
      if (map.has(k)) continue;
      map.set(k, true);
      out.push(p);
    }
    return out;
  }

  function orderPolygonOnPlane(pts, nx, ny, nz) {
    const list = uniquePts(pts);
    if (list.length < 3) return list;
    const n = norm(v(nx, ny, nz));
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < list.length; i++) {
      cx += list[i].x;
      cy += list[i].y;
      cz += list[i].z;
    }
    const c = v(cx / list.length, cy / list.length, cz / list.length);
    let ref = cross(n, v(0, 1, 0));
    if (len(ref) < 1e-6) ref = cross(n, v(1, 0, 0));
    ref = norm(ref);
    const bit = cross(n, ref);
    list.sort((a, b) => {
      const aa = Math.atan2(dot(sub(a, c), bit), dot(sub(a, c), ref));
      const bb = Math.atan2(dot(sub(b, c), bit), dot(sub(b, c), ref));
      return aa - bb;
    });
    return list;
  }

  function clipSolidToBox(faces, box) {
    const planes = [
      { nx: 1, ny: 0, nz: 0, d: box.minx },
      { nx: -1, ny: 0, nz: 0, d: -box.maxx },
      { nx: 0, ny: 1, nz: 0, d: box.miny },
      { nx: 0, ny: -1, nz: 0, d: -box.maxy },
      { nx: 0, ny: 0, nz: 1, d: box.minz },
      { nx: 0, ny: 0, nz: -1, d: -box.maxz },
    ];
    let current = faces.map((f) => ({ pts: f.pts.slice(), n: f.n }));
    for (let p = 0; p < planes.length; p++) {
      const pl = planes[p];
      const next = [];
      const cuts = [];
      for (let i = 0; i < current.length; i++) {
        const clipped = clipPolyTracked(current[i].pts, pl.nx, pl.ny, pl.nz, pl.d);
        if (clipped.pts.length < 3) continue;
        next.push({ pts: clipped.pts.map((pt) => snapToBox(pt, box)), n: current[i].n });
        if (clipped.cut) cuts.push([snapToBox(clipped.cut[0], box), snapToBox(clipped.cut[1], box)]);
      }
      if (!next.length) return [];
      let capPts = chainCutLoop(cuts);
      if (capPts.length < 3 && cuts.length >= 3) {
        const raw = [];
        for (let i = 0; i < cuts.length; i++) {
          raw.push(cuts[i][0], cuts[i][1]);
        }
        capPts = orderPolygonOnPlane(raw, -pl.nx, -pl.ny, -pl.nz);
      }
      if (capPts.length >= 3) {
        const outward = v(-pl.nx, -pl.ny, -pl.nz);
        next.push({ pts: orientPoly(capPts, outward), n: outward });
      }
      current = next;
    }
    return current;
  }

  function facesVolume(faces) {
    let vol = 0;
    for (let i = 0; i < faces.length; i++) {
      const pts = faces[i].pts;
      if (!pts || pts.length < 3) continue;
      const a = pts[0];
      for (let k = 1; k < pts.length - 1; k++) {
        const b = pts[k];
        const c = pts[k + 1];
        vol += a.x * (b.y * c.z - b.z * c.y) + a.y * (b.z * c.x - b.x * c.z) + a.z * (b.x * c.y - b.y * c.x);
      }
    }
    return vol / 6;
  }

  function meshSignedVolume(positions, indices) {
    let vol = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i] * 3;
      const ib = indices[i + 1] * 3;
      const ic = indices[i + 2] * 3;
      const ax = positions[ia];
      const ay = positions[ia + 1];
      const az = positions[ia + 2];
      const bx = positions[ib];
      const by = positions[ib + 1];
      const bz = positions[ib + 2];
      const cx = positions[ic];
      const cy = positions[ic + 1];
      const cz = positions[ic + 2];
      vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    }
    return vol / 6;
  }

  function flipIndices(indices) {
    const out = indices.slice();
    for (let i = 0; i < out.length; i += 3) {
      const t = out[i + 1];
      out[i + 1] = out[i + 2];
      out[i + 2] = t;
    }
    return out;
  }

  function validateClosedMesh(positions, indices, box) {
    const issues = [];
    if (!positions || !indices || indices.length < 12) {
      return { ok: false, closed: false, issues: ["empty"] };
    }
    const edgeCount = new Map();
    const directed = new Map();
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      if (a === b || b === c || c === a) {
        issues.push("degenerate-index");
        continue;
      }
      const pa = v(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]);
      const pb = v(positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]);
      const pc = v(positions[c * 3], positions[c * 3 + 1], positions[c * 3 + 2]);
      if (triArea(pa, pb, pc) < AREA_MIN) issues.push("degenerate-tri");
      const edges = [
        [a, b],
        [b, c],
        [c, a],
      ];
      for (let e = 0; e < 3; e++) {
        const i0 = edges[e][0];
        const i1 = edges[e][1];
        const und = i0 < i1 ? i0 + "_" + i1 : i1 + "_" + i0;
        edgeCount.set(und, (edgeCount.get(und) || 0) + 1);
        const dir = i0 + ">" + i1;
        const rev = i1 + ">" + i0;
        if (directed.has(dir)) issues.push("duplicate-winding");
        directed.set(dir, true);
        if (directed.has(rev)) directed.set(rev, "paired");
      }
    }
    edgeCount.forEach((count) => {
      if (count !== 2) issues.push(count < 2 ? "naked-edge" : "nonmanifold-edge");
    });
    if (box) {
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        if (x < box.minx - 1e-4 || x > box.maxx + 1e-4 || y < box.miny - 1e-4 || y > box.maxy + 1e-4 || z < box.minz - 1e-4 || z > box.maxz + 1e-4) {
          issues.push("outside");
          break;
        }
      }
    }
    const vol = meshSignedVolume(positions, indices);
    if (vol < VOL_MIN) issues.push("zero-volume");
    const uniqueIssues = [];
    const seen = {};
    for (let i = 0; i < issues.length; i++) {
      if (seen[issues[i]]) continue;
      seen[issues[i]] = true;
      uniqueIssues.push(issues[i]);
    }
    return { ok: uniqueIssues.length === 0, closed: uniqueIssues.indexOf("naked-edge") < 0 && uniqueIssues.indexOf("nonmanifold-edge") < 0, issues: uniqueIssues, volume: vol };
  }

  function worldToLocalPositions(pos, center, U, W, T, hu, hw, ht) {
    const sx = Math.max(1e-9, hu * 2);
    const sy = Math.max(1e-9, hw * 2);
    const sz = Math.max(1e-9, ht * 2);
    const out = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      const dx = pos[i] - center.x;
      const dy = pos[i + 1] - center.y;
      const dz = pos[i + 2] - center.z;
      out[i] = (dx * U.x + dy * U.y + dz * U.z) / sx;
      out[i + 1] = (dx * W.x + dy * W.y + dz * W.z) / sy;
      out[i + 2] = (dx * T.x + dy * T.y + dz * T.z) / sz;
    }
    return out;
  }

  function localToWorldPositions(pos, center, U, W, T, hu, hw, ht) {
    const sx = Math.max(1e-9, hu * 2);
    const sy = Math.max(1e-9, hw * 2);
    const sz = Math.max(1e-9, ht * 2);
    const out = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      const lx = pos[i] * sx;
      const ly = pos[i + 1] * sy;
      const lz = pos[i + 2] * sz;
      out[i] = center.x + U.x * lx + W.x * ly + T.x * lz;
      out[i + 1] = center.y + U.y * lx + W.y * ly + T.y * lz;
      out[i + 2] = center.z + U.z * lx + W.z * ly + T.z * lz;
    }
    return out;
  }

  function rectangularFrameFromPoints(positions, U, W, T) {
    if (!positions || positions.length < 24) return null;
    let minU = Infinity;
    let maxU = -Infinity;
    let minW = Infinity;
    let maxW = -Infinity;
    let minT = Infinity;
    let maxT = -Infinity;
    const coords = [];
    for (let i = 0; i < positions.length; i += 3) {
      const p = v(positions[i], positions[i + 1], positions[i + 2]);
      const u = dot(p, U);
      const w = dot(p, W);
      const t = dot(p, T);
      coords.push({ u, w, t });
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (w < minW) minW = w;
      if (w > maxW) maxW = w;
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
    const hu = (maxU - minU) * 0.5;
    const hw = (maxW - minW) * 0.5;
    const ht = (maxT - minT) * 0.5;
    if (hu < DIM_MIN * 0.5 || hw < DIM_MIN * 0.5 || ht < DIM_MIN * 0.5) return null;
    const eps = 1e-3;
    const corners = new Set();
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      const atU = Math.abs(c.u - minU) <= eps || Math.abs(c.u - maxU) <= eps;
      const atW = Math.abs(c.w - minW) <= eps || Math.abs(c.w - maxW) <= eps;
      const atT = Math.abs(c.t - minT) <= eps || Math.abs(c.t - maxT) <= eps;
      if (!atU || !atW || !atT) return null;
      corners.add((Math.abs(c.u - maxU) <= eps ? "1" : "0") + (Math.abs(c.w - maxW) <= eps ? "1" : "0") + (Math.abs(c.t - maxT) <= eps ? "1" : "0"));
    }
    if (corners.size !== 8) return null;
    const center = add(scale(U, (minU + maxU) * 0.5), add(scale(W, (minW + maxW) * 0.5), scale(T, (minT + maxT) * 0.5)));
    return {
      center,
      origin: add(center, add(scale(U, -hu), add(scale(W, -hw), scale(T, -ht)))),
      axisU: scale(U, hu * 2),
      axisW: scale(W, hw * 2),
      axisT: scale(T, ht * 2),
    };
  }

  function polyNormal(pts) {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
    }
    return norm(v(nx, ny, nz));
  }

  function orientPoly(pts, desired) {
    const n = polyNormal(pts);
    if (desired && dot(n, desired) < 0) {
      const rev = pts.slice();
      rev.reverse();
      return rev;
    }
    return pts;
  }

  function MeshBuilder() {
    this.positions = [];
    this.indices = [];
    this.vertMap = new Map();
  }

  MeshBuilder.prototype.vert = function (p, weld) {
    if (weld) {
      const k = weldKey(p.x, p.y, p.z);
      if (this.vertMap.has(k)) return this.vertMap.get(k);
      const id = this.positions.length / 3;
      this.positions.push(p.x, p.y, p.z);
      this.vertMap.set(k, id);
      return id;
    }
    const id = this.positions.length / 3;
    this.positions.push(p.x, p.y, p.z);
    return id;
  };

  MeshBuilder.prototype.addTri = function (pa, pb, pc, weld) {
    if (triArea(pa, pb, pc) < AREA_MIN) return false;
    const a = this.vert(pa, weld);
    const b = this.vert(pb, weld);
    const c = this.vert(pc, weld);
    if (a === b || b === c || c === a) return false;
    this.indices.push(a, b, c);
    return true;
  };

  MeshBuilder.prototype.addPoly = function (pts, desiredN, weld) {
    if (!pts || pts.length < 3) return 0;
    const poly = orientPoly(pts, desiredN);
    let added = 0;
    for (let i = 1; i < poly.length - 1; i++) {
      if (this.addTri(poly[0], poly[i], poly[i + 1], weld)) added += 1;
    }
    return added;
  };

  function frameForDir(D) {
    const d = norm(D);
    let w;
    if (Math.abs(d.y) > 0.92) {
      w = cross(v(0, 0, 1), d);
      if (len(w) < 1e-8) w = v(1, 0, 0);
      else w = norm(w);
    } else {
      w = norm(cross(v(0, 1, 0), d));
    }
    const t = norm(cross(d, w));
    return { U: d, W: w, T: t };
  }

  function round2(n) {
    return (Math.round(Number(n) * 100) / 100).toFixed(2);
  }

  function runStableId(s) {
    const a = round2(s.ax) + "," + round2(s.ay) + "," + round2(s.az);
    const b = round2(s.bx) + "," + round2(s.by) + "," + round2(s.bz);
    return a < b ? "s:" + a + ">" + b : "s:" + b + ">" + a;
  }

  function nodeStableId(node) {
    return "j:" + round2(node.x) + "," + round2(node.y) + "," + round2(node.z);
  }

  function rotX(p, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return v(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
  }

  function rotY(p, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return v(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  }

  function rotZ(p, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return v(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
  }

  function applyEulerVec(p, rx, ry, rz) {
    return rotZ(rotY(rotX(p, rx), ry), rz);
  }

  function frameFromEulerDeg(rxd, ryd, rzd) {
    const rx = ((Number(rxd) || 0) * Math.PI) / 180;
    const ry = ((Number(ryd) || 0) * Math.PI) / 180;
    const rz = ((Number(rzd) || 0) * Math.PI) / 180;
    return {
      U: applyEulerVec(v(1, 0, 0), rx, ry, rz),
      W: applyEulerVec(v(0, 1, 0), rx, ry, rz),
      T: applyEulerVec(v(0, 0, 1), rx, ry, rz),
    };
  }

  function eulerDegFromFrame(U, W, T) {
    const m13 = T.x;
    const m23 = T.y;
    const m33 = T.z;
    const m12 = W.x;
    const m11 = U.x;
    const m32 = W.z;
    const m22 = W.y;
    const y = Math.asin(clamp(m13, -1, 1));
    let x;
    let z;
    if (Math.abs(m13) < 0.9999999) {
      x = Math.atan2(-m23, m33);
      z = Math.atan2(-m12, m11);
    } else {
      x = Math.atan2(m32, m22);
      z = 0;
    }
    return { rx: (x * 180) / Math.PI, ry: (y * 180) / Math.PI, rz: (z * 180) / Math.PI };
  }

  function isDupKey(id) {
    return String(id || "").indexOf("d:") === 0;
  }

  function overrideEdited(ov) {
    if (!ov) return false;
    return (
      ov.deleted ||
      ov.dup ||
      ov.width != null ||
      ov.thickness != null ||
      ov.length != null ||
      ov.size != null ||
      ov.cx != null ||
      ov.cy != null ||
      ov.cz != null ||
      ov.rx != null ||
      ov.ry != null ||
      ov.rz != null
    );
  }

  function overrideHasPose(ov) {
    if (!ov) return false;
    return ov.cx != null || ov.cy != null || ov.cz != null || ov.rx != null || ov.ry != null || ov.rz != null || ov.dup;
  }

  function aabbOf(corners) {
    let minx = corners[0].x;
    let maxx = corners[0].x;
    let miny = corners[0].y;
    let maxy = corners[0].y;
    let minz = corners[0].z;
    let maxz = corners[0].z;
    for (let i = 1; i < corners.length; i++) {
      const c = corners[i];
      if (c.x < minx) minx = c.x;
      if (c.x > maxx) maxx = c.x;
      if (c.y < miny) miny = c.y;
      if (c.y > maxy) maxy = c.y;
      if (c.z < minz) minz = c.z;
      if (c.z > maxz) maxz = c.z;
    }
    return { minx, maxx, miny, maxy, minz, maxz };
  }

  function constrainOrientedBox(center, U, W, T, hu, hw, ht, box, flexAxis) {
    let c = v(center.x, center.y, center.z);
    let hU = Math.max(0.05, hu);
    let hW = Math.max(0.05, hw);
    let hT = Math.max(0.05, ht);
    let constrained = false;
    const flex = flexAxis === "U" || flexAxis === "W" || flexAxis === "T" ? flexAxis : null;

    function cornersNow() {
      return orientedCorners(c, U, W, T, hU, hW, hT);
    }

    function shiftToFit() {
      const a = aabbOf(cornersNow());
      const spanX = a.maxx - a.minx;
      const spanY = a.maxy - a.miny;
      const spanZ = a.maxz - a.minz;
      const roomX = box.maxx - box.minx;
      const roomY = box.maxy - box.miny;
      const roomZ = box.maxz - box.minz;
      let nx = c.x;
      let ny = c.y;
      let nz = c.z;
      if (spanX > roomX + 1e-9) nx = (box.minx + box.maxx) * 0.5;
      else {
        if (a.minx < box.minx) nx += box.minx - a.minx;
        if (a.maxx > box.maxx) nx -= a.maxx - box.maxx;
      }
      if (spanY > roomY + 1e-9) ny = (box.miny + box.maxy) * 0.5;
      else {
        if (a.miny < box.miny) ny += box.miny - a.miny;
        if (a.maxy > box.maxy) ny -= a.maxy - box.maxy;
      }
      if (spanZ > roomZ + 1e-9) nz = (box.minz + box.maxz) * 0.5;
      else {
        if (a.minz < box.minz) nz += box.minz - a.minz;
        if (a.maxz > box.maxz) nz -= a.maxz - box.maxz;
      }
      if (Math.abs(nx - c.x) > 1e-8 || Math.abs(ny - c.y) > 1e-8 || Math.abs(nz - c.z) > 1e-8) {
        c = v(nx, ny, nz);
        constrained = true;
      }
    }

    function fitAxis(axis) {
      const read = () => (axis === "U" ? hU : axis === "W" ? hW : hT);
      const write = (val) => {
        if (axis === "U") hU = val;
        else if (axis === "W") hW = val;
        else hT = val;
      };
      const start = read();
      if (!anyOutside(cornersNow(), box)) return;
      let lo = 0.05;
      let hi = start;
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) * 0.5;
        write(mid);
        if (anyOutside(cornersNow(), box)) hi = mid;
        else lo = mid;
      }
      write(lo);
      if (Math.abs(lo - start) > 1e-8) constrained = true;
    }

    shiftToFit();
    if (anyOutside(cornersNow(), box)) {
      if (flex) fitAxis(flex);
      else {
        fitAxis("U");
        if (anyOutside(cornersNow(), box)) fitAxis("W");
        if (anyOutside(cornersNow(), box)) fitAxis("T");
      }
      shiftToFit();
    }
    return { center: c, hu: hU, hw: hW, ht: hT, constrained };
  }

  function orientedCorners(center, U, W, T, hu, hw, ht) {
    const p = (su, sw, st) => add(center, add(scale(U, su * hu), add(scale(W, sw * hw), scale(T, st * ht))));
    return [
      p(-1, -1, -1),
      p(1, -1, -1),
      p(-1, 1, -1),
      p(1, 1, -1),
      p(-1, -1, 1),
      p(1, -1, 1),
      p(-1, 1, 1),
      p(1, 1, 1),
    ];
  }

  function boxFaces(center, U, W, T, hu, hw, ht) {
    const p = (su, sw, st) => add(center, add(scale(U, su * hu), add(scale(W, sw * hw), scale(T, st * ht))));
    return [
      { n: U, pts: [p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1)] },
      { n: scale(U, -1), pts: [p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), p(-1, -1, -1)] },
      { n: W, pts: [p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1)] },
      { n: scale(W, -1), pts: [p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), p(-1, -1, -1)] },
      { n: T, pts: [p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)] },
      { n: scale(T, -1), pts: [p(-1, 1, -1), p(1, 1, -1), p(1, -1, -1), p(-1, -1, -1)] },
    ];
  }

  function anyOutside(corners, box) {
    for (let i = 0; i < corners.length; i++) {
      const c = corners[i];
      if (c.x < box.minx - 1e-6 || c.x > box.maxx + 1e-6) return true;
      if (c.y < box.miny - 1e-6 || c.y > box.maxy + 1e-6) return true;
      if (c.z < box.minz - 1e-6 || c.z > box.maxz + 1e-6) return true;
    }
    return false;
  }

  function meshFromFaces(faces) {
    const mesh = new MeshBuilder();
    let tris = 0;
    for (let i = 0; i < faces.length; i++) {
      tris += mesh.addPoly(faces[i].pts, faces[i].n, true);
    }
    return { positions: mesh.positions.slice(), indices: mesh.indices.slice(), triangleCount: tris };
  }

  function readOpts(options) {
    const o = options || {};
    return {
      width: dim(o.width != null ? o.width : DEFAULTS.width, DEFAULTS.width),
      thickness: dim(o.thickness != null ? o.thickness : DEFAULTS.thickness, DEFAULTS.thickness),
      junction: dim(o.junction != null ? o.junction : DEFAULTS.junction, DEFAULTS.junction),
      overrides: o.overrides || {},
      flexId: o.flexId || null,
      flexAxis: o.flexAxis === "U" || o.flexAxis === "W" || o.flexAxis === "T" ? o.flexAxis : null,
    };
  }

  function buildElement(id, kind, center, U, W, T, hu, hw, ht, box, source, skipClip, flexAxis) {
    const c = center;
    const hU = Math.max(DIM_MIN * 0.5, hu);
    const hW = Math.max(DIM_MIN * 0.5, hw);
    const hT = Math.max(DIM_MIN * 0.5, ht);
    const corners = orientedCorners(c, U, W, T, hU, hW, hT);
    let faces = boxFaces(c, U, W, T, hU, hW, hT);
    const outside = anyOutside(corners, box);
    let clipped = false;
    if (outside) {
      faces = clipSolidToBox(faces, box);
      clipped = true;
    }
    if (!faces.length) return null;
    const volFaces = facesVolume(faces);
    if (Math.abs(volFaces) < VOL_MIN) return null;
    if (volFaces < 0) {
      faces = faces.map((f) => ({ pts: f.pts.slice().reverse(), n: scale(f.n, -1) }));
    }
    let mesh = meshFromFaces(faces);
    if (!mesh.triangleCount) return null;
    let vol = meshSignedVolume(mesh.positions, mesh.indices);
    if (vol < 0) {
      mesh = { positions: mesh.positions, indices: flipIndices(mesh.indices), triangleCount: mesh.triangleCount };
      vol = -vol;
    }
    if (vol < VOL_MIN) return null;
    let validation = validateClosedMesh(mesh.positions, mesh.indices, box);
    if (!validation.ok && clipped) {
      const repaired = meshFromFaces(faces);
      if (repaired.triangleCount) {
        let rv = meshSignedVolume(repaired.positions, repaired.indices);
        if (rv < 0) repaired.indices = flipIndices(repaired.indices);
        const check = validateClosedMesh(repaired.positions, repaired.indices, box);
        if (check.ok || check.closed) {
          mesh = repaired;
          validation = check;
        }
      }
    }
    const euler = eulerDegFromFrame(U, W, T);
    const origin = add(c, add(scale(U, -hU), add(scale(W, -hW), scale(T, -hT))));
    const solid = rectangularFrameFromPoints(mesh.positions, U, W, T);
    const localPositions = worldToLocalPositions(mesh.positions, c, U, W, T, hU, hW, hT);
    return {
      id,
      kind,
      center: c,
      U,
      W,
      T,
      hu: hU,
      hw: hW,
      ht: hT,
      width: hW * 2,
      thickness: hT * 2,
      length: hU * 2,
      size: Math.max(hU, hW, hT) * 2,
      origin,
      axisU: scale(U, hU * 2),
      axisW: scale(W, hW * 2),
      axisT: scale(T, hT * 2),
      solidOrigin: solid ? solid.origin : null,
      solidAxisU: solid ? solid.axisU : null,
      solidAxisW: solid ? solid.axisW : null,
      solidAxisT: solid ? solid.axisT : null,
      corners,
      clipped,
      constrained: clipped,
      closedBox: !!(solid && validation.closed),
      meshClosed: !!validation.closed,
      invalid: !validation.ok,
      issues: validation.issues,
      rx: euler.rx,
      ry: euler.ry,
      rz: euler.rz,
      source,
      positions: mesh.positions,
      indices: mesh.indices,
      localPositions,
      localIndices: mesh.indices.slice(),
      triangleCount: mesh.triangleCount,
    };
  }

  function cellKey(ix, iy, iz) {
    return ix + "," + iy + "," + iz;
  }

  function parseCell(k) {
    const p = String(k).split(",");
    return { x: Number(p[0]), y: Number(p[1]), z: Number(p[2]) };
  }

  function toCell(x, S) {
    return Math.floor(Number(x) / S + 1e-9);
  }

  function dominantAxis(dx, dy, dz) {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const az = Math.abs(dz);
    if (ax >= ay && ax >= az) return 0;
    if (ay >= az) return 1;
    return 2;
  }

  function occupyBrush(occ, i, j, k, axis, nW, nT) {
    const a0 = -Math.floor((nW - 1) / 2);
    const b0 = -Math.floor((nT - 1) / 2);
    for (let a = 0; a < nW; a++) {
      for (let b = 0; b < nT; b++) {
        let x = i;
        let y = j;
        let z = k;
        if (axis === 0) {
          y = j + b0 + b;
          z = k + a0 + a;
        } else if (axis === 1) {
          x = i + a0 + a;
          z = k + b0 + b;
        } else {
          x = i + a0 + a;
          y = j + b0 + b;
        }
        occ.add(cellKey(x, y, z));
      }
    }
  }

  function occupyCube(occ, i, j, k, n) {
    const o = -Math.floor((n - 1) / 2);
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) occ.add(cellKey(i + o + x, j + o + y, k + o + z));
      }
    }
  }

  function fillManhattan(occ, ax, ay, az, bx, by, bz, S, nW, nT) {
    const a = { x: toCell(ax, S), y: toCell(ay, S), z: toCell(az, S) };
    const b = { x: toCell(bx, S), y: toCell(by, S), z: toCell(bz, S) };
    const axis = dominantAxis(b.x - a.x, b.y - a.y, b.z - a.z);
    let x = a.x;
    let y = a.y;
    let z = a.z;
    occupyBrush(occ, x, y, z, axis, nW, nT);
    const steps = Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + Math.abs(b.z - a.z);
    for (let n = 0; n < steps; n++) {
      const dx = b.x - x;
      const dy = b.y - y;
      const dz = b.z - z;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      const adz = Math.abs(dz);
      let stepAxis = axis;
      if (adx >= ady && adx >= adz) {
        x += dx > 0 ? 1 : -1;
        stepAxis = 0;
      } else if (ady >= adz) {
        y += dy > 0 ? 1 : -1;
        stepAxis = 1;
      } else {
        z += dz > 0 ? 1 : -1;
        stepAxis = 2;
      }
      occupyBrush(occ, x, y, z, stepAxis, nW, nT);
    }
  }

  function greedyBoxes(occ) {
    const visited = new Set();
    const boxes = [];
    const cells = [];
    occ.forEach((k) => cells.push(parseCell(k)));
    cells.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
    function has(x, y, z) {
      return occ.has(cellKey(x, y, z));
    }
    function used(x, y, z) {
      return visited.has(cellKey(x, y, z));
    }
    for (let c = 0; c < cells.length; c++) {
      const p = cells[c];
      if (used(p.x, p.y, p.z)) continue;
      let x1 = p.x;
      while (has(x1 + 1, p.y, p.z) && !used(x1 + 1, p.y, p.z)) x1 += 1;
      let y1 = p.y;
      yLoop: while (true) {
        for (let x = p.x; x <= x1; x++) {
          if (!has(x, y1 + 1, p.z) || used(x, y1 + 1, p.z)) break yLoop;
        }
        y1 += 1;
      }
      let z1 = p.z;
      zLoop: while (true) {
        for (let y = p.y; y <= y1; y++) {
          for (let x = p.x; x <= x1; x++) {
            if (!has(x, y, z1 + 1) || used(x, y, z1 + 1)) break zLoop;
          }
        }
        z1 += 1;
      }
      for (let z = p.z; z <= z1; z++) {
        for (let y = p.y; y <= y1; y++) {
          for (let x = p.x; x <= x1; x++) visited.add(cellKey(x, y, z));
        }
      }
      boxes.push({ x0: p.x, y0: p.y, z0: p.z, x1: x1, y1: y1, z1: z1 });
    }
    return boxes;
  }

  function voxelBoxPose(bx, S) {
    const minx = bx.x0 * S;
    const maxx = (bx.x1 + 1) * S;
    const miny = bx.y0 * S;
    const maxy = (bx.y1 + 1) * S;
    const minz = bx.z0 * S;
    const maxz = (bx.z1 + 1) * S;
    const sx = maxx - minx;
    const sy = maxy - miny;
    const sz = maxz - minz;
    const center = v((minx + maxx) * 0.5, (miny + maxy) * 0.5, (minz + maxz) * 0.5);
    if (sx >= sy && sx >= sz) {
      return { center, U: v(1, 0, 0), W: v(0, 1, 0), T: v(0, 0, 1), hu: sx * 0.5, hw: sy * 0.5, ht: sz * 0.5 };
    }
    if (sy >= sx && sy >= sz) {
      return { center, U: v(0, 1, 0), W: v(0, 0, 1), T: v(1, 0, 0), hu: sy * 0.5, hw: sz * 0.5, ht: sx * 0.5 };
    }
    return { center, U: v(0, 0, 1), W: v(1, 0, 0), T: v(0, 1, 0), hu: sz * 0.5, hw: sx * 0.5, ht: sy * 0.5 };
  }

  function voxelStableId(bx) {
    return "v:" + bx.x0 + "," + bx.y0 + "," + bx.z0 + ">" + bx.x1 + "," + bx.y1 + "," + bx.z1;
  }

  function clipPolyToBox(pts, box) {
    const planes = [
      { nx: 1, ny: 0, nz: 0, d: box.minx },
      { nx: -1, ny: 0, nz: 0, d: -box.maxx },
      { nx: 0, ny: 1, nz: 0, d: box.miny },
      { nx: 0, ny: -1, nz: 0, d: -box.maxy },
      { nx: 0, ny: 0, nz: 1, d: box.minz },
      { nx: 0, ny: 0, nz: -1, d: -box.maxz },
    ];
    let cur = pts;
    for (let i = 0; i < planes.length; i++) {
      const pl = planes[i];
      cur = clipPolyTracked(cur, pl.nx, pl.ny, pl.nz, pl.d).pts;
      if (!cur || cur.length < 3) return [];
    }
    return cur;
  }

  function chainStableId(chain) {
    const pts = chain.points || [];
    const keys = [];
    for (let i = 0; i < pts.length; i++) {
      keys.push(round2(pts[i].x) + "," + round2(pts[i].y) + "," + round2(pts[i].z));
    }
    return "f:" + keys.join("|");
  }

  function frameFromPositions(pos) {
    const n = Math.floor((pos && pos.length ? pos.length : 0) / 3);
    if (n < 1) return { center: v(0, 0, 0), U: v(1, 0, 0), W: v(0, 1, 0), T: v(0, 0, 1) };
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      cx += pos[i * 3];
      cy += pos[i * 3 + 1];
      cz += pos[i * 3 + 2];
    }
    const center = v(cx / n, cy / n, cz / n);
    let T = v(0, 1, 0);
    let U = v(1, 0, 0);
    if (n >= 3) {
      const a = v(pos[0], pos[1], pos[2]);
      const b = v(pos[3], pos[4], pos[5]);
      const c = v(pos[6], pos[7], pos[8]);
      const tn = cross(sub(b, a), sub(c, a));
      if (len(tn) > 1e-10) T = norm(tn);
      U = sub(b, a);
      U = sub(U, scale(T, dot(U, T)));
      if (len(U) < 1e-8) U = frameForDir(T).W;
      else U = norm(U);
    }
    let W = cross(T, U);
    if (len(W) < 1e-8) W = frameForDir(U).W;
    else W = norm(W);
    T = norm(cross(U, W));
    let minU = Infinity;
    let maxU = -Infinity;
    let minW = Infinity;
    let maxW = -Infinity;
    let minT = Infinity;
    let maxT = -Infinity;
    for (let i = 0; i < n; i++) {
      const dx = pos[i * 3] - center.x;
      const dy = pos[i * 3 + 1] - center.y;
      const dz = pos[i * 3 + 2] - center.z;
      const u = dx * U.x + dy * U.y + dz * U.z;
      const w = dx * W.x + dy * W.y + dz * W.z;
      const t = dx * T.x + dy * T.y + dz * T.z;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (w < minW) minW = w;
      if (w > maxW) maxW = w;
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
    const mid = add(
      center,
      add(scale(U, (minU + maxU) * 0.5), add(scale(W, (minW + maxW) * 0.5), scale(T, (minT + maxT) * 0.5)))
    );
    return {
      center: mid,
      U,
      W,
      T,
      hu: Math.max(DIM_MIN * 0.5, (maxU - minU) * 0.5),
      hw: Math.max(DIM_MIN * 0.5, (maxW - minW) * 0.5),
      ht: Math.max(DIM_MIN * 0.5, (maxT - minT) * 0.5),
    };
  }

  function buildStripElement(id, positions, indices, ov, stripW) {
    if (!positions || positions.length < 9 || !indices || indices.length < 3) return null;
    const frame = frameFromPositions(positions);
    const posed = applyOverridePose(ov, frame, frame.center, frame.hu, frame.hw, frame.ht);
    const localPositions = worldToLocalPositions(positions, frame.center, frame.U, frame.W, frame.T, frame.hu, frame.hw, frame.ht);
    const euler = eulerDegFromFrame(posed.U, posed.W, posed.T);
    const worldPos = localToWorldPositions(localPositions, posed.center, posed.U, posed.W, posed.T, posed.hu, posed.hw, posed.ht);
    const shownW = ov && ov.width != null ? dim(ov.width, stripW) : stripW;
    return {
      id,
      kind: "surface",
      center: posed.center,
      U: posed.U,
      W: posed.W,
      T: posed.T,
      hu: posed.hu,
      hw: posed.hw,
      ht: posed.ht,
      width: shownW,
      thickness: posed.ht * 2,
      length: posed.hu * 2,
      rx: euler.rx,
      ry: euler.ry,
      rz: euler.rz,
      clipped: true,
      source: { strip: true, runIndex: 0 },
      positions: worldPos,
      indices: indices.slice(),
      localPositions,
      localIndices: indices.slice(),
      triangleCount: indices.length / 3,
    };
  }

  function fuseStrips(strips) {
    const mesh = new MeshBuilder();
    for (let i = 0; i < (strips || []).length; i++) {
      const el = strips[i];
      const pos = el.positions;
      const idx = el.indices || el.localIndices;
      if (!pos || !idx) continue;
      const map = [];
      for (let k = 0; k < pos.length; k += 3) {
        map.push(mesh.vert(v(pos[k], pos[k + 1], pos[k + 2]), false));
      }
      for (let k = 0; k < idx.length; k++) mesh.indices.push(map[idx[k]]);
    }
    return { positions: mesh.positions.slice(), indices: mesh.indices.slice() };
  }

  function surfaceFromBranches(graph, width, box, overrides) {
    const ovs = overrides || {};
    const nodes = graph.nodes || [];
    const chains = extractSurfaceChains(graph);
    const strips = [];

    function endInset(nodeId, segLen, hw) {
      const n = nodes[nodeId];
      if (!n || n.degree < 3) return 0;
      return Math.min(hw, Math.max(0, segLen * 0.45));
    }

    for (let c = 0; c < chains.length; c++) {
      const chain = chains[c];
      const id = chainStableId(chain);
      const ov = ovs[id] || {};
      if (ov.deleted) continue;
      const stripW = ov.width != null ? dim(ov.width, width) : width;
      const hw = Math.max(DIM_MIN * 0.5, Number(stripW) * 0.5);
      const maxMiter = hw * 3;
      const mesh = new MeshBuilder();
      const pts = chain.points;
      const ids = chain.nodeIds;
      const nPts = pts.length;
      if (nPts < 2) continue;
      const closed = !!chain.closed && nPts >= 3;
      const nSeg = closed ? nPts : nPts - 1;
      const dirs = [];
      const seglens = [];
      for (let i = 0; i < nSeg; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % nPts];
        const d = sub(b, a);
        const L = len(d);
        seglens.push(L);
        dirs.push(L < 1e-8 ? v(1, 0, 0) : scale(d, 1 / L));
      }
      const leftN = [];
      leftN[0] = frameForDir(dirs[0]).W;
      for (let i = 1; i < nSeg; i++) {
        leftN[i] = nextStripLeft(dirs[i - 1], leftN[i - 1], dirs[i]);
      }
      if (closed) {
        leftN[0] = nextStripLeft(dirs[nSeg - 1], leftN[nSeg - 1], dirs[0]);
        for (let i = 1; i < nSeg; i++) {
          leftN[i] = nextStripLeft(dirs[i - 1], leftN[i - 1], dirs[i]);
        }
      }

      function offsetAt(i) {
        const P = pts[i];
        if (!closed && i === 0) {
          const n = leftN[0];
          const Q = add(P, scale(dirs[0], endInset(ids[0], seglens[0], hw)));
          return { L: add(Q, scale(n, hw)), R: add(Q, scale(n, -hw)) };
        }
        if (!closed && i === nPts - 1) {
          const si = nSeg - 1;
          const n = leftN[si];
          const Q = add(P, scale(dirs[si], -endInset(ids[i], seglens[si], hw)));
          return { L: add(Q, scale(n, hw)), R: add(Q, scale(n, -hw)) };
        }
        const i0 = closed ? (i - 1 + nSeg) % nSeg : i - 1;
        const i1 = closed ? i % nSeg : i;
        const d0 = dirs[i0];
        const d1 = dirs[i1];
        const n0 = leftN[i0];
        const n1 = leftN[i1];
        if (dot(d0, d1) > COLLINEAR_DOT) {
          return { L: add(P, scale(n0, hw)), R: add(P, scale(n0, -hw)) };
        }
        let Lpt = lineClosestPoint(add(P, scale(n0, hw)), d0, add(P, scale(n1, hw)), d1);
        let Rpt = lineClosestPoint(add(P, scale(n0, -hw)), d0, add(P, scale(n1, -hw)), d1);
        if (!Lpt) Lpt = add(P, scale(n0, hw));
        if (!Rpt) Rpt = add(P, scale(n0, -hw));
        Lpt = limitMiter(Lpt, P, maxMiter);
        Rpt = limitMiter(Rpt, P, maxMiter);
        return { L: Lpt, R: Rpt };
      }

      function addClippedQuad(a, b, c, d) {
        const n = cross(sub(b, a), sub(d, a));
        if (len(n) < 1e-10) return;
        const poly = clipPolyToBox([a, b, c, d], box);
        if (poly.length < 3) return;
        mesh.addPoly(poly, n, true);
      }

      const offs = [];
      for (let i = 0; i < nPts; i++) offs.push(offsetAt(i));
      const last = closed ? nPts : nPts - 1;
      for (let i = 0; i < last; i++) {
        const a = offs[i];
        const b = offs[(i + 1) % nPts];
        addClippedQuad(a.L, b.L, b.R, a.R);
      }
      const el = buildStripElement(id, mesh.positions.slice(), mesh.indices.slice(), ov, stripW);
      if (!el) continue;
      el.source.runIndex = strips.length;
      strips.push(el);
    }
    const fused = fuseStrips(strips);
    return { positions: fused.positions, indices: fused.indices, strips };
  }

  function applyOverridePose(ov, frame, center, hu, hw, ht) {
    let U = frame.U;
    let W = frame.W;
    let T = frame.T;
    let c = v(center.x, center.y, center.z);
    let hU = hu;
    let hW = hw;
    let hT = ht;
    if (ov) {
      if (ov.width != null) hW = dim(ov.width, DEFAULTS.width) * 0.5;
      if (ov.thickness != null) hT = dim(ov.thickness, DEFAULTS.thickness) * 0.5;
      if (ov.length != null) hU = dim(ov.length, 2) * 0.5;
      if (ov.rx != null || ov.ry != null || ov.rz != null) {
        const fr = frameFromEulerDeg(ov.rx || 0, ov.ry || 0, ov.rz || 0);
        U = fr.U;
        W = fr.W;
        T = fr.T;
      }
      if (ov.cx != null) c.x = ov.cx;
      if (ov.cy != null) c.y = ov.cy;
      if (ov.cz != null) c.z = ov.cz;
    }
    return { U, W, T, center: c, hu: hU, hw: hW, ht: hT };
  }

  function rebuild(graph, options) {
    const opts = readOpts(options);
    const box = graph.box;
    const elements = [];
    const overrides = opts.overrides || {};
    const runs = graph.runs && graph.runs.length ? graph.runs : extractRuns(graph);
    graph.runs = runs;
    function flexFor(id) {
      return opts.flexId && opts.flexId === id ? opts.flexAxis : null;
    }

    const S = Math.max(DIM_MIN, opts.width);
    const nW = Math.max(1, Math.round(opts.width / S));
    const nT = Math.max(1, Math.round(opts.thickness / S));
    const nJ = Math.max(1, Math.round(opts.junction / S));
    const occ = new Set();
    const segs = graph.segs || [];
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      fillManhattan(occ, s.ax, s.ay, s.az, s.bx, s.by, s.bz, S, nW, nT);
    }
    const nodes = graph.nodes || [];
    if (nJ > 1) {
      for (let n = 0; n < nodes.length; n++) {
        const node = nodes[n];
        if (!node || node.degree < 2) continue;
        occupyCube(occ, toCell(node.x, S), toCell(node.y, S), toCell(node.z, S), nJ);
      }
    }

    let didConstrain = false;
    let invalidCount = 0;

    function pushEl(el, ov) {
      if (!el) return;
      el.override = ov || {};
      if (el.clipped) didConstrain = true;
      if (el.constrained && overrideEdited(ov)) didConstrain = true;
      if (el.invalid) invalidCount += 1;
      elements.push(el);
    }

    const boxes = greedyBoxes(occ);
    for (let i = 0; i < boxes.length; i++) {
      const bx = boxes[i];
      const id = voxelStableId(bx);
      const ov = overrides[id] || {};
      if (ov.deleted) continue;
      const pose = voxelBoxPose(bx, S);
      const posed = applyOverridePose(ov, pose, pose.center, pose.hu, pose.hw, pose.ht);
      const el = buildElement(
        id,
        "segment",
        posed.center,
        posed.U,
        posed.W,
        posed.T,
        posed.hu,
        posed.hw,
        posed.ht,
        box,
        { voxel: true, runIndex: i, x0: bx.x0, y0: bx.y0, z0: bx.z0, x1: bx.x1, y1: bx.y1, z1: bx.z1 },
        overrideEdited(ov),
        flexFor(id)
      );
      pushEl(el, ov);
    }

    let forkCount = 0;
    for (let n = 0; n < nodes.length; n++) {
      if (nodes[n] && nodes[n].degree >= 3) forkCount += 1;
    }

    for (const key in overrides) {
      if (!Object.prototype.hasOwnProperty.call(overrides, key)) continue;
      if (!isDupKey(key)) continue;
      const ov = overrides[key];
      if (!ov || ov.deleted) continue;
      const posed = applyOverridePose(
        ov,
        frameFromEulerDeg(ov.rx || 0, ov.ry || 0, ov.rz || 0),
        v(ov.cx != null ? ov.cx : 10, ov.cy != null ? ov.cy : 10, ov.cz != null ? ov.cz : 10),
        dim(ov.length != null ? ov.length : 2, 2) * 0.5,
        dim(ov.width != null ? ov.width : opts.width, opts.width) * 0.5,
        dim(ov.thickness != null ? ov.thickness : opts.thickness, opts.thickness) * 0.5
      );
      const el = buildElement(
        key,
        "duplicate",
        posed.center,
        posed.U,
        posed.W,
        posed.T,
        posed.hu,
        posed.hw,
        posed.ht,
        box,
        { dup: true },
        true,
        flexFor(key)
      );
      pushEl(el, ov);
    }

    const mesh = new MeshBuilder();
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const pos = el.positions;
      const idx = el.indices;
      const map = [];
      for (let k = 0; k < pos.length; k += 3) {
        map.push(mesh.vert(v(pos[k], pos[k + 1], pos[k + 2]), false));
      }
      for (let k = 0; k < idx.length; k++) mesh.indices.push(map[idx[k]]);
    }

    const surf = surfaceFromBranches(graph, opts.width, box, overrides);
    const surfaces = surf.strips || [];

    return {
      ok: true,
      graph,
      box,
      defaults: {
        width: opts.width,
        thickness: opts.thickness,
        junction: opts.junction,
      },
      overrides,
      elements,
      surfaces,
      elementCount: elements.length,
      segmentCount: elements.filter((e) => e.kind === "segment").length,
      runCount: boxes.length,
      junctionCount: forkCount,
      duplicateCount: elements.filter((e) => e.kind === "duplicate").length,
      didConstrain,
      invalidCount,
      positions: new Float32Array(mesh.positions),
      indices: mesh.indices.slice(),
      triangleCount: mesh.indices.length / 3,
      vertexCount: mesh.positions.length / 3,
      surfacePositions: new Float32Array(surf.positions),
      surfaceIndices: surf.indices.slice(),
      surfaceTriangleCount: surf.indices.length / 3,
      guides: graph.segs.map((s) => ({ ax: s.ax, ay: s.ay, az: s.az, bx: s.bx, by: s.by, bz: s.bz })),
    };
  }

  function fitGraphToCube(graph, cube) {
    const size = Number(cube) > 0 ? Number(cube) : CUBE;
    const nodes = graph && graph.nodes ? graph.nodes : [];
    const segs = graph && graph.segs ? graph.segs : [];
    if (!nodes.length && !segs.length) {
      if (graph) graph.box = { minx: 0, maxx: size, miny: 0, maxy: size, minz: 0, maxz: size };
      return graph;
    }
    let minx = Infinity;
    let maxx = -Infinity;
    let miny = Infinity;
    let maxy = -Infinity;
    let minz = Infinity;
    let maxz = -Infinity;
    function acc(x, y, z) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      if (z < minz) minz = z;
      if (z > maxz) maxz = z;
    }
    for (let i = 0; i < nodes.length; i++) acc(nodes[i].x, nodes[i].y, nodes[i].z);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      acc(s.ax, s.ay, s.az);
      acc(s.bx, s.by, s.bz);
    }
    if (!Number.isFinite(minx)) {
      graph.box = { minx: 0, maxx: size, miny: 0, maxy: size, minz: 0, maxz: size };
      return graph;
    }
    const dx = Math.max(1e-6, maxx - minx);
    const dy = Math.max(1e-6, maxy - miny);
    const dz = Math.max(1e-6, maxz - minz);
    const s = Math.min(size / dx, size / dy, size / dz);
    const ox = (size - dx * s) * 0.5 - minx * s;
    const oy = 0 - miny * s;
    const oz = (size - dz * s) * 0.5 - minz * s;
    function map(x, y, z) {
      return { x: x * s + ox, y: y * s + oy, z: z * s + oz };
    }
    for (let i = 0; i < nodes.length; i++) {
      const p = map(nodes[i].x, nodes[i].y, nodes[i].z);
      nodes[i].x = p.x;
      nodes[i].y = p.y;
      nodes[i].z = p.z;
    }
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const a = map(seg.ax, seg.ay, seg.az);
      const b = map(seg.bx, seg.by, seg.bz);
      seg.ax = a.x;
      seg.ay = a.y;
      seg.az = a.z;
      seg.bx = b.x;
      seg.by = b.y;
      seg.bz = b.z;
      const lx = b.x - a.x;
      const ly = b.y - a.y;
      const lz = b.z - a.z;
      const L = Math.hypot(lx, ly, lz);
      seg.len = L;
      if (L > 1e-9) {
        seg.dx = lx / L;
        seg.dy = ly / L;
        seg.dz = lz / L;
      }
    }
    graph.box = { minx: 0, maxx: size, miny: 0, maxy: size, minz: 0, maxz: size };
    graph.fit = { scale: s, ox, oy, oz, cube: size };
    return graph;
  }

  function generate(nodes, branches, box, options) {
    const graph = clipGraph(nodes, branches, box);
    if (!graph.segs.length) {
      return {
        ok: false,
        error: "No branches inside the 20' × 20' × 20' module. Grow inside the cyan box, then Generate Geometry.",
        graph,
      };
    }
    fitGraphToCube(graph, CUBE);
    return rebuild(graph, options);
  }

  function testCaps() {
    const sel = { minx: 0, maxx: 10, miny: 0, maxy: 10, minz: 0, maxz: 10 };
    const I = { U: v(1, 0, 0), W: v(0, 1, 0), T: v(0, 0, 1) };
    function make(c, hu, hw, ht, rx, ry, rz) {
      let U = I.U;
      let W = I.W;
      let T = I.T;
      if (rx || ry || rz) {
        const fr = frameFromEulerDeg(rx || 0, ry || 0, rz || 0);
        U = fr.U;
        W = fr.W;
        T = fr.T;
      }
      return buildElement("t", "segment", c, U, W, T, hu, hw, ht, sel, {}, false, null);
    }
    function report(el, expect) {
      if (!el) return { ok: expect === "empty", empty: true };
      return {
        ok: !!el.meshClosed && !el.invalid && (expect === "clipped" ? el.clipped : expect === "inside" ? !el.clipped : true),
        closed: el.meshClosed,
        clipped: el.clipped,
        invalid: el.invalid,
        issues: el.issues,
        closedBox: el.closedBox,
        tris: el.triangleCount,
      };
    }
    const A = report(make(v(5, 5, 5), 1, 1, 1), "inside");
    const B = report(make(v(10, 5, 5), 2, 1, 1), "clipped");
    const C = report(make(v(10, 10, 5), 2, 2, 1), "clipped");
    const D = report(make(v(10, 10, 10), 2, 2, 2), "clipped");
    const E = report(make(v(9, 5, 5), 2, 1, 1, 25, 18, 12), "clipped");
    const F = report(make(v(11, 5, 5), 2, 1, 1), "clipped");
    const G1 = make(v(5, 5, 5), 1.5, 1, 1);
    const G2 = make(v(6, 5, 5), 1.5, 0.6, 1.2);
    const G = { ok: !!(G1 && G2 && G1.meshClosed && G2.meshClosed), a: report(G1), b: report(G2) };
    const empty = report(make(v(20, 5, 5), 1, 1, 1), "empty");
    const touch = report(make(v(11, 5, 5), 1, 1, 1), "empty");
    return { A, B, C, D, E, F, G, empty, touch };
  }

  global.D7GridSpaces = {
    CUBE,
    DEFAULTS,
    clipGraph,
    fitGraphToCube,
    generate,
    rebuild,
    extractRuns,
    normalizeBox,
    eulerDegFromFrame,
    frameFromEulerDeg,
    testCaps,
  };
})(window);

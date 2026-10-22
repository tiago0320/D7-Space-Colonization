/**
 * Plank Builder: convert an imported 3D Grid Growth network into continuous
 * constant-width, zero-thickness plank surfaces.
 * Workspace: 20 ft cube. 1 world unit = 1 foot. Y is vertical.
 * Degree-2 runs become folded quad strips with shared edges.
 * Messy 3D bends rebuild as one crease or a trimmed fold patch.
 * Y-junctions trim all legs back, then share one equal-edge quad hub.
 */
(function (global) {
  const CUBE = 20;
  const DEFAULT_WIDTH = 2;
  const MIN_WIDTH = 0.5;
  const MAX_WIDTH = 6;
  const EPS = 1e-8;

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function cloneNetwork(data) {
    if (!data) return { cube: CUBE, unit: "ft", nodes: [], branches: [] };
    return {
      cube: CUBE,
      unit: "ft",
      nodes: (data.nodes || []).map((n) => ({
        id: n.id,
        x: Number(n.x) || 0,
        y: Number(n.y) || 0,
        z: Number(n.z) || 0,
        parentId: n.parentId,
        isRoot: !!n.isRoot,
        networkId: n.networkId,
        rootIndex: n.rootIndex,
      })),
      branches: (data.branches || []).map((b) => ({
        id: b.id,
        fromId: b.fromId,
        toId: b.toId,
        order: b.order,
        connection: !!b.connection,
      })),
    };
  }

  function edgeKey(a, b) {
    return a < b ? a + "|" + b : b + "|" + a;
  }

  function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  function len(v) {
    return Math.hypot(v.x, v.y, v.z);
  }

  function norm(v) {
    const L = len(v);
    if (L < EPS) return { x: 0, y: 0, z: 0 };
    return { x: v.x / L, y: v.y / L, z: v.z / L };
  }

  function cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  function scale(v, s) {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
  }

  function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }

  function lerp(a, b, t) {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
  }

  function rotateVec(v, axis, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const k = norm(axis);
    return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
  }

  function parallelTransport(right, t0, t1) {
    const a = norm(t0);
    const b = norm(t1);
    const c = clamp(dot(a, b), -1, 1);
    const ax = cross(a, b);
    const axl = len(ax);
    let r;
    if (axl < 1e-8) {
      r = projectPerp(right, b);
    } else {
      r = rotateVec(right, scale(ax, 1 / axl), Math.atan2(axl, c));
      r = projectPerp(r, b);
    }
    if (len(r) < 1e-6) r = perpTo(b, { x: 0, y: 1, z: 0 });
    else r = norm(r);
    if (dot(r, projectPerp(right, b)) < -0.2) r = scale(r, -1);
    return r;
  }

  /**
   * Split the graph into polylines. Intermediate vertices of degree 2 stay in one run.
   * Junctions (degree != 2) become endpoints. Cycles of all degree-2 nodes are included.
   */
  function buildChains(network) {
    const nodes = network.nodes || [];
    const branches = network.branches || [];
    const byId = new Map();
    for (let i = 0; i < nodes.length; i++) byId.set(nodes[i].id, nodes[i]);
    const adj = new Map();
    function addAdj(a, b, branchId) {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push({ nodeId: b, branchId: branchId });
    }
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      if (!byId.has(b.fromId) || !byId.has(b.toId) || b.fromId === b.toId) continue;
      addAdj(b.fromId, b.toId, b.id);
      addAdj(b.toId, b.fromId, b.id);
    }
    function degree(id) {
      return (adj.get(id) || []).length;
    }
    const used = new Set();
    const chains = [];

    function walk(start, next, firstBranchId) {
      const nodeIds = [start, next];
      const branchIds = [firstBranchId];
      used.add(edgeKey(start, next));
      let prev = start;
      let cur = next;
      while (degree(cur) === 2) {
        const nbs = adj.get(cur);
        const nb = nbs[0].nodeId === prev ? nbs[1] : nbs[0];
        const key = edgeKey(cur, nb.nodeId);
        if (used.has(key)) break;
        used.add(key);
        branchIds.push(nb.branchId);
        nodeIds.push(nb.nodeId);
        prev = cur;
        cur = nb.nodeId;
      }
      const points = [];
      for (let i = 0; i < nodeIds.length; i++) {
        const n = byId.get(nodeIds[i]);
        if (!n) continue;
        const last = points[points.length - 1];
        if (last && Math.hypot(n.x - last.x, n.y - last.y, n.z - last.z) < 1e-6) continue;
        points.push({ x: n.x, y: n.y, z: n.z });
      }
      return { nodeIds: nodeIds, branchIds: branchIds, points: points };
    }

    for (let i = 0; i < nodes.length; i++) {
      const id = nodes[i].id;
      const d = degree(id);
      if (d === 2) continue;
      const nbs = adj.get(id) || [];
      for (let j = 0; j < nbs.length; j++) {
        const nb = nbs[j];
        const key = edgeKey(id, nb.nodeId);
        if (used.has(key)) continue;
        const chain = walk(id, nb.nodeId, nb.branchId);
        if (chain.points.length >= 2) chains.push(chain);
      }
    }

    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      const key = edgeKey(b.fromId, b.toId);
      if (used.has(key)) continue;
      if (!byId.has(b.fromId) || !byId.has(b.toId)) continue;
      const chain = walk(b.fromId, b.toId, b.id);
      if (chain.points.length >= 2) chains.push(chain);
    }
    return chains;
  }

  function perpTo(dir, hint) {
    let r = cross(dir, hint);
    if (len(r) < 1e-6) r = cross(dir, { x: 1, y: 0, z: 0 });
    if (len(r) < 1e-6) r = cross(dir, { x: 0, y: 0, z: 1 });
    return norm(r);
  }

  function projectPerp(v, dir) {
    return {
      x: v.x - dir.x * dot(v, dir),
      y: v.y - dir.y * dot(v, dir),
      z: v.z - dir.z * dot(v, dir),
    };
  }

  function segmentDir(points, i) {
    return norm(sub(points[i + 1], points[i]));
  }

  function VertexPool() {
    this.verts = [];
  }
  VertexPool.prototype.add = function (p) {
    const verts = this.verts;
    for (let i = 0; i < verts.length; i++) {
      const q = verts[i];
      if (Math.abs(q.x - p.x) + Math.abs(q.y - p.y) + Math.abs(q.z - p.z) < 1e-7) return i;
    }
    verts.push({ x: p.x, y: p.y, z: p.z });
    return verts.length - 1;
  };

  function addQuad(quads, a, b, c, d) {
    if (a === b || b === c || c === d || d === a || a === c || b === d) return;
    quads.push([a, b, c, d]);
  }

  function triArea(A, B, C) {
    return len(cross(sub(B, A), sub(C, A)));
  }

  function isBowtie(a, b) {
    const n1 = cross(sub(a.R, a.L), sub(b.R, a.L));
    const n2 = cross(sub(b.R, a.L), sub(b.L, a.L));
    if (len(n1) < 1e-10 || len(n2) < 1e-10) return true;
    if (dot(n1, n2) < 0) return true;
    const area = triArea(a.L, a.R, b.R) + triArea(a.L, b.R, b.L);
    if (area < 1e-5) return true;
    return false;
  }

  function flipCross(cs) {
    return {
      center: cs.center,
      iL: cs.iR,
      iR: cs.iL,
      L: cs.R,
      R: cs.L,
      right: scale(cs.right, -1),
    };
  }

  function connectOriented(quads, a, b) {
    if (!isBowtie(a, b)) {
      addQuad(quads, a.iL, a.iR, b.iR, b.iL);
      return b;
    }
    const flipped = flipCross(b);
    if (!isBowtie(a, flipped)) {
      addQuad(quads, a.iL, a.iR, flipped.iR, flipped.iL);
      return flipped;
    }
    return null;
  }

  function crossSection(pool, center, right, half) {
    const r = norm(right);
    const L = add(center, scale(r, half));
    const R = sub(center, scale(r, half));
    return { center: center, right: r, iL: pool.add(L), iR: pool.add(R), L: L, R: R };
  }

  function connectCross(quads, a, b) {
    addQuad(quads, a.iL, a.iR, b.iR, b.iL);
  }

  function segmentLengths(points) {
    const out = [];
    for (let i = 0; i < points.length - 1; i++) out.push(len(sub(points[i + 1], points[i])));
    return out;
  }

  function initialRight(tangents, startN, endN) {
    const plane = startN || endN;
    if (plane) {
      const r = cross(plane, tangents[0]);
      if (len(r) > 1e-6) return norm(r);
    }
    for (let i = 0; i < tangents.length - 1; i++) {
      const n = cross(tangents[i], tangents[i + 1]);
      if (len(n) < 1e-5) continue;
      const r = cross(n, tangents[0]);
      if (len(r) > 1e-6) return norm(r);
    }
    return perpTo(tangents[0], { x: 0, y: 1, z: 0 });
  }

  function chainRights(tangents, startN, endN) {
    const rights = [];
    let r = initialRight(tangents, startN, endN);
    rights.push(r);
    for (let i = 0; i < tangents.length - 1; i++) {
      r = parallelTransport(r, tangents[i], tangents[i + 1]);
      rights.push(r);
    }
    return rights;
  }

  function junctionNormal(nodeId, adj, byId) {
    const p = byId.get(nodeId);
    const nbs = adj.get(nodeId) || [];
    if (!p || nbs.length < 3) return null;
    const dirs = [];
    for (let i = 0; i < nbs.length; i++) {
      const q = byId.get(nbs[i].nodeId);
      if (!q) continue;
      dirs.push(norm(sub(q, p)));
    }
    let N = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < dirs.length; i++) {
      N = add(N, cross(dirs[i], dirs[(i + 1) % dirs.length]));
    }
    if (len(N) < 1e-6) return { x: 0, y: 0, z: 1 };
    return norm(N);
  }

  function miterRight(dIn, dOut, rIn) {
    const n = cross(dIn, dOut);
    let B = add(dIn, dOut);
    if (len(n) < 1e-6 || len(B) < 1e-6) return norm(rIn);
    B = norm(B);
    let rM = cross(n, B);
    if (len(rM) < 1e-6) rM = rIn;
    rM = norm(rM);
    if (dot(rM, rIn) < 0) rM = scale(rM, -1);
    return rM;
  }

  function creaseRight(dIn, rIn, dOut, rOut) {
    const nIn = cross(dIn, rIn);
    const nOut = cross(dOut, rOut);
    let c = cross(nIn, nOut);
    if (len(c) < 1e-6) return miterRight(dIn, dOut, rIn);
    c = norm(c);
    if (dot(c, rIn) < 0) c = scale(c, -1);
    return c;
  }

  function lineIntersect(p1, d1, p2, d2) {
    const w = sub(p1, p2);
    const a = dot(d1, d1);
    const b = dot(d1, d2);
    const c = dot(d2, d2);
    const d = dot(d1, w);
    const e = dot(d2, w);
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-10) return null;
    const s = (b * e - c * d) / denom;
    const t = (a * e - b * d) / denom;
    const A = add(p1, scale(d1, s));
    const B = add(p2, scale(d2, t));
    if (len(sub(A, B)) > 2e-4) return null;
    return { point: lerp(A, B, 0.5), s: s, t: t };
  }

  function makeCross(pool, L, R) {
    return {
      center: lerp(L, R, 0.5),
      iL: pool.add(L),
      iR: pool.add(R),
      L: L,
      R: R,
      right: norm(sub(L, R)),
    };
  }

  function miterCross(pool, P, dIn, dOut, rIn, rOut, half) {
    const hitL = lineIntersect(add(P, scale(rIn, half)), dIn, add(P, scale(rOut, half)), dOut);
    const hitR = lineIntersect(sub(P, scale(rIn, half)), dIn, sub(P, scale(rOut, half)), dOut);
    if (!hitL || !hitR) return null;
    const L = hitL.point;
    const R = hitR.point;
    const span = len(sub(L, R));
    const mid = lerp(L, R, 0.5);
    if (span < half * 0.7 || span > half * 2.45) return null;
    if (len(sub(mid, P)) > half * 0.85) return null;
    if (dot(sub(L, R), rIn) < 0.35 * span) return null;
    return makeCross(pool, L, R);
  }

  function creaseCross(pool, P, dIn, rIn, dOut, rOut, half) {
    const rFold = creaseRight(dIn, rIn, dOut, rOut);
    return crossSection(pool, P, rFold, half);
  }

  function fillInnerNgon(pool, ring, quads) {
    if (ring.length < 3) return;
    if (ring.length === 4) {
      addQuad(quads, ring[0], ring[1], ring[2], ring[3]);
      return;
    }
    const verts = pool.verts;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = verts[ring[i]];
      cx += p.x;
      cy += p.y;
      cz += p.z;
    }
    const inv = 1 / ring.length;
    const c = pool.add({ x: cx * inv, y: cy * inv, z: cz * inv });
    const mids = [];
    for (let i = 0; i < ring.length; i++) {
      const a = verts[ring[i]];
      const b = verts[ring[(i + 1) % ring.length]];
      mids.push(pool.add(lerp(a, b, 0.5)));
    }
    for (let i = 0; i < ring.length; i++) {
      const prev = (i + ring.length - 1) % ring.length;
      addQuad(quads, ring[i], mids[i], c, mids[prev]);
    }
  }

  function sortLegsAround(N, legs) {
    const ref = perpTo(N, { x: 1, y: 0, z: 0 });
    const ref2 = cross(N, ref);
    legs.sort((a, b) => {
      const aa = Math.atan2(dot(a.dirAway, ref2), dot(a.dirAway, ref));
      const ba = Math.atan2(dot(b.dirAway, ref2), dot(b.dirAway, ref));
      return aa - ba;
    });
  }

  function computeJunctionTrims(degrees, adj, byId, width) {
    const half = width * 0.5;
    const out = new Map();
    degrees.forEach((d, id) => {
      if (d < 3) return;
      const p = byId.get(id);
      const nbs = adj.get(id) || [];
      if (!p || nbs.length < 3) return;
      const dirs = [];
      for (let i = 0; i < nbs.length; i++) {
        const q = byId.get(nbs[i].nodeId);
        if (!q) continue;
        dirs.push(norm(sub(q, p)));
      }
      if (dirs.length < 3) return;
      let N = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < dirs.length; i++) {
        N = add(N, cross(dirs[i], dirs[(i + 1) % dirs.length]));
      }
      if (len(N) < 1e-6) N = { x: 0, y: 0, z: 1 };
      N = norm(N);
      const items = dirs.map((dir) => ({ dirAway: dir }));
      sortLegsAround(N, items);
      let need = half * 1.1;
      for (let i = 0; i < items.length; i++) {
        const a = items[i].dirAway;
        const b = items[(i + 1) % items.length].dirAway;
        const ang = Math.acos(clamp(dot(a, b), -1, 1));
        const ha = Math.max(0.18, ang * 0.5);
        need = Math.max(need, (half / Math.tan(ha)) * 1.22);
      }
      out.set(id, clamp(need, half * 1.05, width * 1.35));
    });
    return out;
  }

  function fillJunction(J, legs, pool, quads, width) {
    if (!legs || legs.length < 3) return;
    let N = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < legs.length; i++) {
      N = add(N, cross(legs[i].dirAway, legs[(i + 1) % legs.length].dirAway));
    }
    if (len(N) < 1e-6) {
      for (let i = 0; i < legs.length; i++) N = add(N, cross(legs[i].dirAway, legs[i].right));
    }
    if (len(N) < 1e-6) N = { x: 0, y: 1, z: 0 };
    N = norm(N);
    sortLegsAround(N, legs);
    const half = width * 0.5;
    function sideIndex(leg, ccw) {
      const std = perpTo(leg.dirAway, N);
      const leftIsCcw = dot(leg.right, std) >= 0;
      if (ccw) return leftIsCcw ? leg.iL : leg.iR;
      return leftIsCcw ? leg.iR : leg.iL;
    }
    const inners = [];
    for (let i = 0; i < legs.length; i++) {
      const a = legs[i];
      const b = legs[(i + 1) % legs.length];
      let bis = add(norm(a.dirAway), norm(b.dirAway));
      const da = len(sub(a.center, J));
      const db = len(sub(b.center, J));
      if (len(bis) < 1e-6) {
        inners.push(pool.add(J));
        continue;
      }
      bis = norm(bis);
      const t = clamp(Math.min(da, db) * 0.32, half * 0.14, Math.min(da, db) * 0.42);
      inners.push(pool.add(add(J, scale(bis, t))));
    }
    for (let i = 0; i < legs.length; i++) {
      const prev = (i + legs.length - 1) % legs.length;
      addQuad(quads, sideIndex(legs[i], false), sideIndex(legs[i], true), inners[i], inners[prev]);
    }
    if (inners.length === 4) addQuad(quads, inners[0], inners[1], inners[2], inners[3]);
    else fillInnerNgon(pool, inners, quads);
  }

  function clampJunctionTrim(need, segLen, otherNeed) {
    let t = need;
    if (otherNeed > 0) {
      const sum = t + otherNeed;
      const limit = segLen * 0.82;
      if (sum > limit && sum > 1e-6) t *= limit / sum;
    }
    return clamp(t, Math.min(need * 0.35, segLen * 0.12), segLen * 0.4);
  }

  function junctionCap(pool, center, dirAway, chainRight, planeN, half) {
    let r = chainRight;
    if (planeN) {
      let rHub = cross(planeN, dirAway);
      if (len(rHub) > 1e-6) {
        rHub = norm(rHub);
        if (dot(rHub, chainRight) < 0) rHub = scale(rHub, -1);
        r = rHub;
      }
    }
    return crossSection(pool, center, r, half);
  }

  function emitSimplifiedFold(P, dIn, dOut, rIn, rOut, half, maxInset, pool, quads, prev) {
    const inset = clamp(half * 0.5, half * 0.22, maxInset);
    const csIn = crossSection(pool, sub(P, scale(dIn, inset)), rIn, half);
    let cur = connectOriented(quads, prev, csIn);
    if (!cur) {
      connectCross(quads, prev, csIn);
      cur = csIn;
    }
    const csOut = crossSection(pool, add(P, scale(dOut, inset)), rOut, half);
    let next = connectOriented(quads, cur, csOut);
    if (!next) {
      const flipped = flipCross(csOut);
      connectCross(quads, cur, flipped);
      return flipped;
    }
    return next;
  }

  function emitVertex(P, dIn, dOut, rIn, rOut, half, maxInset, pool, quads, prev) {
    const ang = Math.acos(clamp(dot(dIn, dOut), -1, 1));
    if (ang < 0.18) {
      const cs = crossSection(pool, P, rOut, half);
      const used = connectOriented(quads, prev, cs);
      return used || cs;
    }
    const nIn = cross(dIn, rIn);
    const nOut = cross(dOut, rOut);
    const coplanar =
      len(nIn) > 1e-8 && len(nOut) > 1e-8 && Math.abs(dot(norm(nIn), norm(nOut))) > 0.97;
    if (coplanar && ang < 1.05) {
      const miter = miterCross(pool, P, dIn, dOut, rIn, rOut, half);
      if (miter) {
        const used = connectOriented(quads, prev, miter);
        if (used) return used;
      }
    }
    const crease = creaseCross(pool, P, dIn, rIn, dOut, rOut, half);
    const used = connectOriented(quads, prev, crease);
    if (used) return used;
    return emitSimplifiedFold(P, dIn, dOut, rIn, rOut, half, maxInset, pool, quads, prev);
  }

  function emitChain(chain, width, degrees, pool, quads, junctionLegs, jNormals, jTrims) {
    const points = chain.points;
    const nodeIds = chain.nodeIds;
    const n = points.length;
    if (n < 2) return;
    const half = width * 0.5;
    const segs = segmentLengths(points);
    const tangents = [];
    for (let i = 0; i < n - 1; i++) tangents.push(segmentDir(points, i));
    const startN = jNormals && jNormals.get(nodeIds[0]);
    const endN = jNormals && jNormals.get(nodeIds[n - 1]);
    const rights = chainRights(tangents, startN, endN);
    const startJunc = (degrees.get(nodeIds[0]) || 0) > 2;
    const endJunc = (degrees.get(nodeIds[n - 1]) || 0) > 2;
    const startNeed = startJunc ? jTrims.get(nodeIds[0]) || half * 1.1 : 0;
    const endNeed = endJunc ? jTrims.get(nodeIds[n - 1]) || half * 1.1 : 0;

    function registerLeg(nodeId, dirAway, cs) {
      const list = junctionLegs.get(nodeId) || [];
      list.push({
        dirAway: dirAway,
        right: cs.right,
        iL: cs.iL,
        iR: cs.iR,
        center: cs.center,
      });
      junctionLegs.set(nodeId, list);
    }

    let prev;
    if (startJunc) {
      const other = endJunc && n === 2 ? endNeed : 0;
      const t = clampJunctionTrim(startNeed, segs[0], other);
      prev = junctionCap(
        pool,
        add(points[0], scale(tangents[0], t)),
        tangents[0],
        rights[0],
        startN,
        half
      );
      registerLeg(nodeIds[0], tangents[0], prev);
    } else {
      prev = crossSection(pool, points[0], rights[0], half);
    }

    for (let i = 0; i < n - 1; i++) {
      if (i === n - 2) {
        let cs;
        if (endJunc) {
          const other = startJunc && n === 2 ? startNeed : 0;
          const t = clampJunctionTrim(endNeed, segs[i], other);
          const dirAway = scale(tangents[i], -1);
          cs = junctionCap(
            pool,
            add(points[n - 1], scale(dirAway, t)),
            dirAway,
            rights[i],
            endN,
            half
          );
          registerLeg(nodeIds[n - 1], dirAway, cs);
        } else {
          cs = crossSection(pool, points[n - 1], rights[i], half);
        }
        const used = connectOriented(quads, prev, cs);
        if (!used) connectCross(quads, prev, cs);
        break;
      }
      const maxInset = Math.min(segs[i], segs[i + 1]) * 0.34;
      prev = emitVertex(
        points[i + 1],
        tangents[i],
        tangents[i + 1],
        rights[i],
        rights[i + 1],
        half,
        maxInset,
        pool,
        quads,
        prev
      );
    }
  }

  function nodeDegrees(network) {
    const deg = new Map();
    const nodes = network.nodes || [];
    const branches = network.branches || [];
    for (let i = 0; i < nodes.length; i++) deg.set(nodes[i].id, 0);
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      if (b.fromId === b.toId) continue;
      deg.set(b.fromId, (deg.get(b.fromId) || 0) + 1);
      deg.set(b.toId, (deg.get(b.toId) || 0) + 1);
    }
    return deg;
  }

  function buildPlankSystem(network, width) {
    const w = clamp(Number(width) || DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH);
    const chains = buildChains(network);
    const degrees = nodeDegrees(network);
    const byId = new Map();
    const nodes = network.nodes || [];
    for (let i = 0; i < nodes.length; i++) byId.set(nodes[i].id, nodes[i]);
    const pool = new VertexPool();
    const quads = [];
    const junctionLegs = new Map();
    const adj = new Map();
    function addAdj(a, b) {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push({ nodeId: b });
    }
    const branches = network.branches || [];
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      if (!byId.has(b.fromId) || !byId.has(b.toId) || b.fromId === b.toId) continue;
      addAdj(b.fromId, b.toId);
      addAdj(b.toId, b.fromId);
    }
    const jNormals = new Map();
    degrees.forEach((d, id) => {
      if (d > 2) jNormals.set(id, junctionNormal(id, adj, byId));
    });
    const jTrims = computeJunctionTrims(degrees, adj, byId, w);
    for (let i = 0; i < chains.length; i++) {
      emitChain(chains[i], w, degrees, pool, quads, junctionLegs, jNormals, jTrims);
    }
    junctionLegs.forEach((legs, nodeId) => {
      if (!legs || legs.length < 3) return;
      const n = byId.get(nodeId);
      if (!n) return;
      fillJunction({ x: n.x, y: n.y, z: n.z }, legs, pool, quads, w);
    });
    const kept = [];
    for (let i = 0; i < quads.length; i++) {
      const q = quads[i];
      const A = pool.verts[q[0]];
      const B = pool.verts[q[1]];
      const C = pool.verts[q[2]];
      const D = pool.verts[q[3]];
      if (!A || !B || !C || !D) continue;
      const area = triArea(A, B, C) + triArea(A, C, D);
      if (area < w * w * 0.02) continue;
      kept.push(q);
    }
    quads.length = 0;
    for (let i = 0; i < kept.length; i++) quads.push(kept[i]);
    const pos = new Float32Array(pool.verts.length * 3);
    for (let i = 0; i < pool.verts.length; i++) {
      pos[i * 3] = pool.verts[i].x;
      pos[i * 3 + 1] = pool.verts[i].y;
      pos[i * 3 + 2] = pool.verts[i].z;
    }
    const tri = [];
    const edgeSet = new Set();
    function pushEdge(a, b) {
      const k = a < b ? a + "|" + b : b + "|" + a;
      if (edgeSet.has(k)) return;
      edgeSet.add(k);
    }
    for (let i = 0; i < quads.length; i++) {
      const q = quads[i];
      tri.push(q[0], q[1], q[2], q[0], q[2], q[3]);
      pushEdge(q[0], q[1]);
      pushEdge(q[1], q[2]);
      pushEdge(q[2], q[3]);
      pushEdge(q[3], q[0]);
    }
    const edgePos = [];
    edgeSet.forEach((k) => {
      const p = k.split("|");
      const a = Number(p[0]);
      const b = Number(p[1]);
      const va = pool.verts[a];
      const vb = pool.verts[b];
      if (!va || !vb) return;
      edgePos.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
    });
    return {
      positions: pos,
      triangles: tri,
      edges: edgePos,
      chainCount: chains.length,
      quadCount: quads.length,
      chains: chains,
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", "Plank Builder viewport");
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

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.35);
    keyLight.position.set(18, 28, 14);
    scene.add(keyLight);

    const branchGeom = new THREE.BufferGeometry();
    branchGeom.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    const branches = new THREE.LineSegments(
      branchGeom,
      new THREE.LineBasicMaterial({ color: 0xff3d8a })
    );
    branches.renderOrder = 2;
    scene.add(branches);

    const plankGroup = new THREE.Group();
    plankGroup.renderOrder = 1;
    scene.add(plankGroup);

    const plankMat = new THREE.MeshBasicMaterial({
      color: 0xececec,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const plankEdgeMat = new THREE.LineBasicMaterial({
      color: 0x222222,
      transparent: true,
      opacity: 0.92,
    });

    let showBranches = true;
    let showPlanks = true;

    function clearPlanks() {
      while (plankGroup.children.length) {
        const ch = plankGroup.children[0];
        plankGroup.remove(ch);
        if (ch.geometry) ch.geometry.dispose();
      }
    }

    function setNetworkLines(network) {
      const segs = [];
      const byId = new Map();
      const nodes = (network && network.nodes) || [];
      const list = (network && network.branches) || [];
      for (let i = 0; i < nodes.length; i++) byId.set(nodes[i].id, nodes[i]);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        const a = byId.get(b.fromId);
        const c = byId.get(b.toId);
        if (!a || !c) continue;
        segs.push(a.x, a.y, a.z, c.x, c.y, c.z);
      }
      branchGeom.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
      branchGeom.computeBoundingSphere();
      branches.visible = showBranches && segs.length > 0;
    }

    function setPlankMeshes(system) {
      clearPlanks();
      const THREE = global.THREE;
      if (!system || !system.positions || !system.positions.length || !system.quadCount) {
        plankGroup.visible = false;
        return;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(system.positions, 3));
      geom.setIndex(system.triangles);
      geom.computeVertexNormals();
      geom.computeBoundingSphere();
      const mesh = new THREE.Mesh(geom, plankMat);
      mesh.frustumCulled = false;
      plankGroup.add(mesh);
      if (system.edges && system.edges.length) {
        const eg = new THREE.BufferGeometry();
        eg.setAttribute("position", new THREE.Float32BufferAttribute(system.edges, 3));
        const lines = new THREE.LineSegments(eg, plankEdgeMat);
        lines.renderOrder = 3;
        lines.frustumCulled = false;
        plankGroup.add(lines);
      }
      plankGroup.visible = showPlanks;
    }

    function setShowBranches(on) {
      showBranches = !!on;
      branches.visible = showBranches && branchGeom.getAttribute("position") && branchGeom.getAttribute("position").count > 0;
    }

    function setShowPlanks(on) {
      showPlanks = !!on;
      plankGroup.visible = showPlanks && plankGroup.children.length > 0;
    }

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
      setNetworkLines,
      setPlankMeshes,
      setShowBranches,
      setShowPlanks,
      clearPlanks,
    };
  }

  function mount() {
    const stage = document.getElementById("plankStage");
    if (!stage) return null;
    const els = {
      status: document.getElementById("plankStatus"),
      width: document.getElementById("plankWidth"),
      widthVal: document.getElementById("plankWidthVal"),
      showBranches: document.getElementById("plankShowBranches"),
      showPlanks: document.getElementById("plankShowPlanks"),
      reset: document.getElementById("plankReset"),
    };

    let viewer = null;
    let network = cloneNetwork(null);
    let chains = [];
    let width = DEFAULT_WIDTH;

    function ensureViewer() {
      if (viewer) return viewer;
      if (!global.THREE) {
        setStatus("Three.js did not load — Plank Builder cannot start.", "error");
        return null;
      }
      viewer = createViewer(stage);
      return viewer;
    }

    function setStatus(message, kind) {
      if (!els.status) return;
      els.status.textContent = message;
      els.status.classList.toggle("active", kind === "active");
      els.status.classList.toggle("error", kind === "error");
    }

    function paintWidth() {
      if (els.width) els.width.value = String(width);
      if (els.widthVal) els.widthVal.textContent = width.toFixed(1) + "'";
    }

    function paintStatus() {
      if (!network.branches.length) {
        setStatus("Send a branching network from 3D Grid Growth.");
        return;
      }
      setStatus(
        network.branches.length +
          " branches · " +
          chains.length +
          " plank runs · width " +
          width.toFixed(1) +
          "'"
      );
    }

    function paintViewButtons() {
      const mode = viewer && viewer.getViewMode ? viewer.getViewMode() : "perspective";
      document.querySelectorAll("#plankViewBar .grid3d-view-btn").forEach((btn) => {
        const on = btn.dataset.view === mode;
        btn.classList.toggle("active", on);
        btn.classList.toggle("primary", on);
        btn.classList.toggle("ghost", !on);
      });
    }

    function rebuildPlanks() {
      const v = ensureViewer();
      if (!v) return;
      const system = buildPlankSystem(network, width);
      chains = system.chains || [];
      v.setNetworkLines(network);
      v.setPlankMeshes(system);
      v.setShowBranches(!(els.showBranches) || els.showBranches.checked);
      v.setShowPlanks(!(els.showPlanks) || els.showPlanks.checked);
      paintStatus();
    }

    function receive(data) {
      network = cloneNetwork(data);
      rebuildPlanks();
      if (!network.branches.length) {
        setStatus("No branches in the sent network. Grow in 3D Grid Growth first.", "error");
      }
    }

    function resetPlanks() {
      width = DEFAULT_WIDTH;
      paintWidth();
      if (els.showBranches) els.showBranches.checked = true;
      if (els.showPlanks) els.showPlanks.checked = true;
      rebuildPlanks();
    }

    if (els.width) {
      els.width.addEventListener("input", () => {
        width = clamp(Number(els.width.value) || DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH);
        paintWidth();
        rebuildPlanks();
      });
    }
    if (els.showBranches) {
      els.showBranches.addEventListener("change", () => {
        const v = ensureViewer();
        if (v) v.setShowBranches(els.showBranches.checked);
      });
    }
    if (els.showPlanks) {
      els.showPlanks.addEventListener("change", () => {
        const v = ensureViewer();
        if (v) v.setShowPlanks(els.showPlanks.checked);
      });
    }
    if (els.reset) els.reset.addEventListener("click", () => resetPlanks());

    document.querySelectorAll("#plankViewBar .grid3d-view-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = ensureViewer();
        if (!v) return;
        v.setViewMode(btn.dataset.view);
        paintViewButtons();
      });
    });

    paintWidth();
    paintStatus();

    const api = {
      show() {
        const v = ensureViewer();
        if (!v) return;
        v.start();
        v.resize();
        if (els.showBranches) v.setShowBranches(els.showBranches.checked);
        if (els.showPlanks) v.setShowPlanks(els.showPlanks.checked);
        paintViewButtons();
      },
      hide() {
        if (viewer) viewer.stop();
      },
      resize() {
        if (viewer) viewer.resize();
      },
      receive,
      resetPlanks,
    };
    global.D7PlankBuilder.instance = api;
    return api;
  }

  global.D7PlankBuilder = {
    CUBE,
    mount,
    buildChains,
    cloneNetwork,
    buildPlankSystem,
  };
})(window);

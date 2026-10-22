/**
 * Plank Builder: convert an imported 3D Grid Growth network into simple
 * constant-width, zero-thickness planar quads.
 * Workspace: 20 ft cube. 1 world unit = 1 foot. Y is vertical.
 * One branch segment = one planar quad. Direction changes are miter-trimmed
 * so consecutive quads share one fold edge. At a Y-junction the smallest-turn
 * child continues the parent as one strip; the side branch is trimmed back
 * and connected into the side of that strip with a planar quad joint.
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
   * Split the graph into polylines. Degree-2 corners stay in one run.
   * At a Y-junction the walk continues along the smallest turn so the
   * main path is one connected strip; leftover legs start new runs.
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

    function bestContinuation(cur, prev, available) {
      if (available.length === 1) return available[0];
      const P = byId.get(cur);
      const A = byId.get(prev);
      if (!P || !A) return available[0];
      const incoming = norm(sub(P, A));
      let best = available[0];
      let bestDot = -Infinity;
      for (let i = 0; i < available.length; i++) {
        const Q = byId.get(available[i].nodeId);
        if (!Q) continue;
        const outgoing = norm(sub(Q, P));
        const d = dot(incoming, outgoing);
        if (d > bestDot) {
          bestDot = d;
          best = available[i];
        }
      }
      return best;
    }

    function walk(start, next, firstBranchId) {
      const nodeIds = [start, next];
      const branchIds = [firstBranchId];
      used.add(edgeKey(start, next));
      let prev = start;
      let cur = next;
      while (true) {
        const nbs = adj.get(cur) || [];
        const available = [];
        for (let i = 0; i < nbs.length; i++) {
          if (nbs[i].nodeId === prev) continue;
          const key = edgeKey(cur, nbs[i].nodeId);
          if (used.has(key)) continue;
          available.push(nbs[i]);
        }
        if (!available.length) break;
        const pick = degree(cur) <= 2 ? available[0] : bestContinuation(cur, prev, available);
        used.add(edgeKey(cur, pick.nodeId));
        branchIds.push(pick.branchId);
        nodeIds.push(pick.nodeId);
        prev = cur;
        cur = pick.nodeId;
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

    function startWalks(id) {
      const nbs = adj.get(id) || [];
      for (let j = 0; j < nbs.length; j++) {
        const nb = nbs[j];
        const key = edgeKey(id, nb.nodeId);
        if (used.has(key)) continue;
        const chain = walk(id, nb.nodeId, nb.branchId);
        if (chain.points.length >= 2) chains.push(chain);
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].isRoot) startWalks(nodes[i].id);
    }
    for (let i = 0; i < nodes.length; i++) {
      const id = nodes[i].id;
      if (nodes[i].isRoot || degree(id) !== 1) continue;
      startWalks(id);
    }

    for (let i = 0; i < nodes.length; i++) {
      if (degree(nodes[i].id) !== 3) continue;
      startWalks(nodes[i].id);
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

  function buildAdjacency(network) {
    const nodes = network.nodes || [];
    const branches = network.branches || [];
    const byId = new Map();
    for (let i = 0; i < nodes.length; i++) byId.set(nodes[i].id, nodes[i]);
    const adj = new Map();
    function addAdj(a, b) {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push(b);
    }
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      if (!byId.has(b.fromId) || !byId.has(b.toId) || b.fromId === b.toId) continue;
      addAdj(b.fromId, b.toId);
      addAdj(b.toId, b.fromId);
    }
    return { byId: byId, adj: adj };
  }

  function classifyYJunctions(network, chains) {
    const g = buildAdjacency(network);
    const yAt = new Map();
    for (let c = 0; c < chains.length; c++) {
      const chain = chains[c];
      const ids = chain.nodeIds;
      for (let i = 1; i < ids.length - 1; i++) {
        const id = ids[i];
        const nbs = g.adj.get(id) || [];
        if (nbs.length !== 3) continue;
        const parent = ids[i - 1];
        const main = ids[i + 1];
        let side = null;
        for (let k = 0; k < nbs.length; k++) {
          if (nbs[k] !== parent && nbs[k] !== main) side = nbs[k];
        }
        if (side == null || yAt.has(id)) continue;
        const P = g.byId.get(id);
        const S = g.byId.get(side);
        const sideDir = P && S ? norm(sub(S, P)) : { x: 0, y: 0, z: 1 };
        yAt.set(id, { parent: parent, main: main, side: side, sideDir: sideDir });
      }
    }
    return yAt;
  }

  function reverseChain(chain) {
    chain.nodeIds.reverse();
    chain.branchIds.reverse();
    chain.points.reverse();
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

  function sharedWidthDir(tIn, rIn, tOut, rOut) {
    const nIn = cross(tIn, rIn);
    const nOut = cross(tOut, rOut);
    if (len(nIn) > 1e-8 && len(nOut) > 1e-8) {
      let crease = cross(nIn, nOut);
      if (len(crease) > 1e-5) {
        crease = norm(crease);
        if (dot(crease, rIn) < 0) crease = scale(crease, -1);
        if (Math.abs(dot(crease, tIn)) < 0.96 && Math.abs(dot(crease, tOut)) < 0.96) return crease;
      }
    }
    const n = cross(tIn, tOut);
    if (len(n) < 1e-6) return norm(rIn);
    const leaveIn = scale(tIn, -1);
    let bis = add(norm(leaveIn), norm(tOut));
    if (len(bis) < 1e-6) return perpTo(tIn, n);
    bis = norm(bis);
    let m = cross(norm(n), bis);
    if (len(m) < 1e-6) m = rIn;
    m = norm(m);
    if (dot(m, rIn) < 0) m = scale(m, -1);
    return m;
  }

  function lineIntersect(p1, d1, p2, d2) {
    const a = norm(d1);
    const b = norm(d2);
    const n = cross(a, b);
    const n2 = dot(n, n);
    if (n2 < 1e-12) return null;
    const r = sub(p2, p1);
    const s = dot(cross(r, b), n) / n2;
    return add(p1, scale(a, s));
  }

  function parallelogramEnd(pool, start, endCenter) {
    const offset = sub(endCenter, start.center);
    const L = add(start.L, offset);
    const R = add(start.R, offset);
    return {
      center: endCenter,
      right: start.right,
      iL: pool.add(L),
      iR: pool.add(R),
      L: L,
      R: R,
    };
  }

  function makeCrossFromCorners(pool, L, R, hintRight) {
    const mid = scale(add(L, R), 0.5);
    let right = sub(L, R);
    if (len(right) < 1e-10) return null;
    right = norm(right);
    if (hintRight && dot(right, hintRight) < 0) {
      return {
        center: mid,
        right: scale(right, -1),
        iL: pool.add(R),
        iR: pool.add(L),
        L: R,
        R: L,
      };
    }
    return { center: mid, right: right, iL: pool.add(L), iR: pool.add(R), L: L, R: R };
  }

  function foldCross(pool, P, tIn, rIn, tOut, rOutHint, half) {
    const rInU = norm(rIn);
    let rOut = rOutHint && len(rOutHint) > 1e-8 ? norm(rOutHint) : parallelTransport(rInU, tIn, tOut);
    if (len(rOut) < 1e-8) rOut = rInU;
    if (dot(rOut, rInU) < 0) rOut = scale(rOut, -1);

    if (Math.abs(dot(norm(tIn), norm(tOut))) > 0.98) {
      return crossSection(pool, P, rInU, half);
    }

    const nIn = cross(tIn, rInU);
    const nOut = cross(tOut, rOut);
    const crease = cross(nIn, nOut);
    const outOfPlane =
      len(nIn) > 1e-8 &&
      len(nOut) > 1e-8 &&
      len(crease) > 1e-5 &&
      Math.abs(dot(norm(nIn), norm(nOut))) < 0.999;

    if (outOfPlane) {
      let c = norm(crease);
      if (dot(c, rInU) < 0) c = scale(c, -1);
      if (Math.abs(dot(c, tIn)) < 0.96 && Math.abs(dot(c, tOut)) < 0.96) {
        return crossSection(pool, P, c, half);
      }
    }

    const L = lineIntersect(add(P, scale(rInU, half)), tIn, add(P, scale(rOut, half)), tOut);
    const R = lineIntersect(sub(P, scale(rInU, half)), tIn, sub(P, scale(rOut, half)), tOut);
    if (L && R) {
      const span = len(sub(L, R));
      const mid = scale(add(L, R), 0.5);
      if (span >= half * 0.25 && span <= half * 8 && len(sub(mid, P)) <= half * 4) {
        const made = makeCrossFromCorners(pool, L, R, rInU);
        if (made) return made;
      }
    }

    return crossSection(pool, P, sharedWidthDir(tIn, rInU, tOut, rOut), half);
  }

  function quadPlanar(a, b) {
    const n1 = cross(sub(a.R, a.L), sub(b.R, a.L));
    const n2 = cross(sub(b.R, a.L), sub(b.L, a.L));
    if (len(n1) < 1e-10 || len(n2) < 1e-10) return false;
    return Math.abs(dot(norm(n1), norm(n2))) > 0.999;
  }

  function quadArea(a, b) {
    return triArea(a.L, a.R, b.R) + triArea(a.L, b.R, b.L);
  }

  function tryEmitQuad(quads, a, b, minArea) {
    const n0 = quads.length;
    const used = connectOriented(quads, a, b);
    if (used && quadPlanar(a, used) && !isBowtie(a, used) && quadArea(a, used) >= minArea) return used;
    quads.length = n0;
    return null;
  }

  function emitSpan(quads, pool, prev, endCenter, end, minArea) {
    let used = tryEmitQuad(quads, prev, end, minArea);
    if (used) return used;
    const fresh = parallelogramEnd(pool, prev, endCenter);
    used = tryEmitQuad(quads, prev, fresh, minArea);
    return used || fresh;
  }

  function yTrim(segLen, half) {
    if (segLen <= 1e-8) return 0;
    return Math.min(half, Math.max(half * 0.2, segLen * 0.35));
  }

  function makeSidePort(CA, CB, tSide) {
    const useL = dot(tSide, CA.right) >= 0;
    const A = useL ? CA.L : CA.R;
    const B = useL ? CB.L : CB.R;
    const iA = useL ? CA.iL : CA.iR;
    const iB = useL ? CB.iL : CB.iR;
    if (iA === iB) return null;
    const span = sub(A, B);
    if (len(span) < 1e-6) return null;
    const center = scale(add(A, B), 0.5);
    let right = norm(span);
    if (dot(right, CA.right) < 0) {
      return { center: center, right: scale(right, -1), iL: iB, iR: iA, L: B, R: A };
    }
    return { center: center, right: right, iL: iA, iR: iB, L: A, R: B };
  }

  function emitYJunction(pool, quads, prev, P, tIn, tOut, rIn, rOut, tSide, segIn, segOut, half, minArea, sidePorts, yId) {
    const trimIn = yTrim(segIn, half);
    const trimOut = yTrim(segOut, half);
    const cA = add(P, scale(tIn, -trimIn));
    const cB = add(P, scale(tOut, trimOut));
    const CA = crossSection(pool, cA, rIn, half);
    let CB = crossSection(pool, cB, rOut, half);
    if (dot(CB.right, CA.right) < 0) CB = flipCross(CB);

    const fromCA = emitSpan(quads, pool, prev, cA, CA, minArea);
    let joint = tryEmitQuad(quads, fromCA, CB, minArea);
    if (!joint) {
      const fresh = parallelogramEnd(pool, fromCA, cB);
      joint = tryEmitQuad(quads, fromCA, fresh, minArea);
      if (joint) CB = joint;
      else joint = fromCA;
    } else {
      CB = joint;
    }

    const port = makeSidePort(fromCA, CB, tSide);
    if (port && len(sub(port.L, port.R)) >= half * 0.4) {
      sidePorts.set(yId, port);
    } else {
      const standoff = add(P, scale(norm(tSide), half));
      let portRight = tIn;
      if (Math.abs(dot(norm(portRight), norm(tSide))) > 0.9) portRight = fromCA.right;
      sidePorts.set(yId, crossSection(pool, standoff, portRight, half));
    }
    return CB;
  }

  function emitChain(chain, width, pool, quads, nodeCross, yAt, sidePorts) {
    const points = chain.points;
    const nodeIds = chain.nodeIds;
    const n = points.length;
    if (n < 2) return;
    const half = width * 0.5;
    const minArea = width * width * 0.02;
    const segs = segmentLengths(points);
    const tangents = [];
    for (let i = 0; i < n - 1; i++) tangents.push(segmentDir(points, i));
    const rights = chainRights(tangents, null, null);

    function cached(i, hintRight, maker) {
      const id = nodeIds[i];
      if (yAt.has(id)) {
        const cs = maker();
        return hintRight && dot(cs.right, hintRight) < 0 ? flipCross(cs) : cs;
      }
      if (nodeCross.has(id)) {
        const existing = nodeCross.get(id);
        return hintRight && dot(existing.right, hintRight) < 0 ? flipCross(existing) : existing;
      }
      const cs = maker();
      nodeCross.set(id, cs);
      return cs;
    }

    let currentRight = rights[0];
    let prev;
    if (sidePorts.has(nodeIds[0])) {
      const port = sidePorts.get(nodeIds[0]);
      prev = dot(port.right, currentRight) < 0 ? flipCross(port) : port;
    } else if (yAt.has(nodeIds[0])) {
      const standoff = add(points[0], scale(tangents[0], yTrim(segs[0], half)));
      prev = crossSection(pool, standoff, currentRight, half);
    } else {
      prev = cached(0, currentRight, function () {
        return crossSection(pool, points[0], currentRight, half);
      });
    }
    currentRight = prev.right;

    for (let i = 0; i < n - 1; i++) {
      const endId = nodeIds[i + 1];
      const yInfo = yAt.get(endId);
      const endIsInteriorY =
        yInfo && i + 1 < n - 1 && nodeIds[i] == yInfo.parent && nodeIds[i + 2] == yInfo.main;

      if (endIsInteriorY) {
        const rNext = rights[i + 1];
        prev = emitYJunction(
          pool,
          quads,
          prev,
          points[i + 1],
          tangents[i],
          tangents[i + 1],
          currentRight,
          rNext,
          yInfo.sideDir,
          segs[i],
          segs[i + 1],
          half,
          minArea,
          sidePorts,
          endId
        );
        currentRight = prev.right;
      } else {
      const endCenter = points[i + 1];
      let end;
      if (sidePorts.has(endId) && i === n - 2) {
        const port = sidePorts.get(endId);
        end = dot(port.right, currentRight) < 0 ? flipCross(port) : port;
      } else if (i < n - 2) {
        const rNext = rights[i + 1];
        end = cached(i + 1, currentRight, function () {
          return foldCross(pool, endCenter, tangents[i], currentRight, tangents[i + 1], rNext, half);
        });
      } else if (nodeCross.has(endId)) {
        const existing = nodeCross.get(endId);
        end = dot(existing.right, currentRight) < 0 ? flipCross(existing) : existing;
      } else {
        end = parallelogramEnd(pool, prev, endCenter);
        if (!yAt.has(endId)) nodeCross.set(endId, end);
      }
      const used = emitSpan(quads, pool, prev, endCenter, end, minArea);
      prev = used;
      currentRight = used.right;
      }
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

  function validatePlanks(pool, quads, width) {
    let bad = 0;
    for (let i = 0; i < quads.length; i++) {
      const q = quads[i];
      const A = pool.verts[q[0]];
      const B = pool.verts[q[1]];
      const C = pool.verts[q[2]];
      const D = pool.verts[q[3]];
      if (!A || !B || !C || !D) {
        bad += 1;
        continue;
      }
      const n1 = cross(sub(B, A), sub(C, A));
      const n2 = cross(sub(C, A), sub(D, A));
      const planar =
        len(n1) > 1e-10 &&
        len(n2) > 1e-10 &&
        Math.abs(dot(norm(n1), norm(n2))) > 0.999;
      const area = triArea(A, B, C) + triArea(A, C, D);
      const ids = [q[0], q[1], q[2], q[3]];
      const unique = new Set(ids);
      if (!planar || unique.size !== 4 || area < width * width * 0.02) bad += 1;
    }
    if (bad) {
      console.warn("[Plank Builder] " + bad + "/" + quads.length + " faces failed planar-quad checks.");
    }
  }

  function buildPlankSystem(network, width) {
    const w = clamp(Number(width) || DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH);
    const chains = buildChains(network);
    chains.sort(function (a, b) {
      return b.points.length - a.points.length;
    });
    const yAt = classifyYJunctions(network, chains);
    for (let i = 0; i < chains.length; i++) {
      const ids = chains[i].nodeIds;
      if (ids.length < 2) continue;
      const yStart = yAt.has(ids[0]);
      const yEnd = yAt.has(ids[ids.length - 1]);
      if (!yStart && yEnd) reverseChain(chains[i]);
    }
    chains.sort(function (a, b) {
      function interiorY(ch) {
        for (let k = 1; k < ch.nodeIds.length - 1; k++) {
          if (yAt.has(ch.nodeIds[k])) return 1;
        }
        return 0;
      }
      const dy = interiorY(b) - interiorY(a);
      if (dy) return dy;
      return b.points.length - a.points.length;
    });
    const pool = new VertexPool();
    const quads = [];
    const nodeCross = new Map();
    const sidePorts = new Map();
    for (let i = 0; i < chains.length; i++) {
      emitChain(chains[i], w, pool, quads, nodeCross, yAt, sidePorts);
    }
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
    validatePlanks(pool, quads, w);
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
        setStatus("Three.js did not load â€” Plank Builder cannot start.", "error");
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

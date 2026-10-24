/**
 * Plank Builder: convert an imported 3D Grid Growth network into simple
 * constant-width, zero-thickness planar quads.
 * Workspace: 20 ft cube. 1 world unit = 1 foot. Y is vertical.
 * One branch segment = one planar rectangle. Direction changes never miter.
 * In-plane 90° turns get a square corner plate in that plane. Vertical-to-
 * horizontal turns share one width edge (butt joint) plus a square in the
 * outgoing plane. Every face is a flat quad. At a Y-junction the smallest-turn
 * child continues the parent as one strip; the side branch T-joins a side edge.
 * Nothing runs through the hub center.
 * Click a face to select it. Shift-click adds, Ctrl/Cmd-click toggles.
 * Selected Plank Width changes both edges of every selected plank. Direct
 * unselected neighbors keep their own target width on the far edge and
 * match the shared edge, becoming one planar trapezoid.
 */
(function (global) {
  const CUBE = 20;
  const DEFAULT_WIDTH = 2;
  const MIN_WIDTH = 0.5;
  const MAX_WIDTH = 6;
  const SELECT_MIN_WIDTH = 1;
  const SELECT_MAX_WIDTH = 8;
  const SELECT_STEP = 0.25;
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

  function classifyYJunctions(network) {
    const g = buildAdjacency(network);
    const yAt = new Map();
    g.adj.forEach(function (nbs, id) {
      if (!nbs || nbs.length < 3) return;
      const P = g.byId.get(id);
      if (!P) return;
      const dirs = [];
      for (let k = 0; k < nbs.length; k++) {
        const S = g.byId.get(nbs[k]);
        dirs.push(S ? norm(sub(S, P)) : { x: 0, y: 1, z: 0 });
      }
      const stem = P.parentId;
      let bestI = 0;
      let bestJ = 1;
      let bestDot = 1;
      let bestStem = -1;
      for (let i = 0; i < nbs.length; i++) {
        for (let j = i + 1; j < nbs.length; j++) {
          const d = dot(dirs[i], dirs[j]);
          const stemHit = stem != null && (nbs[i] == stem || nbs[j] == stem) ? 1 : 0;
          if (d < bestDot - 1e-6 || (Math.abs(d - bestDot) <= 1e-6 && stemHit > bestStem)) {
            bestDot = d;
            bestI = i;
            bestJ = j;
            bestStem = stemHit;
          }
        }
      }
      const parent = nbs[bestI];
      const main = nbs[bestJ];
      const sides = [];
      for (let k = 0; k < nbs.length; k++) {
        if (k === bestI || k === bestJ) continue;
        sides.push({ id: nbs[k], dir: dirs[k] });
      }
      if (!sides.length) return;
      yAt.set(id, {
        parent: parent,
        main: main,
        side: sides[0].id,
        sideDir: sides[0].dir,
        sides: sides,
      });
    });
    return yAt;
  }

  function stitchThroughChains(chains, yAt) {
    const covered = new Set();
    for (let c = 0; c < chains.length; c++) {
      const ids = chains[c].nodeIds;
      for (let i = 1; i < ids.length - 1; i++) {
        if (isMainThrough(chains[c], i, yAt)) covered.add(ids[i]);
      }
    }
    const used = new Set();
    const extra = [];
    yAt.forEach(function (info, yId) {
      if (covered.has(yId)) return;
      function stubAt(nodeId, neighbor, wantEnd) {
        for (let i = 0; i < chains.length; i++) {
          if (used.has(i)) continue;
          const ids = chains[i].nodeIds;
          if (ids.length < 2) continue;
          const last = ids.length - 1;
          if (wantEnd) {
            if (ids[last] == nodeId && ids[last - 1] == neighbor) return { i: i, reverse: false };
            if (ids[0] == nodeId && ids[1] == neighbor) return { i: i, reverse: true };
          } else {
            if (ids[0] == nodeId && ids[1] == neighbor) return { i: i, reverse: false };
            if (ids[last] == nodeId && ids[last - 1] == neighbor) return { i: i, reverse: true };
          }
        }
        return null;
      }
      const incoming = stubAt(yId, info.parent, true);
      const outgoing = stubAt(yId, info.main, false);
      if (!incoming || !outgoing || incoming.i === outgoing.i) return;
      const A = chains[incoming.i];
      const B = chains[outgoing.i];
      if (incoming.reverse) reverseChain(A);
      if (outgoing.reverse) reverseChain(B);
      extra.push({
        nodeIds: A.nodeIds.concat(B.nodeIds.slice(1)),
        branchIds: A.branchIds.concat(B.branchIds),
        points: A.points.concat(B.points.slice(1)),
      });
      used.add(incoming.i);
      used.add(outgoing.i);
    });
    if (!used.size) return chains;
    const out = extra.slice();
    for (let i = 0; i < chains.length; i++) {
      if (!used.has(i)) out.push(chains[i]);
    }
    return out;
  }

  function isMainThrough(chain, i, yAt) {
    const y = yAt.get(chain.nodeIds[i]);
    if (!y) return false;
    return chain.nodeIds[i - 1] == y.parent && chain.nodeIds[i + 1] == y.main;
  }

  function sliceChain(chain, i0, i1) {
    return {
      nodeIds: chain.nodeIds.slice(i0, i1 + 1),
      branchIds: chain.branchIds.slice(i0, i1),
      points: chain.points.slice(i0, i1 + 1),
    };
  }

  function splitNonMainAtJunctions(chains, yAt) {
    const out = [];
    for (let c = 0; c < chains.length; c++) {
      const chain = chains[c];
      const ids = chain.nodeIds;
      if (ids.length < 2 || chain.points.length !== ids.length) {
        out.push(chain);
        continue;
      }
      const cuts = [0];
      for (let i = 1; i < ids.length - 1; i++) {
        if (yAt.has(ids[i]) && !isMainThrough(chain, i, yAt)) cuts.push(i);
      }
      cuts.push(ids.length - 1);
      if (cuts.length === 2) {
        out.push(chain);
        continue;
      }
      for (let k = 0; k < cuts.length - 1; k++) {
        const a = cuts[k];
        const b = cuts[k + 1];
        if (b <= a) continue;
        const piece = sliceChain(chain, a, b);
        if (piece.points.length >= 2) out.push(piece);
      }
    }
    return out;
  }

  function mergeStarCenters(chains, network) {
    const nodes = network.nodes || [];
    const byId = new Map();
    for (let i = 0; i < nodes.length; i++) byId.set(nodes[i].id, nodes[i]);
    const interior = new Set();
    for (let c = 0; c < chains.length; c++) {
      const ids = chains[c].nodeIds;
      for (let i = 1; i < ids.length - 1; i++) interior.add(ids[i]);
    }
    const byStart = new Map();
    for (let c = 0; c < chains.length; c++) {
      const id = chains[c].nodeIds[0];
      if (id == null || interior.has(id)) continue;
      if (!byStart.has(id)) byStart.set(id, []);
      byStart.get(id).push(c);
    }
    const used = new Set();
    const extra = [];
    byStart.forEach(function (idxs) {
      if (idxs.length < 3) return;
      const dirs = [];
      for (let i = 0; i < idxs.length; i++) {
        const ch = chains[idxs[i]];
        const a = byId.get(ch.nodeIds[0]);
        const b = byId.get(ch.nodeIds[1]);
        dirs.push(a && b ? norm(sub(b, a)) : { x: 0, y: 1, z: 0 });
      }
      let bestI = 0;
      let bestJ = 1;
      let bestDot = 1;
      for (let i = 0; i < idxs.length; i++) {
        for (let j = i + 1; j < idxs.length; j++) {
          const d = dot(dirs[i], dirs[j]);
          if (d < bestDot) {
            bestDot = d;
            bestI = i;
            bestJ = j;
          }
        }
      }
      const A = chains[idxs[bestI]];
      const B = chains[idxs[bestJ]];
      reverseChain(A);
      extra.push({
        nodeIds: A.nodeIds.concat(B.nodeIds.slice(1)),
        branchIds: A.branchIds.concat(B.branchIds),
        points: A.points.concat(B.points.slice(1)),
      });
      used.add(idxs[bestI]);
      used.add(idxs[bestJ]);
    });
    if (!used.size) return chains;
    const out = extra.slice();
    for (let i = 0; i < chains.length; i++) {
      if (!used.has(i)) out.push(chains[i]);
    }
    return out;
  }

  function chainHasMainJunction(chain, yAt) {
    const ids = chain.nodeIds;
    for (let i = 1; i < ids.length - 1; i++) {
      if (isMainThrough(chain, i, yAt)) return true;
    }
    return false;
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
      if (Math.abs(q.x - p.x) + Math.abs(q.y - p.y) + Math.abs(q.z - p.z) < 1e-5) return i;
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

  function initialRight(tangents) {
    const t = tangents[0];
    const flat = cross({ x: 0, y: 1, z: 0 }, t);
    if (len(flat) > 1e-6) return norm(flat);
    return perpTo(t, { x: 1, y: 0, z: 0 });
  }

  function chainRights(tangents, startN, endN) {
    const rights = [];
    let r = initialRight(tangents);
    rights.push(r);
    for (let i = 0; i < tangents.length - 1; i++) {
      r = parallelTransport(r, tangents[i], tangents[i + 1]);
      rights.push(r);
    }
    return rights;
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

  function planesCoplanar(t0, r0, t1, r1) {
    const n0 = cross(t0, r0);
    const n1 = cross(t1, r1);
    if (len(n0) < 1e-8 || len(n1) < 1e-8) return true;
    return Math.abs(dot(norm(n0), norm(n1))) > 0.92;
  }

  function emitFlatSpan(quads, pool, prev, endCenter, minArea) {
    if (!prev || !endCenter) return prev;
    if (len(sub(prev.center, endCenter)) < 1e-4) return prev;
    const end = parallelogramEnd(pool, prev, endCenter);
    const used = tryEmitQuad(quads, prev, end, minArea);
    if (used) return used;
    connectCross(quads, prev, end);
    return end;
  }

  function emitCoplanarElbow(pool, quads, prev, P, t0, t1, half, minArea, segIn, segOut, sidePorts, yId) {
    const reach = Math.max(0, len(sub(P, prev.center)));
    const outLen = Number(segOut) || 0;
    if (reach < half * 0.99 || outLen < half * 0.99) {
      return emitButtTurn(pool, quads, prev, P, t1, half, minArea, segOut, sidePorts, yId);
    }
    const d = half;
    const Cin = add(P, scale(t0, -d));
    const usedIn = emitFlatSpan(quads, pool, prev, Cin, minArea);
    const v = scale(t0, 2 * half);
    const Cpt = add(usedIn.R, v);
    const Dpt = add(usedIn.L, v);
    const iC = pool.add(Cpt);
    const iD = pool.add(Dpt);
    addQuad(quads, usedIn.iL, usedIn.iR, iC, iD);
    const Cout = add(P, scale(t1, half));
    const edges = [
      { L: Dpt, R: Cpt, iL: iD, iR: iC },
      { L: usedIn.L, R: Dpt, iL: usedIn.iL, iR: iD },
      { L: usedIn.R, R: Cpt, iL: usedIn.iR, iR: iC },
    ];
    let best = edges[0];
    let bestD = Infinity;
    for (let i = 0; i < edges.length; i++) {
      const mid = scale(add(edges[i].L, edges[i].R), 0.5);
      const dist = len(sub(mid, Cout));
      if (dist < bestD) {
        bestD = dist;
        best = edges[i];
      }
    }
    const rHint = parallelTransport(usedIn.right, t0, t1);
    const exit = makePortFromCorners(best.L, best.R, best.iL, best.iR, rHint);
    if (sidePorts && yId != null) {
      addHubSpan(
        sidePorts,
        yId,
        {
          L: usedIn.L,
          R: Dpt,
          iL: usedIn.iL,
          iR: iD,
          center: scale(add(usedIn.L, Dpt), 0.5),
          right: usedIn.right,
        },
        {
          L: usedIn.R,
          R: Cpt,
          iL: usedIn.iR,
          iR: iC,
          center: scale(add(usedIn.R, Cpt), 0.5),
          right: scale(usedIn.right, -1),
        },
        P,
        quads
      );
    }
    return exit || usedIn;
  }

  function emitButtTurn(pool, quads, prev, P, t1, half, minArea, segOut, sidePorts, yId) {
    const used = emitFlatSpan(quads, pool, prev, P, minArea);
    const remain = Number(segOut) || 0;
    const squareLen = 2 * half;
    const canSquare =
      remain > squareLen + half * 0.25 && Math.abs(dot(norm(t1), used.right)) < 0.96;
    if (!canSquare) {
      if (sidePorts && yId != null) addHubSpan(sidePorts, yId, used, used, P, quads);
      return used;
    }
    const c = add(P, scale(norm(t1), squareLen));
    const nxt = emitFlatSpan(quads, pool, used, c, minArea);
    if (sidePorts && yId != null) addHubSpan(sidePorts, yId, used, nxt, P, quads);
    return nxt;
  }

  function emitTurn(pool, quads, prev, P, tIn, tOut, rOutHint, half, minArea, segIn, segOut, sidePorts, yId) {
    const t0 = norm(tIn);
    const t1 = norm(tOut);
    if (Math.abs(dot(t0, t1)) > 0.98) {
      return emitFlatSpan(quads, pool, prev, P, minArea);
    }
    let r1 = rOutHint && len(rOutHint) > 1e-8 ? norm(rOutHint) : parallelTransport(prev.right, t0, t1);
    if (len(r1) < 1e-8) r1 = prev.right;
    if (dot(r1, prev.right) < 0) r1 = scale(r1, -1);
    if (planesCoplanar(t0, prev.right, t1, r1)) {
      return emitCoplanarElbow(pool, quads, prev, P, t0, t1, half, minArea, segIn, segOut, sidePorts, yId);
    }
    return emitButtTurn(pool, quads, prev, P, t1, half, minArea, segOut, sidePorts, yId);
  }

  function attachToPort(quads, pool, prev, port, hintRight, minArea) {
    if (!prev || !port) return null;
    const oriented = orientPort(port, hintRight || prev.right);
    if (!oriented) return null;
    if (facesOnEdge(quads, oriented.iL, oriented.iR) >= 2) return oriented;
    if (
      (prev.iL === oriented.iL && prev.iR === oriented.iR) ||
      (prev.iL === oriented.iR && prev.iR === oriented.iL)
    ) {
      return oriented;
    }
    let used = tryEmitQuad(quads, prev, oriented, minArea);
    if (used) return oriented;
    if (quadPlanar(prev, oriented) && !isBowtie(prev, oriented)) {
      connectCross(quads, prev, oriented);
      return oriented;
    }
    const mid = emitFlatSpan(quads, pool, prev, oriented.center, minArea);
    used = tryEmitQuad(quads, mid, oriented, minArea);
    if (used) return oriented;
    if (quadPlanar(mid, oriented) && !isBowtie(mid, oriented)) {
      connectCross(quads, mid, oriented);
      return oriented;
    }
    const welded = connectOriented(quads, mid, oriented);
    if (welded) return welded;
    connectCross(quads, mid, oriented);
    return oriented;
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

  function emitSpan(quads, pool, prev, endCenter, end, minArea, lockEnd) {
    if (lockEnd && end && end.iL != null && end.iR != null) {
      const locked = tryEmitQuad(quads, prev, end, minArea);
      if (locked) return locked;
      if (quadPlanar(prev, end) && !isBowtie(prev, end)) {
        connectCross(quads, prev, end);
        return end;
      }
    }
    return emitFlatSpan(quads, pool, prev, endCenter || (end && end.center), minArea);
  }

  function yTrim(segLen, half) {
    if (segLen <= 1e-8) return 0;
    return Math.min(half, Math.max(half * 0.2, segLen * 0.35));
  }

  function makePortFromCorners(A, B, iA, iB, hintRight) {
    if (iA == null || iB == null || iA === iB) return null;
    if (len(sub(A, B)) < 1e-6) return null;
    const center = scale(add(A, B), 0.5);
    let right = sub(A, B);
    if (len(right) < 1e-10) return null;
    right = norm(right);
    if (hintRight && dot(right, hintRight) < 0) {
      return { center: center, right: scale(right, -1), iL: iB, iR: iA, L: B, R: A };
    }
    return { center: center, right: right, iL: iA, iR: iB, L: A, R: B };
  }

  function ensureHub(ports, id, P) {
    if (!ports.has(id)) ports.set(id, { P: P, slots: [] });
    return ports.get(id);
  }

  function edgeKeyIds(a, b) {
    return a < b ? a + "|" + b : b + "|" + a;
  }

  function facesOnEdge(quads, a, b) {
    const k = edgeKeyIds(a, b);
    let n = 0;
    for (let f = 0; f < quads.length; f++) {
      const q = quads[f];
      const loops = [[q[0], q[1]], [q[1], q[2]], [q[2], q[3]], [q[3], q[0]]];
      for (let e = 0; e < 4; e++) {
        if (edgeKeyIds(loops[e][0], loops[e][1]) === k) n += 1;
      }
    }
    return n;
  }

  function addHubSpan(ports, id, CA, CB, P, quads) {
    if (!CA || !CB) return;
    const hub = ensureHub(ports, id, P || CA.center);
    const L = makePortFromCorners(CA.L, CB.L, CA.iL, CB.iL, CA.right);
    const R = makePortFromCorners(CA.R, CB.R, CA.iR, CB.iR, scale(CA.right, -1));
    const In = makePortFromCorners(CA.L, CA.R, CA.iL, CA.iR, CA.right);
    const Out = makePortFromCorners(CB.L, CB.R, CB.iL, CB.iR, CB.right || CA.right);
    function addSlot(port) {
      if (!port) return;
      const k = edgeKeyIds(port.iL, port.iR);
      if (hub.slots.some(function (s) { return s.key === k; })) return;
      if (quads && facesOnEdge(quads, port.iL, port.iR) >= 2) return;
      hub.slots.push({ port: port, used: false, key: k });
    }
    addSlot(L);
    addSlot(R);
    addSlot(In);
    addSlot(Out);
  }

  function takeHubPort(ports, id, dirFromJunction, quads) {
    const hub = ports.get(id);
    if (!hub || !hub.slots.length) return null;
    const dir = norm(dirFromJunction);
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < hub.slots.length; i++) {
      const slot = hub.slots[i];
      if (!slot.port || slot.used) continue;
      if (quads && facesOnEdge(quads, slot.port.iL, slot.port.iR) >= 2) continue;
      const offset = sub(slot.port.center, hub.P);
      const wantRight = perpTo(dir, { x: 0, y: 1, z: 0 });
      const align = Math.abs(dot(slot.port.right, wantRight));
      const sc = align * 2 + dot(offset, dir) - 0.35 * len(offset);
      if (sc > bestScore) {
        bestScore = sc;
        best = i;
      }
    }
    if (best < 0) return null;
  }

  function orientPort(port, hintRight) {
    if (!port) return null;
    return hintRight && dot(port.right, hintRight) < 0 ? flipCross(port) : port;
  }

  function emitYJunction(pool, quads, prev, P, tIn, tOut, rIn, rOut, tSide, segIn, segOut, half, minArea, sidePorts, yId) {
    const t0 = norm(tIn);
    const t1 = norm(tOut);
    if (Math.abs(dot(t0, t1)) < 0.98) {
      return emitTurn(pool, quads, prev, P, t0, t1, rOut, half, minArea, segIn, segOut, sidePorts, yId);
    }
    const trimIn = yTrim(segIn, half);
    const trimOut = yTrim(segOut, half);
    const cA = add(P, scale(t0, -trimIn));
    const cB = add(P, scale(t1, trimOut));
    const fromCA = emitFlatSpan(quads, pool, prev, cA, minArea);
    const CB = emitFlatSpan(quads, pool, fromCA, cB, minArea);
    addHubSpan(sidePorts, yId, fromCA, CB, P, quads);
    return CB;
  }

  function emitChain(chain, width, pool, quads, nodeCross, yAt, sidePorts, startCount) {
    const points = chain.points;
    const nodeIds = chain.nodeIds;
    const n = points.length;
    if (n < 2) return;
    const half = width * 0.5;
    const minArea = Math.max(1e-6, width * 0.002);
    const segs = segmentLengths(points);
    const tangents = [];
    for (let i = 0; i < n - 1; i++) tangents.push(segmentDir(points, i));
    const rights = chainRights(tangents, null, null);
    const startId = nodeIds[0];
    const hubStart = yAt.has(startId) || sidePorts.has(startId);

    function cached(i, hintRight, maker) {
      const id = nodeIds[i];
      if (yAt.has(id)) return null;
      if (nodeCross.has(id)) {
        const existing = nodeCross.get(id);
        if (facesOnEdge(quads, existing.iL, existing.iR) >= 2) return null;
        return hintRight && dot(existing.right, hintRight) < 0 ? flipCross(existing) : existing;
      }
      const cs = maker();
      nodeCross.set(id, cs);
      return cs;
    }

    let currentRight = rights[0];
    let prev;
    if (hubStart) {
      const port = takeHubPort(sidePorts, startId, tangents[0], quads);
      if (port) {
        prev = orientPort(port, currentRight) || port;
      } else {
        const trim = Math.min(Math.max(yTrim(segs[0], half), half * 0.2), segs[0] * 0.45);
        const origin = add(points[0], scale(tangents[0], trim));
        prev = crossSection(pool, origin, currentRight, half);
      }
    } else {
      prev = cached(0, currentRight, function () {
        return crossSection(pool, points[0], currentRight, half);
      });
      if (!prev) prev = crossSection(pool, points[0], currentRight, half);
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
        continue;
      }

      const endCenter = points[i + 1];
      let end;
      let lockEnd = false;
      const hubEnd = i === n - 2 && (yAt.has(endId) || sidePorts.has(endId));
      if (hubEnd) {
        const port = takeHubPort(sidePorts, endId, sub(points[i], points[i + 1]), quads);
        if (port) {
          const attached = attachToPort(quads, pool, prev, port, currentRight, minArea);
          prev = attached || prev;
          currentRight = prev.right;
          continue;
        }
        const trim = Math.min(Math.max(yTrim(segs[i], half), half * 0.2), segs[i] * 0.45);
        const c = add(endCenter, scale(tangents[i], -trim));
        prev = emitFlatSpan(quads, pool, prev, c, minArea);
        currentRight = prev.right;
        continue;
      } else if (i < n - 2) {
        prev = emitTurn(
          pool,
          quads,
          prev,
          endCenter,
          tangents[i],
          tangents[i + 1],
          rights[i + 1],
          half,
          minArea,
          segs[i],
          segs[i + 1],
          null,
          null
        );
        currentRight = prev.right;
        continue;
      } else if (nodeCross.has(endId) && !yAt.has(endId)) {
        const existing = nodeCross.get(endId);
        const aligned = Math.abs(dot(norm(existing.right), norm(currentRight))) > 0.85;
        const oriented = dot(existing.right, currentRight) < 0 ? flipCross(existing) : existing;
        if (!aligned || facesOnEdge(quads, oriented.iL, oriented.iR) >= 2) {
          end = parallelogramEnd(pool, prev, endCenter);
        } else {
          end = oriented;
          lockEnd = true;
        }
      } else {
        end = parallelogramEnd(pool, prev, endCenter);
        if (!yAt.has(endId) && (startCount.get(endId) || 0) < 2) nodeCross.set(endId, end);
      }
      if (!end) end = parallelogramEnd(pool, prev, endCenter);
      const used = emitSpan(quads, pool, prev, end.center || endCenter, end, minArea, lockEnd);
      prev = used;
      currentRight = used.right;
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

  function clonePt(p) {
    return { x: p.x, y: p.y, z: p.z };
  }

  function cloneVerts(verts) {
    const out = [];
    for (let i = 0; i < verts.length; i++) out.push(clonePt(verts[i]));
    return out;
  }

  function copyVerts(src, dst) {
    for (let i = 0; i < src.length; i++) {
      dst[i].x = src[i].x;
      dst[i].y = src[i].y;
      dst[i].z = src[i].z;
    }
  }

  function projectToPlane(p, origin, n) {
    return sub(p, scale(n, dot(sub(p, origin), n)));
  }

  function makePlankRecords(pool, quads, width) {
    const w0 = clamp(Number(width) || DEFAULT_WIDTH, MIN_WIDTH, SELECT_MAX_WIDTH);
    const planks = [];
    const verts = pool.verts;
    for (let i = 0; i < quads.length; i++) {
      const q = quads[i];
      const A = verts[q[0]] || { x: 0, y: 0, z: 0 };
      const B = verts[q[1]] || { x: 0, y: 0, z: 0 };
      const C = verts[q[2]] || { x: 0, y: 0, z: 0 };
      const D = verts[q[3]] || { x: 0, y: 0, z: 0 };
      const startC = scale(add(A, B), 0.5);
      const endC = scale(add(D, C), 0.5);
      let startR = sub(A, B);
      let endR = sub(D, C);
      if (len(startR) < 1e-8) startR = { x: 1, y: 0, z: 0 };
      if (len(endR) < 1e-8) endR = startR;
      startR = norm(startR);
      endR = norm(endR);
      if (dot(endR, startR) < 0) endR = scale(endR, -1);
      planks[i] = {
        id: i,
        quad: [q[0], q[1], q[2], q[3]],
        targetWidth: w0,
        start: { iL: q[0], iR: q[1], center: clonePt(startC), right: startR },
        end: { iL: q[3], iR: q[2], center: clonePt(endC), right: endR },
      };
    }
    const joints = new Map();
    function addIncident(plank, which) {
      const end = plank[which];
      const k = edgeKeyIds(end.iL, end.iR);
      if (!joints.has(k)) {
        joints.set(k, {
          key: k,
          iL: end.iL,
          iR: end.iR,
          center: clonePt(end.center),
          right: { x: end.right.x, y: end.right.y, z: end.right.z },
          incidents: [],
        });
      }
      joints.get(k).incidents.push({ id: plank.id, end: which });
    }
    for (let i = 0; i < planks.length; i++) {
      addIncident(planks[i], "start");
      addIncident(planks[i], "end");
    }
    return { planks: planks, joints: joints };
  }

  function jointWidth(joint, planks, overrides) {
    if (overrides && overrides.has(joint.key)) return overrides.get(joint.key);
    let w = 0;
    for (let i = 0; i < joint.incidents.length; i++) {
      const p = planks[joint.incidents[i].id];
      if (p) w = Math.max(w, p.targetWidth);
    }
    return w || DEFAULT_WIDTH;
  }

  function placeJoint(verts, joint, width) {
    const half = Math.max(0.05, width) * 0.5;
    const r = norm(joint.right);
    const L = add(joint.center, scale(r, half));
    const R = sub(joint.center, scale(r, half));
    const iL = joint.iL;
    const iR = joint.iR;
    if (verts[iL]) {
      verts[iL].x = L.x;
      verts[iL].y = L.y;
      verts[iL].z = L.z;
    }
    if (verts[iR]) {
      verts[iR].x = R.x;
      verts[iR].y = R.y;
      verts[iR].z = R.z;
    }
  }

  function planarizePlank(verts, plank, overrides) {
    const A = verts[plank.start.iL];
    const B = verts[plank.start.iR];
    const C = verts[plank.end.iR];
    const D = verts[plank.end.iL];
    if (!A || !B || !C || !D) return;
    const n1 = cross(sub(B, A), sub(C, A));
    const n2 = cross(sub(C, A), sub(D, A));
    if (len(n1) > 1e-10 && len(n2) > 1e-10 && Math.abs(dot(norm(n1), norm(n2))) > 0.999) return;
    const startLocked = overrides && overrides.has(edgeKeyIds(plank.start.iL, plank.start.iR));
    const endLocked = overrides && overrides.has(edgeKeyIds(plank.end.iL, plank.end.iR));
    if (startLocked && endLocked) return;
    const moveEnd = !endLocked;
    const origin = moveEnd ? A : C;
    const edgeU = moveEnd ? sub(B, A) : sub(D, C);
    const toward = moveEnd
      ? sub(plank.end.center, plank.start.center)
      : sub(plank.start.center, plank.end.center);
    let n = cross(edgeU, toward);
    if (len(n) < 1e-8) n = n1;
    if (len(n) < 1e-8) return;
    n = norm(n);
    if (moveEnd) {
      const pC = projectToPlane(C, origin, n);
      const pD = projectToPlane(D, origin, n);
      const mid = scale(add(pC, pD), 0.5);
      let r = sub(pD, pC);
      if (len(r) < 1e-8) r = plank.end.right;
      r = norm(r);
      if (dot(r, plank.end.right) < 0) r = scale(r, -1);
      const half = 0.5 * Math.max(1e-4, len(sub(D, C)));
      const L = add(mid, scale(r, half));
      const R = sub(mid, scale(r, half));
      D.x = L.x;
      D.y = L.y;
      D.z = L.z;
      C.x = R.x;
      C.y = R.y;
      C.z = R.z;
    } else {
      const pA = projectToPlane(A, origin, n);
      const pB = projectToPlane(B, origin, n);
      const mid = scale(add(pA, pB), 0.5);
      let r = sub(pA, pB);
      if (len(r) < 1e-8) r = plank.start.right;
      r = norm(r);
      if (dot(r, plank.start.right) < 0) r = scale(r, -1);
      const half = 0.5 * Math.max(1e-4, len(sub(A, B)));
      const L = add(mid, scale(r, half));
      const R = sub(mid, scale(r, half));
      A.x = L.x;
      A.y = L.y;
      A.z = L.z;
      B.x = R.x;
      B.y = R.y;
      B.z = R.z;
    }
  }

  function refreshSystemBuffers(system) {
    const verts = system.verts;
    const quads = system.quads;
    const pos = new Float32Array(verts.length * 3);
    for (let i = 0; i < verts.length; i++) {
      pos[i * 3] = verts[i].x;
      pos[i * 3 + 1] = verts[i].y;
      pos[i * 3 + 2] = verts[i].z;
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
    edgeSet.forEach(function (k) {
      const p = k.split("|");
      const a = Number(p[0]);
      const b = Number(p[1]);
      const va = verts[a];
      const vb = verts[b];
      if (!va || !vb) return;
      edgePos.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
    });
    system.positions = pos;
    system.triangles = tri;
    system.edges = edgePos;
    system.quadCount = quads.length;
  }

  function applyPlankWidths(system) {
    if (!system || !system.planks || !system.restVerts || !system.joints) return system;
    copyVerts(system.restVerts, system.verts);
    const overrides = system.jointOverrides || new Map();
    const deferred = [];
    system.joints.forEach(function (joint) {
      if (overrides.has(joint.key)) deferred.push(joint);
      else placeJoint(system.verts, joint, jointWidth(joint, system.planks, overrides));
    });
    for (let i = 0; i < deferred.length; i++) {
      placeJoint(system.verts, deferred[i], jointWidth(deferred[i], system.planks, overrides));
    }
    for (let i = 0; i < system.planks.length; i++) {
      planarizePlank(system.verts, system.planks[i], overrides);
    }
    refreshSystemBuffers(system);
    validatePlanks({ verts: system.verts }, system.quads, system.defaultWidth || DEFAULT_WIDTH);
    return system;
  }

  function setPlankTargetWidths(system, plankIds, nextWidth) {
    if (!system || !system.planks) return system;
    const ids = [];
    const seen = new Set();
    const src = Array.isArray(plankIds) ? plankIds : [plankIds];
    for (let i = 0; i < src.length; i++) {
      const id = src[i];
      if (id == null || id < 0 || seen.has(id) || !system.planks[id]) continue;
      seen.add(id);
      ids.push(id);
    }
    if (!ids.length) return system;
    const w = clamp(Number(nextWidth) || system.defaultWidth || DEFAULT_WIDTH, SELECT_MIN_WIDTH, SELECT_MAX_WIDTH);
    if (!system.jointOverrides) system.jointOverrides = new Map();
    const selSet = new Set();
    for (let n = 0; n < ids.length; n++) {
      const plank = system.planks[ids[n]];
      plank.targetWidth = w;
      const q = plank.quad;
      selSet.add(edgeKeyIds(plank.start.iL, plank.start.iR));
      selSet.add(edgeKeyIds(plank.end.iL, plank.end.iR));
      selSet.add(edgeKeyIds(q[0], q[1]));
      selSet.add(edgeKeyIds(q[1], q[2]));
      selSet.add(edgeKeyIds(q[2], q[3]));
      selSet.add(edgeKeyIds(q[3], q[0]));
    }
    selSet.forEach(function (k) {
      system.jointOverrides.set(k, w);
    });
    system.joints.forEach(function (joint) {
      if (selSet.has(joint.key)) {
        system.jointOverrides.set(joint.key, w);
        return;
      }
      for (let i = 0; i < joint.incidents.length; i++) {
        if (seen.has(joint.incidents[i].id)) system.jointOverrides.set(joint.key, w);
      }
    });
    const planks = system.planks;
    for (let i = 0; i < planks.length; i++) {
      if (seen.has(i) || !planks[i]) continue;
      const ends = [planks[i].start, planks[i].end];
      for (let e = 0; e < 2; e++) {
        const k = edgeKeyIds(ends[e].iL, ends[e].iR);
        if (selSet.has(k)) system.jointOverrides.set(k, w);
      }
    }
    return applyPlankWidths(system);
  }

  function setPlankTargetWidth(system, plankId, nextWidth) {
    return setPlankTargetWidths(system, [plankId], nextWidth);
  }

  function resetPlankTargetWidths(system, width) {
    if (!system || !system.planks) return system;
    const w = clamp(Number(width) || system.defaultWidth || DEFAULT_WIDTH, MIN_WIDTH, SELECT_MAX_WIDTH);
    for (let i = 0; i < system.planks.length; i++) system.planks[i].targetWidth = w;
    system.jointOverrides = new Map();
    system.defaultWidth = w;
    return applyPlankWidths(system);
  }

  function uniqueQuads(quads) {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < quads.length; i++) {
      const q = quads[i];
      const sig = [q[0], q[1], q[2], q[3]].slice().sort(function (a, b) { return a - b; }).join(":");
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(q);
    }
    return out;
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
      if (!planar || unique.size !== 4 || area < Math.max(1e-8, width * 0.002)) bad += 1;
    }
    const edgeMap = new Map();
    function key(a, b) {
      return a < b ? a + "|" + b : b + "|" + a;
    }
    let stacked = 0;
    for (let f = 0; f < quads.length; f++) {
      const q = quads[f];
      const loops = [[q[0], q[1]], [q[1], q[2]], [q[2], q[3]], [q[3], q[0]]];
      for (let e = 0; e < 4; e++) {
        const k = key(loops[e][0], loops[e][1]);
        edgeMap.set(k, (edgeMap.get(k) || 0) + 1);
      }
    }
    edgeMap.forEach(function (n) {
      if (n > 2) stacked += 1;
    });
    if (bad) {
      console.warn("[Plank Builder] " + bad + "/" + quads.length + " faces failed planar-quad checks.");
    }
    if (stacked) {
      console.warn("[Plank Builder] " + stacked + " edges still shared by more than two faces.");
    }
  }

  function buildPlankSystem(network, width) {
    const w = clamp(Number(width) || DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH);
    let chains = buildChains(network);
    chains.sort(function (a, b) {
      return b.points.length - a.points.length;
    });
    chains = mergeStarCenters(chains, network);
    const yAt = classifyYJunctions(network);
    chains = splitNonMainAtJunctions(chains, yAt);
    chains = stitchThroughChains(chains, yAt);
    for (let i = 0; i < chains.length; i++) {
      const ids = chains[i].nodeIds;
      if (ids.length < 2) continue;
      const yStart = yAt.has(ids[0]);
      const yEnd = yAt.has(ids[ids.length - 1]);
      if (!yStart && yEnd) reverseChain(chains[i]);
    }
    const mains = [];
    const rest = [];
    for (let i = 0; i < chains.length; i++) {
      if (chainHasMainJunction(chains[i], yAt)) mains.push(chains[i]);
      else rest.push(chains[i]);
    }
    mains.sort(function (a, b) { return b.points.length - a.points.length; });
    rest.sort(function (a, b) { return b.points.length - a.points.length; });
    chains = mains.concat(rest);
    const startCount = new Map();
    for (let i = 0; i < chains.length; i++) {
      const id = chains[i].nodeIds[0];
      if (id == null) continue;
      startCount.set(id, (startCount.get(id) || 0) + 1);
    }
    const pool = new VertexPool();
    const quads = [];
    const nodeCross = new Map();
    const sidePorts = new Map();
    const byId = new Map();
    const nodes = network.nodes || [];
    for (let i = 0; i < nodes.length; i++) byId.set(nodes[i].id, nodes[i]);
    const half = w * 0.5;
    const minArea = Math.max(1e-6, w * 0.002);
    function waitingOnHub(chain) {
      const sid = chain.nodeIds[0];
      return yAt.has(sid) && !sidePorts.has(sid) && !chainHasMainJunction(chain, yAt);
    }
    function emitList(list, defer) {
      const again = [];
      for (let i = 0; i < list.length; i++) {
        if (defer && waitingOnHub(list[i])) {
          again.push(list[i]);
          continue;
        }
        emitChain(list[i], w, pool, quads, nodeCross, yAt, sidePorts, startCount);
      }
      return again;
    }
    let pending = emitList(mains, true);
    pending = pending.concat(emitList(rest, true));
    yAt.forEach(function (info, yId) {
      if (sidePorts.has(yId)) return;
      const P = byId.get(yId);
      const A = byId.get(info.parent);
      const B = byId.get(info.main);
      if (!P || !A || !B) return;
      const tIn = norm(sub(P, A));
      const tOut = norm(sub(B, P));
      if (len(tIn) < 1e-8 || len(tOut) < 1e-8) return;
      let rIn = perpTo(tIn, { x: 0, y: 1, z: 0 });
      const flat = cross({ x: 0, y: 1, z: 0 }, tIn);
      if (len(flat) > 1e-6) rIn = norm(flat);
      const reach = Math.max(half, len(sub(P, A)) * 0.45);
      const dummyPrev = crossSection(pool, add(P, scale(tIn, -reach)), rIn, half);
      emitTurn(pool, quads, dummyPrev, P, tIn, tOut, rIn, half, minArea, len(sub(P, A)), len(sub(B, P)), sidePorts, yId);
    });
    emitList(pending, false);
    const kept = [];
    for (let i = 0; i < quads.length; i++) {
      const q = quads[i];
      const A = pool.verts[q[0]];
      const B = pool.verts[q[1]];
      const C = pool.verts[q[2]];
      const D = pool.verts[q[3]];
      if (!A || !B || !C || !D) continue;
      const area = triArea(A, B, C) + triArea(A, C, D);
      if (area < 1e-8) continue;
      kept.push(q);
    }
    const cleaned = uniqueQuads(kept);
    quads.length = 0;
    for (let i = 0; i < cleaned.length; i++) quads.push(cleaned[i]);
    validatePlanks(pool, quads, w);
    const annotated = makePlankRecords(pool, quads, w);
    const branchSegs = [];
    const netNodes = network.nodes || [];
    const netById = new Map();
    for (let i = 0; i < netNodes.length; i++) netById.set(netNodes[i].id, netNodes[i]);
    const netBranches = network.branches || [];
    for (let i = 0; i < netBranches.length; i++) {
      const b = netBranches[i];
      const a = netById.get(b.fromId);
      const c = netById.get(b.toId);
      if (!a || !c) continue;
      branchSegs.push({
        id: b.id != null ? "branch_" + String(b.id) : "branch_" + String(i + 1).padStart(3, "0"),
        ax: a.x,
        ay: a.y,
        az: a.z,
        bx: c.x,
        by: c.y,
        bz: c.z,
      });
    }
    const system = {
      chainCount: chains.length,
      quadCount: quads.length,
      chains: chains,
      verts: pool.verts,
      restVerts: cloneVerts(pool.verts),
      quads: quads.slice(),
      planks: annotated.planks,
      joints: annotated.joints,
      jointOverrides: new Map(),
      defaultWidth: w,
      branchSegs: branchSegs,
    };
    refreshSystemBuffers(system);
    return system;
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
    let plankPickMesh = null;
    let selectedPlankIds = [];
    const highlightMat = new THREE.MeshBasicMaterial({
      color: 0x3ec2ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const highlightGeom = new THREE.BufferGeometry();
    highlightGeom.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    highlightGeom.setIndex([0, 1, 2, 0, 2, 3]);
    const highlightMesh = new THREE.Mesh(highlightGeom, highlightMat);
    highlightMesh.visible = false;
    highlightMesh.renderOrder = 4;
    highlightMesh.frustumCulled = false;
    scene.add(highlightMesh);
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();

    function clearPlanks() {
      while (plankGroup.children.length) {
        const ch = plankGroup.children[0];
        plankGroup.remove(ch);
        if (ch.geometry) ch.geometry.dispose();
      }
      plankPickMesh = null;
    }

    function normalizeIds(idOrList) {
      const src = Array.isArray(idOrList) ? idOrList : idOrList == null ? [] : [idOrList];
      const out = [];
      const seen = new Set();
      for (let i = 0; i < src.length; i++) {
        const id = src[i];
        if (id == null || id < 0 || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
      return out;
    }

    function updateHighlight(system, idOrList) {
      selectedPlankIds = normalizeIds(idOrList);
      if (!system || !system.verts || !system.quads || !selectedPlankIds.length) {
        highlightMesh.visible = false;
        return;
      }
      const v = system.verts;
      const pos = [];
      const idx = [];
      for (let n = 0; n < selectedPlankIds.length; n++) {
        const q = system.quads[selectedPlankIds[n]];
        if (!q) continue;
        const corners = [v[q[0]], v[q[1]], v[q[2]], v[q[3]]];
        if (!corners[0] || !corners[1] || !corners[2] || !corners[3]) continue;
        const base = pos.length / 3;
        for (let i = 0; i < 4; i++) pos.push(corners[i].x, corners[i].y, corners[i].z);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      if (!idx.length) {
        highlightMesh.visible = false;
        return;
      }
      highlightGeom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      highlightGeom.setIndex(idx);
      highlightGeom.computeVertexNormals();
      highlightGeom.computeBoundingSphere();
      highlightMesh.visible = showPlanks;
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

    function setPlankMeshes(system, selectedId) {
      clearPlanks();
      const THREE = global.THREE;
      if (!system || !system.positions || !system.positions.length || !system.quadCount) {
        plankGroup.visible = false;
        highlightMesh.visible = false;
        return;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(system.positions, 3));
      geom.setIndex(system.triangles);
      geom.computeVertexNormals();
      geom.computeBoundingSphere();
      const mesh = new THREE.Mesh(geom, plankMat);
      mesh.frustumCulled = false;
      mesh.userData.isPlanks = true;
      plankPickMesh = mesh;
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
      updateHighlight(system, selectedId == null ? selectedPlankIds : selectedId);
    }

    function pickPlank(clientX, clientY) {
      if (!plankPickMesh || !showPlanks) return -1;
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return -1;
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, activeCamera);
      const hits = raycaster.intersectObject(plankPickMesh, false);
      if (!hits.length) return -1;
      const faceIndex = hits[0].faceIndex;
      if (faceIndex == null || faceIndex < 0) return -1;
      return Math.floor(faceIndex / 2);
    }

    function setShowBranches(on) {
      showBranches = !!on;
      branches.visible = showBranches && branchGeom.getAttribute("position") && branchGeom.getAttribute("position").count > 0;
    }

    function setShowPlanks(on) {
      showPlanks = !!on;
      plankGroup.visible = showPlanks && plankGroup.children.length > 0;
      if (!showPlanks) highlightMesh.visible = false;
      else if (selectedPlankIds.length) highlightMesh.visible = true;
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
      setSelectedPlank(system, id) {
        updateHighlight(system, id);
      },
      setSelectedPlanks(system, ids) {
        updateHighlight(system, ids);
      },
      pickPlank,
      clearPlanks,
      getDomElement() {
        return renderer.domElement;
      },
    };
  }

  function mount() {
    const stage = document.getElementById("plankStage");
    if (!stage) return null;
    const els = {
      status: document.getElementById("plankStatus"),
      width: document.getElementById("plankWidth"),
      widthVal: document.getElementById("plankWidthVal"),
      selectedWrap: document.getElementById("plankSelectedWrap"),
      selectedWidth: document.getElementById("plankSelectedWidth"),
      selectedWidthVal: document.getElementById("plankSelectedWidthVal"),
      showBranches: document.getElementById("plankShowBranches"),
      showPlanks: document.getElementById("plankShowPlanks"),
      reset: document.getElementById("plankReset"),
      resetWidths: document.getElementById("plankResetWidths"),
      export3dm: document.getElementById("plankExport3dm"),
    };

    let viewer = null;
    let network = cloneNetwork(null);
    let chains = [];
    let width = DEFAULT_WIDTH;
    let lastSystem = null;
    let selectedPlankIds = [];
    let pickBound = false;
    let pointerDown = null;

    function ensureViewer() {
      if (viewer) return viewer;
      if (!global.THREE) {
        setStatus("Three.js did not load. Plank Builder cannot start.", "error");
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

    function paintSelected() {
      const planks = lastSystem && lastSystem.planks;
      const selected = [];
      for (let i = 0; i < selectedPlankIds.length; i++) {
        const p = planks && planks[selectedPlankIds[i]];
        if (p) selected.push(p);
      }
      const on = selected.length > 0;
      let shown = on ? selected[0].targetWidth : width;
      if (on) {
        for (let i = 1; i < selected.length; i++) {
          if (Math.abs(selected[i].targetWidth - shown) > 1e-6) {
            shown = selected[selected.length - 1].targetWidth;
            break;
          }
        }
      }
      if (els.selectedWidth) {
        els.selectedWidth.disabled = !on;
        if (on) els.selectedWidth.value = String(shown);
      }
      if (els.selectedWidthVal) {
        if (!on) els.selectedWidthVal.textContent = "—";
        else if (selected.length === 1) els.selectedWidthVal.textContent = shown.toFixed(2) + "'";
        else els.selectedWidthVal.textContent = selected.length + " · " + shown.toFixed(2) + "'";
      }
      if (els.selectedWrap) els.selectedWrap.classList.toggle("is-disabled", !on);
    }

    function paintExport() {
      if (els.export3dm) els.export3dm.disabled = !(lastSystem && lastSystem.quadCount);
    }

    function paintStatus() {
      paintExport();
      if (!network.branches.length) {
        setStatus("Send a branching network from 3D Grid Growth.");
        return;
      }
      let sel = "";
      if (selectedPlankIds.length && lastSystem && lastSystem.planks) {
        const first = lastSystem.planks[selectedPlankIds[0]];
        const w0 = first ? first.targetWidth : width;
        if (selectedPlankIds.length === 1) {
          sel = " · plank #" + selectedPlankIds[0] + " · " + w0.toFixed(2) + "'";
        } else {
          sel = " · " + selectedPlankIds.length + " planks selected · " + w0.toFixed(2) + "'";
        }
      }
      setStatus(
        network.branches.length +
          " branches · " +
          chains.length +
          " plank runs · " +
          (lastSystem && lastSystem.quadCount ? lastSystem.quadCount + " faces · " : "") +
          "width " +
          width.toFixed(1) +
          "'" +
          sel
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

    function bindPick(v) {
      if (pickBound || !v || !v.getDomElement) return;
      const el = v.getDomElement();
      if (!el) return;
      pickBound = true;
      el.addEventListener("pointerdown", function (ev) {
        if (ev.button !== 0) return;
        pointerDown = { x: ev.clientX, y: ev.clientY };
      });
      el.addEventListener("pointerup", function (ev) {
        if (!pointerDown || ev.button !== 0) return;
        const dx = ev.clientX - pointerDown.x;
        const dy = ev.clientY - pointerDown.y;
        pointerDown = null;
        if (dx * dx + dy * dy > 16) return;
        const id = v.pickPlank(ev.clientX, ev.clientY);
        const toggle = !!(ev.ctrlKey || ev.metaKey);
        const add = !!ev.shiftKey;
        if (id < 0) {
          if (!toggle && !add) selectedPlankIds = [];
        } else if (toggle) {
          const at = selectedPlankIds.indexOf(id);
          if (at >= 0) selectedPlankIds.splice(at, 1);
          else selectedPlankIds.push(id);
        } else if (add) {
          if (selectedPlankIds.indexOf(id) < 0) selectedPlankIds.push(id);
        } else {
          selectedPlankIds = [id];
        }
        if (v.setSelectedPlanks) v.setSelectedPlanks(lastSystem, selectedPlankIds);
        else if (v.setSelectedPlank) v.setSelectedPlank(lastSystem, selectedPlankIds);
        paintSelected();
        paintStatus();
      });
    }

    function refreshMeshes() {
      const v = ensureViewer();
      if (!v || !lastSystem) return;
      v.setPlankMeshes(lastSystem, selectedPlankIds);
      v.setShowBranches(!(els.showBranches) || els.showBranches.checked);
      v.setShowPlanks(!(els.showPlanks) || els.showPlanks.checked);
    }

    function rebuildPlanks() {
      const v = ensureViewer();
      if (!v) return;
      bindPick(v);
      selectedPlankIds = [];
      const system = buildPlankSystem(network, width);
      lastSystem = system;
      chains = system.chains || [];
      v.setNetworkLines(network);
      refreshMeshes();
      paintSelected();
      paintStatus();
    }

    function applySelectedWidth(next) {
      if (!lastSystem || !selectedPlankIds.length) return;
      setPlankTargetWidths(lastSystem, selectedPlankIds, next);
      refreshMeshes();
      paintSelected();
      paintStatus();
    }

    async function exportUnifiedPlank() {
      if (!lastSystem || !lastSystem.quadCount) {
        setStatus("No plank surfaces to export.", "error");
        return;
      }
      if (!global.D7SpatialExport || typeof global.D7SpatialExport.exportUnifiedPlank3dm !== "function") {
        setStatus("Rhino export is not available.", "error");
        return;
      }
      if (els.export3dm) els.export3dm.disabled = true;
      setStatus("Writing unified plank .3dm…", "active");
      try {
        const result = await global.D7SpatialExport.exportUnifiedPlank3dm(lastSystem);
        setStatus(
          "Exported PLANK_SYSTEM · " +
            result.quadCount +
            " joined faces · " +
            (result.branchCount != null ? result.branchCount + " branch lines · " : "") +
            result.filename
        );
      } catch (err) {
        setStatus(String(err && err.message ? err.message : err), "error");
      }
      paintExport();
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
      selectedPlankIds = [];
      paintWidth();
      if (els.showBranches) els.showBranches.checked = true;
      if (els.showPlanks) els.showPlanks.checked = true;
      rebuildPlanks();
    }

    function resetPlankWidths() {
      if (!lastSystem) return;
      resetPlankTargetWidths(lastSystem, width);
      refreshMeshes();
      paintSelected();
      paintStatus();
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
    if (els.selectedWidth) {
      els.selectedWidth.addEventListener("input", () => {
        applySelectedWidth(els.selectedWidth.value);
      });
    }
    if (els.reset) els.reset.addEventListener("click", () => resetPlanks());
    if (els.resetWidths) els.resetWidths.addEventListener("click", () => resetPlankWidths());
    if (els.export3dm) els.export3dm.addEventListener("click", () => exportUnifiedPlank());

    document.querySelectorAll("#plankViewBar .grid3d-view-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = ensureViewer();
        if (!v) return;
        v.setViewMode(btn.dataset.view);
        paintViewButtons();
      });
    });

    paintWidth();
    paintSelected();
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
    applyPlankWidths,
    setPlankTargetWidth,
    setPlankTargetWidths,
    resetPlankTargetWidths,
  };
})(window);

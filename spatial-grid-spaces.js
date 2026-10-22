/**
 * Clip 3D Grid Growth branches to the 20' module.
 * Workspace: 20 ft cube. 1 unit = 1 foot. Y is vertical.
 */
(function (global) {
  const CUBE = 20;
  const MERGE_EPS = 0.04;

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
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
    return { nodes: outNodes, segs, box: b };
  }

  global.D7GridSpaces = {
    CUBE,
    clipGraph,
    normalizeBox,
  };
})(window);

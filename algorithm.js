/**
 * 2D space colonization (Runions et al.).
 *
 * Attractors pull nearby nodes. Each node grows one step toward the
 * average direction of attractors that chose it. Attractors inside the
 * kill distance are consumed. That loop produces branching structure.
 */
(function (global) {
  class Vec2 {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }

    add(v) {
      return new Vec2(this.x + v.x, this.y + v.y);
    }

    sub(v) {
      return new Vec2(this.x - v.x, this.y - v.y);
    }

    mul(s) {
      return new Vec2(this.x * s, this.y * s);
    }

    length() {
      return Math.hypot(this.x, this.y);
    }

    normalize() {
      const len = this.length();
      if (len < 1e-8) return new Vec2(0, 0);
      return new Vec2(this.x / len, this.y / len);
    }
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function buildPathIndex(points, cell) {
    const map = new Map();
    for (const p of points) {
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }
    return { map, cell };
  }

  function searchPathBuckets(index, x, y, radius, fn) {
    const cx = Math.floor(x / index.cell);
    const cy = Math.floor(y / index.cell);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const bucket = index.map.get(`${cx + dx},${cy + dy}`);
        if (!bucket) continue;
        for (const p of bucket) fn(p);
      }
    }
  }

  function nearestPathPoint(x, y, index, maxDist) {
    const maxSq = maxDist * maxDist;
    const radius = Math.max(1, Math.ceil(maxDist / index.cell));
    let best = null;
    let bestSq = maxSq;
    searchPathBuckets(index, x, y, radius, (p) => {
      const dx = p.x - x;
      const dy = p.y - y;
      const dSq = dx * dx + dy * dy;
      if (dSq <= bestSq) {
        bestSq = dSq;
        best = p;
      }
    });
    return best;
  }

  function pickPathStep(x, y, dirX, dirY, step, index, maxScale = 1.8) {
    const min = step * 0.35;
    const max = step * maxScale;
    const minSq = min * min;
    const maxSq = max * max;
    const radius = Math.max(1, Math.ceil(max / index.cell));
    let best = null;
    let bestScore = -Infinity;
    searchPathBuckets(index, x, y, radius, (p) => {
      const vx = p.x - x;
      const vy = p.y - y;
      const dSq = vx * vx + vy * vy;
      if (dSq < minSq || dSq > maxSq) return;
      const d = Math.sqrt(dSq);
      const score = (vx / d) * dirX + (vy / d) * dirY + (Math.random() - 0.5) * 0.02;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    });
    return best ? new Vec2(best.x, best.y) : null;
  }

  function pickPathAhead(x, y, dirX, dirY, step, index, maxDist) {
    const maxSq = maxDist * maxDist;
    const minSq = step * step * 0.2;
    const radius = Math.max(1, Math.ceil(maxDist / index.cell));
    let best = null;
    let bestScore = -Infinity;
    searchPathBuckets(index, x, y, radius, (p) => {
      const vx = p.x - x;
      const vy = p.y - y;
      const dSq = vx * vx + vy * vy;
      if (dSq < minSq || dSq > maxSq) return;
      const d = Math.sqrt(dSq);
      const dot = (vx / d) * dirX + (vy / d) * dirY;
      if (dot < 0.15) return;
      const score = dot * 2 - d / maxDist;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    });
    return best;
  }

  function pickPathOrBridgeStep(x, y, dirX, dirY, step, index, bridgeReach) {
    const local = pickPathStep(x, y, dirX, dirY, step, index);
    if (local) return local;

    const wide = pickPathStep(x, y, dirX, dirY, step, index, 8);
    if (wide) return wide;

    const ahead = pickPathAhead(x, y, dirX, dirY, step, index, bridgeReach);
    if (ahead) {
      const vx = ahead.x - x;
      const vy = ahead.y - y;
      const d = Math.hypot(vx, vy) || 1;
      if (d <= step * 3) return new Vec2(ahead.x, ahead.y);
      return new Vec2(x + (vx / d) * step, y + (vy / d) * step);
    }

    const nx = x + dirX * step;
    const ny = y + dirY * step;
    const snap = nearestPathPoint(nx, ny, index, Math.max(step * 8, bridgeReach * 0.35));
    if (snap) return new Vec2(snap.x, snap.y);
    return new Vec2(nx, ny);
  }

  function obstacleAabb(obs) {
    if (obs.type === "circle") {
      return {
        minX: obs.x - obs.r,
        minY: obs.y - obs.r,
        maxX: obs.x + obs.r,
        maxY: obs.y + obs.r,
      };
    }
    if (obs.type === "rect") {
      const x0 = Math.min(obs.x, obs.x + obs.w);
      const y0 = Math.min(obs.y, obs.y + obs.h);
      const x1 = Math.max(obs.x, obs.x + obs.w);
      const y1 = Math.max(obs.y, obs.y + obs.h);
      return { minX: x0, minY: y0, maxX: x1, maxY: y1 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of obs.points || []) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }

  function aabbHitsPoint(box, x, y, pad = 0) {
    return x >= box.minX - pad && x <= box.maxX + pad && y >= box.minY - pad && y <= box.maxY + pad;
  }

  function aabbHitsSegment(box, x1, y1, x2, y2, pad = 0) {
    const minX = box.minX - pad;
    const minY = box.minY - pad;
    const maxX = box.maxX + pad;
    const maxY = box.maxY + pad;
    if (
      (x1 < minX && x2 < minX) ||
      (x1 > maxX && x2 > maxX) ||
      (y1 < minY && y2 < minY) ||
      (y1 > maxY && y2 > maxY)
    ) {
      return false;
    }
    return true;
  }

  function pointInPolygon(points, x, y) {
    if (!points || points.length < 3) return false;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x;
      const yi = points[i].y;
      const xj = points[j].x;
      const yj = points[j].y;
      const denom = yj - yi || 1e-12;
      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / denom + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function closestOnSegment(x, y, ax, ay, bx, by) {
    const vx = bx - ax;
    const vy = by - ay;
    const lenSq = vx * vx + vy * vy;
    let t = 0;
    if (lenSq > 1e-12) t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / lenSq));
    const px = ax + vx * t;
    const py = ay + vy * t;
    return { x: px, y: py, t, dSq: (x - px) * (x - px) + (y - py) * (y - py) };
  }

  function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const abx = bx - ax;
    const aby = by - ay;
    const cdx = dx - cx;
    const cdy = dy - cy;
    const den = abx * cdy - aby * cdx;
    if (Math.abs(den) < 1e-12) return false;
    const acx = cx - ax;
    const acy = cy - ay;
    const t = (acx * cdy - acy * cdx) / den;
    const u = (acx * aby - acy * abx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  function obstacleContains(obs, x, y) {
    if (!obs) return false;
    const box = obstacleAabb(obs);
    if (!aabbHitsPoint(box, x, y, 0.5)) return false;
    if (obs.type === "circle") {
      const dx = x - obs.x;
      const dy = y - obs.y;
      return dx * dx + dy * dy <= obs.r * obs.r;
    }
    if (obs.type === "rect") {
      return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
    }
    return pointInPolygon(obs.points, x, y);
  }

  function closestOnObstacle(obs, x, y) {
    if (obs.type === "circle") {
      const dx = x - obs.x;
      const dy = y - obs.y;
      const d = Math.hypot(dx, dy);
      const inside = d <= obs.r;
      if (d < 1e-8) {
        return { x: obs.x + obs.r, y: obs.y, nx: 1, ny: 0, dist: -obs.r, inside: true };
      }
      const nx = dx / d;
      const ny = dy / d;
      return {
        x: obs.x + nx * obs.r,
        y: obs.y + ny * obs.r,
        nx,
        ny,
        dist: d - obs.r,
        inside,
      };
    }

    if (obs.type === "rect") {
      const box = obstacleAabb(obs);
      const cx = Math.max(box.minX, Math.min(box.maxX, x));
      const cy = Math.max(box.minY, Math.min(box.maxY, y));
      const inside = x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
      if (!inside) {
        const d = Math.hypot(x - cx, y - cy) || 1e-8;
        return { x: cx, y: cy, nx: (x - cx) / d, ny: (y - cy) / d, dist: d, inside: false };
      }
      const dLeft = x - box.minX;
      const dRight = box.maxX - x;
      const dTop = y - box.minY;
      const dBottom = box.maxY - y;
      const m = Math.min(dLeft, dRight, dTop, dBottom);
      if (m === dLeft) return { x: box.minX, y, nx: -1, ny: 0, dist: -m, inside: true };
      if (m === dRight) return { x: box.maxX, y, nx: 1, ny: 0, dist: -m, inside: true };
      if (m === dTop) return { x, y: box.minY, nx: 0, ny: -1, dist: -m, inside: true };
      return { x, y: box.maxY, nx: 0, ny: 1, dist: -m, inside: true };
    }

    const pts = obs.points || [];
    if (pts.length < 2) {
      return { x, y, nx: 0, ny: 1, dist: Infinity, inside: false };
    }
    let best = null;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const hit = closestOnSegment(x, y, a.x, a.y, b.x, b.y);
      if (!best || hit.dSq < best.dSq) best = { ...hit, a, b };
    }
    const inside = pointInPolygon(pts, x, y);
    const dx = x - best.x;
    const dy = y - best.y;
    let nx;
    let ny;
    const d = Math.hypot(dx, dy);
    if (d > 1e-8) {
      nx = dx / d;
      ny = dy / d;
    } else {
      const ex = best.b.x - best.a.x;
      const ey = best.b.y - best.a.y;
      const el = Math.hypot(ex, ey) || 1;
      nx = ey / el;
      ny = -ex / el;
    }
    if (inside && nx * dx + ny * dy > 0) {
      nx = -nx;
      ny = -ny;
    }
    if (!inside && nx * dx + ny * dy < 0) {
      nx = -nx;
      ny = -ny;
    }
    const dist = Math.sqrt(best.dSq);
    return { x: best.x, y: best.y, nx, ny, dist: inside ? -dist : dist, inside };
  }

  function segmentHitsObstacle(obs, x1, y1, x2, y2) {
    const box = obstacleAabb(obs);
    if (!aabbHitsSegment(box, x1, y1, x2, y2, 0.5)) return false;
    if (obstacleContains(obs, x1, y1) || obstacleContains(obs, x2, y2)) return true;
    if (obs.type === "circle") {
      const hit = closestOnSegment(obs.x, obs.y, x1, y1, x2, y2);
      return hit.dSq <= obs.r * obs.r;
    }
    if (obs.type === "rect") {
      const x0 = box.minX;
      const y0 = box.minY;
      const x3 = box.maxX;
      const y3 = box.maxY;
      return (
        segmentsIntersect(x1, y1, x2, y2, x0, y0, x3, y0) ||
        segmentsIntersect(x1, y1, x2, y2, x3, y0, x3, y3) ||
        segmentsIntersect(x1, y1, x2, y2, x3, y3, x0, y3) ||
        segmentsIntersect(x1, y1, x2, y2, x0, y3, x0, y0)
      );
    }
    const pts = obs.points || [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (segmentsIntersect(x1, y1, x2, y2, a.x, a.y, b.x, b.y)) return true;
    }
    return false;
  }

  function anyObstacleContains(obstacles, x, y) {
    for (const obs of obstacles) {
      if (obstacleContains(obs, x, y)) return obs;
    }
    return null;
  }

  function anyObstacleHitsSegment(obstacles, x1, y1, x2, y2) {
    for (const obs of obstacles) {
      if (segmentHitsObstacle(obs, x1, y1, x2, y2)) return obs;
    }
    return null;
  }

  function pushOutsideObstacles(x, y, obstacles) {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const obs of obstacles) {
        const hit = closestOnObstacle(obs, x, y);
        if (!hit.inside && hit.dist > 1.25) continue;
        const nx = hit.nx;
        const ny = hit.ny;
        const nlen = Math.hypot(nx, ny) || 1;
        x = hit.x + (nx / nlen) * 1.35;
        y = hit.y + (ny / nlen) * 1.35;
        moved = true;
      }
      if (!moved) break;
    }
    return { x, y };
  }

  function clipStepAgainstObstacles(x1, y1, x2, y2, obstacles) {
    if (!obstacles || !obstacles.length) return { x: x2, y: y2 };
    if (anyObstacleContains(obstacles, x1, y1)) {
      const pushed = pushOutsideObstacles(x1, y1, obstacles);
      if (anyObstacleContains(obstacles, pushed.x, pushed.y)) return null;
      return pushed;
    }
    if (!anyObstacleHitsSegment(obstacles, x1, y1, x2, y2) && !anyObstacleContains(obstacles, x2, y2)) {
      return { x: x2, y: y2 };
    }
    let lo = 0;
    let hi = 1;
    let last = { x: x1, y: y1 };
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) * 0.5;
      const x = x1 + (x2 - x1) * mid;
      const y = y1 + (y2 - y1) * mid;
      if (anyObstacleContains(obstacles, x, y) || anyObstacleHitsSegment(obstacles, x1, y1, x, y)) {
        hi = mid;
      } else {
        last = { x, y };
        lo = mid;
      }
    }
    const d = Math.hypot(last.x - x1, last.y - y1);
    if (d < 0.6) return null;
    return last;
  }

  function obstacleRepulsionAt(x, y, obstacles, distance, strength) {
    let rx = 0;
    let ry = 0;
    if (!(distance > 0) || !(strength > 0) || !obstacles.length) return { x: 0, y: 0 };
    for (const obs of obstacles) {
      const box = obstacleAabb(obs);
      if (!aabbHitsPoint(box, x, y, distance)) continue;
      const hit = closestOnObstacle(obs, x, y);
      const d = hit.inside ? 0 : Math.max(0, hit.dist);
      if (d >= distance) continue;
      const t = 1 - d / distance;
      const mag = strength * t * t;
      const nlen = Math.hypot(hit.nx, hit.ny) || 1;
      rx += (hit.nx / nlen) * mag;
      ry += (hit.ny / nlen) * mag;
    }
    return { x: rx, y: ry };
  }

  function hitTestObstacle(obs, x, y, pad = 10) {
    const box = obstacleAabb(obs);
    if (!aabbHitsPoint(box, x, y, pad)) return null;
    if (obs.type === "circle") {
      const d = Math.hypot(x - obs.x, y - obs.y);
      if (Math.abs(d - obs.r) <= pad) return { obs, handle: "rim" };
      if (d <= obs.r) return { obs, handle: "body" };
      return null;
    }
    if (obs.type === "rect") {
      const corners = [
        { x: box.minX, y: box.minY, handle: "nw" },
        { x: box.maxX, y: box.minY, handle: "ne" },
        { x: box.maxX, y: box.maxY, handle: "se" },
        { x: box.minX, y: box.maxY, handle: "sw" },
      ];
      for (const c of corners) {
        if (Math.hypot(x - c.x, y - c.y) <= pad) return { obs, handle: c.handle };
      }
      const onEdge =
        (Math.abs(x - box.minX) <= pad || Math.abs(x - box.maxX) <= pad) &&
        y >= box.minY - pad &&
        y <= box.maxY + pad;
      const onHorz =
        (Math.abs(y - box.minY) <= pad || Math.abs(y - box.maxY) <= pad) &&
        x >= box.minX - pad &&
        x <= box.maxX + pad;
      if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY) {
        return { obs, handle: "body" };
      }
      if (onEdge || onHorz) return { obs, handle: "body" };
      return null;
    }
    const pts = obs.points || [];
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(x - pts[i].x, y - pts[i].y) <= pad) return { obs, handle: "vertex", vertex: i };
    }
    if (pointInPolygon(pts, x, y)) return { obs, handle: "body" };
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const hit = closestOnSegment(x, y, a.x, a.y, b.x, b.y);
      if (Math.sqrt(hit.dSq) <= pad) return { obs, handle: "body" };
    }
    return null;
  }

  function hitTestObstacles(obstacles, x, y, pad = 10) {
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const hit = hitTestObstacle(obstacles[i], x, y, pad);
      if (hit) return { ...hit, index: i };
    }
    return null;
  }

    class Node {
      constructor(pos, parent = null) {
        this.pos = pos;
        this.parent = parent;
        this.children = [];
        this.thickness = 1;
        this.order = 1;
        this.age = 0;
        this.rootId = parent && parent.rootId != null ? parent.rootId : null;
        this.fused = false;
      }
    }

    function hashNodes(nodes, cell) {
      const map = new Map();
      const size = Math.max(4, cell);
      for (const node of nodes) {
        const key = `${Math.floor(node.pos.x / size)},${Math.floor(node.pos.y / size)}`;
        let bucket = map.get(key);
        if (!bucket) {
          bucket = [];
          map.set(key, bucket);
        }
        bucket.push(node);
      }
      return { map, cell: size };
    }

    function forNodesNear(hash, x, y, radius, fn) {
      const cell = hash.cell;
      const r = Math.max(1, Math.ceil(radius / cell));
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const rSq = radius * radius;
      for (let iy = -r; iy <= r; iy++) {
        for (let ix = -r; ix <= r; ix++) {
          const bucket = hash.map.get(`${cx + ix},${cy + iy}`);
          if (!bucket) continue;
          for (const node of bucket) {
            const dx = node.pos.x - x;
            const dy = node.pos.y - y;
            if (dx * dx + dy * dy <= rSq) fn(node);
          }
        }
      }
    }

    class Simulator {
      constructor() {
        this.nodes = [];
        this.attractors = [];
        this.attractionRadius = 90;
        this.killDistance = 12;
        this.stepSize = 6;
        this.jitter = 0.12;
        this.pathIndex = null;
        this.bias = new Vec2(0, 0);
        this.growthDirection = 0;
        this.mergeBranches = false;
        this.mergeDistance = 20;
        this.mergeLinks = [];
        this._mergeParent = new Map();
        this.nextRootId = 1;
        this.generation = 0;
        this.lastInfluences = [];
        this.consumed = [];
        this.circles = [];
        this.obstacles = [];
        this.obstacleMode = "hard";
        this.repulsionDistance = 40;
        this.repulsionStrength = 1.2;
      }

      clearStructure() {
        this.nodes = [];
        this.generation = 0;
        this.lastInfluences = [];
        this.consumed = [];
        this.mergeLinks = [];
        this._mergeParent = new Map();
        this.nextRootId = 1;
      }

    clearAll() {
      this.clearStructure();
      this.attractors = [];
    }

    addAttractor(x, y) {
      this.attractors.push(new Vec2(x, y));
    }

    addAttractors(points) {
      for (const p of points) this.attractors.push(new Vec2(p.x, p.y));
    }

      addSeed(x, y) {
        let pos = { x, y };
        if (this.pathIndex) {
          const hit = nearestPathPoint(x, y, this.pathIndex, this.stepSize * 2.5);
          if (hit) pos = hit;
        }
        const seed = new Node(new Vec2(pos.x, pos.y), null);
        seed.rootId = this.nextRootId++;
        this._mergeParent.set(seed.rootId, seed.rootId);
        this.nodes.push(seed);
        return seed;
      }

      findComponent(rootId) {
        if (rootId == null) return null;
        let cur = rootId;
        const seen = [];
        while (true) {
          const parent = this._mergeParent.get(cur);
          if (parent == null) {
            this._mergeParent.set(cur, cur);
            break;
          }
          seen.push(cur);
          if (parent === cur) break;
          cur = parent;
        }
        for (const id of seen) this._mergeParent.set(id, cur);
        return cur;
      }

      unionComponents(a, b) {
        const ra = this.findComponent(a);
        const rb = this.findComponent(b);
        if (ra == null || rb == null || ra === rb) return false;
        this._mergeParent.set(ra, rb);
        return true;
      }

      rebuildMergeComponents() {
        this._mergeParent = new Map();
        for (const node of this.nodes) {
          if (node.rootId == null) continue;
          this._mergeParent.set(node.rootId, node.rootId);
        }
        for (const link of this.mergeLinks) {
          if (link.a && link.b) this.unionComponents(link.a.rootId, link.b.rootId);
        }
      }

      dropMergeLinksFor(removeSet) {
        const before = this.mergeLinks.length;
        this.mergeLinks = this.mergeLinks.filter(
          (link) => !removeSet.has(link.a) && !removeSet.has(link.b)
        );
        if (this.mergeLinks.length !== before) this.rebuildMergeComponents();
      }

      _connectNetworks(a, b, opts = {}) {
        if (!a || !b || a === b) return false;
        if (a.rootId == null || b.rootId == null || a.rootId === b.rootId) return false;
        if (this.findComponent(a.rootId) === this.findComponent(b.rootId)) return false;
        if (!opts.ignoreDistance) {
          const max = this.mergeDistance;
          if (!(max > 0) || dist(a.pos, b.pos) > max + 0.5) return false;
        }
        for (const link of this.mergeLinks) {
          if ((link.a === a && link.b === b) || (link.a === b && link.b === a)) return false;
        }
        this.mergeLinks.push({ a, b });
        this.unionComponents(a.rootId, b.rootId);
        return true;
      }

      _blockingNode(from, x, y, radius) {
        if (!(radius > 0) || !this._nodeHash) return null;
        let best = null;
        let bestSq = radius * radius;
        forNodesNear(this._nodeHash, x, y, radius, (other) => {
          if (other === from || other === from.parent) return;
          if (other.rootId == null || other.rootId === from.rootId) return;
          const dx = other.pos.x - x;
          const dy = other.pos.y - y;
          const dSq = dx * dx + dy * dy;
          if (dSq <= bestSq) {
            bestSq = dSq;
            best = other;
          }
        });
        return best;
      }

      _mergeNearbyTips() {
        const distMax = this.mergeDistance;
        if (!(distMax > 0)) return 0;
        const tips = [];
        for (const node of this.nodes) {
          if (node.children.length || node.rootId == null) continue;
          tips.push(node);
        }
        if (tips.length < 2) return 0;
        const hash = hashNodes(tips, distMax);
        const candidates = [];
        const seen = new Set();
        const indexOf = new Map();
        for (let i = 0; i < tips.length; i++) indexOf.set(tips[i], i);
        for (let i = 0; i < tips.length; i++) {
          const tip = tips[i];
          forNodesNear(hash, tip.pos.x, tip.pos.y, distMax, (other) => {
            if (other === tip) return;
            if (other.rootId === tip.rootId) return;
            if (this.findComponent(tip.rootId) === this.findComponent(other.rootId)) return;
            const ib = indexOf.get(other);
            if (ib == null) return;
            const key = i < ib ? `${i}:${ib}` : `${ib}:${i}`;
            if (seen.has(key)) return;
            seen.add(key);
            const dx = other.pos.x - tip.pos.x;
            const dy = other.pos.y - tip.pos.y;
            candidates.push({ a: tip, b: other, dSq: dx * dx + dy * dy });
          });
        }
        candidates.sort((p, q) => p.dSq - q.dSq);
        let merged = 0;
        for (const pair of candidates) {
          if (merged >= 8) break;
          if (this._connectNetworks(pair.a, pair.b)) merged += 1;
        }
        return merged;
      }

    step() {
      this.consumed = [];
      const hasCircles = this.circles && this.circles.length;
      const hasPath = this.pathIndex && this.pathIndex.map.size;
      if (!this.nodes.length || !hasPath || !this.attractors.length) {
        this.lastInfluences = [];
        return false;
      }

      const radius = this.attractionRadius;
      const radiusSq = radius * radius;
      const influence = new Map();

      for (const attractor of this.attractors) {
        let closest = null;
        let closestDistSq = radiusSq;

        for (const node of this.nodes) {
          const dx = attractor.x - node.pos.x;
          const dy = attractor.y - node.pos.y;
          const dSq = dx * dx + dy * dy;
          if (dSq < closestDistSq) {
            closestDistSq = dSq;
            closest = node;
          }
        }

        if (closest) {
          if (!influence.has(closest)) influence.set(closest, []);
          influence.get(closest).push(attractor);
        }
      }

      // If nothing is in range yet, grow the closest node toward the nearest
      // attractor so a seed can reach a distant field (classic tree trunk).
      if (!influence.size && this.attractors.length) {
        let bestNode = null;
        let bestAttractor = null;
        let bestDist = Infinity;
        for (const attractor of this.attractors) {
          for (const node of this.nodes) {
            const d = dist(attractor, node.pos);
            if (d < bestDist) {
              bestDist = d;
              bestNode = node;
              bestAttractor = attractor;
            }
          }
        }
        if (bestNode && bestAttractor) {
          influence.set(bestNode, [bestAttractor]);
        }
      }

      this.lastInfluences = [];
      const newborns = [];
      let mergedThisStep = 0;
      const mergeOn = !!this.mergeBranches;
      if (mergeOn) {
        this._nodeHash = hashNodes(this.nodes, Math.max(4, this.mergeDistance || this.stepSize));
      } else {
        this._nodeHash = null;
      }

      for (const [node, nearby] of influence) {
        let dirX = 0;
        let dirY = 0;
        for (const attractor of nearby) {
          const vx = attractor.x - node.pos.x;
          const vy = attractor.y - node.pos.y;
          const len = Math.hypot(vx, vy) || 1;
          dirX += vx / len;
          dirY += vy / len;
          this.lastInfluences.push({ from: node.pos, to: attractor });
        }

        dirX += this.bias.x * nearby.length;
        dirY += this.bias.y * nearby.length;

        const growthDir = this.growthDirection || 0;
        if (growthDir < 0) {
          const w = -growthDir;
          dirX += Math.sign(dirX) * 0.8 * w * nearby.length;
          dirY *= 1 - 0.28 * w;
        } else if (growthDir > 0) {
          const w = growthDir;
          dirY += Math.sign(dirY) * 0.8 * w * nearby.length;
          dirX *= 1 - 0.28 * w;
        }

        const userObstacles = this.obstacles || [];
        if (this.obstacleMode === "repel" && userObstacles.length) {
          const push = obstacleRepulsionAt(
            node.pos.x,
            node.pos.y,
            userObstacles,
            this.repulsionDistance,
            this.repulsionStrength
          );
          dirX += push.x * nearby.length;
          dirY += push.y * nearby.length;
        }

        const len = Math.hypot(dirX, dirY);
        if (len < 1e-8) continue;

        const step = this.stepSize;
        const bridgeReach = Math.min(
          480,
          Math.max(this.attractionRadius * 3, step * 24)
        );
        let nextPos = pickPathOrBridgeStep(
          node.pos.x,
          node.pos.y,
          dirX / len,
          dirY / len,
          step,
          this.pathIndex,
          bridgeReach
        );
        if (hasCircles) {
          const outside = pushOutsideCircles(nextPos.x, nextPos.y, this.circles);
          const hit = nearestPathPoint(outside.x, outside.y, this.pathIndex, step * 1.5);
          nextPos = hit ? new Vec2(hit.x, hit.y) : new Vec2(outside.x, outside.y);
        }
        if (userObstacles.length) {
          const clipped = clipStepAgainstObstacles(
            node.pos.x,
            node.pos.y,
            nextPos.x,
            nextPos.y,
            userObstacles
          );
          if (!clipped) continue;
          if (clipped.x !== nextPos.x || clipped.y !== nextPos.y) {
            const snapped = nearestPathPoint(
              clipped.x,
              clipped.y,
              this.pathIndex,
              step * 1.5
            );
            nextPos = snapped ? new Vec2(snapped.x, snapped.y) : new Vec2(clipped.x, clipped.y);
            if (anyObstacleContains(userObstacles, nextPos.x, nextPos.y)) continue;
            if (
              anyObstacleHitsSegment(
                userObstacles,
                node.pos.x,
                node.pos.y,
                nextPos.x,
                nextPos.y
              )
            ) {
              continue;
            }
          }
        }

        if (mergeOn) {
          const collideR = Math.max(this.stepSize * 0.85, 2);
          const blocker = this._blockingNode(
            node,
            nextPos.x,
            nextPos.y,
            Math.max(this.mergeDistance, collideR)
          );
          if (blocker) {
            const joined =
              this.findComponent(node.rootId) === this.findComponent(blocker.rootId);
            const nodeGap = dist(node.pos, blocker.pos);
            const nextGap = dist(nextPos, blocker.pos);
            if (!joined && nodeGap <= this.mergeDistance) {
              if (this._connectNetworks(node, blocker)) mergedThisStep += 1;
              continue;
            }
            if (nextGap <= collideR) continue;
          }
        }

        const next = new Node(nextPos, node);
        node.children.push(next);
        newborns.push(next);
      }

      if (newborns.length) {
        this.nodes.push(...newborns);
        const killSq = this.killDistance * this.killDistance;
        const remaining = [];
        for (const attractor of this.attractors) {
          let eaten = false;
          for (const node of newborns) {
            const dx = attractor.x - node.pos.x;
            const dy = attractor.y - node.pos.y;
            if (dx * dx + dy * dy < killSq) {
              eaten = true;
              break;
            }
          }
          if (eaten) this.consumed.push(attractor);
          else remaining.push(attractor);
        }
        this.attractors = remaining;
      }

      if (mergeOn) mergedThisStep += this._mergeNearbyTips();
      if (!newborns.length && !mergedThisStep) return false;

      this.generation += 1;
      this._computeThickness();
      this._computeOrders();
      return true;
    }

    _computeThickness() {
      const visit = (node) => {
        if (!node.children.length) {
          node.thickness = 1;
          return 1;
        }
        let sum = 0;
        for (const child of node.children) sum += visit(child);
        node.thickness = sum;
        return sum;
      };
      for (const node of this.nodes) {
        if (!node.parent) visit(node);
      }
    }

    _computeOrders() {
      const assign = (node, order) => {
        node.order = order;
        if (!node.children.length) return;
        let main = node.children[0];
        for (const child of node.children) {
          if (child.thickness > main.thickness) main = child;
        }
        for (const child of node.children) {
          const next = child === main ? order : Math.min(3, order + 1);
          assign(child, next);
        }
      };
      for (const node of this.nodes) {
        if (!node.parent) assign(node, 1);
      }
    }
  }

  function pushOutsideCircles(x, y, circles) {
    for (let pass = 0; pass < 2; pass++) {
      for (const circle of circles) {
        const dx = x - circle.x;
        const dy = y - circle.y;
        const d = Math.hypot(dx, dy);
        const limit = circle.r + 1.25;
        if (d < limit && d > 1e-4) {
          x = circle.x + (dx / d) * limit;
          y = circle.y + (dy / d) * limit;
        }
      }
    }
    return { x, y };
  }

  function findInkComponents(ink, sw, sh) {
    const mask = new Uint8Array(sw * sh);
    for (const p of ink) mask[p.y * sw + p.x] = 1;
    const seen = new Uint8Array(sw * sh);
    const components = [];
    for (const p of ink) {
      const start = p.y * sw + p.x;
      if (seen[start]) continue;
      const pixels = [];
      const stack = [p];
      seen[start] = 1;
      while (stack.length) {
        const cur = stack.pop();
        pixels.push(cur);
        const neighbors = [
          { x: cur.x + 1, y: cur.y },
          { x: cur.x - 1, y: cur.y },
          { x: cur.x, y: cur.y + 1 },
          { x: cur.x, y: cur.y - 1 },
        ];
        for (const n of neighbors) {
          if (n.x < 0 || n.y < 0 || n.x >= sw || n.y >= sh) continue;
          const idx = n.y * sw + n.x;
          if (!mask[idx] || seen[idx]) continue;
          seen[idx] = 1;
          stack.push(n);
        }
      }
      components.push({ pixels });
    }
    return components;
  }

  function componentBoundary(pixels, sw, sh) {
    const set = new Set(pixels.map((p) => `${p.x},${p.y}`));
    const boundary = [];
    for (const p of pixels) {
      const edge =
        !set.has(`${p.x + 1},${p.y}`) ||
        !set.has(`${p.x - 1},${p.y}`) ||
        !set.has(`${p.x},${p.y + 1}`) ||
        !set.has(`${p.x},${p.y - 1}`);
      if (edge) boundary.push(p);
    }
    return boundary;
  }

  function tryFitCircle(boundary) {
    if (boundary.length < 16) return null;
    let cx = 0;
    let cy = 0;
    for (const p of boundary) {
      cx += p.x;
      cy += p.y;
    }
    cx /= boundary.length;
    cy /= boundary.length;
    const radii = boundary.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    if (mean < 8) return null;
    let variance = 0;
    for (const r of radii) variance += (r - mean) * (r - mean);
    const std = Math.sqrt(variance / radii.length);
    const roundness = 1 - std / mean;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of boundary) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const aspect = bw > bh ? bw / bh : bh / bw;
    if (roundness < 0.78 || aspect > 1.28) return null;
    return { x: cx, y: cy, r: mean, score: roundness };
  }

  function tryFitRect(boundary) {
    if (boundary.length < 16) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of boundary) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (w < 12 || h < 12) return null;
    const tol = Math.max(2, Math.min(w, h) * 0.08);
    let edgeHits = 0;
    for (const p of boundary) {
      const onEdge =
        p.x <= minX + tol ||
        p.x >= maxX - tol ||
        p.y <= minY + tol ||
        p.y >= maxY - tol;
      if (onEdge) edgeHits += 1;
    }
    const edgeScore = edgeHits / boundary.length;
    const aspect = w > h ? w / h : h / w;
    if (edgeScore < 0.72 || aspect > 4.5) return null;
    const corners = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
    let cornerHits = 0;
    for (const corner of corners) {
      for (const p of boundary) {
        if (Math.hypot(p.x - corner.x, p.y - corner.y) <= tol * 2.5) {
          cornerHits += 1;
          break;
        }
      }
    }
    if (cornerHits < 3) return null;
    return { x: minX, y: minY, w, h, score: edgeScore * (cornerHits / 4) };
  }

  function overlapsCircle(rect, circle) {
    const cx = Math.max(rect.x, Math.min(circle.x, rect.x + rect.w));
    const cy = Math.max(rect.y, Math.min(circle.y, rect.y + rect.h));
    const d = Math.hypot(circle.x - cx, circle.y - cy);
    return d < circle.r + 4;
  }

  function detectGridShapes(ink, sw, sh) {
    const minArea = Math.max(80, (sw * sh) * 0.0015);
    const components = findInkComponents(ink, sw, sh).sort(
      (a, b) => b.pixels.length - a.pixels.length
    );
    const circles = [];
    const rectangles = [];
    for (const comp of components) {
      if (comp.pixels.length < minArea) continue;
      const boundary = componentBoundary(comp.pixels, sw, sh);
      const circle = tryFitCircle(boundary);
      if (circle && circle.score >= 0.8) {
        const duplicate = circles.some(
          (c) => Math.hypot(c.x - circle.x, c.y - circle.y) < Math.min(c.r, circle.r) * 0.35
        );
        if (!duplicate) circles.push(circle);
        continue;
      }
      const rect = tryFitRect(boundary);
      if (rect && rect.score >= 0.62) {
        const duplicate = rectangles.some(
          (r) =>
            Math.hypot(r.x - rect.x, r.y - rect.y) < 8 &&
            Math.abs(r.w - rect.w) < 8 &&
            Math.abs(r.h - rect.h) < 8
        );
        const insideCircle = circles.some((c) => overlapsCircle(rect, c));
        if (!duplicate && !insideCircle) rectangles.push(rect);
      }
    }
    return { circles, rectangles };
  }

  function sampleCirclePerimeter(circle, count) {
    const n = Math.max(24, Math.min(count, Math.round(circle.r * 0.9)));
    const points = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      points.push({
        x: circle.x + Math.cos(a) * circle.r,
        y: circle.y + Math.sin(a) * circle.r,
      });
    }
    return points;
  }

  function sampleRectPerimeter(rect, count) {
    const perimeter = 2 * (rect.w + rect.h);
    const n = Math.max(16, Math.min(count, Math.round(perimeter * 0.35)));
    const points = [];
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const len = t * perimeter;
      if (len <= rect.w) points.push({ x: rect.x + len, y: rect.y });
      else if (len <= rect.w + rect.h) points.push({ x: rect.x + rect.w, y: rect.y + (len - rect.w) });
      else if (len <= rect.w * 2 + rect.h) {
        points.push({ x: rect.x + rect.w - (len - rect.w - rect.h), y: rect.y + rect.h });
      } else {
        points.push({ x: rect.x, y: rect.y + rect.h - (len - rect.w * 2 - rect.h) });
      }
    }
    return points;
  }

  function parseSvgGridShapes(svgText, imgW, imgH) {
    const circles = [];
    const rectangles = [];
    if (!svgText || !/<svg[\s>]/i.test(svgText)) return { circles, rectangles };
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() === "parsererror") return { circles, rectangles };
    let vbW = imgW;
    let vbH = imgH;
    const vb = root.getAttribute("viewBox");
    if (vb) {
      const parts = vb.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4) {
        vbW = parts[2];
        vbH = parts[3];
      }
    }
    const sx = imgW / vbW;
    const sy = imgH / vbH;
    const num = (value, fallback = 0) => {
      const n = parseFloat(value);
      return Number.isFinite(n) ? n : fallback;
    };
    for (const node of root.querySelectorAll("circle")) {
      const cx = num(node.getAttribute("cx"));
      const cy = num(node.getAttribute("cy"));
      const r = num(node.getAttribute("r"));
      if (r > 0) circles.push({ x: cx * sx, y: cy * sy, r: r * (sx + sy) * 0.5, score: 1 });
    }
    for (const node of root.querySelectorAll("ellipse")) {
      const cx = num(node.getAttribute("cx"));
      const cy = num(node.getAttribute("cy"));
      const rx = num(node.getAttribute("rx"));
      const ry = num(node.getAttribute("ry"));
      if (rx > 0 && ry > 0) {
        const ratio = rx > ry ? rx / ry : ry / rx;
        if (ratio < 1.18) {
          const r = (rx + ry) * 0.5 * (sx + sy) * 0.5;
          circles.push({ x: cx * sx, y: cy * sy, r, score: 1 });
        }
      }
    }
    for (const node of root.querySelectorAll("rect")) {
      const x = num(node.getAttribute("x"));
      const y = num(node.getAttribute("y"));
      const w = num(node.getAttribute("width"));
      const h = num(node.getAttribute("height"));
      if (w > 0 && h > 0) {
        rectangles.push({ x: x * sx, y: y * sy, w: w * sx, h: h * sy, score: 1 });
      }
    }
    return { circles, rectangles };
  }

  function inPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      const intersect =
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function scatterInRect(count, x, y, w, h) {
    const points = [];
    for (let i = 0; i < count; i++) {
      points.push({ x: x + Math.random() * w, y: y + Math.random() * h });
    }
    return points;
  }

  function scatterInEllipse(count, cx, cy, rx, ry) {
    const points = [];
    while (points.length < count) {
      const x = cx + (Math.random() * 2 - 1) * rx;
      const y = cy + (Math.random() * 2 - 1) * ry;
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1) points.push({ x, y });
    }
    return points;
  }

  function scatterInPolygon(count, polygon, bounds) {
    const points = [];
    let guard = 0;
    while (points.length < count && guard < count * 40) {
      guard += 1;
      const x = bounds.x + Math.random() * bounds.w;
      const y = bounds.y + Math.random() * bounds.h;
      if (inPolygon(x, y, polygon)) points.push({ x, y });
    }
    return points;
  }

  const Presets = {
    canopy(width, height) {
      const margin = 48;
      const crown = scatterInEllipse(
        1300,
        width * 0.5,
        height * 0.36,
        width * 0.38,
        height * 0.3
      );
      const trunk = scatterInEllipse(
        180,
        width * 0.5,
        height * 0.72,
        width * 0.05,
        height * 0.2
      );
      return {
        attractors: [...crown, ...trunk].filter((p) => p.y > margin && p.y < height - 28),
        seeds: [{ x: width * 0.5, y: height - 36 }],
        attractionRadius: 96,
        killDistance: 11,
        stepSize: 5.5,
        jitter: 0.18,
        bias: { x: 0, y: -0.22 },
      };
    },

    coral(width, height) {
      return {
        attractors: scatterInEllipse(
          1600,
          width * 0.5,
          height * 0.5,
          width * 0.42,
          height * 0.42
        ),
        seeds: [
          { x: width * 0.5, y: height * 0.52 },
          { x: width * 0.38, y: height * 0.6 },
          { x: width * 0.62, y: height * 0.58 },
        ],
        attractionRadius: 70,
        killDistance: 10,
        stepSize: 4.5,
        jitter: 0.28,
        bias: { x: 0, y: 0 },
      };
    },

    lightning(width, height) {
      return {
        attractors: scatterInEllipse(
          900,
          width * 0.5,
          height * 0.28,
          width * 0.34,
          height * 0.22
        ),
        seeds: [{ x: width * 0.5, y: height - 24 }],
        attractionRadius: 220,
        killDistance: 14,
        stepSize: 10,
        jitter: 0.08,
        bias: { x: 0, y: -0.35 },
      };
    },

    veins(width, height) {
      const cx = width * 0.5;
      const cy = height * 0.52;
      const leaf = [
        { x: cx, y: height * 0.12 },
        { x: width * 0.78, y: height * 0.38 },
        { x: width * 0.72, y: height * 0.7 },
        { x: cx, y: height * 0.9 },
        { x: width * 0.28, y: height * 0.7 },
        { x: width * 0.22, y: height * 0.38 },
      ];
      return {
        attractors: scatterInPolygon(1500, leaf, {
          x: width * 0.18,
          y: height * 0.1,
          w: width * 0.64,
          h: height * 0.82,
        }),
        seeds: [{ x: cx, y: height * 0.88 }],
        attractionRadius: 72,
        killDistance: 9,
        stepSize: 4.2,
        jitter: 0.1,
        bias: { x: 0, y: -0.12 },
      };
    },

    cluster(width, height) {
      const clouds = [];
      const centers = [
        [0.28, 0.3],
        [0.72, 0.26],
        [0.5, 0.52],
        [0.3, 0.74],
        [0.7, 0.7],
        [0.52, 0.22],
      ];
      for (const [nx, ny] of centers) {
        clouds.push(
          ...scatterInEllipse(220, width * nx, height * ny, width * 0.12, height * 0.1)
        );
      }
      return {
        attractors: clouds,
        seeds: [{ x: width * 0.5, y: height * 0.5 }],
        attractionRadius: 110,
        killDistance: 12,
        stepSize: 6,
        jitter: 0.16,
        bias: { x: 0, y: 0 },
      };
    },

    mycelium(width, height) {
      return {
        attractors: scatterInRect(1800, 24, 24, width - 48, height - 48),
        seeds: [
          { x: width * 0.2, y: height * 0.8 },
          { x: width * 0.8, y: height * 0.75 },
          { x: width * 0.55, y: height * 0.2 },
        ],
        attractionRadius: 64,
        killDistance: 8,
        stepSize: 4,
        jitter: 0.22,
        bias: { x: 0, y: 0 },
      };
    },
  };

  global.SpaceColonization = {
    Vec2,
    Node,
    Simulator,
    Presets,
    dist,
    buildPathIndex,
    nearestPathPoint,
    detectGridShapes,
    sampleCirclePerimeter,
    sampleRectPerimeter,
    parseSvgGridShapes,
    obstacleContains,
    hitTestObstacles,
    obstacleAabb,
  };
})(window);

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

    const wide = pickPathStep(x, y, dirX, dirY, step, index, 4);
    if (wide) return wide;

    const ahead = pickPathAhead(x, y, dirX, dirY, step, index, bridgeReach);
    if (ahead) {
      const vx = ahead.x - x;
      const vy = ahead.y - y;
      const d = Math.hypot(vx, vy) || 1;
      if (d <= step * 1.25) return new Vec2(ahead.x, ahead.y);
      return new Vec2(x + (vx / d) * step, y + (vy / d) * step);
    }

    const nx = x + dirX * step;
    const ny = y + dirY * step;
    const snap = nearestPathPoint(nx, ny, index, step * 2);
    if (snap) return new Vec2(snap.x, snap.y);
    return new Vec2(nx, ny);
  }

  class Node {
    constructor(pos, parent = null) {
      this.pos = pos;
      this.parent = parent;
      this.children = [];
      this.thickness = 1;
      this.order = 1;
      this.age = 0;
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
      this.generation = 0;
      this.lastInfluences = [];
      this.consumed = [];
      this.circles = [];
    }

    clearStructure() {
      this.nodes = [];
      this.generation = 0;
      this.lastInfluences = [];
      this.consumed = [];
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
      this.nodes.push(seed);
      return seed;
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

        const len = Math.hypot(dirX, dirY);
        if (len < 1e-8) continue;

        const step = this.stepSize;
        const bridgeReach = Math.max(this.attractionRadius, step * 8);
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

        const next = new Node(nextPos, node);
        node.children.push(next);
        newborns.push(next);
      }

      if (!newborns.length) return false;

      this.nodes.push(...newborns);
      this.generation += 1;

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
  };
})(window);

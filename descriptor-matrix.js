/**
 * Descriptor Matrix: generate emergent candidates, analyze section space,
 * score against a descriptor, then keep the best diverse results.
 */
(function (global) {
  const TYPES = [
    { id: "lobby", label: "Lobby" },
    { id: "workspace", label: "Workspace" },
    { id: "gathering", label: "Gathering" },
  ];

  const DESCRIPTORS = {
    lobby: [
      { id: "interlocking", label: "Interlocking" },
      { id: "centralized", label: "Centralized" },
      { id: "sequential", label: "Sequential" },
      { id: "terraced", label: "Terraced" },
      { id: "continuous", label: "Continuous" },
    ],
    workspace: [
      { id: "porosity", label: "Porosity" },
      { id: "stepped", label: "Stepped" },
      { id: "overlooking", label: "Overlooking" },
      { id: "sequential", label: "Sequential" },
      { id: "compressed", label: "Compressed" },
    ],
    gathering: [
      { id: "nesting", label: "Nesting" },
      { id: "offset", label: "Offset" },
      { id: "terraced", label: "Terraced" },
      { id: "vertical-porosity", label: "Vertical Porosity" },
      { id: "slope", label: "Slope" },
    ],
  };

  const CANDIDATE_COUNT = 100;
  const MATRIX_COUNT = 25;
  const ANALYSIS_N = 200;
  const MIN_REGION_CELLS = 80;

  function descriptorsFor(type) {
    return DESCRIPTORS[type] || DESCRIPTORS.lobby;
  }

  function createRng(seed) {
    let a = seed >>> 0;
    return function rng() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeed(seed, salt) {
    return ((seed >>> 0) ^ Math.imul((salt + 1) | 0, 2654435761)) >>> 0;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function roundTo(n, step) {
    if (!step) return n;
    return Math.round(n / step) * step;
  }

  function hypot2(dx, dy) {
    return Math.sqrt(dx * dx + dy * dy);
  }

  function mean(arr) {
    if (!arr.length) return 0;
    let s = 0;
    for (const v of arr) s += v;
    return s / arr.length;
  }

  function variance(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    let s = 0;
    for (const v of arr) s += (v - m) * (v - m);
    return s / arr.length;
  }

  function peakAround(value, lo, hi, best) {
    if (value <= lo || value >= hi) return 0;
    if (value <= best) return (value - lo) / Math.max(1e-6, best - lo);
    return (hi - value) / Math.max(1e-6, hi - best);
  }

  function varyAround(base, min, max, v, rng, frac) {
    const span = (max - min) * (0.1 + v * 0.9) * (frac == null ? 0.55 : frac);
    return clamp(Number(base) + (rng() * 2 - 1) * span, min, max);
  }

  function sampleAttractors(pool, count, rng, jitterPx) {
    const out = [];
    if (!pool || !pool.length) return out;
    const n = Math.max(80, Math.round(count));
    let guard = 0;
    while (out.length < n && guard < n * 6) {
      guard += 1;
      const p = pool[(rng() * pool.length) | 0];
      out.push({
        x: p.x + (rng() * 2 - 1) * jitterPx,
        y: p.y + (rng() * 2 - 1) * jitterPx,
      });
    }
    return out;
  }

  function sampleRoots(path, count, rng, site) {
    const n = Math.max(1, count);
    if (!path || !path.length) {
      return [{ x: site.x + site.w * 0.5, y: site.y + site.h * 0.88 }];
    }
    const pts = [];
    const used = new Set();
    let guard = 0;
    while (pts.length < n && guard < 80) {
      guard += 1;
      const i = (rng() * path.length) | 0;
      if (used.has(i)) continue;
      used.add(i);
      pts.push({ x: path[i].x, y: path[i].y });
    }
    if (!pts.length) pts.push({ x: path[0].x, y: path[0].y });
    return pts;
  }

  function planCandidate(options) {
    const rng = options.rng || createRng(options.seed >>> 0);
    const v = clamp(Number(options.variation || 0) / 100, 0, 1);
    const base = options.baseParams || {};
    const site = options.site;
    const pool = options.attractorPool || [];
    const path = options.path || [];
    const count = Math.round(varyAround(base.count || 800, 420, 1400, v, rng, 0.7));
    const jitterPx = (base.stepSize || 6) * (0.15 + v * 1.1);
    const rootCount = v < 0.25 ? 1 : 1 + Math.round(rng() * (v < 0.65 ? 1 : 2));
    const keepMerge = rng() > v * 0.45;
    const params = {
      count,
      influence: Math.round(varyAround(base.influence || 90, 40, 150, v, rng)),
      kill: roundTo(varyAround(base.kill || 12, 6, 18, v, rng), 0.5),
      stepSize: roundTo(varyAround(base.stepSize || 6, 3.5, 9, v, rng), 0.1),
      growthDirection: roundTo(varyAround(base.growthDirection || 0, -1, 1, v, rng, 0.85), 0.05),
      mergeBranches: keepMerge ? !!base.mergeBranches : rng() < 0.55,
      mergeDistance: Math.round(varyAround(base.mergeDistance || 20, 8, 48, v, rng)),
      iterationsCap: roundTo(varyAround(base.iterationsCap || 250, 160, 380, v, rng), 10),
      siteFeet: base.siteFeet,
      pixelsPerFoot: base.pixelsPerFoot,
      viewportW: base.viewportW,
      viewportH: base.viewportH,
    };
    return {
      seed: options.seed >>> 0,
      index: options.index || 0,
      params,
      jitter: varyAround(0.05, 0.015, 0.14, v, rng, 0.8),
      attractors: sampleAttractors(pool, count, rng, jitterPx),
      roots: sampleRoots(path, rootCount, rng, site),
    };
  }

  function stampCircle(occ, n, cx, cy, r) {
    const r0 = Math.max(1, Math.ceil(r));
    const x0 = Math.max(0, Math.floor(cx - r0));
    const x1 = Math.min(n - 1, Math.ceil(cx + r0));
    const y0 = Math.max(0, Math.floor(cy - r0));
    const y1 = Math.min(n - 1, Math.ceil(cy + r0));
    const rSq = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= rSq) occ[y * n + x] = 1;
      }
    }
  }

  function stampSegment(occ, n, x1, y1, x2, y2, r) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.max(1, hypot2(dx, dy));
    const steps = Math.max(1, Math.ceil(len));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stampCircle(occ, n, x1 + dx * t, y1 + dy * t, r);
    }
  }

  function distanceField(occ, n) {
    const inf = n * n;
    const dist = new Float32Array(n * n);
    const qx = [];
    const qy = [];
    for (let i = 0; i < occ.length; i++) {
      if (occ[i]) {
        dist[i] = 0;
        qx.push(i % n);
        qy.push((i / n) | 0);
      } else dist[i] = inf;
    }
    let head = 0;
    while (head < qx.length) {
      const x = qx[head];
      const y = qy[head];
      head += 1;
      const d = dist[y * n + x];
      if (x > 0 && dist[y * n + x - 1] > d + 1) {
        dist[y * n + x - 1] = d + 1;
        qx.push(x - 1);
        qy.push(y);
      }
      if (x < n - 1 && dist[y * n + x + 1] > d + 1) {
        dist[y * n + x + 1] = d + 1;
        qx.push(x + 1);
        qy.push(y);
      }
      if (y > 0 && dist[(y - 1) * n + x] > d + 1) {
        dist[(y - 1) * n + x] = d + 1;
        qx.push(x);
        qy.push(y - 1);
      }
      if (y < n - 1 && dist[(y + 1) * n + x] > d + 1) {
        dist[(y + 1) * n + x] = d + 1;
        qx.push(x);
        qy.push(y + 1);
      }
    }
    return dist;
  }

  function regionFromCells(cells, n) {
    let minX = n;
    let minY = n;
    let maxX = 0;
    let maxY = 0;
    let sx = 0;
    let sy = 0;
    let peri = 0;
    let enclosed = 0;
    for (const i of cells) {
      const x = i % n;
      const y = (i / n) | 0;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const set = new Set(cells);
    for (const i of cells) {
      const x = i % n;
      const y = (i / n) | 0;
      const nbs = [
        x > 0 ? i - 1 : -1,
        x < n - 1 ? i + 1 : -1,
        y > 0 ? i - n : -1,
        y < n - 1 ? i + n : -1,
      ];
      for (const nb of nbs) {
        if (nb < 0 || !set.has(nb)) {
          peri += 1;
          if (nb >= 0) enclosed += 1;
        }
      }
    }
    const w = (maxX - minX + 1) / n;
    const h = (maxY - minY + 1) / n;
    return {
      area: cells.length,
      areaFrac: cells.length / (n * n),
      cx: sx / cells.length / n,
      cy: sy / cells.length / n,
      minX: minX / n,
      minY: minY / n,
      maxX: (maxX + 1) / n,
      maxY: (maxY + 1) / n,
      width: w,
      height: h,
      aspect: h / Math.max(1e-6, w),
      distCenter: hypot2(sx / cells.length / n - 0.5, sy / cells.length / n - 0.5),
      enclosure: peri ? enclosed / peri : 0,
      perimeter: peri,
    };
  }

  function findRegions(occ, n, minCells) {
    const seen = new Uint8Array(n * n);
    const regions = [];
    const stack = [];
    for (let i = 0; i < occ.length; i++) {
      if (occ[i] || seen[i]) continue;
      stack.length = 0;
      stack.push(i);
      seen[i] = 1;
      const cells = [];
      while (stack.length) {
        const cur = stack.pop();
        cells.push(cur);
        const x = cur % n;
        const y = (cur / n) | 0;
        if (x > 0 && !occ[cur - 1] && !seen[cur - 1]) {
          seen[cur - 1] = 1;
          stack.push(cur - 1);
        }
        if (x < n - 1 && !occ[cur + 1] && !seen[cur + 1]) {
          seen[cur + 1] = 1;
          stack.push(cur + 1);
        }
        if (y > 0 && !occ[cur - n] && !seen[cur - n]) {
          seen[cur - n] = 1;
          stack.push(cur - n);
        }
        if (y < n - 1 && !occ[cur + n] && !seen[cur + n]) {
          seen[cur + n] = 1;
          stack.push(cur + n);
        }
      }
      if (cells.length >= minCells) regions.push(regionFromCells(cells, n));
    }
    regions.sort((a, b) => b.area - a.area);
    return regions;
  }

  function densityBins(occ, n, bins) {
    const out = new Array(bins * bins).fill(0);
    const cell = n / bins;
    let max = 1;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!occ[y * n + x]) continue;
        const bx = Math.min(bins - 1, (x / cell) | 0);
        const by = Math.min(bins - 1, (y / cell) | 0);
        const i = by * bins + bx;
        out[i] += 1;
        if (out[i] > max) max = out[i];
      }
    }
    return out.map((v) => v / max);
  }

  function clearanceProfile(occ, n, axis) {
    const profile = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let best = 0;
      let run = 0;
      for (let j = 0; j < n; j++) {
        const open = axis === "x" ? !occ[j * n + i] : !occ[i * n + j];
        if (open) {
          run += 1;
          if (run > best) best = run;
        } else run = 0;
      }
      profile[i] = best / n;
    }
    return profile;
  }

  function pinchContrast(profile) {
    if (!profile.length) return { contrast: 0, loc: 0.5, through: 0 };
    let minV = 1;
    let minI = (profile.length / 2) | 0;
    const a = Math.floor(profile.length * 0.18);
    const b = Math.ceil(profile.length * 0.82);
    for (let i = a; i < b; i++) {
      if (profile[i] < minV) {
        minV = profile[i];
        minI = i;
      }
    }
    let left = 0;
    let right = 0;
    const span = Math.max(4, (profile.length * 0.18) | 0);
    for (let i = Math.max(0, minI - span * 2); i < minI - 2; i++) left = Math.max(left, profile[i]);
    for (let i = minI + 2; i < Math.min(profile.length, minI + span * 2); i++) {
      right = Math.max(right, profile[i]);
    }
    const sides = Math.max(left, right);
    const contrast = sides > 0.04 ? clamp((sides - minV) / sides, 0, 1) : 0;
    const both = left > minV * 1.15 && right > minV * 1.15 ? 1 : 0.35;
    return { contrast, loc: minI / profile.length, through: minV, both };
  }

  function analyzeSection(segments, site, extra) {
    const n = ANALYSIS_N;
    const occ = new Uint8Array(n * n);
    const stamp = Math.max(2.2, n * 0.034);
    const w = Math.max(1, site.w);
    const h = Math.max(1, site.h);
    for (let i = 0; i + 3 < segments.length; i += 4) {
      const x1 = ((segments[i] - site.x) / w) * (n - 1);
      const y1 = ((segments[i + 1] - site.y) / h) * (n - 1);
      const x2 = ((segments[i + 2] - site.x) / w) * (n - 1);
      const y2 = ((segments[i + 3] - site.y) / h) * (n - 1);
      stampSegment(occ, n, x1, y1, x2, y2, stamp);
    }
    let occupied = 0;
    for (let i = 0; i < occ.length; i++) if (occ[i]) occupied += 1;
    const regions = findRegions(occ, n, MIN_REGION_CELLS);
    const dist = distanceField(occ, n);
    let distSum = 0;
    let open = 0;
    for (let i = 0; i < dist.length; i++) {
      if (!occ[i]) {
        open += 1;
        distSum += dist[i];
      }
    }
    const xClear = clearanceProfile(occ, n, "x");
    const yClear = clearanceProfile(occ, n, "y");
    const roots = extra && extra.roots ? extra.roots : [];
    const fingerprint = {
      n: regions.length,
      occ: occupied / occ.length,
      open: open / occ.length,
      cents: regions.slice(0, 4).map((r) => [r.cx, r.cy, r.areaFrac]),
      sizes: regions.slice(0, 4).map((r) => r.areaFrac),
      roots: roots.map((r) => [
        (r.x - site.x) / w,
        (r.y - site.y) / h,
      ]),
      bins: densityBins(occ, n, 4),
    };
    return {
      n,
      occupancy: occupied / occ.length,
      openFrac: open / occ.length,
      meanOpenDist: open ? distSum / open / n : 0,
      regions,
      largest: regions[0] || null,
      xClear,
      yClear,
      xPinch: pinchContrast(xClear),
      yPinch: pinchContrast(yClear),
      fingerprint,
    };
  }

  function bboxOverlap(a, b, pad) {
    const p = pad || 0;
    const x0 = Math.max(a.minX - p, b.minX - p);
    const y0 = Math.max(a.minY - p, b.minY - p);
    const x1 = Math.min(a.maxX + p, b.maxX + p);
    const y1 = Math.min(a.maxY + p, b.maxY + p);
    if (x1 <= x0 || y1 <= y0) return 0;
    return (x1 - x0) * (y1 - y0);
  }

  function containsPoint(region, x, y) {
    return x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY;
  }

  function applyIntensity(score, t, lenient, strict) {
    const n = clamp(score / 100, 0, 1);
    const exp = lerp(lenient == null ? 0.58 : lenient, strict == null ? 1.55 : strict, t);
    return 100 * Math.pow(n, exp);
  }

  function pack(parts, t, lenient, strict) {
    let totalW = 0;
    let acc = 0;
    const breakdown = {};
    for (const part of parts) {
      const s = clamp(part.score, 0, 100);
      breakdown[part.key] = Math.round(s);
      acc += s * part.weight;
      totalW += part.weight;
    }
    const raw = totalW ? acc / totalW : 0;
    return {
      score: Math.round(applyIntensity(raw, t, lenient, strict)),
      breakdown,
      raw: Math.round(raw),
    };
  }

  function scoreInterlocking(analysis) {
    const rs = analysis.regions;
    const n = rs.length;
    const nScore = 100 * peakAround(n, 1.2, 7, 3);
    if (n < 2) {
      return [
        { key: "Region Count", score: nScore * 0.4, weight: 0.35 },
        { key: "Interaction", score: 8, weight: 0.4 },
        { key: "Identity", score: 20, weight: 0.25 },
      ];
    }
    let interact = 0;
    let identity = 0;
    let pairs = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        pairs += 1;
        const a = rs[i];
        const b = rs[j];
        const overlap = bboxOverlap(a, b, 0.04);
        const union = Math.max(1e-6, a.width * a.height + b.width * b.height - overlap);
        const iou = overlap / union;
        const d = hypot2(a.cx - b.cx, a.cy - b.cy);
        const reach = (Math.max(a.width, a.height) + Math.max(b.width, b.height)) * 0.55;
        const near = d < reach ? 1 - d / Math.max(1e-6, reach) : 0;
        interact += Math.max(iou * 1.4, near * 0.85);
        identity += 1 - clamp(iou * 1.6, 0, 1);
      }
    }
    return [
      { key: "Region Count", score: nScore, weight: 0.28 },
      { key: "Interaction", score: 100 * clamp(interact / pairs, 0, 1), weight: 0.42 },
      { key: "Identity", score: 100 * clamp(identity / pairs, 0, 1), weight: 0.3 },
    ];
  }

  function scoreCentralized(analysis, t) {
    const big = analysis.largest;
    if (!big) {
      return [
        { key: "Dominant Region", score: 4, weight: 0.4 },
        { key: "Central Position", score: 4, weight: 0.35 },
        { key: "Surrounding Definition", score: 4, weight: 0.25 },
      ];
    }
    const total = analysis.regions.reduce((s, r) => s + r.area, 0) || 1;
    const dominance = 100 * peakAround(big.area / total, 0.22, 1.02, 0.62);
    const central = 100 * clamp(1 - big.distCenter / 0.42, 0, 1);
    const surround =
      100 *
      clamp(
        big.enclosure * 0.7 + (analysis.regions.length >= 2 ? 0.2 : 0) + analysis.occupancy * 0.25,
        0,
        1
      );
    const cW = 0.35 + t * 0.18;
    const dW = 0.4;
    const sW = Math.max(0.14, 1 - dW - cW);
    return [
      { key: "Dominant Region", score: dominance, weight: dW },
      { key: "Central Position", score: central, weight: cW },
      { key: "Surrounding Definition", score: surround, weight: sW },
    ];
  }

  function bestAxis(regions) {
    let best = { axis: "x", spread: 0 };
    const modes = [
      { axis: "x", proj: (r) => r.cx },
      { axis: "y", proj: (r) => r.cy },
      { axis: "diag", proj: (r) => (r.cx + r.cy) * 0.5 },
    ];
    for (const mode of modes) {
      const vals = regions.map(mode.proj);
      const sp = Math.max(...vals) - Math.min(...vals);
      if (sp > best.spread) best = { axis: mode.axis, spread: sp, proj: mode.proj };
    }
    return best;
  }

  function scoreSequential(analysis, repeated) {
    const rs = analysis.regions;
    const n = rs.length;
    const target = repeated ? 4.2 : 3.6;
    const nScore = 100 * peakAround(n, 1.5, 7.2, target);
    if (n < 2) {
      return [
        { key: "Region Count", score: nScore * 0.35, weight: 0.3 },
        { key: "Progression", score: 6, weight: 0.45 },
        { key: "Spacing", score: 8, weight: 0.25 },
      ];
    }
    const axis = bestAxis(rs);
    const ordered = rs.slice().sort((a, b) => axis.proj(a) - axis.proj(b));
    const gaps = [];
    for (let i = 1; i < ordered.length; i++) {
      gaps.push(axis.proj(ordered[i]) - axis.proj(ordered[i - 1]));
    }
    const gMean = mean(gaps);
    const gVar = variance(gaps);
    const regular = gMean > 0.04 ? 1 - clamp(Math.sqrt(gVar) / gMean, 0, 1) : 0.2;
    const spread = clamp(axis.spread / 0.72, 0, 1);
    const sizes = ordered.map((r) => r.areaFrac);
    const sizeReg = 1 - clamp(Math.sqrt(variance(sizes)) / Math.max(1e-6, mean(sizes)), 0, 1);
    const progression = 100 * clamp(spread * 0.65 + (n >= 3 ? 0.35 : 0.15), 0, 1);
    const spacing = 100 * clamp(regular * (repeated ? 0.7 : 0.55) + sizeReg * (repeated ? 0.3 : 0.2), 0, 1);
    return [
      { key: "Region Count", score: nScore, weight: repeated ? 0.28 : 0.3 },
      { key: "Progression", score: progression, weight: 0.42 },
      { key: "Spacing", score: spacing, weight: repeated ? 0.3 : 0.28 },
    ];
  }

  function scoreTerraced(analysis, dramatic) {
    const rs = analysis.regions;
    const n = rs.length;
    const nScore = 100 * peakAround(n, 1.6, 7, dramatic ? 3.4 : 4);
    if (n < 2) {
      return [
        { key: "Level Count", score: 8, weight: 0.3 },
        { key: "Elevation Shift", score: 6, weight: 0.45 },
        { key: "Horizontal Zones", score: 10, weight: 0.25 },
      ];
    }
    const ordered = rs.slice().sort((a, b) => a.cy - b.cy);
    const dys = [];
    const dxs = [];
    for (let i = 1; i < ordered.length; i++) {
      dys.push(ordered[i].cy - ordered[i - 1].cy);
      dxs.push(ordered[i].cx - ordered[i - 1].cx);
    }
    const yProg = mean(dys.map((v) => (v > 0.03 ? 1 : v > 0 ? 0.4 : 0)));
    const xOff = mean(dxs.map((v) => clamp(Math.abs(v) / (dramatic ? 0.18 : 0.12), 0, 1)));
    const horiz = mean(rs.map((r) => (r.width > r.height * 0.85 ? 1 : r.width / Math.max(r.height, 0.05))));
    const ySpan = ordered[ordered.length - 1].cy - ordered[0].cy;
    const elev = 100 * clamp(yProg * 0.5 + clamp(ySpan / (dramatic ? 0.38 : 0.48), 0, 1) * 0.5, 0, 1);
    return [
      { key: "Level Count", score: nScore, weight: 0.28 },
      { key: "Elevation Shift", score: elev, weight: 0.4 },
      { key: "Horizontal Zones", score: 100 * clamp(horiz * 0.55 + xOff * 0.45, 0, 1), weight: 0.32 },
    ];
  }

  function scoreContinuous(analysis) {
    const rs = analysis.regions;
    const big = analysis.largest;
    const frag = rs.length <= 1 ? 1 : clamp(1 - (rs.length - 1) / 6, 0, 1);
    const cover = big ? clamp(big.areaFrac / Math.max(0.08, analysis.openFrac || 0.2), 0, 1) : 0;
    const smooth = 1 - clamp(variance(Array.from(analysis.xClear)) * 18, 0, 1);
    const connected = 100 * clamp(frag * 0.45 + cover * 0.35 + analysis.openFrac * 0.2, 0, 1);
    return [
      { key: "Connectivity", score: connected, weight: 0.45 },
      { key: "Low Fragmentation", score: 100 * frag, weight: 0.3 },
      { key: "Field Smoothness", score: 100 * clamp(smooth, 0, 1), weight: 0.25 },
    ];
  }

  function scorePorosity(analysis) {
    const n = analysis.regions.length;
    const nScore = 100 * peakAround(n, 1.5, 12, 5);
    if (n < 2) {
      return [
        { key: "Openings", score: nScore * 0.4, weight: 0.34 },
        { key: "Distribution", score: 8, weight: 0.33 },
        { key: "Field Continuity", score: 20, weight: 0.33 },
      ];
    }
    const xs = analysis.regions.map((r) => r.cx);
    const ys = analysis.regions.map((r) => r.cy);
    const spread = clamp((Math.sqrt(variance(xs)) + Math.sqrt(variance(ys))) / 0.45, 0, 1);
    const sizes = analysis.regions.map((r) => r.areaFrac);
    const sizeVar = clamp(Math.sqrt(variance(sizes)) / Math.max(1e-6, mean(sizes)), 0, 1);
    const field = clamp(analysis.occupancy / 0.42, 0, 1) * (1 - clamp((n - 8) / 8, 0, 1) * 0.7);
    return [
      { key: "Openings", score: nScore, weight: 0.34 },
      { key: "Distribution", score: 100 * clamp(spread * 0.7 + sizeVar * 0.3, 0, 1), weight: 0.33 },
      { key: "Field Continuity", score: 100 * field, weight: 0.33 },
    ];
  }

  function clusterLevels(values, minGap) {
    const sorted = values.slice().sort((a, b) => a - b);
    const levels = [];
    for (const v of sorted) {
      const last = levels[levels.length - 1];
      if (!last || v - last.mean > minGap) levels.push({ sum: v, n: 1, mean: v, vals: [v] });
      else {
        last.sum += v;
        last.n += 1;
        last.vals.push(v);
        last.mean = last.sum / last.n;
      }
    }
    return levels;
  }

  function scoreStepped(analysis) {
    const rs = analysis.regions;
    if (rs.length < 2) {
      return [
        { key: "Discrete Levels", score: 8, weight: 0.4 },
        { key: "Abrupt Change", score: 6, weight: 0.35 },
        { key: "Band Shape", score: 10, weight: 0.25 },
      ];
    }
    const levels = clusterLevels(
      rs.map((r) => r.cy),
      0.09
    );
    const nScore = 100 * peakAround(levels.length, 1.4, 6.2, 3.4);
    const gaps = [];
    for (let i = 1; i < levels.length; i++) gaps.push(levels[i].mean - levels[i - 1].mean);
    const abrupt = gaps.length ? mean(gaps.map((g) => clamp((g - 0.06) / 0.16, 0, 1))) : 0;
    const within = mean(
      levels.map((lv) => 1 - clamp(Math.sqrt(variance(lv.vals)) / 0.08, 0, 1))
    );
    const horiz = mean(rs.map((r) => clamp(r.width / Math.max(r.height, 0.05) / 1.6, 0, 1)));
    const slopeLike = Math.abs(corr(rs.map((r) => r.cx), rs.map((r) => r.cy)));
    return [
      { key: "Discrete Levels", score: nScore, weight: 0.38 },
      { key: "Abrupt Change", score: 100 * clamp(abrupt * 0.6 + within * 0.4, 0, 1), weight: 0.37 },
      { key: "Band Shape", score: 100 * clamp(horiz * 0.75 * (1 - slopeLike * 0.55), 0, 1), weight: 0.25 },
    ];
  }

  function corr(xs, ys) {
    if (xs.length < 3) return 0;
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < xs.length; i++) {
      const ax = xs[i] - mx;
      const ay = ys[i] - my;
      num += ax * ay;
      dx += ax * ax;
      dy += ay * ay;
    }
    const den = Math.sqrt(dx * dy);
    return den < 1e-8 ? 0 : num / den;
  }

  function scoreOverlooking(analysis) {
    const rs = analysis.regions;
    if (rs.length < 2) {
      return [
        { key: "Paired Regions", score: 6, weight: 0.3 },
        { key: "Vertical Separation", score: 6, weight: 0.35 },
        { key: "Open Between", score: 8, weight: 0.35 },
      ];
    }
    let best = 0;
    let bestVert = 0;
    let bestOpen = 0;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i];
        const b = rs[j];
        const dy = Math.abs(a.cy - b.cy);
        const xOverlap = bboxOverlap(
          { minX: a.minX, maxX: a.maxX, minY: 0, maxY: 1 },
          { minX: b.minX, maxX: b.maxX, minY: 0, maxY: 1 },
          0.02
        );
        const midY = (a.cy + b.cy) / 2;
        const midX = (a.cx + b.cx) / 2;
        const between = analysis.regions.some(
          (r) => r !== a && r !== b && Math.abs(r.cy - midY) < 0.16 && Math.abs(r.cx - midX) < 0.22
        );
        const open = between ? 1 : clamp(dy * 1.4, 0, 0.55);
        const pair = clamp(dy / 0.28, 0, 1) * 0.55 + clamp(xOverlap * 8, 0, 1) * 0.45;
        if (pair > best) {
          best = pair;
          bestVert = clamp(dy / 0.32, 0, 1);
          bestOpen = open;
        }
      }
    }
    return [
      { key: "Paired Regions", score: 100 * peakAround(rs.length, 1.5, 6, 2.4), weight: 0.28 },
      { key: "Vertical Separation", score: 100 * bestVert, weight: 0.36 },
      { key: "Open Between", score: 100 * clamp(bestOpen, 0, 1), weight: 0.36 },
    ];
  }

  function scoreCompressed(analysis, t) {
    const xp = analysis.xPinch;
    const yp = analysis.yPinch;
    const pinch = xp.contrast * xp.both >= yp.contrast * yp.both ? xp : yp;
    const contrast = 100 * clamp(pinch.contrast, 0, 1);
    const shape = 100 * pinch.both * (pinch.through > 0.015 ? 1 : 0.45);
    const loc = 100 * (1 - Math.abs(pinch.loc - 0.5) * 0.7);
    const need = lerp(0.12, 0.38, t);
    const strength = pinch.contrast >= need ? contrast : contrast * (pinch.contrast / Math.max(0.04, need));
    return [
      { key: "Constriction", score: strength, weight: 0.46 },
      { key: "Open-Narrow-Open", score: shape, weight: 0.32 },
      { key: "Clarity", score: loc, weight: 0.22 },
    ];
  }

  function scoreNesting(analysis) {
    const rs = analysis.regions;
    if (rs.length < 2) {
      return [
        { key: "Containment", score: 8, weight: 0.45 },
        { key: "Scale Hierarchy", score: 8, weight: 0.3 },
        { key: "Enclosure", score: 10, weight: 0.25 },
      ];
    }
    let best = 0;
    let scale = 0;
    let enc = 0;
    for (let i = 0; i < rs.length; i++) {
      for (let j = 0; j < rs.length; j++) {
        if (i === j) continue;
        const outer = rs[i];
        const inner = rs[j];
        if (inner.area >= outer.area * 0.92) continue;
        const inside = containsPoint(outer, inner.cx, inner.cy) ? 1 : 0;
        const overlap = bboxOverlap(outer, inner, 0);
        const innerBox = Math.max(1e-6, inner.width * inner.height);
        const contained = clamp(overlap / innerBox, 0, 1);
        const rel = inside * 0.55 + contained * 0.45;
        if (rel > best) {
          best = rel;
          scale = clamp(outer.area / Math.max(1, inner.area) / 4, 0, 1);
          enc = inner.enclosure;
        }
      }
    }
    return [
      { key: "Containment", score: 100 * best, weight: 0.45 },
      { key: "Scale Hierarchy", score: 100 * scale, weight: 0.3 },
      { key: "Enclosure", score: 100 * enc, weight: 0.25 },
    ];
  }

  function scoreOffset(analysis) {
    const rs = analysis.regions;
    const nScore = 100 * peakAround(rs.length, 1.4, 6.5, 3);
    if (rs.length < 2) {
      return [
        { key: "Region Count", score: 8, weight: 0.25 },
        { key: "Displacement", score: 6, weight: 0.5 },
        { key: "Relationship", score: 10, weight: 0.25 },
      ];
    }
    let disp = 0;
    let rel = 0;
    let pairs = 0;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        pairs += 1;
        const dx = Math.abs(rs[i].cx - rs[j].cx);
        const dy = Math.abs(rs[i].cy - rs[j].cy);
        const misalign = clamp(Math.min(dx, dy) / 0.12, 0, 1);
        disp += clamp((dx + dy) / 0.55, 0, 1) * 0.7 + misalign * 0.3;
        const d = hypot2(dx, dy);
        rel += d > 0.08 && d < 0.62 ? 1 : d < 0.8 ? 0.45 : 0.1;
      }
    }
    return [
      { key: "Region Count", score: nScore, weight: 0.25 },
      { key: "Displacement", score: 100 * clamp(disp / pairs, 0, 1), weight: 0.5 },
      { key: "Relationship", score: 100 * clamp(rel / pairs, 0, 1), weight: 0.25 },
    ];
  }

  function scoreVerticalPorosity(analysis) {
    const tall = analysis.regions.filter((r) => r.aspect >= 1.25 && r.height >= 0.16);
    const nScore = 100 * peakAround(tall.length, 0.6, 7, 3);
    const vert = tall.length
      ? mean(tall.map((r) => clamp((r.aspect - 1) / 1.8, 0, 1) * 0.5 + clamp(r.height / 0.55, 0, 1) * 0.5))
      : 0;
    const xs = tall.map((r) => r.cx);
    const distro = xs.length > 1 ? clamp(Math.sqrt(variance(xs)) / 0.28, 0, 1) : 0.2;
    const roundPenalty = analysis.regions.filter((r) => r.aspect < 1.15 && r.areaFrac < 0.04).length;
    const penalty = clamp(1 - roundPenalty / 8, 0, 1);
    return [
      { key: "Vertical Openings", score: nScore * penalty, weight: 0.36 },
      { key: "Vertical Extent", score: 100 * vert, weight: 0.4 },
      { key: "Distribution", score: 100 * distro, weight: 0.24 },
    ];
  }

  function scoreSlope(analysis) {
    const rs = analysis.regions;
    if (rs.length < 2) {
      return [
        { key: "Gradient", score: 8, weight: 0.4 },
        { key: "Consistency", score: 8, weight: 0.35 },
        { key: "Continuity", score: 12, weight: 0.25 },
      ];
    }
    const xs = rs.map((r) => r.cx);
    const ys = rs.map((r) => r.cy);
    const r = corr(xs, ys);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    const grad = clamp(Math.abs(r) * clamp(spanY / 0.28, 0, 1), 0, 1);
    const stepped = clusterLevels(ys, 0.1);
    const stepPen = clamp((stepped.length - 1) / 4, 0, 1);
    const cont = analysis.regions.length <= 4 ? 1 : clamp(1 - (analysis.regions.length - 4) / 6, 0, 1);
    return [
      { key: "Gradient", score: 100 * grad, weight: 0.42 },
      { key: "Consistency", score: 100 * clamp(Math.abs(r) * (1 - stepPen * 0.65), 0, 1), weight: 0.33 },
      { key: "Continuity", score: 100 * cont * (spanX > 0.2 ? 1 : 0.6), weight: 0.25 },
    ];
  }

  const SCORERS = {
    "lobby:interlocking": (a, t) => pack(scoreInterlocking(a), t, 0.62, 1.4),
    "lobby:centralized": (a, t) => pack(scoreCentralized(a, t), t, 0.55, 1.7),
    "lobby:sequential": (a, t) => pack(scoreSequential(a, false), t, 0.6, 1.5),
    "lobby:terraced": (a, t) => pack(scoreTerraced(a, false), t, 0.6, 1.5),
    "lobby:continuous": (a, t) => pack(scoreContinuous(a), t, 0.58, 1.45),
    "workspace:porosity": (a, t) => pack(scorePorosity(a), t, 0.6, 1.5),
    "workspace:stepped": (a, t) => pack(scoreStepped(a), t, 0.58, 1.65),
    "workspace:overlooking": (a, t) => pack(scoreOverlooking(a), t, 0.6, 1.55),
    "workspace:sequential": (a, t) => pack(scoreSequential(a, true), t, 0.55, 1.6),
    "workspace:compressed": (a, t) => pack(scoreCompressed(a, t), t, 0.52, 1.75),
    "gathering:nesting": (a, t) => pack(scoreNesting(a), t, 0.6, 1.55),
    "gathering:offset": (a, t) => pack(scoreOffset(a), t, 0.6, 1.5),
    "gathering:terraced": (a, t) => pack(scoreTerraced(a, true), t, 0.58, 1.55),
    "gathering:vertical-porosity": (a, t) => pack(scoreVerticalPorosity(a), t, 0.6, 1.5),
    "gathering:slope": (a, t) => pack(scoreSlope(a), t, 0.55, 1.65),
  };

  function scoreDescriptor(type, descriptor, analysis, intensity) {
    const t = clamp(Number(intensity || 0) / 100, 0, 1);
    const key = `${type}:${descriptor}`;
    const fn = SCORERS[key] || SCORERS["lobby:centralized"];
    const result = fn(analysis, t);
    return {
      score: clamp(result.score, 0, 100),
      breakdown: result.breakdown,
      raw: result.raw,
    };
  }

  function fingerprintDistance(a, b) {
    if (!a || !b) return 1;
    let d = Math.abs((a.n || 0) - (b.n || 0)) / 6;
    d += Math.abs((a.occ || 0) - (b.occ || 0));
    const na = a.cents || [];
    const nb = b.cents || [];
    const k = Math.max(na.length, nb.length, 1);
    let cd = 0;
    for (let i = 0; i < k; i++) {
      const pa = na[i] || [0.5, 0.5, 0];
      const pb = nb[i] || [0.5, 0.5, 0];
      cd += hypot2(pa[0] - pb[0], pa[1] - pb[1]) + Math.abs((pa[2] || 0) - (pb[2] || 0));
    }
    d += cd / k;
    const ba = a.bins || [];
    const bb = b.bins || [];
    let bd = 0;
    const bn = Math.max(ba.length, bb.length, 1);
    for (let i = 0; i < bn; i++) bd += Math.abs((ba[i] || 0) - (bb[i] || 0));
    d += bd / bn;
    const ra = a.roots || [];
    const rb = b.roots || [];
    d += Math.abs(ra.length - rb.length) * 0.12;
    return d / 3.2;
  }

  function selectDiverse(ranked, count) {
    const want = count || MATRIX_COUNT;
    const picked = [];
    const thresholds = [0.14, 0.1, 0.075, 0.05, 0.03, 0.015];
    const pass = (minDist) => {
      for (const item of ranked) {
        if (picked.length >= want) break;
        if (picked.some((p) => fingerprintDistance(p.fingerprint, item.fingerprint) < minDist)) {
          continue;
        }
        picked.push(item);
      }
    };
    for (const threshold of thresholds) {
      pass(threshold);
      if (picked.length >= want) break;
    }
    if (picked.length < want) {
      for (const item of ranked) {
        if (picked.length >= want) break;
        if (!picked.includes(item)) picked.push(item);
      }
    }
    return picked.slice(0, want);
  }

  function collectSegments(nodes, mergeLinks) {
    const segs = [];
    for (const node of nodes || []) {
      if (!node || !node.parent) continue;
      const a = node.parent.pos || node.parent;
      const b = node.pos || node;
      segs.push(a.x, a.y, b.x, b.y);
    }
    for (const link of mergeLinks || []) {
      if (!link || !link.a || !link.b) continue;
      const a = link.a.pos || link.a;
      const b = link.b.pos || link.b;
      segs.push(a.x, a.y, b.x, b.y);
    }
    return segs;
  }

  global.D7DescriptorMatrix = {
    TYPES,
    DESCRIPTORS,
    CANDIDATE_COUNT,
    MATRIX_COUNT,
    descriptorsFor,
    createRng,
    hashSeed,
    planCandidate,
    analyzeSection,
    scoreDescriptor,
    selectDiverse,
    collectSegments,
  };
})(window);

/**
 * Volumetric 3D spatial generation from a 2D colonization chunk.
 * The 2D network is a spatial generator, not geometry to thicken.
 * Occupancy is built as platform + enclosure + opening + support + void,
 * then meshed with marching tetrahedra.
 * Workspace: 20 ft × 20 ft × 20 ft. 1 world unit = 1 foot.
 */
(function (global) {
  const CUBE = 20;
  const WALL = 0.05;
  const RES = 40;
  const PRESETS = {
    A1: { label: "A1 Controlled", mode: "A", variation: 22, expansion: 32, openness: 32, growth: 0, steps: 10, splits: 0.08 },
    A2: { label: "A2 Expansion", mode: "A", variation: 52, expansion: 62, openness: 55, growth: 8, steps: 14, splits: 0.16 },
    A3: { label: "A3 Exploratory", mode: "A", variation: 78, expansion: 70, openness: 64, growth: -12, steps: 16, splits: 0.26 },
    B1: { label: "B1 Compact", mode: "B", variation: 40, expansion: 28, openness: 22, growth: 0, steps: 11, splits: 0.1 },
    B2: { label: "B2 Porous", mode: "B", variation: 55, expansion: 66, openness: 82, growth: 6, steps: 15, splits: 0.22 },
    B3: { label: "B3 Vertical", mode: "B", variation: 50, expansion: 58, openness: 48, growth: 82, steps: 16, splits: 0.18 },
  };
  const PRESET_SEEDS = { A1: 1001, A2: 2203, A3: 3307, B1: 4411, B2: 5521, B3: 6637 };
  const KEYS = ["A1", "A2", "A3", "B1", "B2", "B3"];

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
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

  function hash3(ix, iy, iz, seed) {
    return hash32(ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 1013904223) / 4294967296;
  }

  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function valueNoise(x, y, z, seed) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const tx = fade(x - x0);
    const ty = fade(y - y0);
    const tz = fade(z - z0);
    const n000 = hash3(x0, y0, z0, seed);
    const n100 = hash3(x0 + 1, y0, z0, seed);
    const n010 = hash3(x0, y0 + 1, z0, seed);
    const n110 = hash3(x0 + 1, y0 + 1, z0, seed);
    const n001 = hash3(x0, y0, z0 + 1, seed);
    const n101 = hash3(x0 + 1, y0, z0 + 1, seed);
    const n011 = hash3(x0, y0 + 1, z0 + 1, seed);
    const n111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
    return lerp(
      lerp(lerp(n000, n100, tx), lerp(n010, n110, tx), ty),
      lerp(lerp(n001, n101, tx), lerp(n011, n111, tx), ty),
      tz
    );
  }

  function fbm(x, y, z, seed) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < 4; i++) {
      sum += amp * (valueNoise(x * freq, y * freq, z * freq, seed + i * 19) * 2 - 1);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / Math.max(1e-6, norm);
  }

  function distPointSeg2(px, py, pz, ax, ay, az, bx, by, bz) {
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const apx = px - ax;
    const apy = py - ay;
    const apz = pz - az;
    const ab2 = abx * abx + aby * aby + abz * abz;
    let t = ab2 > 1e-12 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = apx - abx * t;
    const dy = apy - aby * t;
    const dz = apz - abz * t;
    return dx * dx + dy * dy + dz * dz;
  }

  function chunkMatrix(THREE, transform) {
    const t = transform || {};
    const pos = new THREE.Vector3(t.x || 0, t.y || 0, t.z || 0);
    const euler = new THREE.Euler(
      ((t.rx || 0) * Math.PI) / 180,
      ((t.ry || 0) * Math.PI) / 180,
      ((t.rz || 0) * Math.PI) / 180,
      "XYZ"
    );
    const q = new THREE.Quaternion().setFromEuler(euler);
    const s = Number(t.scale) || 1;
    return new THREE.Matrix4().compose(pos, q, new THREE.Vector3(s, s, s));
  }

  function mixParams(key, user) {
    const pre = PRESETS[key];
    const u = user || {};
    const shift = (base, slider) => clamp(base + (Number(slider) - 50) * 0.45, 0, 100);
    const gShift = (base, slider) => clamp(base + Number(slider) * 0.35, -100, 100);
    return {
      key,
      label: pre.label,
      mode: pre.mode,
      variation: shift(pre.variation, u.variation != null ? u.variation : 50),
      expansion: shift(pre.expansion, u.expansion != null ? u.expansion : 50),
      openness: shift(pre.openness, u.openness != null ? u.openness : 50),
      growth: gShift(pre.growth, u.growth != null ? u.growth : 0),
      steps: pre.steps,
      splits: pre.splits,
      seed: (PRESET_SEEDS[key] ^ ((Number(u.seed) || 0) * 7919)) >>> 0,
    };
  }

  function analyze(THREE, chunk) {
    const matrix = chunkMatrix(THREE, chunk.transform);
    const segs = [];
    const nodes = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const seg of chunk.branches || []) {
      a.set(seg.ax, seg.ay, seg.az || 0).applyMatrix4(matrix);
      b.set(seg.bx, seg.by, seg.bz || 0).applyMatrix4(matrix);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dy, dz);
      segs.push({
        ax: a.x,
        ay: a.y,
        az: a.z,
        bx: b.x,
        by: b.y,
        bz: b.z,
        order: seg.order || 1,
        len,
        horiz: Math.abs(dx) >= Math.abs(dy) * 0.75,
        vert: Math.abs(dy) >= Math.abs(dx) * 0.85,
      });
    }
    for (const node of chunk.nodes || []) {
      a.set(node.x, node.y, node.z || 0).applyMatrix4(matrix);
      nodes.push({
        x: a.x,
        y: a.y,
        z: a.z,
        order: node.order || 1,
        parentIndex: node.parentIndex,
      });
    }
    let dirX = 0;
    let dirY = 0;
    let dirZ = 0;
    let lenSum = 0;
    for (const seg of segs) {
      if (seg.len < 1e-4) continue;
      dirX += seg.bx - seg.ax;
      dirY += seg.by - seg.ay;
      dirZ += seg.bz - seg.az;
      lenSum += seg.len;
    }
    const n = Math.hypot(dirX, dirY, dirZ) || 1;
    return {
      segs,
      nodes,
      meanDir: { x: dirX / n, y: dirY / n, z: dirZ / n },
      length: lenSum,
      width: chunk.width || 10,
      height: chunk.height || 10,
    };
  }

  function blur3(grid, res) {
    const next = new Float32Array(grid.length);
    const n = res;
    for (let iz = 0; iz < n; iz++) {
      for (let iy = 0; iy < n; iy++) {
        for (let ix = 0; ix < n; ix++) {
          const idx = ix + iy * n + iz * n * n;
          let s = grid[idx] * 2;
          let c = 2;
          if (ix) {
            s += grid[idx - 1];
            c += 1;
          }
          if (ix + 1 < n) {
            s += grid[idx + 1];
            c += 1;
          }
          if (iy) {
            s += grid[idx - n];
            c += 1;
          }
          if (iy + 1 < n) {
            s += grid[idx + n];
            c += 1;
          }
          if (iz) {
            s += grid[idx - n * n];
            c += 1;
          }
          if (iz + 1 < n) {
            s += grid[idx + n * n];
            c += 1;
          }
          next[idx] = s / c;
        }
      }
    }
    grid.set(next);
  }

  function keepLargest(grid, res) {
    const n = grid.length;
    const occ = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (grid[i] > 0) occ[i] = 1;
    const seen = new Uint8Array(n);
    const q = new Int32Array(n);
    const islands = [];
    const dirs = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    function idxOf(ix, iy, iz) {
      return ix + iy * res + iz * res * res;
    }
    function flood(start, mark) {
      let h = 0;
      let t = 0;
      q[t++] = start;
      mark[start] = 1;
      let size = 0;
      while (h < t) {
        const i = q[h++];
        size += 1;
        const ix = i % res;
        const iy = Math.floor(i / res) % res;
        const iz = Math.floor(i / (res * res));
        for (let k = 0; k < 6; k++) {
          const nx = ix + dirs[k][0];
          const ny = iy + dirs[k][1];
          const nz = iz + dirs[k][2];
          if (nx < 0 || ny < 0 || nz < 0 || nx >= res || ny >= res || nz >= res) continue;
          const ni = idxOf(nx, ny, nz);
          if (!occ[ni] || mark[ni]) continue;
          mark[ni] = 1;
          q[t++] = ni;
        }
      }
      return size;
    }
    for (let start = 0; start < n; start++) {
      if (!occ[start] || seen[start]) continue;
      const size = flood(start, seen);
      islands.push({ start, size });
    }
    if (!islands.length) return;
    islands.sort((a, b) => b.size - a.size);
    const minKeep = Math.max(28, Math.floor(islands[0].size * 0.1));
    const keep = new Uint8Array(n);
    for (let i = 0; i < islands.length; i++) {
      if (islands[i].size < minKeep) break;
      flood(islands[i].start, keep);
    }
    for (let i = 0; i < n; i++) {
      if (!keep[i] && grid[i] > 0) grid[i] = -Math.abs(grid[i]) - 0.05;
    }
  }

  function anchorZ(name) {
    if (name === "front") return 1;
    if (name === "back") return 19;
    return 10;
  }

  function clampBox(box) {
    function span(a, b) {
      const lo = clamp(Math.min(a, b), WALL, CUBE - WALL);
      const hi = clamp(Math.max(a, b), WALL, CUBE - WALL);
      return { lo, hi: Math.max(lo + 0.2, hi) };
    }
    const x = span(box.minx, box.maxx);
    const y = span(box.miny, box.maxy);
    const z = span(box.minz, box.maxz);
    return {
      minx: x.lo,
      maxx: Math.min(CUBE - WALL, x.hi),
      miny: y.lo,
      maxy: Math.min(CUBE - WALL, y.hi),
      minz: z.lo,
      maxz: Math.min(CUBE - WALL, z.hi),
    };
  }

  function sourceBounds(info) {
    let minx = CUBE;
    let miny = CUBE;
    let minz = CUBE;
    let maxx = 0;
    let maxy = 0;
    let maxz = 0;
    function acc(x, y, z) {
      if (x < minx) minx = x;
      if (y < miny) miny = y;
      if (z < minz) minz = z;
      if (x > maxx) maxx = x;
      if (y > maxy) maxy = y;
      if (z > maxz) maxz = z;
    }
    for (let i = 0; i < info.segs.length; i++) {
      const s = info.segs[i];
      acc(s.ax, s.ay, s.az);
      acc(s.bx, s.by, s.bz);
    }
    for (let i = 0; i < info.nodes.length; i++) {
      const n = info.nodes[i];
      acc(n.x, n.y, n.z);
    }
    if (maxx < minx) {
      return { minx: 4, miny: 4, minz: 4, maxx: 16, maxy: 16, maxz: 16 };
    }
    return { minx, miny, minz, maxx, maxy, maxz };
  }

  function growthBox(info, params, zAnchor) {
    const b = sourceBounds(info);
    const exp = params.expansion / 100;
    const varN = params.variation / 100;
    const grow = params.growth / 100;
    const cube = { minx: WALL, miny: WALL, minz: WALL, maxx: CUBE - WALL, maxy: CUBE - WALL, maxz: CUBE - WALL };
    if (params.mode === "B") {
      const local = {
        minx: b.minx - (2 + Math.max(0, -grow) * 2),
        maxx: b.maxx + (2 + Math.max(0, -grow) * 2),
        miny: b.miny - 1.2,
        maxy: b.maxy + 2 + Math.max(0, grow) * 5,
        minz: Math.min(b.minz, 0.5) - 1.5,
        maxz: Math.max(b.maxz, 3) + 3,
      };
      return clampBox({
        minx: lerp(local.minx, cube.minx, exp),
        maxx: lerp(local.maxx, cube.maxx, exp),
        miny: lerp(local.miny, cube.miny, exp),
        maxy: lerp(local.maxy, cube.maxy, exp),
        minz: lerp(local.minz, cube.minz, exp),
        maxz: lerp(local.maxz, cube.maxz, exp),
      });
    }
    const padXY = 1.4 + exp * 5.5 + varN * 1.8;
    const reachZ = 2.4 + exp * 8 + varN * 2;
    return clampBox({
      minx: b.minx - padXY - Math.max(0, -grow) * 2.5,
      maxx: b.maxx + padXY + Math.max(0, -grow) * 2.5,
      miny: b.miny - 1,
      maxy: b.maxy + padXY * 0.7 + Math.max(0, grow) * 4,
      minz: zAnchor - reachZ,
      maxz: zAnchor + reachZ,
    });
  }

  function sample2(map, res, cell, x, y) {
    const fx = clamp(x / cell, 0, res - 1.001);
    const fy = clamp(y / cell, 0, res - 1.001);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(res - 1, x0 + 1);
    const y1 = Math.min(res - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const a = map[x0 + y0 * res];
    const b = map[x1 + y0 * res];
    const c = map[x0 + y1 * res];
    const d = map[x1 + y1 * res];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  }

  function rasterSdf(info, res, cell) {
    const sdf = new Float32Array(res * res);
    const segs = info.segs;
    const horiz = new Float32Array(res * res);
    for (let iy = 0; iy < res; iy++) {
      const y = iy * cell;
      for (let ix = 0; ix < res; ix++) {
        const x = ix * cell;
        let best = 1e12;
        let hBest = 1e12;
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          const d2 = distPointSeg2(x, y, 0, s.ax, s.ay, 0, s.bx, s.by, 0);
          if (d2 < best) best = d2;
          if (s.horiz && d2 < hBest) hBest = d2;
        }
        const idx = ix + iy * res;
        sdf[idx] = Math.sqrt(best);
        horiz[idx] = Math.sqrt(hBest);
      }
    }
    return { sdf, horiz };
  }

  function spanAtY(info, y, band) {
    let minx = Infinity;
    let maxx = -Infinity;
    let hit = 0;
    for (let i = 0; i < info.segs.length; i++) {
      const s = info.segs[i];
      const y0 = Math.min(s.ay, s.by);
      const y1 = Math.max(s.ay, s.by);
      if (y < y0 - band || y > y1 + band) continue;
      minx = Math.min(minx, s.ax, s.bx);
      maxx = Math.max(maxx, s.ax, s.bx);
      hit += 1;
    }
    if (!hit) {
      const b = sourceBounds(info);
      return { minx: b.minx, maxx: b.maxx };
    }
    return { minx, maxx };
  }

  function detectFloors(info, params, box, zAnchor) {
    const grow = params.growth / 100;
    const exp = params.expansion / 100;
    const openN = params.openness / 100;
    const varN = params.variation / 100;
    const story = clamp(4.6 - grow * 0.5, 3.8, 5.4);
    let nWant = 3;
    if (params.mode === "A" && params.variation < 35) nWant = 2;
    if (params.mode === "B" && (grow > 0.45 || params.key === "B3")) nWant = 4;
    if (openN > 0.75) nWant = Math.max(2, nWant - 1);
    const span = Math.max(story, box.maxy - box.miny);
    nWant = Math.min(nWant, Math.max(2, Math.floor(span / story) + 1));
    const y0 = box.miny + 0.85;
    const y1 = Math.max(y0 + story, box.maxy - 0.65);
    const levels = [];
    const bins = [];
    for (let i = 0; i < info.segs.length; i++) {
      const s = info.segs[i];
      if (!s.horiz) continue;
      bins.push((s.ay + s.by) * 0.5);
    }
    bins.sort((a, b) => a - b);
    if (bins.length >= 3) {
      const used = [];
      const step = Math.max(1, Math.floor(bins.length / nWant));
      for (let i = 0; i < bins.length && levels.length < nWant; i += step) {
        const y = clamp(bins[i], y0, y1);
        if (used.every((u) => Math.abs(u - y) >= story * 0.7)) {
          used.push(y);
          levels.push(y);
        }
      }
    }
    if (levels.length < nWant) {
      levels.length = 0;
      for (let i = 0; i < nWant; i++) {
        const t = nWant === 1 ? 0 : i / (nWant - 1);
        levels.push(lerp(y0, y1, t));
      }
    }
    levels.sort((a, b) => a - b);
    const slab = 0.58 + (1 - openN) * 0.22;
    const zDepth = params.mode === "A" ? 5.2 + exp * 5.8 : 7.2 + exp * 6.8;
    return levels.map((y, i) => {
      const xs = spanAtY(info, y, 1.6);
      const spanX = Math.max(6, xs.maxx - xs.minx);
      const core = 0.58 + exp * 0.16 - openN * 0.06;
      const cx = (xs.minx + xs.maxx) * 0.5;
      const halfX = clamp(spanX * core * 0.5, 3.2, 8.8);
      const terrace = (i - (levels.length - 1) * 0.5) * (1.4 + varN * 2.4);
      const stepIn = i * (0.35 + varN * 0.8);
      const zShift = params.mode === "B" ? (i % 2 === 0 ? -1.8 : 1.8) * (0.7 + exp) : i * 0.35;
      const zc = zAnchor + zShift;
      const halfZ = zDepth * (0.38 + (i === 0 ? 0.1 : 0) - i * 0.03);
      return {
        y,
        half: slab,
        x0: clamp(cx - halfX + terrace * 0.4 + stepIn, box.minx, box.maxx - 3.5),
        x1: clamp(cx + halfX + terrace * 0.25 - stepIn * 0.4, box.minx + 3.5, box.maxx),
        z0: clamp(zc - halfZ, box.minz, box.maxz - 2.4),
        z1: clamp(zc + halfZ, box.minz + 2.4, box.maxz),
        atrium: 2.8 + openN * 2.6 + (i > 0 ? 0.5 : 0),
      };
    });
  }

  function collectWalls(info, params, rng, zAnchor, box, floors) {
    const exp = params.expansion / 100;
    const varN = params.variation / 100;
    const openN = params.openness / 100;
    const verts = info.segs.filter((s) => s.vert && s.len > 1.4).sort((a, b) => b.len - a.len);
    const maxW = params.mode === "B" ? 6 : 4;
    const walls = [];
    const yLo = floors.length ? floors[0].y : box.miny;
    const yHi = floors.length ? floors[floors.length - 1].y + 1.2 : box.maxy;
    for (let i = 0; i < verts.length && walls.length < maxW; i++) {
      if (i > 1 && rng() < 0.28 + openN * 0.25) continue;
      const s = verts[i];
      const x = (s.ax + s.bx) * 0.5;
      if (walls.some((w) => Math.abs(w.x - x) < 2.2)) continue;
      const zc = params.mode === "A" ? zAnchor : clamp(zAnchor + (rng() - 0.5) * (3 + exp * 6), box.minz, box.maxz);
      const halfZ = (params.mode === "A" ? 4.2 : 5.5) + exp * 4 + varN * 1.5;
      walls.push({
        x,
        y0: clamp(Math.min(s.ay, s.by, yLo), box.miny, box.maxy - 3),
        y1: clamp(Math.max(s.ay, s.by, yHi), box.miny + 3, box.maxy),
        z0: clamp(zc - halfZ, box.minz, box.maxz),
        z1: clamp(zc + halfZ, box.minz, box.maxz),
        thick: 1.15 + (s.order <= 1 ? 0.35 : 0) - openN * 0.2,
      });
    }
    if (floors.length) {
      const fl = floors[0];
      const xs = [fl.x0 + 0.55, fl.x1 - 0.55];
      for (let k = 0; k < xs.length && walls.length < maxW + 2; k++) {
        walls.push({
          x: xs[k],
          y0: fl.y,
          y1: yHi + 0.4,
          z0: fl.z0 + 0.4,
          z1: fl.z1 - 0.4,
          thick: 1.05,
          edge: true,
        });
      }
    }
    return walls;
  }

  function collectOpenings(info, params, rng, zAnchor, box, maps, res, cell, floors) {
    const openN = params.openness / 100;
    const exp = params.expansion / 100;
    const varN = params.variation / 100;
    const list = [];
    const count = 4 + Math.round(openN * 5) + (params.mode === "B" ? 2 : 0);
    for (let k = 0; k < 60 && list.length < count; k++) {
      const x = box.minx + rng() * Math.max(0.2, box.maxx - box.minx);
      const y = box.miny + rng() * Math.max(0.2, box.maxy - box.miny);
      const dist = sample2(maps.sdf, res, cell, x, y);
      if (dist < 1.1) continue;
      const z =
        params.mode === "A"
          ? clamp(zAnchor + (rng() - 0.5) * (6 + exp * 8), box.minz, box.maxz)
          : box.minz + rng() * Math.max(0.2, box.maxz - box.minz);
      list.push({
        x,
        y,
        z,
        rx: 3.2 + openN * 3.8 + rng() * 1.8,
        ry: 2.6 + openN * 3.2 + rng() * 1.3,
        rz: 3.4 + openN * 4.2 + exp * 2.2 + rng() * 1.6,
      });
    }
    if (floors.length >= 2) {
      const mid = floors[Math.floor(floors.length / 2)];
      list.push({
        x: (mid.x0 + mid.x1) * 0.5,
        y: mid.y + 2.1,
        z: (mid.z0 + mid.z1) * 0.5,
        rx: 4.4 + varN,
        ry: 3.6 + openN * 1.8,
        rz: 5.2 + exp,
      });
    }
    if (!list.length) {
      list.push({
        x: (box.minx + box.maxx) * 0.5,
        y: (box.miny + box.maxy) * 0.55,
        z: params.mode === "A" ? zAnchor + 2.8 : (box.minz + box.maxz) * 0.5,
        rx: 3.2 + varN,
        ry: 2.6,
        rz: 3.8 + exp,
      });
    }
    return list;
  }

  function massFromFloors(floors, box) {
    if (!floors.length) {
      return {
        minx: box.minx + 0.4,
        maxx: box.maxx - 0.4,
        miny: box.miny + 0.4,
        maxy: box.maxy - 0.4,
        minz: box.minz + 0.4,
        maxz: box.maxz - 0.4,
      };
    }
    let minx = Infinity;
    let maxx = -Infinity;
    let minz = Infinity;
    let maxz = -Infinity;
    for (let i = 0; i < floors.length; i++) {
      const f = floors[i];
      minx = Math.min(minx, f.x0);
      maxx = Math.max(maxx, f.x1);
      minz = Math.min(minz, f.z0);
      maxz = Math.max(maxz, f.z1);
    }
    return {
      minx,
      maxx,
      miny: floors[0].y - 0.4,
      maxy: floors[floors.length - 1].y + 2.4,
      minz,
      maxz,
    };
  }

  function boxSdf(x, y, z, b, round) {
    const hx = (b.maxx - b.minx) * 0.5;
    const hy = (b.maxy - b.miny) * 0.5;
    const hz = (b.maxz - b.minz) * 0.5;
    const cx = (b.minx + b.maxx) * 0.5;
    const cy = (b.miny + b.maxy) * 0.5;
    const cz = (b.minz + b.maxz) * 0.5;
    const qx = Math.abs(x - cx) - hx + round;
    const qy = Math.abs(y - cy) - hy + round;
    const qz = Math.abs(z - cz) - hz + round;
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    const oz = Math.max(qz, 0);
    return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - round;
  }

  function composeArchitecture(info, params, rng, zAnchor) {
    const box = growthBox(info, params, zAnchor);
    const res = RES;
    const cell = CUBE / (res - 1);
    const maps = rasterSdf(info, res, cell);
    const floors = detectFloors(info, params, box, zAnchor);
    const walls = collectWalls(info, params, rng, zAnchor, box, floors);
    const openings = collectOpenings(info, params, rng, zAnchor, box, maps, res, cell, floors);
    const mass = massFromFloors(floors, box);
    return { box, maps, floors, walls, openings, mass, cell, res };
  }

  function openingField(x, y, z, openings) {
    let best = 1;
    for (let o = 0; o < openings.length; o++) {
      const op = openings[o];
      const nx = (x - op.x) / op.rx;
      const ny = (y - op.y) / op.ry;
      const nz = (z - op.z) / op.rz;
      const d = nx * nx + ny * ny + nz * nz;
      if (d < best) best = d;
    }
    return best;
  }

  function buildField(info, params, arch, zAnchor) {
    const res = arch.res;
    const cell = arch.cell;
    const grid = new Float32Array(res * res * res);
    const box = arch.box;
    const maps = arch.maps;
    const floors = arch.floors;
    const walls = arch.walls;
    const openings = arch.openings;
    const mass = arch.mass;
    const exp = params.expansion / 100;
    const varN = params.variation / 100;
    const openN = params.openness / 100;
    const shellT = 0.72 + (1 - openN) * 0.28;
    const round = 1.15 + varN * 0.7;

    for (let iz = 0; iz < res; iz++) {
      const z = iz * cell;
      for (let iy = 0; iy < res; iy++) {
        const y = iy * cell;
        for (let ix = 0; ix < res; ix++) {
          const x = ix * cell;
          const idx = ix + iy * res + iz * res * res;
          if (x < box.minx || x > box.maxx || y < box.miny || y > box.maxy || z < box.minz || z > box.maxz) {
            grid[idx] = -0.75;
            continue;
          }
          const wx = varN * 1.5 * fbm(x * 0.07, y * 0.07, z * 0.07, params.seed + 4);
          const wz = varN * 1.4 * fbm(x * 0.07 + 17, y * 0.06, z * 0.07, params.seed + 9);
          const sx = x + wx;
          const sz = z + wz;
          const dMass = boxSdf(sx, y, sz, mass, round);
          const edge = Math.min(x, y, z, CUBE - x, CUBE - y, CUBE - z);
          let v = -0.42;
          const inside = dMass < 0.35;
          if (inside) v = -0.3;
          for (let f = 0; f < floors.length; f++) {
            const fl = floors[f];
            const dy = Math.abs(y - fl.y);
            if (dy >= fl.half) continue;
            if (x < fl.x0 - 0.2 || x > fl.x1 + 0.2 || z < fl.z0 - 0.2 || z > fl.z1 + 0.2) continue;
            const cx = (fl.x0 + fl.x1) * 0.5;
            const cz = (fl.z0 + fl.z1) * 0.5;
            const atrium =
              Math.hypot((x - cx) / Math.max(2.4, (fl.x1 - fl.x0) * 0.2), (z - cz) / Math.max(2.4, (fl.z1 - fl.z0) * 0.26)) < 1;
            if (!atrium) v = Math.max(v, 0.78 - dy * 0.2);
          }
          for (let w = 0; w < walls.length; w++) {
            const wall = walls[w];
            if (y < wall.y0 - 0.15 || y > wall.y1 + 0.15) continue;
            if (z < wall.z0 || z > wall.z1) continue;
            if (Math.abs(x - wall.x) < wall.thick * 0.5) {
              const doorY = y > wall.y0 + 0.4 && y < wall.y0 + 2.45;
              const doorZ = Math.abs(z - (wall.z0 + wall.z1) * 0.5) < 1.5 + openN;
              if (!(doorY && doorZ) || wall.edge) v = Math.max(v, 0.62);
            }
          }
          const noRoof = y < mass.maxy - 1.15;
          const onZ = Math.min(Math.abs(sz - mass.minz), Math.abs(sz - mass.maxz)) < shellT;
          const onX = Math.min(Math.abs(sx - mass.minx), Math.abs(sx - mass.maxx)) < shellT;
          if (inside && noRoof && (onZ || (onX && params.mode === "B"))) {
            const betweenFloors = floors.some((fl, i) => {
              const nxt = floors[i + 1];
              return nxt && y > fl.y + fl.half + 0.35 && y < nxt.y - 0.25;
            });
            const midX = Math.abs(x - (mass.minx + mass.maxx) * 0.5) < 2.8 + openN * 2.2;
            const windowCut = betweenFloors && (onZ ? midX : Math.abs(z - (mass.minz + mass.maxz) * 0.5) < 2.2);
            if (!windowCut) v = Math.max(v, 0.5);
          }
          const od = openingField(x, y, z, openings);
          if (od < 1) {
            const onSlab = v > 0.7;
            if (!(onSlab && od > 0.28)) v = Math.min(v, lerp(-0.18, -0.98, 1 - od));
          }
          if (edge < 0.8) v -= (0.8 - edge) * 1.6;
          grid[idx] = v;
        }
      }
    }

    if (params.mode === "A") {
      const izA = clamp(Math.round(zAnchor / cell), 1, res - 2);
      for (let iy = 0; iy < res; iy++) {
        const y = iy * cell;
        for (let ix = 0; ix < res; ix++) {
          const x = ix * cell;
          let v = -0.38;
          for (let f = 0; f < floors.length; f++) {
            const fl = floors[f];
            if (Math.abs(y - fl.y) < fl.half && x >= fl.x0 && x <= fl.x1) v = Math.max(v, 0.8);
          }
          for (let w = 0; w < walls.length; w++) {
            const wall = walls[w];
            if (y >= wall.y0 && y <= wall.y1 && Math.abs(x - wall.x) < wall.thick * 0.5) v = Math.max(v, 0.64);
          }
          const od = openingField(x, y, zAnchor, openings);
          if (od < 1) v = Math.min(v, lerp(-0.2, -0.9, 1 - od));
          for (let dz = -1; dz <= 1; dz++) {
            const iz = izA + dz;
            if (iz < 0 || iz >= res) continue;
            const idx = ix + iy * res + iz * res * res;
            const mix = dz === 0 ? 0.88 : 0.55;
            grid[idx] = lerp(grid[idx], v, mix);
          }
        }
      }
    }

    blur3(grid, res);
    keepLargest(grid, res);
    return { grid, res, cell };
  }

  const TETS = [
    [0, 2, 3, 7],
    [0, 2, 6, 7],
    [0, 4, 6, 7],
    [0, 6, 1, 2],
    [0, 1, 6, 4],
    [5, 6, 1, 4],
  ];
  const TET_EDGES = [
    [0, 1],
    [1, 2],
    [2, 0],
    [0, 3],
    [1, 3],
    [2, 3],
  ];
  const TET_TRIS = [
    [],
    [[0, 3, 2]],
    [[0, 1, 4]],
    [[2, 3, 4], [2, 4, 1]],
    [[1, 2, 5]],
    [[0, 3, 5], [0, 5, 1]],
    [[0, 2, 5], [0, 5, 4]],
    [[3, 4, 5]],
    [[3, 5, 4]],
    [[0, 4, 5], [0, 5, 2]],
    [[0, 1, 5], [0, 5, 3]],
    [[1, 5, 2]],
    [[2, 1, 4], [2, 4, 3]],
    [[0, 4, 1]],
    [[0, 2, 3]],
    [],
  ];

  function cornerOffset(i) {
    return { x: i & 1, y: (i >> 1) & 1, z: (i >> 2) & 1 };
  }

  function meshField(field) {
    const res = field.res;
    const cell = field.cell;
    const grid = field.grid;
    const positions = [];
    function val(ix, iy, iz) {
      return grid[ix + iy * res + iz * res * res];
    }
    const p = new Array(4);
    const ept = new Array(6);
    for (let i = 0; i < 4; i++) p[i] = { x: 0, y: 0, z: 0, v: 0 };
    for (let i = 0; i < 6; i++) ept[i] = { x: 0, y: 0, z: 0 };
    for (let iz = 0; iz < res - 1; iz++) {
      for (let iy = 0; iy < res - 1; iy++) {
        for (let ix = 0; ix < res - 1; ix++) {
          const corners = new Array(8);
          for (let c = 0; c < 8; c++) {
            const o = cornerOffset(c);
            corners[c] = {
              x: (ix + o.x) * cell,
              y: (iy + o.y) * cell,
              z: (iz + o.z) * cell,
              v: val(ix + o.x, iy + o.y, iz + o.z),
            };
          }
          for (let t = 0; t < 6; t++) {
            const tet = TETS[t];
            let mask = 0;
            for (let k = 0; k < 4; k++) {
              p[k] = corners[tet[k]];
              if (p[k].v > 0) mask |= 1 << k;
            }
            const tris = TET_TRIS[mask];
            if (!tris.length) continue;
            for (let e = 0; e < 6; e++) {
              const a = p[TET_EDGES[e][0]];
              const b = p[TET_EDGES[e][1]];
              const dv = b.v - a.v;
              const u = Math.abs(dv) < 1e-8 ? 0.5 : clamp(-a.v / dv, 0, 1);
              ept[e].x = a.x + (b.x - a.x) * u;
              ept[e].y = a.y + (b.y - a.y) * u;
              ept[e].z = a.z + (b.z - a.z) * u;
            }
            for (let r = 0; r < tris.length; r++) {
              const tri = tris[r];
              const a = ept[tri[0]];
              const b = ept[tri[1]];
              const c = ept[tri[2]];
              positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
            }
          }
        }
      }
    }
    const normals = new Array(positions.length);
    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i + 3] - positions[i];
      const ay = positions[i + 4] - positions[i + 1];
      const az = positions[i + 5] - positions[i + 2];
      const bx = positions[i + 6] - positions[i];
      const by = positions[i + 7] - positions[i + 1];
      const bz = positions[i + 8] - positions[i + 2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      for (let k = 0; k < 3; k++) {
        normals[i + k * 3] = nx;
        normals[i + k * 3 + 1] = ny;
        normals[i + k * 3 + 2] = nz;
      }
    }
    for (let i = 0; i < positions.length; i++) {
      positions[i] = clamp(positions[i], 0, CUBE);
    }
    return { positions, normals, triangleCount: positions.length / 9 };
  }

  function packField(grid) {
    const bytes = new Uint8Array(grid.length);
    for (let i = 0; i < grid.length; i++) {
      bytes[i] = clamp(Math.round((grid[i] + 1) * 127.5), 0, 255);
    }
    let bin = "";
    const step = 4096;
    for (let i = 0; i < bytes.length; i += step) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + step)));
    }
    return { encoding: "u8/b64", res: RES, data: btoa(bin) };
  }

  function unpackField(packed) {
    if (!packed || !packed.data) return null;
    const res = packed.res || RES;
    const bin = atob(packed.data);
    const grid = new Float32Array(res * res * res);
    for (let i = 0; i < grid.length && i < bin.length; i++) {
      grid[i] = bin.charCodeAt(i) / 127.5 - 1;
    }
    return { grid, res, cell: CUBE / (res - 1) };
  }

  function geometryFromPacked(THREE, packed) {
    const field = unpackField(packed);
    if (!field) return null;
    const mesh = meshField(field);
    if (!mesh.triangleCount) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
    geom.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
    return geom;
  }

  function generateOne(THREE, chunk, spec) {
    if (!THREE || !chunk) return null;
    const key = spec && spec.key;
    if (!PRESETS[key]) return null;
    const params = mixParams(key, spec.user);
    const zA = anchorZ(spec.anchor || "center");
    const rng = mulberry32(params.seed);
    const info = analyze(THREE, chunk);
    if (!info.segs.length && !info.nodes.length) {
      return { ok: false, error: "The selected chunk has no branch geometry." };
    }
    const arch = composeArchitecture(info, params, rng, zA);
    const field = buildField(info, params, arch, zA);
    const mesh = meshField(field);
    return {
      ok: mesh.triangleCount > 0,
      key,
      label: params.label,
      mode: params.mode,
      seed: params.seed,
      params,
      anchor: spec.anchor || "center",
      packed: packField(field.grid),
      positions: mesh.positions,
      normals: mesh.normals,
      triangleCount: mesh.triangleCount,
    };
  }

  function keysForMode(mode) {
    if (mode === "A") return ["A1", "A2", "A3"];
    if (mode === "B") return ["B1", "B2", "B3"];
    return KEYS.slice();
  }

  global.D7SpatialGenerate = {
    CUBE,
    RES,
    PRESETS,
    PRESET_SEEDS,
    KEYS,
    mixParams,
    generateOne,
    keysForMode,
    geometryFromPacked,
    unpackField,
    meshField,
    packField,
    anchorZ,
  };
})(window);

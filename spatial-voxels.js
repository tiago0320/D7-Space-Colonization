/**
 * Voxel occupancy from current 3D branch geometry (or generated solids).
 * Occupied cells = solid. Empty cells stay void. Does not alter source geometry.
 * Adaptive sizes are 1× / 2× / 3× the resolution cell on one shared grid.
 */
(function (global) {
  const CUBE = 20;
  const RESOLUTIONS = [10, 20, 30, 40];
  const SIZE_SMALL = 1;
  const SIZE_MED = 2;
  const SIZE_LARGE = 3;

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function cellSize(resolution) {
    const res = clampRes(resolution);
    return CUBE / res;
  }

  function clampRes(resolution) {
    const n = Number(resolution) || 20;
    if (RESOLUTIONS.indexOf(n) >= 0) return n;
    let best = 20;
    let d = Infinity;
    for (let i = 0; i < RESOLUTIONS.length; i++) {
      const dd = Math.abs(RESOLUTIONS[i] - n);
      if (dd < d) {
        d = dd;
        best = RESOLUTIONS[i];
      }
    }
    return best;
  }

  function orderScale(order, useHierarchy) {
    if (!useHierarchy) return 1;
    const o = Number(order) || 1;
    if (o >= 3) return 0.46;
    if (o >= 2) return 0.7;
    return 1;
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

  function distPointTri2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const apx = px - ax;
    const apy = py - ay;
    const apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
    const bpx = px - bx;
    const bpy = py - by;
    const bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      const dx = apx - abx * v;
      const dy = apy - aby * v;
      const dz = apz - abz * v;
      return dx * dx + dy * dy + dz * dz;
    }
    const cpx = px - cx;
    const cpy = py - cy;
    const cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      const dx = apx - acx * w;
      const dy = apy - acy * w;
      const dz = apz - acz * w;
      return dx * dx + dy * dy + dz * dz;
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      const dx = bpx + (cx - bx) * w;
      const dy = bpy + (cy - by) * w;
      const dz = bpz + (cz - bz) * w;
      return dx * dx + dy * dy + dz * dz;
    }
    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    const dx = apx - abx * v - acx * w;
    const dy = apy - aby * v - acy * w;
    const dz = apz - abz * v - acz * w;
    return dx * dx + dy * dy + dz * dz;
  }

  function worldSegmentsFromChunk(THREE, chunk) {
    if (!chunk) return [];
    const matrix = chunkMatrix(THREE, chunk.transform);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const segs = [];
    const branches = chunk.branches || [];
    for (let i = 0; i < branches.length; i++) {
      const seg = branches[i];
      a.set(seg.ax, seg.ay, seg.az || 0).applyMatrix4(matrix);
      b.set(seg.bx, seg.by, seg.bz || 0).applyMatrix4(matrix);
      segs.push({
        ax: a.x,
        ay: a.y,
        az: a.z,
        bx: b.x,
        by: b.y,
        bz: b.z,
        order: seg.order || 1,
      });
    }
    return segs;
  }

  function worldSegmentsFromLoftSet(THREE, loftSet) {
    const lib = global.D7SpatialLoft;
    if (!THREE || !loftSet || !lib || typeof lib.evaluateSection !== "function") return [];
    const segs = [];
    const topology = loftSet.topology || {};
    const topoSegs = topology.segments || [];
    const sections = loftSet.sections || [];
    for (let s = 0; s < sections.length; s++) {
      const evaluated = lib.evaluateSection(THREE, sections[s], loftSet.width, loftSet.height);
      const nodes = evaluated && evaluated.nodes;
      if (!nodes) continue;
      for (let i = 0; i < topoSegs.length; i++) {
        const seg = topoSegs[i];
        const ia = seg.a != null ? seg.a : seg.startNodeId;
        const ib = seg.b != null ? seg.b : seg.endNodeId;
        const A = nodes[ia];
        const B = nodes[ib];
        if (!A || !B) continue;
        segs.push({
          ax: A.x,
          ay: A.y,
          az: A.z,
          bx: B.x,
          by: B.y,
          bz: B.z,
          order: seg.order || 1,
        });
      }
    }
    return segs;
  }

  function collectCells(occupied, resolution) {
    const cell = CUBE / resolution;
    const cells = [];
    const n = resolution * resolution * resolution;
    for (let i = 0; i < n; i++) {
      if (!occupied[i]) continue;
      const ix = i % resolution;
      const iy = Math.floor(i / resolution) % resolution;
      const iz = Math.floor(i / (resolution * resolution));
      cells.push({
        ix,
        iy,
        iz,
        size: 1,
        centerX: (ix + 0.5) * cell,
        centerY: (iy + 0.5) * cell,
        centerZ: (iz + 0.5) * cell,
        occupied: true,
      });
    }
    return cells;
  }

  function voxelizeSegments(segments, resolution, width, useHierarchy, occupied) {
    const res = clampRes(resolution);
    const cell = CUBE / res;
    const occ = occupied || new Uint8Array(res * res * res);
    const baseR = Math.max(cell * 0.72, cell * 0.22 + 0.1 + clamp(width, 0, 1) * 1.05);
    let marked = 0;
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      const radius = baseR * orderScale(seg.order, useHierarchy);
      const r2 = radius * radius;
      const minx = Math.min(seg.ax, seg.bx) - radius;
      const miny = Math.min(seg.ay, seg.by) - radius;
      const minz = Math.min(seg.az, seg.bz) - radius;
      const maxx = Math.max(seg.ax, seg.bx) + radius;
      const maxy = Math.max(seg.ay, seg.by) + radius;
      const maxz = Math.max(seg.az, seg.bz) + radius;
      const i0 = Math.max(0, Math.floor(minx / cell));
      const i1 = Math.min(res - 1, Math.floor(maxx / cell));
      const j0 = Math.max(0, Math.floor(miny / cell));
      const j1 = Math.min(res - 1, Math.floor(maxy / cell));
      const k0 = Math.max(0, Math.floor(minz / cell));
      const k1 = Math.min(res - 1, Math.floor(maxz / cell));
      if (i1 < i0 || j1 < j0 || k1 < k0) continue;
      for (let iz = k0; iz <= k1; iz++) {
        const cz = (iz + 0.5) * cell;
        for (let iy = j0; iy <= j1; iy++) {
          const cy = (iy + 0.5) * cell;
          for (let ix = i0; ix <= i1; ix++) {
            const idx = ix + iy * res + iz * res * res;
            if (occ[idx]) continue;
            const cx = (ix + 0.5) * cell;
            if (distPointSeg2(cx, cy, cz, seg.ax, seg.ay, seg.az, seg.bx, seg.by, seg.bz) <= r2) {
              occ[idx] = 1;
              marked += 1;
            }
          }
        }
      }
    }
    if (occupied) return { occupied: occ, marked: countOccupied(occ), resolution: res, cell };
    return { occupied: occ, marked, resolution: res, cell };
  }

  function countOccupied(occupied) {
    let n = 0;
    for (let i = 0; i < occupied.length; i++) {
      if (occupied[i]) n += 1;
    }
    return n;
  }

  function cellIndex(ix, iy, iz, res) {
    return ix + iy * res + iz * res * res;
  }

  function inGrid(ix, iy, iz, res) {
    return ix >= 0 && iy >= 0 && iz >= 0 && ix < res && iy < res && iz < res;
  }

  const FACE_DIRS = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  function neighborCounts(occupied, res) {
    const counts = new Uint8Array(occupied.length);
    for (let iz = 0; iz < res; iz++) {
      for (let iy = 0; iy < res; iy++) {
        for (let ix = 0; ix < res; ix++) {
          const idx = cellIndex(ix, iy, iz, res);
          if (!occupied[idx]) continue;
          let n = 0;
          for (let d = 0; d < 6; d++) {
            const nx = ix + FACE_DIRS[d][0];
            const ny = iy + FACE_DIRS[d][1];
            const nz = iz + FACE_DIRS[d][2];
            if (inGrid(nx, ny, nz, res) && occupied[cellIndex(nx, ny, nz, res)]) n += 1;
          }
          counts[idx] = n;
        }
      }
    }
    return counts;
  }

  function keepLargestComponent(occupied, res) {
    const n = occupied.length;
    const seen = new Uint8Array(n);
    const queue = new Int32Array(Math.max(1, n));
    let bestStart = -1;
    let bestSize = 0;
    for (let start = 0; start < n; start++) {
      if (!occupied[start] || seen[start]) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      seen[start] = 1;
      let size = 0;
      while (head < tail) {
        const idx = queue[head++];
        size += 1;
        const ix = idx % res;
        const iy = Math.floor(idx / res) % res;
        const iz = Math.floor(idx / (res * res));
        for (let d = 0; d < 6; d++) {
          const nx = ix + FACE_DIRS[d][0];
          const ny = iy + FACE_DIRS[d][1];
          const nz = iz + FACE_DIRS[d][2];
          if (!inGrid(nx, ny, nz, res)) continue;
          const nidx = cellIndex(nx, ny, nz, res);
          if (!occupied[nidx] || seen[nidx]) continue;
          seen[nidx] = 1;
          queue[tail++] = nidx;
        }
      }
      if (size > bestSize) {
        bestSize = size;
        bestStart = start;
      }
    }
    const next = new Uint8Array(n);
    if (bestStart < 0) return { occupied: next, marked: 0 };
    let head = 0;
    let tail = 0;
    const vis = new Uint8Array(n);
    queue[tail++] = bestStart;
    vis[bestStart] = 1;
    let marked = 0;
    while (head < tail) {
      const idx = queue[head++];
      next[idx] = 1;
      marked += 1;
      const ix = idx % res;
      const iy = Math.floor(idx / res) % res;
      const iz = Math.floor(idx / (res * res));
      for (let d = 0; d < 6; d++) {
        const nx = ix + FACE_DIRS[d][0];
        const ny = iy + FACE_DIRS[d][1];
        const nz = iz + FACE_DIRS[d][2];
        if (!inGrid(nx, ny, nz, res)) continue;
        const nidx = cellIndex(nx, ny, nz, res);
        if (!occupied[nidx] || vis[nidx]) continue;
        vis[nidx] = 1;
        queue[tail++] = nidx;
      }
    }
    return { occupied: next, marked };
  }

  function emptyFaceNeighbors(idx, occupied, res, out) {
    const ix = idx % res;
    const iy = Math.floor(idx / res) % res;
    const iz = Math.floor(idx / (res * res));
    for (let d = 0; d < 6; d++) {
      const nx = ix + FACE_DIRS[d][0];
      const ny = iy + FACE_DIRS[d][1];
      const nz = iz + FACE_DIRS[d][2];
      if (!inGrid(nx, ny, nz, res)) continue;
      const nidx = cellIndex(nx, ny, nz, res);
      if (!occupied[nidx]) out.push(nidx);
    }
  }

  function touchesMarked(idx, marked, res) {
    const ix = idx % res;
    const iy = Math.floor(idx / res) % res;
    const iz = Math.floor(idx / (res * res));
    for (let d = 0; d < 6; d++) {
      const nx = ix + FACE_DIRS[d][0];
      const ny = iy + FACE_DIRS[d][1];
      const nz = iz + FACE_DIRS[d][2];
      if (!inGrid(nx, ny, nz, res)) continue;
      if (marked[cellIndex(nx, ny, nz, res)]) return true;
    }
    return false;
  }

  function listComponents(occupied, res) {
    const n = occupied.length;
    const seen = new Uint8Array(n);
    const queue = new Int32Array(Math.max(1, n));
    const comps = [];
    for (let start = 0; start < n; start++) {
      if (!occupied[start] || seen[start]) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      seen[start] = 1;
      const cells = [];
      while (head < tail) {
        const idx = queue[head++];
        cells.push(idx);
        const ix = idx % res;
        const iy = Math.floor(idx / res) % res;
        const iz = Math.floor(idx / (res * res));
        for (let d = 0; d < 6; d++) {
          const nx = ix + FACE_DIRS[d][0];
          const ny = iy + FACE_DIRS[d][1];
          const nz = iz + FACE_DIRS[d][2];
          if (!inGrid(nx, ny, nz, res)) continue;
          const nidx = cellIndex(nx, ny, nz, res);
          if (!occupied[nidx] || seen[nidx]) continue;
          seen[nidx] = 1;
          queue[tail++] = nidx;
        }
      }
      comps.push(cells);
    }
    comps.sort((a, b) => b.length - a.length);
    return comps;
  }

  function reconnectCloseIslands(occupied, res) {
    for (let pass = 0; pass < 8; pass++) {
      const comps = listComponents(occupied, res);
      if (comps.length <= 1) return;
      const main = comps[0];
      const mainMark = new Uint8Array(occupied.length);
      for (let i = 0; i < main.length; i++) mainMark[main[i]] = 1;
      let bridged = false;
      for (let c = 1; c < comps.length; c++) {
        const island = comps[c];
        if (island.length <= 2) continue;
        let gap = -1;
        for (let i = 0; i < island.length && gap < 0; i++) {
          const near = [];
          emptyFaceNeighbors(island[i], occupied, res, near);
          for (let k = 0; k < near.length; k++) {
            if (touchesMarked(near[k], mainMark, res)) {
              gap = near[k];
              break;
            }
          }
        }
        if (gap >= 0) {
          occupied[gap] = 1;
          bridged = true;
          break;
        }
        if (island.length < 8) continue;
        let n1 = -1;
        let n2 = -1;
        scan: for (let i = 0; i < island.length; i++) {
          const first = [];
          emptyFaceNeighbors(island[i], occupied, res, first);
          for (let a = 0; a < first.length; a++) {
            const second = [];
            emptyFaceNeighbors(first[a], occupied, res, second);
            for (let b = 0; b < second.length; b++) {
              if (second[b] === first[a]) continue;
              if (touchesMarked(second[b], mainMark, res)) {
                n1 = first[a];
                n2 = second[b];
                break scan;
              }
            }
          }
        }
        if (n1 >= 0 && n2 >= 0) {
          occupied[n1] = 1;
          occupied[n2] = 1;
          bridged = true;
          break;
        }
      }
      if (!bridged) return;
    }
  }

  function blockStats(occupied, claimed, counts, res, ix, iy, iz, span) {
    const total = span * span * span;
    let occ = 0;
    let freeOcc = 0;
    let blocked = false;
    let nsum = 0;
    for (let z = 0; z < span; z++) {
      for (let y = 0; y < span; y++) {
        for (let x = 0; x < span; x++) {
          const cx = ix + x;
          const cy = iy + y;
          const cz = iz + z;
          if (!inGrid(cx, cy, cz, res)) return null;
          const idx = cellIndex(cx, cy, cz, res);
          if (claimed[idx]) blocked = true;
          if (occupied[idx]) {
            occ += 1;
            nsum += counts[idx];
            if (!claimed[idx]) freeOcc += 1;
          }
        }
      }
    }
    return {
      occ,
      freeOcc,
      blocked,
      total,
      ratio: occ / total,
      meanN: occ ? nsum / occ : 0,
    };
  }

  function claimBlock(claimed, ix, iy, iz, span, res) {
    for (let z = 0; z < span; z++) {
      for (let y = 0; y < span; y++) {
        for (let x = 0; x < span; x++) {
          claimed[cellIndex(ix + x, iy + y, iz + z, res)] = 1;
        }
      }
    }
  }

  function makeVoxel(ix, iy, iz, size, cell) {
    return {
      ix,
      iy,
      iz,
      size,
      centerX: (ix + size * 0.5) * cell,
      centerY: (iy + size * 0.5) * cell,
      centerZ: (iz + size * 0.5) * cell,
      occupied: true,
    };
  }

  function collectAlignedBlocks(occupied, claimed, counts, res, span, minRatio, minOcc, step) {
    const blocks = [];
    const max = res - span;
    if (max < 0) return blocks;
    const stride = Math.max(1, step == null ? 1 : step);
    for (let iz = 0; iz <= max; iz += stride) {
      for (let iy = 0; iy <= max; iy += stride) {
        for (let ix = 0; ix <= max; ix += stride) {
          const st = blockStats(occupied, claimed, counts, res, ix, iy, iz, span);
          if (!st || st.blocked || st.freeOcc < minOcc) continue;
          if (st.ratio < minRatio) continue;
          blocks.push({
            ix,
            iy,
            iz,
            span,
            score: st.ratio * 10 + st.meanN * 1.4 + st.occ * 0.08,
            occ: st.occ,
            meanN: st.meanN,
            ratio: st.ratio,
          });
        }
      }
    }
    blocks.sort((a, b) => b.score - a.score || b.occ - a.occ);
    return blocks;
  }

  function voxelsFaceTouch(a, b) {
    const ax1 = a.ix + a.size;
    const ay1 = a.iy + a.size;
    const az1 = a.iz + a.size;
    const bx1 = b.ix + b.size;
    const by1 = b.iy + b.size;
    const bz1 = b.iz + b.size;
    const ox = a.ix < bx1 && b.ix < ax1;
    const oy = a.iy < by1 && b.iy < ay1;
    const oz = a.iz < bz1 && b.iz < az1;
    const adjX = ax1 === b.ix || bx1 === a.ix;
    const adjY = ay1 === b.iy || by1 === a.iy;
    const adjZ = az1 === b.iz || bz1 === a.iz;
    return (adjX && oy && oz) || (adjY && ox && oz) || (adjZ && ox && oy);
  }

  function voxelAdjacency(voxels, res) {
    const n = voxels.length;
    const adj = new Array(n);
    for (let i = 0; i < n; i++) adj[i] = [];
    if (!n) return adj;
    const map = new Int32Array(res * res * res);
    map.fill(-1);
    for (let v = 0; v < n; v++) {
      const a = voxels[v];
      const s = Math.max(1, a.size);
      for (let z = 0; z < s; z++) {
        for (let y = 0; y < s; y++) {
          for (let x = 0; x < s; x++) {
            map[cellIndex(a.ix + x, a.iy + y, a.iz + z, res)] = v;
          }
        }
      }
    }
    for (let v = 0; v < n; v++) {
      const a = voxels[v];
      const s = Math.max(1, a.size);
      for (let d = 0; d < 6; d++) {
        const dx = FACE_DIRS[d][0];
        const dy = FACE_DIRS[d][1];
        const dz = FACE_DIRS[d][2];
        if (dx) {
          const fx = dx > 0 ? a.ix + s : a.ix - 1;
          for (let y = 0; y < s; y++) {
            for (let z = 0; z < s; z++) {
              const nx = fx;
              const ny = a.iy + y;
              const nz = a.iz + z;
              if (!inGrid(nx, ny, nz, res)) continue;
              const u = map[cellIndex(nx, ny, nz, res)];
              if (u >= 0 && u !== v) adj[v].push(u);
            }
          }
        } else if (dy) {
          const fy = dy > 0 ? a.iy + s : a.iy - 1;
          for (let x = 0; x < s; x++) {
            for (let z = 0; z < s; z++) {
              const nx = a.ix + x;
              const ny = fy;
              const nz = a.iz + z;
              if (!inGrid(nx, ny, nz, res)) continue;
              const u = map[cellIndex(nx, ny, nz, res)];
              if (u >= 0 && u !== v) adj[v].push(u);
            }
          }
        } else {
          const fz = dz > 0 ? a.iz + s : a.iz - 1;
          for (let x = 0; x < s; x++) {
            for (let y = 0; y < s; y++) {
              const nx = a.ix + x;
              const ny = a.iy + y;
              const nz = fz;
              if (!inGrid(nx, ny, nz, res)) continue;
              const u = map[cellIndex(nx, ny, nz, res)];
              if (u >= 0 && u !== v) adj[v].push(u);
            }
          }
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const uniq = [];
      const seen = new Uint8Array(n);
      const list = adj[i];
      for (let k = 0; k < list.length; k++) {
        const u = list[k];
        if (seen[u]) continue;
        seen[u] = 1;
        uniq.push(u);
      }
      adj[i] = uniq;
    }
    return adj;
  }

  function connectedGroups(voxels, res) {
    const adj = voxelAdjacency(voxels, res);
    const n = voxels.length;
    const seen = new Uint8Array(n);
    const groups = [];
    for (let i = 0; i < n; i++) {
      if (seen[i]) continue;
      const stack = [i];
      seen[i] = 1;
      const group = [];
      while (stack.length) {
        const cur = stack.pop();
        group.push(cur);
        const nbrs = adj[cur];
        for (let k = 0; k < nbrs.length; k++) {
          const u = nbrs[k];
          if (seen[u]) continue;
          seen[u] = 1;
          stack.push(u);
        }
      }
      groups.push(group);
    }
    groups.sort((a, b) => b.length - a.length);
    return { adj, groups };
  }

  function countIsolated(adj) {
    let n = 0;
    for (let i = 0; i < adj.length; i++) {
      if (!adj[i].length) n += 1;
    }
    return n;
  }

  function restoreVoxels(target, source) {
    target.length = 0;
    for (let i = 0; i < source.length; i++) target.push(source[i]);
  }

  function finalizeVoxels(voxels, res) {
    if (!voxels.length) return { voxels: [], components: 0, isolatedCount: 0 };
    const graph = connectedGroups(voxels, res);
    return {
      voxels: voxels.slice(),
      components: graph.groups.length,
      isolatedCount: countIsolated(graph.adj),
    };
  }

  function keepLargestVoxelGroup(voxels, res) {
    const cleaned = finalizeVoxels(voxels, res);
    return { voxels: cleaned.voxels, components: cleaned.components, isolatedCount: cleaned.isolatedCount };
  }

  function blockTouchesVoxels(ix, iy, iz, span, voxels) {
    if (!voxels.length) return true;
    const probe = { ix, iy, iz, size: span };
    for (let i = 0; i < voxels.length; i++) {
      if (voxelsFaceTouch(probe, voxels[i])) return true;
    }
    return false;
  }

  function remainingOccupied(occupied, claimed) {
    let n = 0;
    for (let i = 0; i < occupied.length; i++) {
      if (occupied[i] && !claimed[i]) n += 1;
    }
    return n;
  }

  function countSize(voxels, size) {
    let n = 0;
    for (let i = 0; i < voxels.length; i++) {
      if (voxels[i].size === size) n += 1;
    }
    return n;
  }

  function replaceCovered(voxels, ix, iy, iz, span, cell, res) {
    const cover = new Uint8Array(res * res * res);
    claimBlock(cover, ix, iy, iz, span, res);
    const next = [makeVoxel(ix, iy, iz, span, cell)];
    for (let v = 0; v < voxels.length; v++) {
      const voxel = voxels[v];
      let overlap = false;
      scan: for (let z = 0; z < voxel.size; z++) {
        for (let y = 0; y < voxel.size; y++) {
          for (let x = 0; x < voxel.size; x++) {
            if (cover[cellIndex(voxel.ix + x, voxel.iy + y, voxel.iz + z, res)]) {
              overlap = true;
              break scan;
            }
          }
        }
      }
      if (!overlap) next.push(voxel);
    }
    voxels.length = 0;
    for (let k = 0; k < next.length; k++) voxels.push(next[k]);
  }

  function forceSize(voxels, occupied, counts, res, cell, span, minRatio, want) {
    const need = Math.max(1, want || 1);
    const emptyClaimed = new Uint8Array(occupied.length);
    const candidates = collectAlignedBlocks(occupied, emptyClaimed, counts, res, span, 0, 1);
    for (let i = 0; i < candidates.length; i++) {
      if (countSize(voxels, span) >= need) return;
      const b = candidates[i];
      const st = blockStats(occupied, emptyClaimed, counts, res, b.ix, b.iy, b.iz, span);
      if (!st || st.occ < 1 || st.ratio < minRatio) continue;
      if (voxels.some((v) => v.size === span && v.ix === b.ix && v.iy === b.iy && v.iz === b.iz)) continue;
      if (!blockTouchesVoxels(b.ix, b.iy, b.iz, span, voxels)) continue;
      const snapshot = voxels.slice();
      replaceCovered(voxels, b.ix, b.iy, b.iz, span, cell, res);
      if (!countSize(voxels, span)) {
        restoreVoxels(voxels, snapshot);
        continue;
      }
    }
  }

  function splitVoxelToSize(voxels, index, nextSize, cell) {
    const v = voxels[index];
    if (!v || nextSize >= v.size) return false;
    voxels.splice(index, 1);
    const span = v.size;
    if (nextSize === 1) {
      for (let z = 0; z < span; z++) {
        for (let y = 0; y < span; y++) {
          for (let x = 0; x < span; x++) voxels.push(makeVoxel(v.ix + x, v.iy + y, v.iz + z, 1, cell));
        }
      }
      return true;
    }
    for (let z = 0; z < span; z += nextSize) {
      for (let y = 0; y < span; y += nextSize) {
        for (let x = 0; x < span; x += nextSize) {
          if (x + nextSize <= span && y + nextSize <= span && z + nextSize <= span) {
            voxels.push(makeVoxel(v.ix + x, v.iy + y, v.iz + z, nextSize, cell));
          } else {
            for (let zz = z; zz < Math.min(z + nextSize, span); zz++) {
              for (let yy = y; yy < Math.min(y + nextSize, span); yy++) {
                for (let xx = x; xx < Math.min(x + nextSize, span); xx++) {
                  voxels.push(makeVoxel(v.ix + xx, v.iy + yy, v.iz + zz, 1, cell));
                }
              }
            }
          }
        }
      }
    }
    return true;
  }

  function forceSmall(voxels, cell) {
    if (countSize(voxels, SIZE_SMALL)) return;
    for (let i = voxels.length - 1; i >= 0; i--) {
      if (voxels[i].size === SIZE_MED) {
        splitVoxelToSize(voxels, i, SIZE_SMALL, cell);
        return;
      }
    }
    for (let i = voxels.length - 1; i >= 0; i--) {
      if (voxels[i].size === SIZE_LARGE) {
        splitVoxelToSize(voxels, i, SIZE_SMALL, cell);
        return;
      }
    }
  }

  function adaptMultiSize(occupied, res, cell, fidelity) {
    const f = clamp(fidelity, 0, 1);
    const counts = neighborCounts(occupied, res);
    const claimed = new Uint8Array(occupied.length);
    const voxels = [];
    const occupiedCount = countOccupied(occupied);
    const largeVol = SIZE_LARGE * SIZE_LARGE * SIZE_LARGE;
    const minInteriorLarge = 2.4 + f * 1.5;
    const minInteriorMed = 1.5 + f * 1.3;
    const maxLargeVol = Math.max(largeVol, Math.floor(occupiedCount * (0.54 - f * 0.14)));
    const maxMedVol = Math.max(SIZE_MED * SIZE_MED * SIZE_MED, Math.floor(occupiedCount * (0.44 - f * 0.06)));
    const largeMinRatio = 0.42 + f * 0.22;
    const medMinRatio = 0.34 + f * 0.16;
    const largeMinOcc = Math.max(8, Math.ceil(largeVol * (0.38 + f * 0.14)));
    const medMinOcc = Math.max(3, Math.ceil(8 * (0.34 + f * 0.12)));

    const placeFrom = (blocks, span, volumeCap, minKeep) => {
      let used = 0;
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const st = blockStats(occupied, claimed, counts, res, b.ix, b.iy, b.iz, span);
        if (!st || st.blocked || st.freeOcc < 1) continue;
        const leftover = remainingOccupied(occupied, claimed) - st.freeOcc;
        if (leftover < minKeep) continue;
        if (used + st.total > volumeCap && voxels.length) continue;
        claimBlock(claimed, b.ix, b.iy, b.iz, span, res);
        voxels.push(makeVoxel(b.ix, b.iy, b.iz, span, cell));
        used += st.total;
      }
    };

    const largeBlocks = collectAlignedBlocks(
      occupied,
      claimed,
      counts,
      res,
      SIZE_LARGE,
      largeMinRatio,
      largeMinOcc,
      1
    ).filter((b) => b.meanN >= minInteriorLarge || b.occ >= Math.ceil(largeVol * 0.7));
    placeFrom(largeBlocks, SIZE_LARGE, maxLargeVol, Math.max(18, Math.floor(occupiedCount * 0.14)));

    const mediumBlocks = collectAlignedBlocks(
      occupied,
      claimed,
      counts,
      res,
      SIZE_MED,
      medMinRatio,
      medMinOcc,
      1
    ).filter((b) => b.meanN >= minInteriorMed || b.occ >= 4);
    placeFrom(mediumBlocks, SIZE_MED, maxMedVol, 4);

    for (let iz = 0; iz < res; iz++) {
      for (let iy = 0; iy < res; iy++) {
        for (let ix = 0; ix < res; ix++) {
          const idx = cellIndex(ix, iy, iz, res);
          if (!occupied[idx] || claimed[idx]) continue;
          claimed[idx] = 1;
          voxels.push(makeVoxel(ix, iy, iz, SIZE_SMALL, cell));
        }
      }
    }

    forceSize(voxels, occupied, counts, res, cell, SIZE_LARGE, 0.32, 1);
    forceSize(voxels, occupied, counts, res, cell, SIZE_MED, 0.22, 1);
    forceSmall(voxels, cell);

    let grouped = keepLargestVoxelGroup(voxels, res);
    restoreVoxels(voxels, grouped.voxels);
    if (!countSize(voxels, SIZE_LARGE) || !countSize(voxels, SIZE_MED) || !countSize(voxels, SIZE_SMALL)) {
      forceSize(voxels, occupied, counts, res, cell, SIZE_LARGE, 0.26, 1);
      forceSize(voxels, occupied, counts, res, cell, SIZE_MED, 0.18, 1);
      forceSmall(voxels, cell);
      grouped = keepLargestVoxelGroup(voxels, res);
      restoreVoxels(voxels, grouped.voxels);
    }

    const final = finalizeVoxels(voxels, res);
    return {
      voxels: final.voxels,
      smallCount: countSize(final.voxels, SIZE_SMALL),
      mediumCount: countSize(final.voxels, SIZE_MED),
      largeCount: countSize(final.voxels, SIZE_LARGE),
      components: final.components,
      isolatedCount: final.isolatedCount,
    };
  }

  function voxelizeCapsules(capsules, resolution, occupied) {
    const res = clampRes(resolution);
    const cell = CUBE / res;
    const occ = occupied || new Uint8Array(res * res * res);
    let marked = 0;
    for (let s = 0; s < capsules.length; s++) {
      const seg = capsules[s];
      const radius = Math.max(cell * 0.18, Number(seg.radius) || cell * 0.4);
      const r2 = radius * radius;
      const minx = Math.min(seg.ax, seg.bx) - radius;
      const miny = Math.min(seg.ay, seg.by) - radius;
      const minz = Math.min(seg.az, seg.bz) - radius;
      const maxx = Math.max(seg.ax, seg.bx) + radius;
      const maxy = Math.max(seg.ay, seg.by) + radius;
      const maxz = Math.max(seg.az, seg.bz) + radius;
      const i0 = Math.max(0, Math.floor(minx / cell));
      const i1 = Math.min(res - 1, Math.floor(maxx / cell));
      const j0 = Math.max(0, Math.floor(miny / cell));
      const j1 = Math.min(res - 1, Math.floor(maxy / cell));
      const k0 = Math.max(0, Math.floor(minz / cell));
      const k1 = Math.min(res - 1, Math.floor(maxz / cell));
      if (i1 < i0 || j1 < j0 || k1 < k0) continue;
      for (let iz = k0; iz <= k1; iz++) {
        const cz = (iz + 0.5) * cell;
        for (let iy = j0; iy <= j1; iy++) {
          const cy = (iy + 0.5) * cell;
          for (let ix = i0; ix <= i1; ix++) {
            const idx = ix + iy * res + iz * res * res;
            if (occ[idx]) continue;
            const cx = (ix + 0.5) * cell;
            if (distPointSeg2(cx, cy, cz, seg.ax, seg.ay, seg.az, seg.bx, seg.by, seg.bz) <= r2) {
              occ[idx] = 1;
              marked += 1;
            }
          }
        }
      }
    }
    return { occupied: occ, marked, resolution: res, cell };
  }

  function voxelizeGeometries(geometries, resolution) {
    const res = clampRes(resolution);
    const cell = CUBE / res;
    const occupied = new Uint8Array(res * res * res);
    const half = cell * 0.52;
    const r2 = half * half * 3;
    let marked = 0;
    for (let g = 0; g < geometries.length; g++) {
      const geom = geometries[g];
      if (!geom || !geom.attributes || !geom.attributes.position) continue;
      const pos = geom.attributes.position.array;
      const index = geom.index ? geom.index.array : null;
      const triCount = index ? index.length / 3 : pos.length / 9;
      for (let t = 0; t < triCount; t++) {
        let ia;
        let ib;
        let ic;
        if (index) {
          ia = index[t * 3] * 3;
          ib = index[t * 3 + 1] * 3;
          ic = index[t * 3 + 2] * 3;
        } else {
          ia = t * 9;
          ib = ia + 3;
          ic = ia + 6;
        }
        const ax = pos[ia];
        const ay = pos[ia + 1];
        const az = pos[ia + 2];
        const bx = pos[ib];
        const by = pos[ib + 1];
        const bz = pos[ib + 2];
        const cx = pos[ic];
        const cy = pos[ic + 1];
        const cz = pos[ic + 2];
        const minx = Math.min(ax, bx, cx);
        const miny = Math.min(ay, by, cy);
        const minz = Math.min(az, bz, cz);
        const maxx = Math.max(ax, bx, cx);
        const maxy = Math.max(ay, by, cy);
        const maxz = Math.max(az, bz, cz);
        const i0 = Math.max(0, Math.floor((minx - half) / cell));
        const i1 = Math.min(res - 1, Math.floor((maxx + half) / cell));
        const j0 = Math.max(0, Math.floor((miny - half) / cell));
        const j1 = Math.min(res - 1, Math.floor((maxy + half) / cell));
        const k0 = Math.max(0, Math.floor((minz - half) / cell));
        const k1 = Math.min(res - 1, Math.floor((maxz + half) / cell));
        if (i1 < i0 || j1 < j0 || k1 < k0) continue;
        for (let iz = k0; iz <= k1; iz++) {
          const vz = (iz + 0.5) * cell;
          for (let iy = j0; iy <= j1; iy++) {
            const vy = (iy + 0.5) * cell;
            for (let ix = i0; ix <= i1; ix++) {
              const idx = ix + iy * res + iz * res * res;
              if (occupied[idx]) continue;
              const vx = (ix + 0.5) * cell;
              if (distPointTri2(vx, vy, vz, ax, ay, az, bx, by, bz, cx, cy, cz) <= r2) {
                occupied[idx] = 1;
                marked += 1;
              }
            }
          }
        }
      }
    }
    return { occupied, marked, resolution: res, cell };
  }

  function generate(THREE, params) {
    const resolution = clampRes(params && params.resolution);
    const cell = CUBE / resolution;
    const source =
      params && params.source === "loft"
        ? "loft"
        : params && params.source === "solids"
          ? "solids"
          : "lines";
    let packed;
    const width = params.width != null ? params.width : 0.28;
    const useHierarchy = !!params.useHierarchy;
    if (source === "loft") {
      packed = voxelizeGeometries(params.geometries || [], resolution);
      if (params.capsules && params.capsules.length) {
        voxelizeCapsules(params.capsules, resolution, packed.occupied);
      }
      if (params.segments && params.segments.length) {
        voxelizeSegments(params.segments, resolution, width, useHierarchy, packed.occupied);
      }
      packed.marked = countOccupied(packed.occupied);
    } else if (source === "solids") {
      packed = voxelizeGeometries(params.geometries || [], resolution);
      if (params.segments && params.segments.length) {
        voxelizeSegments(params.segments, resolution, width, useHierarchy, packed.occupied);
      }
      packed.marked = countOccupied(packed.occupied);
    } else {
      packed = voxelizeSegments(params.segments || [], resolution, width, useHierarchy);
    }
    reconnectCloseIslands(packed.occupied, packed.resolution);
    packed.marked = countOccupied(packed.occupied);
    const fidelity = params && params.fidelity != null ? Number(params.fidelity) : 0.75;
    const adapted = adaptMultiSize(packed.occupied, packed.resolution, cell, fidelity);
    const cells = adapted.voxels.length ? adapted.voxels : collectCells(packed.occupied, packed.resolution);
    return {
      resolution: packed.resolution,
      cell,
      cells,
      occupiedCount: packed.marked,
      voxelCount: cells.length,
      smallCount: adapted.smallCount,
      mediumCount: adapted.mediumCount,
      largeCount: adapted.largeCount,
      components: adapted.components,
      isolatedCount: adapted.isolatedCount || 0,
      totalCount: packed.resolution * packed.resolution * packed.resolution,
      source,
    };
  }

  global.D7SpatialVoxels = {
    CUBE,
    RESOLUTIONS,
    clampRes,
    cellSize,
    worldSegmentsFromChunk,
    worldSegmentsFromLoftSet,
    generate,
    voxelsFaceTouch,
  };
})(window);

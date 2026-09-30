/**
 * Branch-solid generator: the 2D network is the solid, gaps stay void.
 * Each source segment is lofted through related sectional states along the chunk normal.
 */
(function (global) {
  const CUBE = 20;
  const SLICE_COUNT = 9;

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
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
    for (let i = 0; i < 3; i++) {
      sum += amp * (valueNoise(x * freq, y * freq, z * freq, seed + i * 17) * 2 - 1);
      norm += amp;
      amp *= 0.5;
      freq *= 2.02;
    }
    return sum / Math.max(1e-6, norm);
  }

  function applyMat4(e, x, y, z, out) {
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    const iw = Math.abs(w) > 1e-12 ? 1 / w : 1;
    out[0] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * iw;
    out[1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * iw;
    out[2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * iw;
    return out;
  }

  function chunkMatrices(THREE, transform) {
    const pos = new THREE.Vector3(transform.x, transform.y, transform.z);
    const euler = new THREE.Euler(
      ((transform.rx || 0) * Math.PI) / 180,
      ((transform.ry || 0) * Math.PI) / 180,
      ((transform.rz || 0) * Math.PI) / 180,
      "XYZ"
    );
    const q = new THREE.Quaternion().setFromEuler(euler);
    const s = Number(transform.scale) || 1;
    const matrix = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(s, s, s));
    const inverse = new THREE.Matrix4();
    if (typeof inverse.invert === "function") inverse.copy(matrix).invert();
    else inverse.getInverse(matrix);
    return { matrix, inverse };
  }

  function sourcePlaneWorld(THREE, transform, width, height) {
    const { matrix } = chunkMatrices(THREE, transform);
    const p = new THREE.Vector3(width * 0.5, height * 0.5, 0).applyMatrix4(matrix);
    const n = new THREE.Vector3(0, 0, 1).transformDirection(matrix).normalize();
    return { point: p, normal: n };
  }

  function nodeKey(x, y) {
    return `${Math.round(x * 250) / 250},${Math.round(y * 250) / 250}`;
  }

  function orderScale(order, useHierarchy) {
    if (!useHierarchy) return 1;
    const o = Number(order) || 1;
    if (o >= 3) return 0.46;
    if (o >= 2) return 0.7;
    return 1;
  }

  function warpXY(x, y, z, seed, fid, variation, reach) {
    const ad = Math.abs(z);
    if (ad < 1e-8) return { x, y, scale: 1, twist: 0 };
    const t = Math.min(1, ad / Math.max(1e-6, reach));
    const power = 1.15 + fid * 1.85;
    const diverge = Math.pow(t, power);
    const amp = variation * (0.1 + 0.9 * (1 - fid)) * 3.6 * diverge;
    const n1 = fbm(x * 0.07, y * 0.07, z * 0.065, seed);
    const n2 = fbm(x * 0.07 + 19.4, y * 0.07 - 8.1, z * 0.065, seed + 5);
    const n3 = fbm(x * 0.05, y * 0.05, z * 0.075, seed + 11);
    const n4 = fbm(x * 0.038 + 7, y * 0.038, z * 0.048, seed + 23);
    return {
      x: x + n1 * amp,
      y: y + n2 * amp,
      scale: 1 + variation * 0.48 * n3 * diverge,
      twist: variation * 0.38 * n4 * diverge,
    };
  }

  function perp(ax, ay, bx, by, twist) {
    let tx = bx - ax;
    let ty = by - ay;
    const len = Math.hypot(tx, ty);
    if (len < 1e-8) {
      tx = 1;
      ty = 0;
    } else {
      tx /= len;
      ty /= len;
    }
    let wx = -ty;
    let wy = tx;
    if (twist) {
      const c = Math.cos(twist);
      const s = Math.sin(twist);
      const rx = wx * c - wy * s;
      const ry = wx * s + wy * c;
      wx = rx;
      wy = ry;
    }
    return { wx, wy, len };
  }

  function pushTri(pos, nrm, a, b, c) {
    const e1x = b[0] - a[0];
    const e1y = b[1] - a[1];
    const e1z = b[2] - a[2];
    const e2x = c[0] - a[0];
    const e2y = c[1] - a[1];
    const e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  }

  function pushQuad(pos, nrm, a, b, c, d) {
    pushTri(pos, nrm, a, b, c);
    pushTri(pos, nrm, a, c, d);
  }

  function barRing(ax, ay, bx, by, z, halfW, twist) {
    const { wx, wy } = perp(ax, ay, bx, by, twist);
    return [
      [ax + wx * halfW, ay + wy * halfW, z],
      [ax - wx * halfW, ay - wy * halfW, z],
      [bx - wx * halfW, by - wy * halfW, z],
      [bx + wx * halfW, by + wy * halfW, z],
    ];
  }

  function nodeRing(x, y, z, halfW) {
    return [
      [x + halfW, y + halfW, z],
      [x - halfW, y + halfW, z],
      [x - halfW, y - halfW, z],
      [x + halfW, y - halfW, z],
    ];
  }

  function loftRings(pos, nrm, rings) {
    if (!rings.length) return;
    const first = rings[0];
    const last = rings[rings.length - 1];
    pushQuad(pos, nrm, first[0], first[1], first[2], first[3]);
    for (let i = 0; i < rings.length - 1; i++) {
      const a = rings[i];
      const b = rings[i + 1];
      for (let k = 0; k < 4; k++) {
        const n = (k + 1) % 4;
        pushQuad(pos, nrm, a[k], a[n], b[n], b[k]);
      }
    }
    pushQuad(pos, nrm, last[0], last[3], last[2], last[1]);
  }

  function transformAndClip(positions, matrix) {
    const e = matrix.elements;
    const out = [0, 0, 0];
    for (let i = 0; i < positions.length; i += 3) {
      applyMat4(e, positions[i], positions[i + 1], positions[i + 2], out);
      positions[i] = clamp(out[0], 0, CUBE);
      positions[i + 1] = clamp(out[1], 0, CUBE);
      positions[i + 2] = clamp(out[2], 0, CUBE);
    }
  }

  function recomputeNormals(positions, normals) {
    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i];
      const ay = positions[i + 1];
      const az = positions[i + 2];
      const bx = positions[i + 3];
      const by = positions[i + 4];
      const bz = positions[i + 5];
      const cx = positions[i + 6];
      const cy = positions[i + 7];
      const cz = positions[i + 8];
      const e1x = bx - ax;
      const e1y = by - ay;
      const e1z = bz - az;
      const e2x = cx - ax;
      const e2y = cy - ay;
      const e2z = cz - az;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
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
  }

  function generate(THREE, chunk, params) {
    const branches = (chunk && chunk.branches) || [];
    if (!THREE || !branches.length) {
      return { positions: [], normals: [], vertexCount: 0, triangleCount: 0 };
    }
    const fid = clamp(params.fidelity, 0, 1);
    const variation = clamp(params.variation, 0, 1);
    const halfW0 = 0.045 + clamp(params.width, 0, 1) * 0.5;
    const halfD = 0.04 + clamp(params.depth, 0, 1) * 0.55;
    const reach = 0.2 + clamp(params.reach, 0, 1) * 9.3;
    const seed = (params.seed | 0) + 1;
    const useHierarchy = !!params.useHierarchy;
    const { matrix } = chunkMatrices(THREE, chunk.transform);

    const zs = [];
    const zMax = reach + halfD;
    for (let i = 0; i < SLICE_COUNT; i++) {
      zs.push(-zMax + (2 * zMax * i) / (SLICE_COUNT - 1));
    }

    const warped = new Map();
    function sampleNode(x, y, zi) {
      const z = zs[zi];
      const key = `${nodeKey(x, y)}@${zi}`;
      let rec = warped.get(key);
      if (rec) return rec;
      rec = warpXY(x, y, z, seed, fid, variation, zMax);
      rec.z = z;
      warped.set(key, rec);
      return rec;
    }

    const positions = [];
    const normals = [];

    for (const seg of branches) {
      if (Math.hypot(seg.bx - seg.ax, seg.by - seg.ay) < 1e-4) continue;
      const hwBase = halfW0 * orderScale(seg.order, useHierarchy);
      const rings = [];
      for (let zi = 0; zi < SLICE_COUNT; zi++) {
        const a = sampleNode(seg.ax, seg.ay, zi);
        const b = sampleNode(seg.bx, seg.by, zi);
        if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-4) continue;
        const hw = Math.max(0.028, hwBase * ((a.scale + b.scale) * 0.5));
        const twist = (a.twist + b.twist) * 0.5;
        rings.push(barRing(a.x, a.y, b.x, b.y, a.z, hw, twist));
      }
      if (rings.length >= 2) loftRings(positions, normals, rings);
    }

    const nodeMaxW = new Map();
    for (const seg of branches) {
      const hw = halfW0 * orderScale(seg.order, useHierarchy);
      const ka = nodeKey(seg.ax, seg.ay);
      const kb = nodeKey(seg.bx, seg.by);
      nodeMaxW.set(ka, Math.max(nodeMaxW.get(ka) || 0, hw));
      nodeMaxW.set(kb, Math.max(nodeMaxW.get(kb) || 0, hw));
    }
    const seenXY = new Set();
    for (const seg of branches) {
      for (const p of [
        [seg.ax, seg.ay],
        [seg.bx, seg.by],
      ]) {
        const xy = nodeKey(p[0], p[1]);
        if (seenXY.has(xy)) continue;
        seenXY.add(xy);
        const hw = (nodeMaxW.get(xy) || halfW0) * 1.04;
        const rings = [];
        for (let zi = 0; zi < SLICE_COUNT; zi++) {
          const s = sampleNode(p[0], p[1], zi);
          rings.push(nodeRing(s.x, s.y, s.z, Math.max(0.028, hw * s.scale)));
        }
        loftRings(positions, normals, rings);
      }
    }

    transformAndClip(positions, matrix);
    recomputeNormals(positions, normals);

    return {
      positions,
      normals,
      vertexCount: positions.length / 3,
      triangleCount: positions.length / 9,
    };
  }

  global.D7SpatialMass = {
    CUBE,
    generate,
    sourcePlaneWorld,
    chunkMatrices,
  };
})(window);

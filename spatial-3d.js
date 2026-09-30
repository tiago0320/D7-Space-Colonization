/**
 * Build a 20' cube spatial study from a clipped 2D branching seed.
 * The seed is transformed through depth and lofted — not extruded.
 */
(function (global) {
  const CUBE = 20;
  const GRID = 32;
  const SLICES = 12;
  const KEY_T = [0, 0.25, 0.5, 0.75, 1];
  const WALL = 0.42;
  const HULL_PAD = 0.55;
  const CONTOUR_SAMPLES = 40;

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function hypot2(dx, dy) {
    return Math.sqrt(dx * dx + dy * dy);
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

  function clipSegment(ax, ay, bx, by, rect) {
    const xmin = rect.x;
    const xmax = rect.x + rect.w;
    const ymin = rect.y;
    const ymax = rect.y + rect.h;
    const dx = bx - ax;
    const dy = by - ay;
    let t0 = 0;
    let t1 = 1;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };
    if (!clip(-dx, ax - xmin) || !clip(dx, xmax - ax)) return null;
    if (!clip(-dy, ay - ymin) || !clip(dy, ymax - ay)) return null;
    return {
      ax: ax + dx * t0,
      ay: ay + dy * t0,
      bx: ax + dx * t1,
      by: ay + dy * t1,
    };
  }

  function clipSegmentsToRect(flat, rect) {
    const out = [];
    if (!rect || rect.w < 1 || rect.h < 1) return out;
    for (let i = 0; i + 3 < (flat || []).length; i += 4) {
      const clipped = clipSegment(flat[i], flat[i + 1], flat[i + 2], flat[i + 3], rect);
      if (!clipped) continue;
      if (hypot2(clipped.bx - clipped.ax, clipped.by - clipped.ay) < 0.4) continue;
      out.push(clipped.ax, clipped.ay, clipped.bx, clipped.by);
    }
    return out;
  }

  function mapToCube(flat, rect) {
    const s = CUBE / Math.max(rect.w, rect.h, 1e-6);
    const cx = rect.x + rect.w * 0.5;
    const cy = rect.y + rect.h * 0.5;
    const out = [];
    for (let i = 0; i < flat.length; i += 2) {
      out.push((flat[i] - cx) * s + CUBE * 0.5, (flat[i + 1] - cy) * s + CUBE * 0.5);
    }
    return { flat: out, scale: s };
  }

  function transformPoint(x, y, t) {
    const cx = CUBE * 0.5;
    const cy = CUBE * 0.5;
    let dx = x - cx;
    let dy = y - cy;
    const rot = 0.11 * Math.sin(t * Math.PI);
    const sc = 1 + 0.07 * Math.sin(t * Math.PI * 2) - 0.035 * t;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    let nx = (dx * c - dy * s) * sc;
    let ny = (dx * s + dy * c) * sc;
    nx *= 1 + 0.08 * Math.sin(t * Math.PI + ny * 0.16);
    ny *= 1 + 0.1 * Math.sin(t * Math.PI * 1.4 + nx * 0.14);
    nx += 0.85 * Math.sin(t * Math.PI * 2 + y * 0.2);
    ny += 0.7 * Math.sin(t * Math.PI * 2 + x * 0.18);
    const ang = Math.atan2(ny, nx);
    const pulse = 1 + 0.1 * Math.sin(t * 4.2 + ang * 2.5);
    return [cx + nx * pulse, cy + ny * pulse];
  }

  function transformSegments(flat, t) {
    const out = [];
    for (let i = 0; i + 3 < flat.length; i += 4) {
      const a = transformPoint(flat[i], flat[i + 1], t);
      const b = transformPoint(flat[i + 2], flat[i + 3], t);
      out.push(a[0], a[1], b[0], b[1]);
    }
    return out;
  }

  function distToSegments(px, py, segs) {
    let best = 1e9;
    for (let i = 0; i + 3 < segs.length; i += 4) {
      const ax = segs[i];
      const ay = segs[i + 1];
      const bx = segs[i + 2];
      const by = segs[i + 3];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1e-8;
      let u = ((px - ax) * dx + (py - ay) * dy) / len2;
      u = clamp(u, 0, 1);
      const d = hypot2(px - (ax + dx * u), py - (ay + dy * u));
      if (d < best) best = d;
    }
    return best;
  }

  function convexHull(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length <= 2) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function distToPoly(px, py, poly) {
    if (!poly.length) return 1e9;
    let inside = false;
    let best = 1e9;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j][0];
      const ay = poly[j][1];
      const bx = poly[i][0];
      const by = poly[i][1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1e-8;
      let u = ((px - ax) * dx + (py - ay) * dy) / len2;
      u = clamp(u, 0, 1);
      best = Math.min(best, hypot2(px - (ax + dx * u), py - (ay + dy * u)));
      const hit = ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay || 1e-8) + ax;
      if (hit) inside = !inside;
    }
    return inside ? -best : best;
  }

  function hullPointsFromSegs(segs) {
    const pts = [];
    for (let i = 0; i + 1 < segs.length; i += 2) pts.push([segs[i], segs[i + 1]]);
    return convexHull(pts);
  }

  function fieldAt(x, y, segs, hull) {
    const d = distToSegments(x, y, segs);
    const h = distToPoly(x, y, hull) - HULL_PAD;
    return Math.min(-h, d - WALL);
  }

  function sampleGrid(segs) {
    const hull = hullPointsFromSegs(segs);
    const field = new Float32Array(GRID * GRID);
    const step = CUBE / (GRID - 1);
    for (let j = 0; j < GRID; j++) {
      const y = j * step;
      for (let i = 0; i < GRID; i++) {
        const x = i * step;
        field[j * GRID + i] = fieldAt(x, y, segs, hull);
      }
    }
    return field;
  }

  const MS_EDGE = [
    [],
    [[3, 0]],
    [[0, 1]],
    [[3, 1]],
    [[1, 2]],
    [[3, 0], [1, 2]],
    [[0, 2]],
    [[3, 2]],
    [[2, 3]],
    [[0, 2]],
    [[0, 1], [2, 3]],
    [[1, 2]],
    [[1, 3]],
    [[0, 1]],
    [[0, 3]],
    [],
  ];

  function edgePoint(i0, j0, i1, j1, field, step) {
    const a = field[j0 * GRID + i0];
    const b = field[j1 * GRID + i1];
    const t = Math.abs(b - a) < 1e-8 ? 0.5 : a / (a - b);
    return [(i0 + (i1 - i0) * t) * step, (j0 + (j1 - j0) * t) * step];
  }

  function contourFromCase(i, j, field, step) {
    const v0 = field[j * GRID + i] > 0 ? 1 : 0;
    const v1 = field[j * GRID + i + 1] > 0 ? 1 : 0;
    const v2 = field[(j + 1) * GRID + i + 1] > 0 ? 1 : 0;
    const v3 = field[(j + 1) * GRID + i] > 0 ? 1 : 0;
    const idx = v0 | (v1 << 1) | (v2 << 2) | (v3 << 3);
    const edges = MS_EDGE[idx];
    const corners = [
      [i, j, i + 1, j],
      [i + 1, j, i + 1, j + 1],
      [i + 1, j + 1, i, j + 1],
      [i, j + 1, i, j],
    ];
    const segs = [];
    for (const pair of edges) {
      const e0 = corners[pair[0]];
      const e1 = corners[pair[1]];
      segs.push([
        edgePoint(e0[0], e0[1], e0[2], e0[3], field, step),
        edgePoint(e1[0], e1[1], e1[2], e1[3], field, step),
      ]);
    }
    return segs;
  }

  function traceContours(field) {
    const step = CUBE / (GRID - 1);
    const unused = [];
    for (let j = 0; j < GRID - 1; j++) {
      for (let i = 0; i < GRID - 1; i++) {
        const bits = contourFromCase(i, j, field, step);
        for (const seg of bits) unused.push(seg);
      }
    }
    const contours = [];
    const used = new Array(unused.length).fill(false);
    const near = (a, b) => hypot2(a[0] - b[0], a[1] - b[1]) < step * 0.65;
    for (let s = 0; s < unused.length; s++) {
      if (used[s]) continue;
      used[s] = true;
      const poly = [unused[s][0], unused[s][1]];
      let guard = 0;
      let grew = true;
      while (grew && guard++ < unused.length + 2) {
        grew = false;
        const head = poly[0];
        const tail = poly[poly.length - 1];
        for (let k = 0; k < unused.length; k++) {
          if (used[k]) continue;
          const a = unused[k][0];
          const b = unused[k][1];
          if (near(tail, a)) {
            poly.push(b);
            used[k] = true;
            grew = true;
            break;
          }
          if (near(tail, b)) {
            poly.push(a);
            used[k] = true;
            grew = true;
            break;
          }
          if (near(head, a)) {
            poly.unshift(b);
            used[k] = true;
            grew = true;
            break;
          }
          if (near(head, b)) {
            poly.unshift(a);
            used[k] = true;
            grew = true;
            break;
          }
        }
      }
      if (poly.length >= 8) contours.push(poly);
    }
    return contours;
  }

  function signedArea(poly) {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    }
    return a * 0.5;
  }

  function resampleClosed(poly, n) {
    if (poly.length < 3) return poly;
    const pts = poly.slice();
    if (hypot2(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) > 1e-4) {
      pts.push([pts[0][0], pts[0][1]]);
    }
    if (signedArea(pts) < 0) pts.reverse();
    let len = 0;
    const acc = [0];
    for (let i = 1; i < pts.length; i++) {
      len += hypot2(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      acc.push(len);
    }
    if (len < 1e-4) return pts.slice(0, n);
    const out = [];
    for (let i = 0; i < n; i++) {
      const target = (i / n) * len;
      let k = 1;
      while (k < acc.length && acc[k] < target) k += 1;
      const a = pts[k - 1];
      const b = pts[k];
      const span = acc[k] - acc[k - 1] || 1e-8;
      const u = (target - acc[k - 1]) / span;
      out.push([lerp(a[0], b[0], u), lerp(a[1], b[1], u)]);
    }
    return out;
  }

  function centroid(poly) {
    let x = 0;
    let y = 0;
    for (const p of poly) {
      x += p[0];
      y += p[1];
    }
    const n = Math.max(1, poly.length);
    return [x / n, y / n];
  }

  function alignStart(poly, ref) {
    if (!ref || !ref.length) return poly;
    let best = 0;
    let bestD = 1e9;
    for (let i = 0; i < poly.length; i++) {
      const d = hypot2(poly[i][0] - ref[0][0], poly[i][1] - ref[0][1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return poly.slice(best).concat(poly.slice(0, best));
  }

  function keyDepth(t) {
    let i = 0;
    while (i < KEY_T.length - 2 && t > KEY_T[i + 1]) i += 1;
    const a = KEY_T[i];
    const b = KEY_T[i + 1];
    const u = (t - a) / Math.max(1e-6, b - a);
    return { a, b, u, i };
  }

  function to3(x, y, z) {
    return [x, CUBE - y, z];
  }

  function addCap(positions, indices, poly, z, inward) {
    const c = centroid(poly);
    const ci = positions.length / 3;
    positions.push(...to3(c[0], c[1], z));
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[i];
      positions.push(...to3(p[0], p[1], z));
    }
    for (let i = 0; i < n; i++) {
      const a = ci + 1 + i;
      const b = ci + 1 + ((i + 1) % n);
      if (inward) indices.push(ci, b, a);
      else indices.push(ci, a, b);
    }
  }

  function loft(positions, indices, a, b, z0, z1) {
    const n = Math.min(a.length, b.length);
    const base = positions.length / 3;
    for (let i = 0; i < n; i++) {
      positions.push(...to3(a[i][0], a[i][1], z0));
    }
    for (let i = 0; i < n; i++) {
      positions.push(...to3(b[i][0], b[i][1], z1));
    }
    for (let i = 0; i < n; i++) {
      const i0 = base + i;
      const i1 = base + ((i + 1) % n);
      const j0 = base + n + i;
      const j1 = base + n + ((i + 1) % n);
      indices.push(i0, i1, j1);
      indices.push(i0, j1, j0);
    }
  }

  function skeletonLines(mapped, depths) {
    const pos = [];
    for (const t of depths) {
      const segs = transformSegments(mapped, t);
      const z = t * CUBE;
      for (let i = 0; i + 3 < segs.length; i += 4) {
        pos.push(...to3(segs[i], segs[i + 1], z), ...to3(segs[i + 2], segs[i + 3], z));
      }
    }
    return pos;
  }

  function generateSpace(flatWorld, rect) {
    const clipped = clipSegmentsToRect(flatWorld, rect);
    if (clipped.length < 8) {
      return { ok: false, reason: "The selection does not contain enough branching geometry." };
    }
    const mapped = mapToCube(clipped, rect).flat;
    const sliceContours = [];
    const sliceZ = [];
    for (let s = 0; s < SLICES; s++) {
      const t = s / (SLICES - 1);
      const segs = transformSegments(mapped, t);
      const field = sampleGrid(segs);
      const raw = traceContours(field)
        .map((p) => resampleClosed(p, CONTOUR_SAMPLES))
        .filter((p) => Math.abs(signedArea(p)) > 4);
      raw.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
      sliceContours.push(raw.slice(0, 5));
      sliceZ.push(t * CUBE);
    }

    const positions = [];
    const indices = [];
    for (let s = 0; s < SLICES; s++) {
      const cur = sliceContours[s];
      if (s === 0) {
        for (const poly of cur) addCap(positions, indices, poly, sliceZ[s], false);
      }
      if (s === SLICES - 1) {
        for (const poly of cur) addCap(positions, indices, poly, sliceZ[s], true);
      }
      if (s >= SLICES - 1) continue;
      const next = sliceContours[s + 1];
      const used = new Array(next.length).fill(false);
      for (const poly of cur) {
        const c = centroid(poly);
        let best = -1;
        let bestD = 6;
        for (let k = 0; k < next.length; k++) {
          if (used[k]) continue;
          const d = hypot2(c[0] - centroid(next[k])[0], c[1] - centroid(next[k])[1]);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
        if (best < 0) continue;
        used[best] = true;
        const aligned = alignStart(next[best], poly);
        loft(positions, indices, poly, aligned, sliceZ[s], sliceZ[s + 1]);
      }
    }

    if (indices.length < 12) {
      const hulls = [];
      for (let s = 0; s < SLICES; s++) {
        const t = s / (SLICES - 1);
        const segs = transformSegments(mapped, t);
        const hull = hullPointsFromSegs(segs);
        hulls.push(hull.length >= 3 ? resampleClosed(hull, CONTOUR_SAMPLES) : null);
      }
      if (hulls[0]) addCap(positions, indices, hulls[0], sliceZ[0], false);
      if (hulls[SLICES - 1]) addCap(positions, indices, hulls[SLICES - 1], sliceZ[SLICES - 1], true);
      for (let s = 0; s < SLICES - 1; s++) {
        if (!hulls[s] || !hulls[s + 1]) continue;
        loft(positions, indices, hulls[s], alignStart(hulls[s + 1], hulls[s]), sliceZ[s], sliceZ[s + 1]);
      }
    }

    if (indices.length < 12) {
      return { ok: false, reason: "Could not build a spatial volume from that selection." };
    }

    return {
      ok: true,
      cube: CUBE,
      positions,
      indices,
      skeleton: skeletonLines(mapped, KEY_T),
      keys: KEY_T.map((t) => t * CUBE),
    };
  }

  function makeLineGeometry(THREE, positions) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }

  function makeMeshGeometry(THREE, positions, indices) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  function cubeWire(THREE, size) {
    const h = size * 0.5;
    const g = new THREE.BufferGeometry();
    const p = [];
    const c = [
      [-h, -h, -h],
      [h, -h, -h],
      [h, h, -h],
      [-h, h, -h],
      [-h, -h, h],
      [h, -h, h],
      [h, h, h],
      [-h, h, h],
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
    for (const [a, b] of e) p.push(...c[a], ...c[b]);
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    return g;
  }

  function shiftToCenter(arr, size) {
    const h = size * 0.5;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] -= h;
      arr[i + 1] -= h;
      arr[i + 2] -= h;
    }
  }

  function createViewer(container) {
    const THREE = global.THREE;
    if (!THREE || !container) return null;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setClearColor(0x0a0a0a, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    camera.position.set(28, 22, 32);
    const controls = THREE.OrbitControls
      ? new THREE.OrbitControls(camera, renderer.domElement)
      : null;
    if (controls) {
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.target.set(0, 0, 0);
      controls.minDistance = 12;
      controls.maxDistance = 80;
    }
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const key = new THREE.DirectionalLight(0xf2efe6, 0.85);
    key.position.set(18, 26, 12);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9aa7b8, 0.35);
    fill.position.set(-16, 8, -18);
    scene.add(fill);
    const hemi = new THREE.HemisphereLight(0xe8e4dc, 0x1a1a1a, 0.35);
    scene.add(hemi);

    const cubeLines = new THREE.LineSegments(
      cubeWire(THREE, CUBE),
      new THREE.LineBasicMaterial({ color: 0xd8d4cc, transparent: true, opacity: 0.38 })
    );
    scene.add(cubeLines);

    const group = new THREE.Group();
    scene.add(group);

    function resize() {
      const w = Math.max(8, container.clientWidth);
      const h = Math.max(8, container.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    let raf = 0;
    let running = false;
    function tick() {
      if (!running) return;
      if (controls) controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }

    const viewer = {
      resize,
      start() {
        running = true;
        if (controls) controls.enabled = true;
        cancelAnimationFrame(raf);
        tick();
        resize();
      },
      stop() {
        running = false;
        cancelAnimationFrame(raf);
        if (controls) controls.enabled = false;
      },
      show(data) {
        while (group.children.length) {
          const child = group.children[0];
          group.remove(child);
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        }
        if (!data || !data.ok) return;
        const pos = data.positions.slice();
        const skel = data.skeleton.slice();
        shiftToCenter(pos, data.cube);
        shiftToCenter(skel, data.cube);
        const mesh = new THREE.Mesh(
          makeMeshGeometry(THREE, pos, data.indices),
          new THREE.MeshStandardMaterial({
            color: 0xcfc8ba,
            roughness: 0.82,
            metalness: 0.04,
            transparent: true,
            opacity: 0.52,
            side: THREE.DoubleSide,
            depthWrite: true,
          })
        );
        group.add(mesh);
        const lines = new THREE.LineSegments(
          makeLineGeometry(THREE, skel),
          new THREE.LineBasicMaterial({ color: 0xe8d5a3, transparent: true, opacity: 0.7 })
        );
        group.add(lines);
        resize();
      },
    };
    resize();
    return viewer;
  }

  global.D7Spatial3D = {
    CUBE,
    collectSegments,
    clipSegmentsToRect,
    generateSpace,
    createViewer,
  };
})(window);

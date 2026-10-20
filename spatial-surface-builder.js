/**
 * Surface Builder: selected branches → a few zero-thickness planar plates
 * → matched connection strips. 20 ft cube. 1 unit = 1 foot. Y is vertical.
 * Not a minimal-surface / Kangaroo solver.
 */
(function (global) {
  const CUBE = 20;
  const COLLINEAR = 0.94;
  const COLLINEAR_STRONG = 0.86;
  const PICK_FT = 0.42;
  const DEFAULT_WIDTH = 2;

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }
  function v(x, y, z) {
    return { x: x || 0, y: y || 0, z: z || 0 };
  }
  function add(a, b) {
    return v(a.x + b.x, a.y + b.y, a.z + b.z);
  }
  function sub(a, b) {
    return v(a.x - b.x, a.y - b.y, a.z - b.z);
  }
  function scale(a, s) {
    return v(a.x * s, a.y * s, a.z * s);
  }
  function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }
  function cross(a, b) {
    return v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }
  function len(a) {
    return Math.hypot(a.x, a.y, a.z);
  }
  function norm(a) {
    const L = len(a);
    return L > 1e-12 ? scale(a, 1 / L) : v(1, 0, 0);
  }
  function clone(p) {
    return v(p.x, p.y, p.z);
  }
  function pad3(n) {
    return String(n).padStart(3, "0");
  }
  function eqv(a, b, eps) {
    return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;
  }
  function nodeKey(p) {
    return Math.round(p.x * 1000) + "," + Math.round(p.y * 1000) + "," + Math.round(p.z * 1000);
  }

  function emptyModel() {
    return {
      version: 1,
      cube: CUBE,
      units: "feet",
      upAxis: "Y",
      box: { minx: 0, maxx: CUBE, miny: 0, maxy: CUBE, minz: 0, maxz: CUBE },
      branches: [],
      nodes: [],
      roots: [],
      planars: [],
      connections: [],
      pairs: [],
      nextSurf: 1,
      nextConn: 1,
      nextPair: 1,
    };
  }

  function simplifyPath(pts, dotMin) {
    const src = pts || [];
    if (src.length <= 2) return src.map(clone);
    const keep = [clone(src[0])];
    for (let i = 1; i < src.length - 1; i++) {
      const prev = keep[keep.length - 1];
      const cur = src[i];
      const nxt = src[i + 1];
      const d0 = norm(sub(cur, prev));
      const d1 = norm(sub(nxt, cur));
      if (dot(d0, d1) < dotMin || len(sub(cur, prev)) < 0.04) keep.push(clone(cur));
    }
    keep.push(clone(src[src.length - 1]));
    if (keep.length === 2 && len(sub(keep[1], keep[0])) < 0.04) return [keep[0]];
    return keep;
  }

  function widthAxis(dir, orient, manualDeg, flip) {
    const D = norm(dir);
    let W;
    const horiz = Math.abs(D.y) < 0.65;
    const mode = orient === "AUTO" ? (horiz ? "HORIZONTAL" : "VERTICAL") : orient;
    if (mode === "VERTICAL") {
      W = sub(v(0, 1, 0), scale(D, D.y));
      if (len(W) < 1e-8) W = v(1, 0, 0);
      else W = norm(W);
    } else if (mode === "HORIZONTAL") {
      W = cross(v(0, 1, 0), D);
      if (len(W) < 1e-8) W = v(1, 0, 0);
      else W = norm(W);
    } else {
      W = cross(v(0, 1, 0), D);
      if (len(W) < 1e-8) W = v(1, 0, 0);
      else W = norm(W);
    }
    if (mode === "MANUAL" || orient === "MANUAL") {
      const ang = ((Number(manualDeg) || 0) * Math.PI) / 180;
      const T = norm(cross(D, W));
      W = norm(add(scale(W, Math.cos(ang)), scale(T, Math.sin(ang))));
    }
    if (flip) W = scale(W, -1);
    return W;
  }

  function lineClosest(p, d, q, e) {
    const w0 = sub(p, q);
    const a = dot(d, d);
    const b = dot(d, e);
    const c = dot(e, e);
    const dp = dot(d, w0);
    const ep = dot(e, w0);
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-14) return null;
    const t = (b * ep - c * dp) / denom;
    return add(p, scale(d, t));
  }

  function limitMiter(corner, origin, maxL) {
    if (!corner) return origin;
    const d = sub(corner, origin);
    const L = len(d);
    if (L <= maxL || L < 1e-12) return corner;
    return add(origin, scale(d, maxL / L));
  }

  function transportW(d0, w0, d1) {
    const T = cross(d0, w0);
    let n = cross(T, d1);
    if (len(n) < 1e-8) {
      n = sub(w0, scale(d1, dot(w0, d1)));
      if (len(n) < 1e-8) n = widthAxis(d1, "PERPENDICULAR", 0, false);
    }
    n = norm(n);
    if (dot(n, w0) < -1e-6) n = scale(n, -1);
    return n;
  }

  function applyMat4(m, p) {
    const x = p.x;
    const y = p.y;
    const z = p.z;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const iw = w ? 1 / w : 1;
    return v(
      (m[0] * x + m[4] * y + m[8] * z + m[12]) * iw,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw
    );
  }

  function identityMat() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  function buildRibbon(path, width, offset, orient, manualDeg, flip) {
    const pts = path || [];
    if (pts.length < 2) return null;
    const hw = Math.max(0.05, Number(width) * 0.5);
    const off = Number(offset) || 0;
    const dirs = [];
    for (let i = 0; i < pts.length - 1; i++) dirs.push(norm(sub(pts[i + 1], pts[i])));
    const W = [];
    W[0] = widthAxis(dirs[0], orient, manualDeg, flip);
    for (let i = 1; i < dirs.length; i++) W[i] = transportW(dirs[i - 1], W[i - 1], dirs[i]);
    const Ls = [];
    const Rs = [];
    const Cs = [];
    for (let i = 0; i < pts.length; i++) {
      const dIn = i === 0 ? dirs[0] : dirs[i - 1];
      const dOut = i === pts.length - 1 ? dirs[dirs.length - 1] : dirs[i];
      const w0 = i === 0 ? W[0] : W[i - 1];
      const w1 = i === pts.length - 1 ? W[W.length - 1] : W[i];
      const T = norm(cross(dIn, w0));
      const P = add(pts[i], scale(T, off));
      Cs.push(P);
      let Lp;
      let Rp;
      if (dot(dIn, dOut) > COLLINEAR) {
        Lp = add(P, scale(w0, hw));
        Rp = add(P, scale(w0, -hw));
      } else {
        Lp = lineClosest(add(P, scale(w0, hw)), dIn, add(P, scale(w1, hw)), dOut);
        Rp = lineClosest(add(P, scale(w0, -hw)), dIn, add(P, scale(w1, -hw)), dOut);
        if (!Lp) Lp = add(P, scale(w0, hw));
        if (!Rp) Rp = add(P, scale(w0, -hw));
        Lp = limitMiter(Lp, P, hw * 3);
        Rp = limitMiter(Rp, P, hw * 3);
      }
      Ls.push(Lp);
      Rs.push(Rp);
    }
    const quads = [];
    for (let i = 0; i < pts.length - 1; i++) {
      quads.push({
        corners: [clone(Ls[i]), clone(Rs[i]), clone(Rs[i + 1]), clone(Ls[i + 1])],
        section: i,
      });
    }
    return { L: Ls, R: Rs, C: Cs, quads: quads };
  }

  function worldRibbon(surf) {
    const local = buildRibbon(surf.path, surf.width, surf.offset, surf.orient, surf.manualDeg, surf.flipped);
    if (!local) return null;
    const m = surf.matrix && surf.matrix.length === 16 ? surf.matrix : identityMat();
    const map = function (p) {
      return applyMat4(m, p);
    };
    const L = local.L.map(map);
    const R = local.R.map(map);
    const C = local.C.map(map);
    const quads = [];
    for (let i = 0; i < local.quads.length; i++) {
      quads.push({
        corners: local.quads[i].corners.map(map),
        section: local.quads[i].section,
      });
    }
    return { L: L, R: R, C: C, quads: quads };
  }

  function boundaryPolyline(rib, edge) {
    if (!rib) return [];
    if (edge === "start") return [rib.L[0], rib.R[0]];
    if (edge === "end") {
      const n = rib.L.length - 1;
      return [rib.L[n], rib.R[n]];
    }
    if (edge === "left") return rib.L.map(clone);
    if (edge === "right") return rib.R.map(clone);
    return [];
  }

  function polyLength(pts) {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += len(sub(pts[i], pts[i - 1]));
    return s;
  }

  function samplePolyline(pts, params) {
    if (!pts || pts.length < 2) return [];
    const total = polyLength(pts);
    const out = [];
    for (let i = 0; i < params.length; i++) {
      const t = clamp(params[i], 0, 1) * total;
      if (t <= 0) {
        out.push(clone(pts[0]));
        continue;
      }
      if (t >= total) {
        out.push(clone(pts[pts.length - 1]));
        continue;
      }
      let acc = 0;
      let hit = false;
      for (let k = 0; k < pts.length - 1; k++) {
        const seg = len(sub(pts[k + 1], pts[k]));
        if (acc + seg >= t || k === pts.length - 2) {
          const u = seg > 1e-12 ? (t - acc) / seg : 0;
          out.push(add(pts[k], scale(sub(pts[k + 1], pts[k]), clamp(u, 0, 1))));
          hit = true;
          break;
        }
        acc += seg;
      }
      if (!hit) out.push(clone(pts[pts.length - 1]));
    }
    return out;
  }

  function defaultParams(nSeg) {
    const n = Math.max(1, nSeg | 0);
    const p = [];
    for (let i = 0; i <= n; i++) p.push(i / n);
    return p;
  }

  function pathFromBranches(branches, selectedIds) {
    const segs = [];
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      if (selectedIds && selectedIds.size && !selectedIds.has(b.id)) continue;
      segs.push(b);
    }
    if (!segs.length) return null;
    const adj = new Map();
    function addE(ka, kb, seg) {
      if (!adj.has(ka)) adj.set(ka, []);
      adj.get(ka).push({ key: kb, seg: seg });
    }
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const a = v(s.ax, s.ay, s.az);
      const b = v(s.bx, s.by, s.bz);
      const ka = nodeKey(a);
      const kb = nodeKey(b);
      addE(ka, kb, s);
      addE(kb, ka, s);
    }
    function componentFrom(start) {
      const seen = new Set();
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const k = stack.pop();
        const links = adj.get(k) || [];
        for (let i = 0; i < links.length; i++) {
          if (!seen.has(links[i].key)) {
            seen.add(links[i].key);
            stack.push(links[i].key);
          }
        }
      }
      return seen;
    }
    let bestComp = null;
    const visited = new Set();
    adj.forEach(function (_links, key) {
      if (visited.has(key)) return;
      const comp = componentFrom(key);
      comp.forEach(function (k) {
        visited.add(k);
      });
      if (!bestComp || comp.size > bestComp.size) bestComp = comp;
    });
    const ends = [];
    bestComp.forEach(function (k) {
      const links = (adj.get(k) || []).filter(function (l) {
        return bestComp.has(l.key);
      });
      if (links.length <= 1) ends.push(k);
    });
    function walk(start, goal) {
      const prev = new Map();
      const q = [start];
      prev.set(start, null);
      while (q.length) {
        const k = q.shift();
        if (goal && k === goal) break;
        const links = adj.get(k) || [];
        for (let i = 0; i < links.length; i++) {
          const nk = links[i].key;
          if (!bestComp.has(nk) || prev.has(nk)) continue;
          prev.set(nk, k);
          q.push(nk);
        }
      }
      const target = goal && prev.has(goal) ? goal : null;
      if (!target && goal) return null;
      let cur = target;
      if (!cur) return null;
      const keys = [];
      while (cur) {
        keys.push(cur);
        cur = prev.get(cur);
      }
      keys.reverse();
      return keys;
    }
    function parseKey(k) {
      const p = k.split(",");
      return v(Number(p[0]) / 1000, Number(p[1]) / 1000, Number(p[2]) / 1000);
    }
    let keys = null;
    if (ends.length >= 2) {
      let best = null;
      for (let i = 0; i < ends.length; i++) {
        for (let j = i + 1; j < ends.length; j++) {
          const w = walk(ends[i], ends[j]);
          if (w && (!best || w.length > best.length)) best = w;
        }
      }
      keys = best;
    }
    if (!keys) {
      const any = bestComp.values().next().value;
      keys = [any];
      const seen = new Set(keys);
      let guard = 0;
      while (guard++ < 4000) {
        const last = keys[keys.length - 1];
        const links = adj.get(last) || [];
        let nxt = null;
        for (let i = 0; i < links.length; i++) {
          if (bestComp.has(links[i].key) && !seen.has(links[i].key)) {
            nxt = links[i].key;
            break;
          }
        }
        if (!nxt) break;
        seen.add(nxt);
        keys.push(nxt);
      }
    }
    const path = keys.map(parseKey);
    const ids = [];
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const ka = nodeKey(v(s.ax, s.ay, s.az));
      const kb = nodeKey(v(s.bx, s.by, s.bz));
      if (bestComp.has(ka) && bestComp.has(kb)) ids.push(s.id);
    }
    return { path: path, sourceBranchIds: ids };
  }

  function pathBetween(branches, startId, endId) {
    const byId = new Map();
    const adj = new Map();
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      byId.set(b.id, b);
      const ka = nodeKey(v(b.ax, b.ay, b.az));
      const kb = nodeKey(v(b.bx, b.by, b.bz));
      if (!adj.has(b.id)) adj.set(b.id, []);
      for (let j = 0; j < branches.length; j++) {
        if (i === j) continue;
        const o = branches[j];
        const oa = nodeKey(v(o.ax, o.ay, o.az));
        const ob = nodeKey(v(o.bx, o.by, o.bz));
        if (ka === oa || ka === ob || kb === oa || kb === ob) adj.get(b.id).push(o.id);
      }
    }
    const prev = new Map();
    const q = [startId];
    prev.set(startId, null);
    while (q.length) {
      const id = q.shift();
      if (id === endId) break;
      const links = adj.get(id) || [];
      for (let i = 0; i < links.length; i++) {
        if (prev.has(links[i])) continue;
        prev.set(links[i], id);
        q.push(links[i]);
      }
    }
    if (!prev.has(endId)) return null;
    const ids = [];
    let cur = endId;
    while (cur) {
      ids.push(cur);
      cur = prev.get(cur);
    }
    ids.reverse();
    return ids;
  }

  function rebuildConnection(model, pair) {
    const a = model.planars.find(function (s) {
      return s.id === pair.surfaceA;
    });
    const b = model.planars.find(function (s) {
      return s.id === pair.surfaceB;
    });
    const conn = model.connections.find(function (c) {
      return c.id === pair.connectionId;
    });
    if (!a || !b || !conn) return;
    const ra = worldRibbon(a);
    const rb = worldRibbon(b);
    if (!ra || !rb) return;
    const pa = boundaryPolyline(ra, pair.edgeA);
    const pb0 = boundaryPolyline(rb, pair.edgeB);
    if (pa.length < 2 || pb0.length < 2) return;
    const n = Math.max(1, pair.segments | 0);
    pair.params = defaultParams(n);
    const A = samplePolyline(pa, pair.params);
    let B = samplePolyline(pb0, pair.params);
    if (pair.reversed) B = B.slice().reverse();
    const quads = [];
    for (let i = 0; i < n; i++) {
      quads.push({
        corners: [A[i], A[i + 1], B[i + 1], B[i]],
        section: i,
      });
    }
    conn.quads = quads;
    conn.verticesA = A;
    conn.verticesB = B;
    conn.segments = n;
    conn.pairId = pair.id;
  }

  function rebuildPairsFor(model, surfaceId) {
    for (let i = 0; i < model.pairs.length; i++) {
      const p = model.pairs[i];
      if (p.surfaceA === surfaceId || p.surfaceB === surfaceId) rebuildConnection(model, p);
    }
  }

  function distRaySeg(origin, dir, ax, ay, az, bx, by, bz) {
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const wx = ax - origin.x;
    const wy = ay - origin.y;
    const wz = az - origin.z;
    const a = ux * ux + uy * uy + uz * uz;
    const b = ux * dir.x + uy * dir.y + uz * dir.z;
    const c = dir.x * dir.x + dir.y * dir.y + dir.z * dir.z;
    const d = ux * wx + uy * wy + uz * wz;
    const e = dir.x * wx + dir.y * wy + dir.z * wz;
    const denom = a * c - b * b;
    let sc;
    let tc;
    if (Math.abs(denom) < 1e-12) {
      sc = 0;
      tc = c > 1e-12 ? e / c : 0;
    } else {
      sc = (b * e - c * d) / denom;
      tc = (a * e - b * d) / denom;
    }
    sc = clamp(sc, 0, 1);
    if (tc < 0) tc = 0;
    const px = ax + ux * sc;
    const py = ay + uy * sc;
    const pz = az + uz * sc;
    const qx = origin.x + dir.x * tc;
    const qy = origin.y + dir.y * tc;
    const qz = origin.z + dir.z * tc;
    return { dist: Math.hypot(px - qx, py - qy, pz - qz), t: sc, x: px, y: py, z: pz };
  }

  function mount() {
    const stage = document.getElementById("sbStage");
    if (!stage || !global.THREE) return null;
    const THREE = global.THREE;
    const els = {
      status: document.getElementById("sbStatus"),
      stats: document.getElementById("sbStats"),
      selectBranch: document.getElementById("sbSelectBranch"),
      selectPath: document.getElementById("sbSelectPath"),
      clearBranchSel: document.getElementById("sbClearBranchSel"),
      createSurface: document.getElementById("sbCreateSurface"),
      surfStatus: document.getElementById("sbSurfStatus"),
      orient: document.getElementById("sbOrient"),
      manual: document.getElementById("sbManual"),
      manualVal: document.getElementById("sbManualVal"),
      manualWrap: document.getElementById("sbManualWrap"),
      width: document.getElementById("sbWidth"),
      widthVal: document.getElementById("sbWidthVal"),
      offset: document.getElementById("sbOffset"),
      offsetVal: document.getElementById("sbOffsetVal"),
      move: document.getElementById("sbMove"),
      rotate: document.getElementById("sbRotate"),
      flip: document.getElementById("sbFlip"),
      simplify: document.getElementById("sbSimplify"),
      split: document.getElementById("sbSplit"),
      del: document.getElementById("sbDelete"),
      connectMode: document.getElementById("sbConnectMode"),
      connStatus: document.getElementById("sbConnStatus"),
      createConnection: document.getElementById("sbCreateConnection"),
      connSegs: document.getElementById("sbConnSegs"),
      reverseConn: document.getElementById("sbReverseConn"),
      disconnect: document.getElementById("sbDisconnect"),
      showBranches: document.getElementById("sbShowBranches"),
      showPlanar: document.getElementById("sbShowPlanar"),
      showConn: document.getElementById("sbShowConn"),
      showEdges: document.getElementById("sbShowEdges"),
      showBox: document.getElementById("sbShowBox"),
      save: document.getElementById("sbSave"),
      saveStatus: document.getElementById("sbSaveStatus"),
      savePanel: document.getElementById("sbSavePanel"),
      saveName: document.getElementById("sbSaveName"),
      saveConfirm: document.getElementById("sbSaveConfirm"),
      saveCancel: document.getElementById("sbSaveCancel"),
      savedList: document.getElementById("sbSavedList"),
      reset: document.getElementById("sbReset"),
      exportBtn: document.getElementById("sbExport"),
      hint: document.getElementById("sbHint"),
      deleteDialog: document.getElementById("sbDeleteDialog"),
      deleteCancel: document.getElementById("sbDeleteCancel"),
      deleteConfirm: document.getElementById("sbDeleteConfirm"),
    };

    let model = emptyModel();
    let mode = "selectBranch";
    let selectedBranches = new Set();
    let pathAnchor = null;
    let selectedSurfIds = new Set();
    let selectedConnId = null;
    let edgePicks = [];
    let hoverEdge = null;
    let gizmoMode = null;
    let running = false;
    let raf = 0;
    let savedRecords = [];
    let activeSaveId = null;
    let pendingDeleteId = null;
    let viewMode = "perspective";

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 1);
    stage.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(12, 22, 8);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-10, 8, -12);
    scene.add(fill);

    const persp = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
    persp.position.set(32, 22, 32);
    persp.up.set(0, 1, 0);
    const ortho = new THREE.OrthographicCamera(-16, 16, 16, -16, -80, 200);
    ortho.up.set(0, 1, 0);
    let camera = persp;
    const target = new THREE.Vector3(10, 10, 10);
    persp.lookAt(target);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.copy(target);
    controls.minDistance = 8;
    controls.maxDistance = 90;

    const boxGroup = new THREE.Group();
    const boxGeom = new THREE.BoxGeometry(CUBE, CUBE, CUBE);
    const boxEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeom),
      new THREE.LineBasicMaterial({ color: 0x3a8aa8, transparent: true, opacity: 0.45 })
    );
    boxEdges.position.set(CUBE / 2, CUBE / 2, CUBE / 2);
    boxGroup.add(boxEdges);
    scene.add(boxGroup);

    const branchLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xc8c8c8, transparent: true, opacity: 0.85 })
    );
    scene.add(branchLines);
    const selBranchLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xc45c5c })
    );
    scene.add(selBranchLines);

    const planarGroup = new THREE.Group();
    const connGroup = new THREE.Group();
    const edgeGroup = new THREE.Group();
    const hoverGroup = new THREE.Group();
    scene.add(planarGroup);
    scene.add(connGroup);
    scene.add(edgeGroup);
    scene.add(hoverGroup);

    const planarMat = new THREE.MeshLambertMaterial({
      color: 0xf2f2f2,
      emissive: 0x222222,
      side: THREE.DoubleSide,
    });
    const planarSelMat = new THREE.MeshLambertMaterial({
      color: 0xc45c5c,
      emissive: 0x3a1010,
      side: THREE.DoubleSide,
    });
    const connMat = new THREE.MeshLambertMaterial({
      color: 0xe4d8c8,
      emissive: 0x2a2218,
      side: THREE.DoubleSide,
    });
    const connSelMat = new THREE.MeshLambertMaterial({
      color: 0xc45c5c,
      emissive: 0x3a1010,
      side: THREE.DoubleSide,
    });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.78 });
    const hoverMat = new THREE.LineBasicMaterial({ color: 0xff4d4d });

    const pivot = new THREE.Object3D();
    scene.add(pivot);
    let gizmo = null;
    if (THREE.TransformControls) {
      gizmo = new THREE.TransformControls(camera, renderer.domElement);
      gizmo.setSize(0.72);
      gizmo.enabled = false;
      gizmo.visible = false;
      gizmo.addEventListener("dragging-changed", function (event) {
        controls.enabled = !event.value;
        if (!event.value) commitGizmo();
      });
      gizmo.addEventListener("objectChange", function () {
        liveGizmo();
      });
      scene.add(gizmo);
    }

    function setStatus(msg, kind) {
      if (!els.status) return;
      els.status.textContent = msg;
      els.status.classList.toggle("active", kind === "active");
      els.status.classList.toggle("error", kind === "error");
    }

    function paintStats() {
      if (els.stats) {
        els.stats.textContent =
          "Branches: " +
          model.branches.length +
          " · Planar: " +
          model.planars.length +
          " · Connections: " +
          model.connections.length +
          " · Selected branches: " +
          selectedBranches.size;
      }
    }

    function setLines(obj, segs, colorOk) {
      const list = segs || [];
      const pos = new Float32Array(Math.max(1, list.length) * 6);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const o = i * 6;
        pos[o] = s.ax;
        pos[o + 1] = s.ay;
        pos[o + 2] = s.az;
        pos[o + 3] = s.bx;
        pos[o + 4] = s.by;
        pos[o + 5] = s.bz;
      }
      obj.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.computeBoundingSphere();
      obj.geometry = g;
      obj.visible = !!list.length && colorOk;
    }

    function disposeGroup(group) {
      while (group.children.length) {
        const ch = group.children[0];
        group.remove(ch);
        if (ch.geometry) ch.geometry.dispose();
      }
    }

    function meshFromQuads(quads) {
      const pos = [];
      const idx = [];
      for (let i = 0; i < quads.length; i++) {
        const c = quads[i].corners;
        const b = pos.length / 3;
        for (let k = 0; k < 4; k++) pos.push(c[k].x, c[k].y, c[k].z);
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      return g;
    }

    function edgeGeomFromQuads(quads) {
      const pos = [];
      for (let i = 0; i < quads.length; i++) {
        const c = quads[i].corners;
        for (let e = 0; e < 4; e++) {
          const a = c[e];
          const b = c[(e + 1) % 4];
          pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
      return g;
    }

    function rebuildScene() {
      setLines(branchLines, model.branches, els.showBranches ? els.showBranches.checked : true);
      const sel = [];
      for (let i = 0; i < model.branches.length; i++) {
        if (selectedBranches.has(model.branches[i].id)) sel.push(model.branches[i]);
      }
      setLines(selBranchLines, sel, true);
      selBranchLines.visible = sel.length > 0;
      disposeGroup(planarGroup);
      disposeGroup(connGroup);
      disposeGroup(edgeGroup);
      const showP = !els.showPlanar || els.showPlanar.checked;
      const showC = !els.showConn || els.showConn.checked;
      const showE = !els.showEdges || els.showEdges.checked;
      if (showP) {
        for (let i = 0; i < model.planars.length; i++) {
          const s = model.planars[i];
          const rib = worldRibbon(s);
          if (!rib) continue;
          s.worldQuads = rib.quads;
          s.worldL = rib.L;
          s.worldR = rib.R;
          const mesh = new THREE.Mesh(meshFromQuads(rib.quads), selectedSurfIds.has(s.id) ? planarSelMat : planarMat);
          mesh.userData.kind = "planar";
          mesh.userData.id = s.id;
          planarGroup.add(mesh);
          if (showE) {
            const lines = new THREE.LineSegments(edgeGeomFromQuads(rib.quads), edgeMat);
            edgeGroup.add(lines);
          }
        }
      }
      if (showC) {
        for (let i = 0; i < model.connections.length; i++) {
          const c = model.connections[i];
          if (!c.quads || !c.quads.length) continue;
          const mesh = new THREE.Mesh(meshFromQuads(c.quads), c.id === selectedConnId ? connSelMat : connMat);
          mesh.userData.kind = "connection";
          mesh.userData.id = c.id;
          connGroup.add(mesh);
          if (showE) {
            const lines = new THREE.LineSegments(edgeGeomFromQuads(c.quads), edgeMat);
            edgeGroup.add(lines);
          }
        }
      }
      boxGroup.visible = !els.showBox || els.showBox.checked;
      paintHover();
      paintStats();
      paintHud();
    }

    function paintHover() {
      disposeGroup(hoverGroup);
      const picks = hoverEdge ? [hoverEdge] : edgePicks;
      for (let i = 0; i < picks.length; i++) {
        const pick = picks[i];
        const surf = model.planars.find(function (s) {
          return s.id === pick.surfaceId;
        });
        if (!surf) continue;
        const rib = worldRibbon(surf);
        const poly = boundaryPolyline(rib, pick.edge);
        if (poly.length < 2) continue;
        const pos = [];
        for (let k = 0; k < poly.length - 1; k++) {
          pos.push(poly[k].x, poly[k].y, poly[k].z, poly[k + 1].x, poly[k + 1].y, poly[k + 1].z);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
        hoverGroup.add(new THREE.LineSegments(g, hoverMat));
      }
    }

    function paintHud() {
      const hasSurf = selectedSurfIds.size > 0;
      const one = selectedSurfIds.size === 1 ? model.planars.find(function (s) { return selectedSurfIds.has(s.id); }) : null;
      const conn = selectedConnId ? model.connections.find(function (c) { return c.id === selectedConnId; }) : null;
      const pair = conn ? model.pairs.find(function (p) { return p.connectionId === conn.id; }) : null;
      if (els.surfStatus) {
        if (one) els.surfStatus.textContent = one.id + " · " + (one.path.length - 1) + " quads · width " + Number(one.width).toFixed(2) + "'";
        else if (hasSurf) els.surfStatus.textContent = selectedSurfIds.size + " surfaces selected.";
        else els.surfStatus.textContent = "Click a plate in the viewport.";
      }
      if (one) {
        if (els.orient) els.orient.value = one.orient || "AUTO";
        if (els.width) {
          els.width.value = String(one.width);
          if (els.widthVal) els.widthVal.textContent = Number(one.width).toFixed(2) + "'";
        }
        if (els.offset) {
          els.offset.value = String(one.offset);
          if (els.offsetVal) els.offsetVal.textContent = Number(one.offset).toFixed(2) + "'";
        }
        if (els.manual) {
          els.manual.value = String(one.manualDeg || 0);
          if (els.manualVal) els.manualVal.textContent = String(one.manualDeg || 0) + "°";
        }
      }
      if (els.manualWrap) els.manualWrap.style.display = one && one.orient === "MANUAL" ? "" : "none";
      if (els.connStatus) {
        if (pair) {
          els.connStatus.textContent =
            pair.id + " · " + pair.surfaceA + " " + pair.edgeA + " ↔ " + pair.surfaceB + " " + pair.edgeB + " · " + pair.segments + " segs";
        } else if (edgePicks.length === 2) {
          els.connStatus.textContent =
            edgePicks[0].surfaceId + " " + edgePicks[0].edge + " + " + edgePicks[1].surfaceId + " " + edgePicks[1].edge;
        } else if (edgePicks.length === 1) {
          els.connStatus.textContent = "Edge 1: " + edgePicks[0].surfaceId + " " + edgePicks[0].edge + " · click a second edge";
        } else if (mode === "connect") {
          els.connStatus.textContent = "Click a boundary edge on surface A.";
        } else {
          els.connStatus.textContent = "No edges selected.";
        }
      }
      if (pair && els.connSegs) els.connSegs.value = String(pair.segments);
      function mark(btn, on) {
        if (!btn) return;
        btn.classList.toggle("active", on);
        btn.classList.toggle("primary", on);
        btn.classList.toggle("ghost", !on);
      }
      mark(els.selectBranch, mode === "selectBranch");
      mark(els.selectPath, mode === "selectPath");
      mark(els.connectMode, mode === "connect");
      mark(els.move, gizmoMode === "translate");
      mark(els.rotate, gizmoMode === "rotate");
      mark(els.split, mode === "split");
      if (els.createSurface) els.createSurface.disabled = selectedBranches.size < 1;
      if (els.createConnection) els.createConnection.disabled = edgePicks.length !== 2;
      if (els.exportBtn) els.exportBtn.disabled = !model.planars.length && !model.connections.length;
    }

    function pointerRay(cx, cy) {
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((cx - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((cy - rect.top) / Math.max(1, rect.height)) * 2 + 1
      );
      const rc = new THREE.Raycaster();
      rc.setFromCamera(pointer, camera);
      return rc;
    }

    function pickBranch(cx, cy) {
      const rc = pointerRay(cx, cy);
      let best = null;
      let bestD = PICK_FT;
      for (let i = 0; i < model.branches.length; i++) {
        const s = model.branches[i];
        const hit = distRaySeg(rc.ray.origin, rc.ray.direction, s.ax, s.ay, s.az, s.bx, s.by, s.bz);
        if (hit.dist < bestD) {
          bestD = hit.dist;
          best = s.id;
        }
      }
      return best;
    }

    function pickSurface(cx, cy) {
      const rc = pointerRay(cx, cy);
      const hits = rc.intersectObjects(planarGroup.children.concat(connGroup.children), false);
      if (!hits.length) return null;
      const h = hits[0].object.userData;
      return { kind: h.kind, id: h.id };
    }

    function pickEdge(cx, cy) {
      const rc = pointerRay(cx, cy);
      let best = null;
      let bestD = PICK_FT * 1.1;
      for (let i = 0; i < model.planars.length; i++) {
        const s = model.planars[i];
        const rib = worldRibbon(s);
        if (!rib) continue;
        const edges = ["start", "end", "left", "right"];
        for (let e = 0; e < edges.length; e++) {
          const poly = boundaryPolyline(rib, edges[e]);
          for (let k = 0; k < poly.length - 1; k++) {
            const a = poly[k];
            const b = poly[k + 1];
            const hit = distRaySeg(rc.ray.origin, rc.ray.direction, a.x, a.y, a.z, b.x, b.y, b.z);
            if (hit.dist < bestD) {
              bestD = hit.dist;
              best = { surfaceId: s.id, edge: edges[e], section: k };
            }
          }
        }
      }
      return best;
    }

    function createPlanarFromSelection(strong) {
      const got = pathFromBranches(model.branches, selectedBranches);
      if (!got || got.path.length < 2) {
        setStatus("Select a connected branch path first.", "error");
        return;
      }
      const path = simplifyPath(got.path, strong ? COLLINEAR_STRONG : COLLINEAR);
      if (path.length < 2) {
        setStatus("Path collapsed. Keep more of the branch.", "error");
        return;
      }
      const id = "SURFACE_" + pad3(model.nextSurf++);
      const surf = {
        id: id,
        kind: "PLANAR_SURFACE",
        sourceBranchIds: got.sourceBranchIds.slice(),
        path: path,
        orient: "AUTO",
        width: DEFAULT_WIDTH,
        offset: 0,
        manualDeg: 0,
        flipped: false,
        matrix: identityMat(),
        connectionIds: [],
      };
      model.planars.push(surf);
      selectedSurfIds = new Set([id]);
      selectedConnId = null;
      setStatus(id + " · " + (path.length - 1) + " planar quads from " + got.sourceBranchIds.length + " branches.", "active");
      rebuildScene();
    }

    function selectedPlanar() {
      if (selectedSurfIds.size !== 1) return null;
      const id = selectedSurfIds.values().next().value;
      return model.planars.find(function (s) {
        return s.id === id;
      });
    }

    function applySurfField(fn) {
      const s = selectedPlanar();
      if (!s) return;
      fn(s);
      rebuildPairsFor(model, s.id);
      rebuildScene();
    }

    function attachGizmo(kind) {
      const s = selectedPlanar();
      if (!s || !gizmo) return;
      const rib = worldRibbon(s);
      if (!rib || !rib.C.length) return;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let i = 0; i < rib.C.length; i++) {
        cx += rib.C[i].x;
        cy += rib.C[i].y;
        cz += rib.C[i].z;
      }
      const n = rib.C.length;
      pivot.position.set(cx / n, cy / n, cz / n);
      pivot.rotation.set(0, 0, 0);
      pivot.quaternion.set(0, 0, 0, 1);
      pivot.userData.surfId = s.id;
      pivot.userData.startMat = s.matrix.slice();
      pivot.userData.startPos = pivot.position.clone();
      gizmoMode = kind;
      gizmo.setMode(kind === "rotate" ? "rotate" : "translate");
      gizmo.enabled = true;
      gizmo.visible = true;
      gizmo.attach(pivot);
      if (gizmo.setCamera) gizmo.setCamera(camera);
      mode = "idle";
      paintHud();
    }

    function liveGizmo() {
      const s = model.planars.find(function (p) {
        return p.id === pivot.userData.surfId;
      });
      if (!s) return;
      const start = new THREE.Matrix4().fromArray(pivot.userData.startMat || identityMat());
      const origin = pivot.userData.startPos || pivot.position;
      if (gizmoMode === "translate") {
        const d = pivot.position.clone().sub(origin);
        const t = new THREE.Matrix4().makeTranslation(d.x, d.y, d.z);
        s.matrix = t.multiply(start).toArray();
      } else {
        const rm = new THREE.Matrix4().makeRotationFromQuaternion(pivot.quaternion);
        const to = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z);
        const from = new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z);
        s.matrix = to.multiply(rm).multiply(from).multiply(start).toArray();
      }
      rebuildPairsFor(model, s.id);
      rebuildScene();
    }

    function commitGizmo() {
      liveGizmo();
      setStatus("Transform updated. Connections stay attached.", "active");
    }

    function detachGizmo() {
      gizmoMode = null;
      if (gizmo) {
        if (gizmo.detach) gizmo.detach();
        gizmo.enabled = false;
        gizmo.visible = false;
      }
    }

    function createConnection() {
      if (edgePicks.length !== 2) return;
      const a = edgePicks[0];
      const b = edgePicks[1];
      if (a.surfaceId === b.surfaceId) {
        setStatus("Pick edges on two different surfaces.", "error");
        return;
      }
      const sa = model.planars.find(function (s) {
        return s.id === a.surfaceId;
      });
      const sb = model.planars.find(function (s) {
        return s.id === b.surfaceId;
      });
      const ra = worldRibbon(sa);
      const rb = worldRibbon(sb);
      const pa = boundaryPolyline(ra, a.edge);
      const pb = boundaryPolyline(rb, b.edge);
      const segsA = Math.max(1, pa.length - 1);
      const segsB = Math.max(1, pb.length - 1);
      const user = Math.max(1, Number(els.connSegs && els.connSegs.value) || 3);
      const segments = Math.max(user, segsA, segsB);
      const pairId = "BOUNDARY_PAIR_" + pad3(model.nextPair++);
      const connId = "CONNECTION_" + pad3(model.nextConn++);
      const pair = {
        id: pairId,
        surfaceA: a.surfaceId,
        edgeA: a.edge,
        surfaceB: b.surfaceId,
        edgeB: b.edge,
        segments: segments,
        params: defaultParams(segments),
        connectionId: connId,
        reversed: false,
      };
      const conn = {
        id: connId,
        kind: "CONNECTION_SURFACE",
        pairId: pairId,
        segments: segments,
        reversed: false,
        quads: [],
      };
      model.pairs.push(pair);
      model.connections.push(conn);
      sa.connectionIds.push(connId);
      sb.connectionIds.push(connId);
      rebuildConnection(model, pair);
      selectedConnId = connId;
      selectedSurfIds = new Set();
      edgePicks = [];
      mode = "idle";
      setStatus(connId + " · " + segments + " matching quads between " + a.surfaceId + " and " + b.surfaceId + ".", "active");
      rebuildScene();
    }

    function splitAt(pick) {
      const s = model.planars.find(function (p) {
        return p.id === pick.surfaceId;
      });
      if (!s || s.path.length < 3) {
        setStatus("Need at least two quads to split.", "error");
        return;
      }
      let idx = 1;
      if (pick.edge === "left" || pick.edge === "right") idx = clamp((pick.section || 0) + 1, 1, s.path.length - 2);
      else {
        setStatus("Click a long edge (left/right) at the split location.", "error");
        return;
      }
      const aPath = s.path.slice(0, idx + 1);
      const bPath = s.path.slice(idx);
      if (aPath.length < 2 || bPath.length < 2) return;
      s.path = aPath;
      const id = "SURFACE_" + pad3(model.nextSurf++);
      const b = {
        id: id,
        kind: "PLANAR_SURFACE",
        sourceBranchIds: s.sourceBranchIds.slice(),
        path: bPath,
        orient: s.orient,
        width: s.width,
        offset: s.offset,
        manualDeg: s.manualDeg,
        flipped: s.flipped,
        matrix: s.matrix.slice(),
        connectionIds: [],
      };
      model.planars.push(b);
      rebuildPairsFor(model, s.id);
      selectedSurfIds = new Set([s.id, b.id]);
      mode = "idle";
      setStatus("Split into " + s.id + " and " + id + ".", "active");
      rebuildScene();
    }

    function deleteSelected() {
      if (selectedConnId) {
        const pair = model.pairs.find(function (p) {
          return p.connectionId === selectedConnId;
        });
        model.connections = model.connections.filter(function (c) {
          return c.id !== selectedConnId;
        });
        model.pairs = model.pairs.filter(function (p) {
          return p.connectionId !== selectedConnId;
        });
        model.planars.forEach(function (s) {
          s.connectionIds = (s.connectionIds || []).filter(function (id) {
            return id !== selectedConnId;
          });
        });
        selectedConnId = null;
        setStatus(pair ? "Disconnected " + pair.id + "." : "Connection removed.", "active");
        rebuildScene();
        return;
      }
      if (!selectedSurfIds.size) return;
      const drop = selectedSurfIds;
      const dropConn = new Set();
      model.pairs.forEach(function (p) {
        if (drop.has(p.surfaceA) || drop.has(p.surfaceB)) dropConn.add(p.connectionId);
      });
      model.planars = model.planars.filter(function (s) {
        return !drop.has(s.id);
      });
      model.connections = model.connections.filter(function (c) {
        return !dropConn.has(c.id);
      });
      model.pairs = model.pairs.filter(function (p) {
        return !dropConn.has(p.connectionId);
      });
      selectedSurfIds = new Set();
      setStatus("Surface deleted.", "active");
      rebuildScene();
    }

    function importPayload(payload) {
      if (!payload || !payload.branches || !payload.branches.length) {
        setStatus("No branches to import.", "error");
        return false;
      }
      const have = new Set(model.branches.map(function (b) { return b.id; }));
      let added = 0;
      for (let i = 0; i < payload.branches.length; i++) {
        const b = payload.branches[i];
        const id = b.id || "branch_" + pad3(model.branches.length + 1);
        if (have.has(id)) continue;
        model.branches.push({
          id: id,
          fromId: b.fromId != null ? b.fromId : b.startNodeId,
          toId: b.toId != null ? b.toId : b.endNodeId,
          ax: b.ax,
          ay: b.ay,
          az: b.az,
          bx: b.bx,
          by: b.by,
          bz: b.bz,
          order: b.order,
          networkId: b.networkId,
          connection: !!b.connection,
        });
        have.add(id);
        added += 1;
      }
      if (payload.nodes && payload.nodes.length) {
        const nHave = new Set(model.nodes.map(function (n) { return String(n.id); }));
        for (let i = 0; i < payload.nodes.length; i++) {
          const n = payload.nodes[i];
          if (nHave.has(String(n.id))) continue;
          model.nodes.push(n);
        }
      }
      if (payload.roots) model.roots = payload.roots.slice();
      if (payload.box) model.box = payload.box;
      const newIds = [];
      for (let i = model.branches.length - added; i < model.branches.length; i++) {
        if (model.branches[i]) newIds.push(model.branches[i].id);
      }
      selectedBranches = newIds.length && newIds.length <= 32 ? new Set(newIds) : new Set();
      pathAnchor = null;
      mode = "selectBranch";
      setStatus(
        "Imported " +
          added +
          " branch" +
          (added === 1 ? "" : "es") +
          " at exact coordinates." +
          (selectedBranches.size ? " Create Surface to make one plate from this path." : " Select a path, then Create Surface."),
        "active"
      );
      rebuildScene();
      return true;
    }

    function captureSnapshot() {
      return {
        schemaVersion: 1,
        model: JSON.parse(JSON.stringify(model)),
        camera: {
          viewMode: viewMode,
          px: camera.position.x,
          py: camera.position.y,
          pz: camera.position.z,
          tx: controls.target.x,
          ty: controls.target.y,
          tz: controls.target.z,
        },
      };
    }

    function applySnapshot(snap) {
      if (!snap || !snap.model) return false;
      model = snap.model;
      if (!model.planars) model.planars = [];
      if (!model.connections) model.connections = [];
      if (!model.pairs) model.pairs = [];
      selectedBranches = new Set();
      selectedSurfIds = new Set();
      selectedConnId = null;
      edgePicks = [];
      if (snap.camera) {
        camera.position.set(snap.camera.px, snap.camera.py, snap.camera.pz);
        controls.target.set(snap.camera.tx, snap.camera.ty, snap.camera.tz);
        controls.update();
      }
      rebuildScene();
      setStatus("Loaded exact saved geometry.", "active");
      return true;
    }

    async function refreshSaves() {
      const store = global.D7SavedSurfaceBuilder;
      if (!store) return;
      try {
        savedRecords = await store.list();
      } catch (err) {
        savedRecords = [];
      }
      if (!els.savedList) return;
      els.savedList.innerHTML = "";
      for (let i = 0; i < savedRecords.length; i++) {
        const rec = savedRecords[i];
        const li = document.createElement("li");
        if (rec.id === activeSaveId) li.classList.add("selected");
        const name = document.createElement("button");
        name.type = "button";
        name.className = "ghost";
        name.textContent = rec.name || "Surface Model";
        name.addEventListener("click", function () {
          applySnapshot(rec.snapshot);
          activeSaveId = rec.id;
          refreshSaves();
        });
        const del = document.createElement("button");
        del.type = "button";
        del.className = "ghost";
        del.textContent = "Delete";
        del.addEventListener("click", function (ev) {
          ev.stopPropagation();
          pendingDeleteId = rec.id;
          if (els.deleteDialog) els.deleteDialog.classList.remove("hidden");
        });
        li.appendChild(name);
        li.appendChild(del);
        els.savedList.appendChild(li);
      }
    }

    function exportRhino() {
      const lib = global.D7SpatialExport;
      if (!lib || typeof lib.exportSurfaceBuilder3dm !== "function") {
        setStatus("Rhino export is not available.", "error");
        return;
      }
      lib
        .exportSurfaceBuilder3dm(model, "D7_Surface_Builder.3dm")
        .then(function () {
          setStatus("Exported planar plates, connections, and shared boundaries (feet).", "active");
        })
        .catch(function (err) {
          setStatus(err.message || "Export failed.", "error");
        });
    }

    function setView(modeName) {
      viewMode = modeName || "perspective";
      const dist = 28;
      const c = 10;
      const map = {
        isometric: [c + 18, c + 16, c + 18],
        perspective: [32, 22, 32],
        front: [c, c, c + dist],
        back: [c, c, c - dist],
        left: [c - dist, c, c],
        right: [c + dist, c, c],
        top: [c, c + dist, c],
        bottom: [c, c - dist, c],
      };
      const p = map[viewMode] || map.perspective;
      const useOrtho = viewMode !== "perspective" && viewMode !== "isometric";
      camera = useOrtho ? ortho : persp;
      camera.position.set(p[0], p[1], p[2]);
      camera.up.set(0, 1, 0);
      if (viewMode === "top") camera.up.set(0, 0, -1);
      if (viewMode === "bottom") camera.up.set(0, 0, 1);
      camera.lookAt(target);
      controls.object = camera;
      controls.enableRotate = !useOrtho;
      controls.update();
      if (gizmo && gizmo.setCamera) gizmo.setCamera(camera);
      document.querySelectorAll("#sbViewBar .grid3d-view-btn").forEach(function (btn) {
        const on = btn.getAttribute("data-view") === viewMode;
        btn.classList.toggle("active", on);
        btn.classList.toggle("primary", on);
      });
      resize();
    }

    function resize() {
      const w = Math.max(1, stage.clientWidth);
      const h = Math.max(1, stage.clientHeight);
      renderer.setSize(w, h, false);
      persp.aspect = w / h;
      persp.updateProjectionMatrix();
      const aspect = w / h;
      const span = 16;
      ortho.left = -span * aspect;
      ortho.right = span * aspect;
      ortho.top = span;
      ortho.bottom = -span;
      ortho.updateProjectionMatrix();
    }

    function tick() {
      if (!running) return;
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }

    function onPointerUp(event) {
      if (event.button !== 0) return;
      const shift = event.shiftKey;
      if (mode === "connect" || mode === "split") {
        const edge = pickEdge(event.clientX, event.clientY);
        if (!edge) return;
        if (mode === "split") {
          splitAt(edge);
          return;
        }
        if (!shift) {
          if (edgePicks.length >= 2) edgePicks = [];
          edgePicks.push(edge);
        } else {
          edgePicks = edgePicks.filter(function (p) {
            return !(p.surfaceId === edge.surfaceId && p.edge === edge.edge);
          });
        }
        selectedSurfIds = new Set(edgePicks.map(function (p) { return p.surfaceId; }));
        rebuildScene();
        return;
      }
      if (mode === "selectBranch" || mode === "selectPath") {
        const id = pickBranch(event.clientX, event.clientY);
        if (!id) return;
        if (mode === "selectPath") {
          if (!pathAnchor) {
            pathAnchor = id;
            selectedBranches = new Set([id]);
            setStatus("Path start set. Click the end branch.", "active");
          } else {
            const ids = pathBetween(model.branches, pathAnchor, id);
            if (!ids) {
              setStatus("No connected path between those branches.", "error");
            } else {
              selectedBranches = new Set(ids);
              setStatus("Path of " + ids.length + " branches. Create Surface when ready.", "active");
            }
            pathAnchor = null;
          }
          rebuildScene();
          return;
        }
        if (shift) {
          if (selectedBranches.has(id)) selectedBranches.delete(id);
          else selectedBranches.add(id);
        } else {
          selectedBranches = new Set([id]);
        }
        rebuildScene();
        return;
      }
      const hit = pickSurface(event.clientX, event.clientY);
      if (!hit) {
        if (!shift) {
          selectedSurfIds = new Set();
          selectedConnId = null;
          detachGizmo();
          rebuildScene();
        }
        return;
      }
      if (hit.kind === "connection") {
        selectedConnId = hit.id;
        selectedSurfIds = new Set();
        detachGizmo();
        rebuildScene();
        return;
      }
      selectedConnId = null;
      if (shift) {
        if (selectedSurfIds.has(hit.id)) selectedSurfIds.delete(hit.id);
        else selectedSurfIds.add(hit.id);
      } else {
        selectedSurfIds = new Set([hit.id]);
      }
      rebuildScene();
    }

    function onPointerMove(event) {
      if (mode === "connect" || mode === "split") {
        hoverEdge = pickEdge(event.clientX, event.clientY);
        paintHover();
      } else {
        hoverEdge = null;
      }
    }

    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointermove", onPointerMove);
    document.querySelectorAll("#sbViewBar .grid3d-view-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setView(btn.getAttribute("data-view"));
      });
    });
    if (els.selectBranch) els.selectBranch.addEventListener("click", function () {
      mode = "selectBranch";
      pathAnchor = null;
      detachGizmo();
      paintHud();
    });
    if (els.selectPath) els.selectPath.addEventListener("click", function () {
      mode = "selectPath";
      pathAnchor = null;
      detachGizmo();
      setStatus("Click a start branch, then an end branch.", "active");
      paintHud();
    });
    if (els.clearBranchSel) els.clearBranchSel.addEventListener("click", function () {
      selectedBranches = new Set();
      pathAnchor = null;
      rebuildScene();
    });
    if (els.createSurface) els.createSurface.addEventListener("click", function () {
      createPlanarFromSelection(false);
    });
    if (els.orient) els.orient.addEventListener("change", function () {
      applySurfField(function (s) {
        s.orient = els.orient.value;
      });
    });
    if (els.manual) els.manual.addEventListener("input", function () {
      if (els.manualVal) els.manualVal.textContent = els.manual.value + "°";
      applySurfField(function (s) {
        s.manualDeg = Number(els.manual.value) || 0;
      });
    });
    if (els.width) els.width.addEventListener("input", function () {
      if (els.widthVal) els.widthVal.textContent = Number(els.width.value).toFixed(2) + "'";
      applySurfField(function (s) {
        s.width = Number(els.width.value);
      });
    });
    if (els.offset) els.offset.addEventListener("input", function () {
      if (els.offsetVal) els.offsetVal.textContent = Number(els.offset.value).toFixed(2) + "'";
      applySurfField(function (s) {
        s.offset = Number(els.offset.value);
      });
    });
    if (els.move) els.move.addEventListener("click", function () {
      attachGizmo("translate");
    });
    if (els.rotate) els.rotate.addEventListener("click", function () {
      attachGizmo("rotate");
    });
    if (els.flip) els.flip.addEventListener("click", function () {
      applySurfField(function (s) {
        s.flipped = !s.flipped;
      });
    });
    if (els.simplify) els.simplify.addEventListener("click", function () {
      applySurfField(function (s) {
        s.path = simplifyPath(s.path, COLLINEAR_STRONG);
      });
    });
    if (els.split) els.split.addEventListener("click", function () {
      mode = "split";
      detachGizmo();
      setStatus("Click a left/right edge where the plate should split.", "active");
      paintHud();
    });
    if (els.del) els.del.addEventListener("click", deleteSelected);
    if (els.connectMode) els.connectMode.addEventListener("click", function () {
      mode = "connect";
      edgePicks = [];
      detachGizmo();
      setStatus("Click boundary A, then boundary B, then Create Connection.", "active");
      paintHud();
    });
    if (els.createConnection) els.createConnection.addEventListener("click", createConnection);
    if (els.connSegs) els.connSegs.addEventListener("change", function () {
      const n = Math.max(1, Number(els.connSegs.value) || 1);
      if (selectedConnId) {
        const pair = model.pairs.find(function (p) {
          return p.connectionId === selectedConnId;
        });
        if (pair) {
          pair.segments = n;
          rebuildConnection(model, pair);
          rebuildScene();
        }
      }
    });
    if (els.reverseConn) els.reverseConn.addEventListener("click", function () {
      const pair = model.pairs.find(function (p) {
        return p.connectionId === selectedConnId;
      });
      if (!pair) return;
      pair.reversed = !pair.reversed;
      rebuildConnection(model, pair);
      rebuildScene();
    });
    if (els.disconnect) els.disconnect.addEventListener("click", function () {
      if (!selectedConnId) {
        setStatus("Select a connection first.", "error");
        return;
      }
      deleteSelected();
    });
    ["showBranches", "showPlanar", "showConn", "showEdges", "showBox"].forEach(function (k) {
      if (els[k]) els[k].addEventListener("change", rebuildScene);
    });
    if (els.save) els.save.addEventListener("click", function () {
      if (els.savePanel) els.savePanel.classList.remove("hidden");
      if (els.saveName) {
        const store = global.D7SavedSurfaceBuilder;
        els.saveName.value = store ? store.nextDefaultName(savedRecords) : "Surface Model 01";
      }
    });
    if (els.saveCancel) els.saveCancel.addEventListener("click", function () {
      if (els.savePanel) els.savePanel.classList.add("hidden");
    });
    if (els.saveConfirm) els.saveConfirm.addEventListener("click", async function () {
      const store = global.D7SavedSurfaceBuilder;
      if (!store) {
        setStatus("IndexedDB is not available.", "error");
        return;
      }
      try {
        const rec = await store.put({
          id: store.createId(),
          name: (els.saveName && els.saveName.value) || store.nextDefaultName(savedRecords),
          snapshot: captureSnapshot(),
        });
        activeSaveId = rec.id;
        if (els.savePanel) els.savePanel.classList.add("hidden");
        if (els.saveStatus) els.saveStatus.textContent = "Saved exact geometry as “" + rec.name + "”.";
        await refreshSaves();
      } catch (err) {
        setStatus(err.message || "Save failed.", "error");
      }
    });
    if (els.reset) els.reset.addEventListener("click", function () {
      model = emptyModel();
      selectedBranches = new Set();
      selectedSurfIds = new Set();
      selectedConnId = null;
      edgePicks = [];
      detachGizmo();
      setStatus("Cleared. Send branches from 3D Grid Growth.", "active");
      rebuildScene();
    });
    if (els.exportBtn) els.exportBtn.addEventListener("click", exportRhino);
    if (els.deleteCancel) els.deleteCancel.addEventListener("click", function () {
      pendingDeleteId = null;
      if (els.deleteDialog) els.deleteDialog.classList.add("hidden");
    });
    if (els.deleteConfirm) els.deleteConfirm.addEventListener("click", async function () {
      const store = global.D7SavedSurfaceBuilder;
      if (store && pendingDeleteId) {
        try {
          await store.remove(pendingDeleteId);
        } catch (err) {}
      }
      pendingDeleteId = null;
      if (els.deleteDialog) els.deleteDialog.classList.add("hidden");
      await refreshSaves();
    });

    const api = {
      show() {
        running = true;
        resize();
        tick();
        refreshSaves();
      },
      hide() {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      },
      resize: resize,
      importPayload: importPayload,
      getModel: function () {
        return model;
      },
      connectEdges: function (aId, aEdge, bId, bEdge) {
        edgePicks = [
          { surfaceId: aId, edge: aEdge },
          { surfaceId: bId, edge: bEdge },
        ];
        createConnection();
        return model.connections[model.connections.length - 1] || null;
      },
      translateSurface: function (id, dx, dy, dz) {
        const s = model.planars.find(function (p) {
          return p.id === id;
        });
        if (!s) return false;
        const start = new THREE.Matrix4().fromArray(s.matrix && s.matrix.length === 16 ? s.matrix : identityMat());
        const t = new THREE.Matrix4().makeTranslation(dx || 0, dy || 0, dz || 0);
        s.matrix = t.multiply(start).toArray();
        rebuildPairsFor(model, s.id);
        rebuildScene();
        return true;
      },
    };
    global.D7SurfaceBuilder.instance = api;
    rebuildScene();
    refreshSaves();
    return api;
  }

  global.D7SurfaceBuilder = {
    CUBE: CUBE,
    mount: mount,
  };
})(window);

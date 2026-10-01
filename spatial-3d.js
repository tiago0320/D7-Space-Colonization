/**
 * 3D Space studio: place selected 2D chunks in a 20 x 20 x 20 volume
 * and convert their branch geometry into solid / void studies.
 */
(function (global) {
  const CUBE = 20;

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function disposeObject(obj) {
    if (!obj) return;
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
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
    for (const [a, b] of e) p.push(...c[a], ...c[b]);
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    return g;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function worldToFt(x, y, site) {
    return {
      x: ((x - site.x) / Math.max(1e-9, site.w)) * CUBE,
      y: ((y - site.y) / Math.max(1e-9, site.h)) * CUBE,
    };
  }

  function pointInRect(x, y, rect) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  function clipSegmentToRect(ax, ay, bx, by, rect) {
    const xmin = rect.x;
    const xmax = rect.x + rect.w;
    const ymin = rect.y;
    const ymax = rect.y + rect.h;
    const dx = bx - ax;
    const dy = by - ay;
    let t0 = 0;
    let t1 = 1;
    function clip(p, q) {
      if (Math.abs(p) < 1e-12) return q >= -1e-12;
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
    if (!clip(-dx, ax - xmin) || !clip(dx, xmax - ax) || !clip(-dy, ay - ymin) || !clip(dy, ymax - ay)) {
      return null;
    }
    if (t1 - t0 < 1e-8) return null;
    return {
      ax: ax + dx * t0,
      ay: ay + dy * t0,
      bx: ax + dx * t1,
      by: ay + dy * t1,
    };
  }

  function toLocal(xFt, yFt, bounds) {
    return {
      x: xFt - bounds.x,
      y: bounds.y + bounds.h - yFt,
      z: 0,
    };
  }

  function defaultChunkTransform(width) {
    return {
      x: clamp((CUBE - width) * 0.5, 0, CUBE),
      y: 0,
      z: 0,
      rx: 0,
      ry: 0,
      rz: 0,
      scale: 1,
      sx: 1,
      sy: 1,
    };
  }

  const SECTION_TONES = [0xd2c4a8, 0xa8c4b8, 0xa8b4d0, 0xd0b0b8, 0xc4c0a0];

  function captureChunkFromSource(source, bounds, meta) {
    const site = source && source.site;
    if (!site || !bounds || bounds.w < 0.05 || bounds.h < 0.05) return null;
    const nodes = source.nodes || [];
    const ftNodes = nodes.map((node) => {
      const ft = worldToFt(node.x, node.y, site);
      return {
        x: ft.x,
        y: ft.y,
        parentIndex: node.parentIndex,
        thickness: node.thickness,
        order: node.order || 1,
        rootId: node.rootId,
        fused: !!node.fused,
        sourceIndex: node.sourceIndex,
      };
    });

    const branches = [];
    function pushClipped(ax, ay, bx, by, props) {
      const clipped = clipSegmentToRect(ax, ay, bx, by, bounds);
      if (!clipped) return;
      const a = toLocal(clipped.ax, clipped.ay, bounds);
      const b = toLocal(clipped.bx, clipped.by, bounds);
      branches.push({
        ax: a.x,
        ay: a.y,
        az: 0,
        bx: b.x,
        by: b.y,
        bz: 0,
        thickness: props.thickness,
        order: props.order,
        rootId: props.rootId,
        source: { ax: clipped.ax, ay: clipped.ay, bx: clipped.bx, by: clipped.by },
      });
    }

    for (let i = 0; i < ftNodes.length; i++) {
      const node = ftNodes[i];
      if (node.parentIndex == null || node.parentIndex < 0) continue;
      const parent = ftNodes[node.parentIndex];
      if (!parent) continue;
      pushClipped(parent.x, parent.y, node.x, node.y, node);
    }

    for (const link of source.mergeLinks || []) {
      const a = ftNodes[link.a];
      const b = ftNodes[link.b];
      if (!a || !b) continue;
      pushClipped(a.x, a.y, b.x, b.y, {
        thickness: Math.max(a.thickness || 1, b.thickness || 1),
        order: Math.min(a.order || 1, b.order || 1),
        rootId: a.rootId,
      });
    }

    if (!branches.length) return null;

    const kept = [];
    const oldToNew = new Map();
    for (let i = 0; i < ftNodes.length; i++) {
      const node = ftNodes[i];
      if (!pointInRect(node.x, node.y, bounds)) continue;
      oldToNew.set(i, kept.length);
      const local = toLocal(node.x, node.y, bounds);
      kept.push({
        id: kept.length,
        x: local.x,
        y: local.y,
        z: 0,
        parentIndex: -1,
        thickness: node.thickness,
        order: node.order,
        rootId: node.rootId,
        fused: node.fused,
        source: { x: node.x, y: node.y },
      });
    }
    for (let i = 0; i < ftNodes.length; i++) {
      if (!oldToNew.has(i)) continue;
      const node = ftNodes[i];
      const rec = kept[oldToNew.get(i)];
      rec.parentIndex = oldToNew.has(node.parentIndex) ? oldToNew.get(node.parentIndex) : -1;
    }

    const segments = [];
    const seenSeg = new Set();
    function addSegment(a, b, order, thickness, rootId) {
      if (a == null || b == null || a < 0 || b < 0 || a === b) return;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seenSeg.has(key)) return;
      seenSeg.add(key);
      segments.push({ a, b, startNodeId: a, endNodeId: b, id: `${a}:${b}`, order: order || 1, thickness, rootId });
    }
    for (let i = 0; i < kept.length; i++) {
      addSegment(kept[i].parentIndex, i, kept[i].order, kept[i].thickness, kept[i].rootId);
    }
    for (const link of source.mergeLinks || []) {
      if (!oldToNew.has(link.a) || !oldToNew.has(link.b)) continue;
      const ia = oldToNew.get(link.a);
      const ib = oldToNew.get(link.b);
      const na = kept[ia];
      const nb = kept[ib];
      addSegment(ia, ib, Math.min(na.order || 1, nb.order || 1), Math.max(na.thickness || 1, nb.thickness || 1), na.rootId);
    }

    const roots = [];
    for (const root of source.roots || []) {
      const ft = worldToFt(root.x, root.y, site);
      if (!pointInRect(ft.x, ft.y, bounds)) continue;
      const local = toLocal(ft.x, ft.y, bounds);
      roots.push({
        id: root.id,
        x: local.x,
        y: local.y,
        z: 0,
        source: { x: ft.x, y: ft.y },
      });
    }

    const attractors = [];
    for (const p of source.attractors || []) {
      const ft = worldToFt(p.x, p.y, site);
      if (!pointInRect(ft.x, ft.y, bounds)) continue;
      const local = toLocal(ft.x, ft.y, bounds);
      attractors.push({ x: local.x, y: local.y, z: 0, source: { x: ft.x, y: ft.y } });
    }

    const index = meta.index;
    return {
      id: meta.id,
      index,
      label: meta.label || `Chunk ${pad2(index)}`,
      bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
      width: bounds.w,
      height: bounds.h,
      branches,
      nodes: kept,
      segments,
      roots,
      attractors,
      hierarchy: kept.map((node, i) => ({
        index: i,
        parentIndex: node.parentIndex,
        rootId: node.rootId,
        order: node.order,
      })),
      sourceBounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
      transform: defaultChunkTransform(bounds.w),
    };
  }

  function cloneChunk(chunk, meta) {
    const copy = JSON.parse(JSON.stringify(chunk));
    copy.id = meta.id;
    copy.index = meta.index;
    copy.label = meta.label || `Chunk ${pad2(meta.index)}`;
    copy.transform = {
      x: clamp(chunk.transform.x + 0.8, 0, CUBE),
      y: chunk.transform.y,
      z: clamp(chunk.transform.z + 0.8, 0, CUBE),
      rx: chunk.transform.rx,
      ry: chunk.transform.ry,
      rz: chunk.transform.rz,
      scale: chunk.transform.scale,
      sx: chunk.transform.sx != null ? chunk.transform.sx : 1,
      sy: chunk.transform.sy != null ? chunk.transform.sy : 1,
    };
    copy.loftSetId = null;
    return copy;
  }

  function ensureGraphIds(chunk) {
    if (!chunk) return chunk;
    (chunk.nodes || []).forEach((node, i) => {
      if (node.id == null) node.id = i;
      if (node.z == null) node.z = 0;
    });
    (chunk.segments || []).forEach((seg, i) => {
      if (seg.a == null && seg.startNodeId != null) seg.a = seg.startNodeId;
      if (seg.b == null && seg.endNodeId != null) seg.b = seg.endNodeId;
      seg.startNodeId = seg.a;
      seg.endNodeId = seg.b;
      if (seg.id == null) seg.id = `${seg.a}:${seg.b}:${i}`;
    });
    return chunk;
  }

  function nodeById(chunk, id) {
    return (chunk.nodes || []).find((n) => n.id === id) || null;
  }

  function rebuildBranchesFromGraph(chunk) {
    if (!chunk) return;
    ensureGraphIds(chunk);
    const byId = new Map((chunk.nodes || []).map((n) => [n.id, n]));
    const branches = [];
    for (const seg of chunk.segments || []) {
      const a = byId.get(seg.a);
      const b = byId.get(seg.b);
      if (!a || !b) continue;
      branches.push({
        ax: a.x,
        ay: a.y,
        az: a.z || 0,
        bx: b.x,
        by: b.y,
        bz: b.z || 0,
        thickness: seg.thickness,
        order: seg.order,
        rootId: seg.rootId,
      });
    }
    chunk.branches = branches;
  }

  function createViewer(container) {
    const THREE = global.THREE;
    if (!THREE || !container) return null;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const workspaceCenter = new THREE.Vector3(CUBE * 0.5, CUBE * 0.5, CUBE * 0.5);
    const perspectiveCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    let activeCamera = perspectiveCamera;
    let viewMode = "perspective";
    let capturingPng = false;
    let capturingTurntable = false;
    let turntablePreview = null;
    let turntableLock = false;
    let turntableCamera = null;
    let turntableSquareCam = null;
    const TURNTABLE_MARGIN = 1.04;
    const turntablePivot = new THREE.Vector3();
    const turntableChildren = [];
    let silhouetteMode = false;
    let silhouetteThickness = 3;
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

    function isLockedParallel(mode) {
      return usesOrtho(mode);
    }

    function viewDirection(mode) {
      const d = viewDirections[mode];
      return d ? d.clone().normalize() : viewDirections.isometric.clone().normalize();
    }

    function setCameraUpForDirection(cam, dir) {
      const d = dir.clone().normalize();
      if (Math.abs(d.y) > 0.95) {
        cam.up.set(0, 0, d.y > 0 ? -1 : 1);
      } else {
        cam.up.set(0, 1, 0);
      }
    }

    function frameOrthoToWorkspace(cam, dir, aspect, margin) {
      const m = margin != null ? margin : 1.08;
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
      for (let xi = 0; xi <= 1; xi++) {
        for (let yi = 0; yi <= 1; yi++) {
          for (let zi = 0; zi <= 1; zi++) {
            const p = new THREE.Vector3(xi ? CUBE : 0, yi ? CUBE : 0, zi ? CUBE : 0).applyMatrix4(inv);
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
            minZ = Math.min(minZ, p.z);
          }
        }
      }
      let halfW = ((maxX - minX) * m) / 2;
      let halfH = ((maxY - minY) * m) / 2;
      if (halfW / Math.max(halfH, 1e-6) > aspect) {
        halfH = halfW / aspect;
      } else {
        halfW = halfH * aspect;
      }
      cam.left = -halfW;
      cam.right = halfW;
      cam.top = halfH;
      cam.bottom = -halfH;
      cam.near = Math.max(0.1, -minZ - CUBE);
      cam.far = Math.max(cam.near + 1, -minZ + CUBE * 4);
      cam.zoom = 1;
      cam.updateProjectionMatrix();
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
      if (isLockedParallel(mode)) {
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
      if (transform) transform.camera = activeCamera;
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
      if (reset && usesOrtho(mode)) {
        const w = Math.max(8, container.clientWidth);
        const h = Math.max(8, container.clientHeight);
        frameOrthoToWorkspace(orthoCamera, viewDirection(mode), w / h);
        if (controls) {
          controls.object = activeCamera;
          controls.target.copy(workspaceCenter);
        }
      }
    }

    const controls = THREE.OrbitControls
      ? new THREE.OrbitControls(perspectiveCamera, renderer.domElement)
      : null;
    if (controls) {
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = true;
      controls.screenSpacePanning = true;
      controls.minDistance = 8;
      controls.maxDistance = 90;
      if (THREE.MOUSE) {
        controls.mouseButtons = {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        };
      }
    }

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xf4f1ea, 0.72);
    key.position.set(18, 28, 14);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xb8c0cc, 0.32);
    fill.position.set(-12, 8, -16);
    scene.add(fill);

    const cube = new THREE.LineSegments(
      cubeWire(THREE, CUBE),
      new THREE.LineBasicMaterial({ color: 0xd8d4cc, transparent: true, opacity: 0.38 })
    );
    cube.name = "workspaceBound";
    cube.userData.workspaceBound = true;
    scene.add(cube);

    const turntableGroup = new THREE.Group();
    turntableGroup.name = "turntable";
    const chunksGroup = new THREE.Group();
    const sectionsGroup = new THREE.Group();
    const massesGroup = new THREE.Group();
    const loftGroup = new THREE.Group();
    const voxelsGroup = new THREE.Group();
    const handlesGroup = new THREE.Group();
    scene.add(turntableGroup);
    turntableGroup.add(chunksGroup);
    turntableGroup.add(sectionsGroup);
    turntableGroup.add(massesGroup);
    turntableGroup.add(loftGroup);
    turntableGroup.add(voxelsGroup);
    scene.add(handlesGroup);
    turntableChildren.push(chunksGroup, sectionsGroup, massesGroup, loftGroup, voxelsGroup);

    const silFillMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
      transparent: false,
    });
    const PlaneGeomSil = THREE.PlaneBufferGeometry || THREE.PlaneGeometry;
    const occRT = new THREE.WebGLRenderTarget(8, 8, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      stencilBuffer: false,
      depthBuffer: true,
    });
    if (occRT.texture) {
      occRT.texture.generateMipmaps = false;
      occRT.texture.minFilter = THREE.NearestFilter;
      occRT.texture.magFilter = THREE.NearestFilter;
    }
    const silUniforms = {
      tOccupancy: { value: occRT.texture },
      uResolution: { value: new THREE.Vector2(8, 8) },
      uThickness: { value: 3 },
      uTransparentBg: { value: 0 },
      uOutline: { value: new THREE.Color(0xff0000) },
      uFill: { value: new THREE.Color(0x000000) },
      uBg: { value: new THREE.Color(0x000000) },
    };
    const silMat = new THREE.ShaderMaterial({
      uniforms: silUniforms,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      vertexShader: [
        "varying vec2 vUv;",
        "void main() {",
        "  vUv = uv;",
        "  gl_Position = vec4(position.xy, 0.0, 1.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform sampler2D tOccupancy;",
        "uniform vec2 uResolution;",
        "uniform float uThickness;",
        "uniform float uTransparentBg;",
        "uniform vec3 uOutline;",
        "varying vec2 vUv;",
        "float occAt(vec2 uv) {",
        "  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;",
        "  vec4 t = texture2D(tOccupancy, uv);",
        "  return max(t.a, max(t.r, max(t.g, t.b)));",
        "}",
        "void main() {",
        "  vec2 texel = 1.0 / max(uResolution, vec2(1.0));",
        "  float occ = occAt(vUv);",
        "  float dilated = occ;",
        "  float neighbor = occ;",
        "  float radius = max(1.0, uThickness);",
        "  for (int i = 1; i <= 8; i++) {",
        "    float fi = float(i);",
        "    if (fi > radius + 0.01) break;",
        "    dilated = max(dilated, occAt(vUv + vec2(fi, 0.0) * texel));",
        "    dilated = max(dilated, occAt(vUv + vec2(-fi, 0.0) * texel));",
        "    dilated = max(dilated, occAt(vUv + vec2(0.0, fi) * texel));",
        "    dilated = max(dilated, occAt(vUv + vec2(0.0, -fi) * texel));",
        "    dilated = max(dilated, occAt(vUv + vec2(fi, fi) * texel));",
        "    dilated = max(dilated, occAt(vUv + vec2(-fi, fi) * texel));",
        "    dilated = max(dilated, occAt(vUv + vec2(fi, -fi) * texel));",
        "    dilated = max(dilated, occAt(vUv + vec2(-fi, -fi) * texel));",
        "    if (fi < 1.51) {",
        "      neighbor = min(neighbor, occAt(vUv + vec2(fi, 0.0) * texel));",
        "      neighbor = min(neighbor, occAt(vUv + vec2(-fi, 0.0) * texel));",
        "      neighbor = min(neighbor, occAt(vUv + vec2(0.0, fi) * texel));",
        "      neighbor = min(neighbor, occAt(vUv + vec2(0.0, -fi) * texel));",
        "    }",
        "  }",
        "  float outside = (1.0 - step(0.5, occ)) * step(0.5, dilated);",
        "  float rim = step(0.5, occ) * (1.0 - step(0.5, neighbor));",
        "  float outline = max(outside, rim);",
        "  if (outline < 0.5) discard;",
        "  gl_FragColor = vec4(uOutline, 1.0);",
        "}",
      ].join("\n"),
    });
    const silScene = new THREE.Scene();
    const silCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const silQuad = new THREE.Mesh(new PlaneGeomSil(2, 2), silMat);
    silQuad.frustumCulled = false;
    silScene.add(silQuad);

    const chunkMeshes = new Map();
    const sectionMeshes = new Map();
    const massMeshes = new Map();
    let loftRec = null;
    let voxelRec = null;
    let voxelCells = [];
    let voxelResolution = 20;
    let voxelsVisible = true;
    let voxelOpacity = 1;
    let voxelColorBySize = false;
    let voxelEdges = true;
    const VoxelBoxGeom = THREE.BoxBufferGeometry || THREE.BoxGeometry;
    const voxelBoxGeom = new VoxelBoxGeom(1, 1, 1);
    let sourceBranchesVisible = true;
    let sourcePlanesVisible = false;
    let sourceChunksVisible = true;
    let sectionLayersVisible = true;
    let loftLinesVisible = true;
    let loftSolidsVisible = true;
    let massesVisible = true;
    let sectionCutEnabled = false;
    let massOpacity = 1;
    let loftOpacity = 1;
    let massWireframe = false;
    let editBranches = false;
    let selectedSectionId = null;
    let selectedNodeIds = [];
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let gizmoMode = "translate";
    let onSelect = null;
    let onTransform = null;
    let onSectionSelect = null;
    let onSectionTransform = null;
    let onGizmoDragEnd = null;
    let onNodeSelect = null;
    let onNodeMove = null;
    let onNodeDragEnd = null;
    let selectedChunkId = null;
    let pointerDown = null;
    let skipPick = false;
    let nodeDrag = null;
    let isTransformDragging = false;
    let isUIInteracting = false;
    let editLines = false;
    let editAxis = "free";
    let boxSelectMode = false;
    let moveSegmentMode = false;
    let editNodeIds = [];
    let editSegIds = [];
    let onLineSelect = null;
    let onLineEdit = null;
    let liveChunk = null;
    let lineDrag = null;
    const editPivot = new THREE.Object3D();
    editPivot.name = "editPivot";
    scene.add(editPivot);
    const SphereGeomEdit = THREE.SphereBufferGeometry || THREE.SphereGeometry;
    const editSphereGeom = new SphereGeomEdit(0.08, 10, 8);
    const editMatIdle = new THREE.MeshBasicMaterial({ color: 0xb8b4ac, depthTest: false });
    const editMatSel = new THREE.MeshBasicMaterial({ color: 0xe8d5a3, depthTest: false });
    const editLineIdle = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: true });
    const editLineSel = new THREE.LineBasicMaterial({ color: 0xe8d5a3, depthTest: false });
    const boxSelectEl = document.createElement("div");
    boxSelectEl.className = "space3d-box-select";
    container.appendChild(boxSelectEl);
    let boxDrag = null;
    let editSnapshot = null;

    function syncOrbitEnabled() {
      if (!controls) return;
      controls.enabled = !isTransformDragging && !nodeDrag && !isUIInteracting && !lineDrag && !boxDrag && !turntableLock;
      applyOrbitPolicy(viewMode);
    }

    function isViewportPointer(event) {
      return event && event.target === renderer.domElement;
    }

    function endTransformPointer() {
      if (!transform) return;
      try {
        transform.domElement.ownerDocument.removeEventListener("pointermove", transform._onPointerMove);
      } catch (err) {}
      transform.domElement.style.touchAction = "";
      if (transform.dragging) transform.dragging = false;
      transform.axis = null;
      isTransformDragging = false;
    }

    function beginUiInteraction() {
      isUIInteracting = true;
      endTransformPointer();
      skipPick = false;
      pointerDown = null;
      if (nodeDrag) {
        nodeDrag = null;
        if (typeof onNodeDragEnd === "function") onNodeDragEnd();
      }
      syncOrbitEnabled();
    }

    function endUiInteraction() {
      isUIInteracting = false;
      syncOrbitEnabled();
    }

    const transform =
      THREE.TransformControls ? new THREE.TransformControls(activeCamera, renderer.domElement) : null;
    if (transform) {
      transform.setSize(0.85);
      transform.setSpace("local");
      transform.addEventListener("dragging-changed", (event) => {
        isTransformDragging = !!event.value;
        if (event.value) skipPick = true;
        syncOrbitEnabled();
      });
      transform.addEventListener("mouseDown", () => {
        skipPick = true;
        if (editLines) {
          captureEditSnapshot();
          if (typeof onLineEdit === "function") onLineEdit("begin");
        }
      });
      transform.addEventListener("mouseUp", () => {
        isTransformDragging = false;
        syncOrbitEnabled();
        if (editLines && typeof onLineEdit === "function") onLineEdit("commit");
        if (typeof onGizmoDragEnd === "function") onGizmoDragEnd();
      });
      transform.addEventListener("objectChange", () => {
        if (isUIInteracting) return;
        const object = transform.object;
        if (!object) return;
        if (editLines && object === editPivot) {
          applyEditPivotChange();
          return;
        }
        if (gizmoMode === "scale") {
          const s = Math.max(0.05, object.scale.x);
          if (object.userData.kind === "section") {
            const sx = object.userData.sx || 1;
            const sy = object.userData.sy || 1;
            object.scale.set(s * sx, s * sy, s);
          } else {
            object.scale.set(s, s, s);
          }
        }
        if (object.userData.kind === "section" && typeof onSectionTransform === "function") {
          onSectionTransform(object.userData.sectionId, readSectionTransform(object));
        } else if (object.userData.chunkId && typeof onTransform === "function") {
          onTransform(object.userData.chunkId, readObjectTransform(object));
        }
      });
      const originalPointerDown = transform._onPointerDown;
      const originalPointerUp = transform._onPointerUp;
      if (originalPointerDown) {
        transform.domElement.removeEventListener("pointerdown", originalPointerDown);
        transform._onPointerDown = function (event) {
          if (!transform.enabled || isUIInteracting) return;
          if (!isViewportPointer(event)) return;
          if (!transform.object || transform.dragging) return;
          transform.pointerHover(transform._getPointer(event));
          if (transform.axis == null) return;
          originalPointerDown.call(transform, event);
        };
        transform.domElement.addEventListener("pointerdown", transform._onPointerDown);
      }
      if (originalPointerUp) {
        transform.domElement.ownerDocument.removeEventListener("pointerup", originalPointerUp);
        transform._onPointerUp = function (event) {
          originalPointerUp.call(transform, event);
          try {
            transform.domElement.ownerDocument.removeEventListener("pointermove", transform._onPointerMove);
          } catch (err) {}
          if (!transform.dragging) {
            isTransformDragging = false;
            syncOrbitEnabled();
          }
        };
        transform.domElement.ownerDocument.addEventListener("pointerup", transform._onPointerUp);
      }
      scene.add(transform);
    }

    function deg(rad) {
      return (rad * 180) / Math.PI;
    }

    function rad(angle) {
      return (angle * Math.PI) / 180;
    }

    function readObjectTransform(object) {
      return {
        x: object.position.x,
        y: object.position.y,
        z: object.position.z,
        rx: deg(object.rotation.x),
        ry: deg(object.rotation.y),
        rz: deg(object.rotation.z),
        scale: object.scale.x,
      };
    }

    function applyObjectTransform(object, t) {
      object.position.set(t.x, t.y, t.z);
      object.rotation.set(rad(t.rx || 0), rad(t.ry || 0), rad(t.rz || 0));
      const s = Math.max(0.05, Number(t.scale) || 1);
      object.scale.set(s, s, s);
    }

    function readSectionTransform(object) {
      const offset = Number(object.userData.offset) || 0;
      const sx = object.userData.sx || 1;
      const sy = object.userData.sy || 1;
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion).normalize();
      const pos = object.position.clone().addScaledVector(n, -offset);
      const us = object.scale.z || object.scale.x / Math.max(1e-6, sx);
      return {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        rx: deg(object.rotation.x),
        ry: deg(object.rotation.y),
        rz: deg(object.rotation.z),
        scale: Math.max(0.05, us),
        sx,
        sy,
      };
    }

    function applySectionObject(object, section) {
      const lib = global.D7SpatialLoft;
      if (!lib) return;
      const place = lib.sectionPlacement(THREE, section);
      object.position.copy(place.position);
      object.quaternion.copy(place.quaternion);
      object.scale.copy(place.scale);
      object.userData.offset = Number(section.offset) || 0;
      object.userData.sx = section.transform.sx != null ? section.transform.sx : 1;
      object.userData.sy = section.transform.sy != null ? section.transform.sy : 1;
    }

    function resetCamera() {
      applyViewMode(viewMode, { reset: true });
    }

    function resize() {
      if (capturingPng || capturingTurntable) return;
      const w = Math.max(8, container.clientWidth);
      const h = Math.max(8, container.clientHeight);
      const aspect = w / Math.max(1, h);
      renderer.setSize(w, h, false);
      if (turntablePreview && turntableSquareCam && turntableCamera) {
        containTurntableCamera(turntableCamera, turntableSquareCam, aspect);
        return;
      }
      perspectiveCamera.aspect = aspect;
      perspectiveCamera.updateProjectionMatrix();
      if (usesOrtho(viewMode)) {
        frameOrthoToWorkspace(orthoCamera, viewDirection(viewMode), aspect);
        syncControlsCamera();
      }
    }

    function disposeChunkMesh(id) {
      const rec = chunkMeshes.get(id);
      if (!rec) return;
      if (transform && transform.object === rec.group) transform.detach();
      chunksGroup.remove(rec.group);
      rec.group.traverse(disposeObject);
      chunkMeshes.delete(id);
      removeMass(id);
    }

    function applySourceVisibility(group) {
      group.traverse((obj) => {
        if (obj.userData.sourceBranch) obj.visible = sourceBranchesVisible;
        if (obj.userData.sourcePlane) obj.visible = sourcePlanesVisible;
      });
    }

    function refreshSourceVisibility() {
      for (const rec of chunkMeshes.values()) {
        rec.group.visible = sourceChunksVisible;
        if (rec.group.visible) applySourceVisibility(rec.group);
      }
    }

    function slabPlanes(chunk) {
      const helper = global.D7SpatialMass && global.D7SpatialMass.sourcePlaneWorld;
      if (!helper || !chunk) return [];
      const { point, normal } = helper(THREE, chunk.transform, chunk.width, chunk.height);
      const half = 0.16;
      const np = normal.dot(point);
      return [
        new THREE.Plane(normal.clone().multiplyScalar(-1), np + half),
        new THREE.Plane(normal.clone(), -np + half),
      ];
    }

    function removeMass(id) {
      const rec = massMeshes.get(id);
      if (!rec) return;
      if (rec.wire) {
        massesGroup.remove(rec.wire);
        disposeObject(rec.wire);
      }
      massesGroup.remove(rec.mesh);
      rec.mesh.traverse(disposeObject);
      massMeshes.delete(id);
    }

    function rebuildMassWire(rec) {
      if (!rec) return;
      if (rec.wire) {
        massesGroup.remove(rec.wire);
        disposeObject(rec.wire);
        rec.wire = null;
      }
      if (!massWireframe || !rec.mesh) return;
      const EdgesGeom = THREE.EdgesGeometry;
      if (!EdgesGeom) return;
      rec.wire = new THREE.LineSegments(
        new EdgesGeom(rec.mesh.geometry, 28),
        new THREE.LineBasicMaterial({ color: 0x8a8680, transparent: true, opacity: 0.7 })
      );
      massesGroup.add(rec.wire);
    }

    function setMassWireframe(enabled) {
      massWireframe = !!enabled;
      for (const rec of massMeshes.values()) rebuildMassWire(rec);
      if (loftRec) {
        if (loftRec.wire) {
          loftGroup.remove(loftRec.wire);
          disposeObject(loftRec.wire);
          loftRec.wire = null;
        }
        if (massWireframe && loftRec.mesh) {
          const EdgesGeom = THREE.EdgesGeometry;
          if (EdgesGeom) {
            loftRec.wire = new THREE.LineSegments(
              new EdgesGeom(loftRec.mesh.geometry, 28),
              new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.7 })
            );
            loftGroup.add(loftRec.wire);
          }
        }
      }
      applyLoftWireVisibility();
      applyMassOverlayVisibility();
    }

    function applyMassOpacity(mat, opacity) {
      const o = Math.max(0.1, Math.min(1, opacity));
      mat.opacity = o;
      mat.transparent = o < 0.999;
      mat.depthWrite = o > 0.94;
      mat.needsUpdate = true;
    }

    function setMassOpacity(opacity) {
      massOpacity = Math.max(0.1, Math.min(1, opacity));
      for (const rec of massMeshes.values()) applyMassOpacity(rec.material, massOpacity);
    }

    function setLoftOpacity(opacity) {
      loftOpacity = Math.max(0.1, Math.min(1, opacity));
      if (loftRec) applyMassOpacity(loftRec.material, loftOpacity);
    }

    function setMass(id, geometry, chunk, opacity) {
      removeMass(id);
      if (!geometry) return null;
      const mat = new THREE.MeshStandardMaterial({
        color: 0xe6e2da,
        roughness: 0.78,
        metalness: 0.02,
        side: THREE.DoubleSide,
        flatShading: false,
      });
      applyMassOpacity(mat, opacity != null ? opacity : massOpacity);
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.userData.chunkId = id;
      mesh.userData.mass = true;
      massesGroup.add(mesh);
      const rec = { mesh, material: mat };
      massMeshes.set(id, rec);
      rebuildMassWire(rec);
      applySilhouetteMaterials();
      applyMassOverlayVisibility();
      return rec;
    }

    function applyMassOverlayVisibility() {
      const showMesh = massesVisible && !voxelsCovering();
      for (const rec of massMeshes.values()) {
        rec.mesh.visible = showMesh;
        if (rec.wire) rec.wire.visible = showMesh && massWireframe && !silhouetteMode;
      }
    }

    function setMassVisible(visible) {
      massesVisible = !!visible;
      applyMassOverlayVisibility();
    }

    function applyVoxelOpacity(mat, opacity) {
      const o = Math.max(0.1, Math.min(1, opacity));
      mat.opacity = o;
      mat.transparent = o < 0.999;
      mat.depthWrite = true;
      mat.needsUpdate = true;
    }

    function writeVoxelInstances(mesh, cells, resolution, colorBySize) {
      const cell = CUBE / Math.max(1, resolution);
      const dummy = new THREE.Object3D();
      const cSmall = new THREE.Color(0xe6e2da);
      const cMed = new THREE.Color(0xcfc8bc);
      const cLarge = new THREE.Color(0xb7b0a4);
      const cBase = new THREE.Color(0xffffff);
      for (let i = 0; i < cells.length; i++) {
        const size = Math.max(1, Number(cells[i].size) || 1);
        const ix = Number(cells[i].ix) || 0;
        const iy = Number(cells[i].iy) || 0;
        const iz = Number(cells[i].iz) || 0;
        const scale = cell * size;
        dummy.position.set((ix + size * 0.5) * cell, (iy + size * 0.5) * cell, (iz + size * 0.5) * cell);
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (mesh.setColorAt) {
          const col = colorBySize ? (size >= 3 ? cLarge : size >= 2 ? cMed : cSmall) : cBase;
          mesh.setColorAt(i, col);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    function voxelCellKey(x, y, z) {
      return `${x},${y},${z}`;
    }

    function buildOccupiedVoxelSet(cells) {
      const occ = new Set();
      for (let i = 0; i < cells.length; i++) {
        const size = Math.max(1, Number(cells[i].size) || 1);
        const ix = Number(cells[i].ix) || 0;
        const iy = Number(cells[i].iy) || 0;
        const iz = Number(cells[i].iz) || 0;
        for (let z = 0; z < size; z++) {
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              occ.add(voxelCellKey(ix + x, iy + y, iz + z));
            }
          }
        }
      }
      return occ;
    }

    const VOXEL_FACE_DIRS = [
      { dx: 1, dy: 0, dz: 0, corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
      { dx: -1, dy: 0, dz: 0, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
      { dx: 0, dy: 1, dz: 0, corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] },
      { dx: 0, dy: -1, dz: 0, corners: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]] },
      { dx: 0, dy: 0, dz: 1, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
      { dx: 0, dy: 0, dz: -1, corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
    ];

    function buildVoxelEdgeGeometry(cells, resolution) {
      const cell = CUBE / Math.max(1, resolution);
      const occ = buildOccupiedVoxelSet(cells);
      const edgeKeys = new Set();
      const positions = [];
      const addEdge = (ax, ay, az, bx, by, bz) => {
        const a = `${ax},${ay},${az}`;
        const b = `${bx},${by},${bz}`;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (edgeKeys.has(key)) return;
        edgeKeys.add(key);
        positions.push(ax * cell, ay * cell, az * cell, bx * cell, by * cell, bz * cell);
      };
      occ.forEach((key) => {
        const parts = key.split(",");
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        const z = Number(parts[2]);
        for (let f = 0; f < VOXEL_FACE_DIRS.length; f++) {
          const face = VOXEL_FACE_DIRS[f];
          if (occ.has(voxelCellKey(x + face.dx, y + face.dy, z + face.dz))) continue;
          const c = face.corners;
          for (let e = 0; e < 4; e++) {
            const p0 = c[e];
            const p1 = c[(e + 1) % 4];
            addEdge(x + p0[0], y + p0[1], z + p0[2], x + p1[0], y + p1[1], z + p1[2]);
          }
        }
      });
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      return geom;
    }

    function disposeVoxelRec() {
      if (!voxelRec) return;
      if (voxelRec.wire) {
        voxelsGroup.remove(voxelRec.wire);
        if (voxelRec.wire.geometry) voxelRec.wire.geometry.dispose();
        if (voxelRec.wire.material) voxelRec.wire.material.dispose();
      }
      voxelsGroup.remove(voxelRec.mesh);
      if (voxelRec.material) voxelRec.material.dispose();
      voxelRec = null;
    }

    function voxelsCovering() {
      return !!(voxelsVisible && voxelRec);
    }

    function applyLoftWireVisibility() {
      if (loftRec && loftRec.wire) {
        loftRec.wire.visible = !!(massWireframe && loftSolidsVisible && !voxelsCovering() && !silhouetteMode);
      }
    }

    function applyLoftOverlayVisibility() {
      const cover = voxelsCovering();
      if (loftGroup) loftGroup.visible = !cover && loftSolidsVisible;
      if (loftRec && loftRec.mesh) loftRec.mesh.visible = !cover && loftSolidsVisible;
      applyLoftWireVisibility();
    }

    function applyVoxelEdgeVisibility() {
      if (voxelRec && voxelRec.wire) {
        voxelRec.wire.visible = !!(voxelsVisible && (silhouetteMode || voxelEdges));
      }
    }

    function rememberMaterialLook(mat) {
      if (!mat || mat.userData._silPrev) return;
      mat.userData._silPrev = {
        color: mat.color ? mat.color.getHex() : 0xffffff,
        emissive: mat.emissive ? mat.emissive.getHex() : 0,
        vertexColors: mat.vertexColors,
        roughness: mat.roughness,
        polygonOffsetFactor: mat.polygonOffsetFactor,
        polygonOffsetUnits: mat.polygonOffsetUnits,
      };
    }

    function restoreMaterialLook(mat) {
      if (!mat || !mat.userData._silPrev) return;
      const prev = mat.userData._silPrev;
      if (mat.color) mat.color.setHex(prev.color);
      if (mat.emissive) mat.emissive.setHex(prev.emissive);
      mat.vertexColors = prev.vertexColors;
      if (prev.roughness != null) mat.roughness = prev.roughness;
      mat.polygonOffsetFactor = prev.polygonOffsetFactor;
      mat.polygonOffsetUnits = prev.polygonOffsetUnits;
      delete mat.userData._silPrev;
      mat.needsUpdate = true;
    }

    function applySilhouetteMaterials() {
      const on = silhouetteMode;
      if (voxelRec && voxelRec.material) {
        const mat = voxelRec.material;
        if (on) {
          rememberMaterialLook(mat);
          mat.color.setHex(0x4a4a46);
          if (mat.emissive) mat.emissive.setHex(0x141412);
          mat.vertexColors = false;
          mat.roughness = 0.92;
          mat.polygonOffset = true;
          mat.polygonOffsetFactor = 6;
          mat.polygonOffsetUnits = 6;
          mat.needsUpdate = true;
        } else {
          restoreMaterialLook(mat);
          if (voxelColorBySize && THREE.VertexColors != null) {
            mat.vertexColors = THREE.VertexColors;
            mat.needsUpdate = true;
          }
        }
      }
      if (voxelRec && voxelRec.wire && voxelRec.wire.material) {
        const wireMat = voxelRec.wire.material;
        if (on) {
          wireMat.color.setHex(0x000000);
          wireMat.opacity = 1;
          wireMat.transparent = false;
          wireMat.depthTest = true;
          wireMat.depthWrite = false;
        } else {
          wireMat.color.setHex(0xff0000);
          wireMat.opacity = 0.85;
          wireMat.transparent = true;
          wireMat.depthTest = true;
          wireMat.depthWrite = false;
        }
        wireMat.needsUpdate = true;
      }
      if (loftRec && loftRec.material) {
        if (on) {
          rememberMaterialLook(loftRec.material);
          loftRec.material.color.setHex(0x3f3f3c);
          if (loftRec.material.emissive) loftRec.material.emissive.setHex(0x101010);
          loftRec.material.roughness = 0.92;
          loftRec.material.needsUpdate = true;
        } else {
          restoreMaterialLook(loftRec.material);
        }
      }
      for (const rec of massMeshes.values()) {
        if (!rec.material) continue;
        if (on) {
          rememberMaterialLook(rec.material);
          rec.material.color.setHex(0x3f3f3c);
          if (rec.material.emissive) rec.material.emissive.setHex(0x101010);
          rec.material.roughness = 0.92;
          rec.material.needsUpdate = true;
        } else {
          restoreMaterialLook(rec.material);
        }
      }
    }

    function clearVoxels() {
      disposeVoxelRec();
      voxelCells = [];
      applyLoftOverlayVisibility();
      applyMassOverlayVisibility();
    }

    function setVoxels(payload) {
      clearVoxels();
      const cells = (payload && payload.cells) || [];
      voxelCells = cells;
      voxelResolution = (payload && payload.resolution) || 20;
      if (!cells.length || !THREE.InstancedMesh) return null;
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.58,
        metalness: 0.02,
        flatShading: true,
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 2,
        depthWrite: true,
      });
      if (voxelColorBySize && THREE.VertexColors != null) mat.vertexColors = THREE.VertexColors;
      applyVoxelOpacity(mat, voxelOpacity);
      const mesh = new THREE.InstancedMesh(voxelBoxGeom, mat, cells.length);
      mesh.frustumCulled = false;
      mesh.userData.voxels = true;
      mesh.visible = voxelsVisible;
      writeVoxelInstances(mesh, cells, voxelResolution, voxelColorBySize);
      voxelsGroup.add(mesh);
      const wire = new THREE.LineSegments(
        buildVoxelEdgeGeometry(cells, voxelResolution),
        new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.85, depthWrite: false })
      );
      wire.frustumCulled = false;
      wire.userData.voxelEdges = true;
      wire.visible = voxelsVisible && (silhouetteMode || voxelEdges);
      wire.renderOrder = 4;
      voxelsGroup.add(wire);
      voxelRec = { mesh, material: mat, wire };
      mesh.renderOrder = 2;
      applySilhouetteMaterials();
      applyLoftOverlayVisibility();
      applyMassOverlayVisibility();
      return voxelRec;
    }

    function setVoxelsVisible(visible) {
      voxelsVisible = !!visible;
      if (voxelRec) voxelRec.mesh.visible = voxelsVisible;
      applyVoxelEdgeVisibility();
      applyLoftOverlayVisibility();
      applyMassOverlayVisibility();
    }

    function setVoxelOpacity(opacity) {
      voxelOpacity = Math.max(0.1, Math.min(1, opacity));
      if (voxelRec) applyVoxelOpacity(voxelRec.material, voxelOpacity);
    }

    function setVoxelEdges(on) {
      voxelEdges = !!on;
      applyVoxelEdgeVisibility();
    }

    function setVoxelColorBySize(on) {
      voxelColorBySize = !!on;
      if (voxelRec && voxelRec.material) {
        if (voxelColorBySize && THREE.VertexColors != null) voxelRec.material.vertexColors = THREE.VertexColors;
        else voxelRec.material.vertexColors = false;
        voxelRec.material.needsUpdate = true;
      }
      if (voxelRec && voxelCells.length) {
        writeVoxelInstances(voxelRec.mesh, voxelCells, voxelResolution, voxelColorBySize);
      }
      applySilhouetteMaterials();
    }

    function collectSolidGeometries(chunkId, includeLoft) {
      const geos = [];
      for (const [id, rec] of massMeshes) {
        if (chunkId && id !== chunkId) continue;
        if (rec.mesh && rec.mesh.geometry) geos.push(rec.mesh.geometry);
      }
      if (includeLoft && loftRec && loftRec.mesh && loftRec.mesh.geometry) {
        geos.push(loftRec.mesh.geometry);
      }
      return geos;
    }

    function getLoftGeometry() {
      return loftRec && loftRec.mesh ? loftRec.mesh.geometry : null;
    }

    function applySectionCut(enabled, chunk) {
      sectionCutEnabled = !!enabled;
      renderer.localClippingEnabled = true;
      for (const [id, rec] of massMeshes) {
        const use = sectionCutEnabled && chunk && chunk.id === id;
        rec.material.clippingPlanes = use ? slabPlanes(chunk) : [];
        rec.material.clipIntersection = !!use;
        rec.material.needsUpdate = true;
      }
    }

    function makeChunkMesh(chunk) {
      const group = new THREE.Group();
      group.name = chunk.id;
      group.userData.chunkId = chunk.id;

      const pos = [];
      for (const seg of chunk.branches || []) {
        pos.push(seg.ax, seg.ay, seg.az || 0, seg.bx, seg.by, seg.bz || 0);
      }
      let lines = null;
      if (pos.length) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        lines = new THREE.LineSegments(
          geom,
          new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 1 })
        );
        lines.userData.sourceBranch = true;
        lines.userData.chunkLines = true;
        group.add(lines);
      }

      if (chunk.attractors && chunk.attractors.length) {
        const pts = [];
        for (const p of chunk.attractors) pts.push(p.x, p.y, p.z || 0);
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        group.add(
          new THREE.Points(
            geom,
            new THREE.PointsMaterial({
              color: 0xb01c18,
              size: 0.08,
              sizeAttenuation: true,
            })
          )
        );
        group.children[group.children.length - 1].userData.sourceBranch = true;
      }

      const SphereGeom = THREE.SphereBufferGeometry || THREE.SphereGeometry;
      for (const root of chunk.roots || []) {
        const mesh = new THREE.Mesh(
          new SphereGeom(0.12, 10, 8),
          new THREE.MeshStandardMaterial({
            color: 0xe8d5a3,
            emissive: 0x443c28,
            roughness: 0.45,
          })
        );
        mesh.position.set(root.x, root.y, root.z || 0);
        mesh.userData.sourceBranch = true;
        group.add(mesh);
      }

      const w = Math.max(0.05, chunk.width);
      const h = Math.max(0.05, chunk.height);
      const boxGeom = new THREE.BoxBufferGeometry
        ? new THREE.BoxBufferGeometry(w, h, 0.08)
        : new THREE.BoxGeometry(w, h, 0.08);
      boxGeom.translate(w * 0.5, h * 0.5, 0);
      const pick = new THREE.Mesh(
        boxGeom,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      pick.userData.chunkId = chunk.id;
      pick.userData.pick = true;
      group.add(pick);

      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(boxGeom),
        new THREE.LineBasicMaterial({
          color: 0xe8d5a3,
          transparent: true,
          opacity: 0.95,
        })
      );
      outline.visible = false;
      outline.userData.outline = true;
      group.add(outline);

      const PlaneGeom = THREE.PlaneBufferGeometry || THREE.PlaneGeometry;
      const plane = new THREE.Mesh(
        new PlaneGeom(w, h),
        new THREE.MeshBasicMaterial({
          color: 0xe8d5a3,
          transparent: true,
          opacity: 0.1,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      plane.position.set(w * 0.5, h * 0.5, 0);
      plane.userData.sourcePlane = true;
      plane.visible = false;
      group.add(plane);

      chunksGroup.add(group);
      chunkMeshes.set(chunk.id, { group, pick, outline, plane, lines });
      applySourceVisibility(group);
      return chunkMeshes.get(chunk.id);
    }

    function syncChunks(chunks, selectedId) {
      selectedChunkId = selectedId || null;
      const live = new Set((chunks || []).map((c) => c.id));
      for (const id of Array.from(chunkMeshes.keys())) {
        if (!live.has(id)) disposeChunkMesh(id);
      }
      for (const chunk of chunks || []) {
        const rec = chunkMeshes.get(chunk.id) || makeChunkMesh(chunk);
        rec.group.userData.kind = "chunk";
        rec.group.userData.chunkId = chunk.id;
        applyObjectTransform(rec.group, chunk.transform);
        rec.outline.visible = chunk.id === selectedChunkId && !selectedSectionId;
        rec.group.visible = sourceChunksVisible;
        if (rec.group.visible) applySourceVisibility(rec.group);
        if (!rec.lines) {
          rec.lines = rec.group.children.find((c) => c.userData.chunkLines) || null;
        }
      }
      if (editLines && liveChunk) {
        liveChunk = chunks.find((c) => c.id === liveChunk.id) || liveChunk;
        refreshEditOverlay();
      }
      attachGizmo();
    }

    function disposeSectionMesh(id) {
      const rec = sectionMeshes.get(id);
      if (!rec) return;
      if (transform && transform.object === rec.group) transform.detach();
      sectionsGroup.remove(rec.group);
      rec.group.traverse(disposeObject);
      sectionMeshes.delete(id);
    }

    function sectionLineGeom(section, loftSet) {
      const lib = global.D7SpatialLoft;
      const pos = [];
      if (lib && loftSet) {
        const local = lib.deformLocal(section, loftSet.width, loftSet.height);
        const byId = new Map(local.map((n) => [n.id, n]));
        for (const seg of loftSet.topology.segments || []) {
          const a = byId.get(seg.a);
          const b = byId.get(seg.b);
          if (!a || !b) continue;
          pos.push(a.x, a.y, 0, b.x, b.y, 0);
        }
      }
      const geom = new THREE.BufferGeometry();
      if (pos.length) geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      return geom;
    }

    function makeSectionMesh(section, loftSet, toneIndex) {
      const group = new THREE.Group();
      group.name = section.id;
      group.userData.kind = "section";
      group.userData.sectionId = section.id;
      const tone = SECTION_TONES[toneIndex % SECTION_TONES.length];
      const lines = new THREE.LineSegments(
        sectionLineGeom(section, loftSet),
        new THREE.LineBasicMaterial({ color: tone, transparent: true, opacity: 1 })
      );
      lines.userData.loftLine = true;
      group.add(lines);
      const w = Math.max(0.05, loftSet.width);
      const h = Math.max(0.05, loftSet.height);
      const boxGeom = THREE.BoxBufferGeometry
        ? new THREE.BoxBufferGeometry(w, h, 0.04)
        : new THREE.BoxGeometry(w, h, 0.04);
      boxGeom.translate(w * 0.5, h * 0.5, 0);
      const pick = new THREE.Mesh(
        boxGeom,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      pick.userData.kind = "section";
      pick.userData.sectionId = section.id;
      pick.userData.pick = true;
      group.add(pick);
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(boxGeom),
        new THREE.LineBasicMaterial({ color: tone, transparent: true, opacity: 0.7 })
      );
      outline.visible = false;
      outline.userData.outline = true;
      group.add(outline);
      const PlaneGeom = THREE.PlaneBufferGeometry || THREE.PlaneGeometry;
      const plane = new THREE.Mesh(
        new PlaneGeom(w, h),
        new THREE.MeshBasicMaterial({
          color: tone,
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      plane.position.set(w * 0.5, h * 0.5, 0);
      plane.userData.sourcePlane = true;
      plane.visible = !!sourcePlanesVisible;
      group.add(plane);
      sectionsGroup.add(group);
      const rec = { group, lines, pick, outline, plane };
      sectionMeshes.set(section.id, rec);
      return rec;
    }

    function rebuildSectionLines(section, loftSet) {
      const rec = sectionMeshes.get(section.id);
      if (!rec) return;
      rec.lines.geometry.dispose();
      rec.lines.geometry = sectionLineGeom(section, loftSet);
    }

    function clearHandles() {
      while (handlesGroup.children.length) {
        const child = handlesGroup.children[0];
        handlesGroup.remove(child);
        disposeObject(child);
      }
    }

    function syncSectionHandles(section, loftSet) {
      clearHandles();
      if (!editBranches || !section || !loftSet || !sectionLayersVisible) return;
      const rec = sectionMeshes.get(section.id);
      if (!rec) return;
      rec.group.updateWorldMatrix(true, false);
      const lib = global.D7SpatialLoft;
      const local = lib.deformLocal(section, loftSet.width, loftSet.height);
      const SphereGeom = THREE.SphereBufferGeometry || THREE.SphereGeometry;
      for (const node of local) {
        const selected = selectedNodeIds.indexOf(node.id) >= 0;
        const mesh = new THREE.Mesh(
          new SphereGeom(0.11, 10, 8),
          new THREE.MeshStandardMaterial({
            color: selected ? 0xe8d5a3 : 0x9a968e,
            emissive: selected ? 0x3a3424 : 0x000000,
            roughness: 0.45,
          })
        );
        mesh.position.set(node.x, node.y, 0);
        mesh.userData.kind = "node";
        mesh.userData.nodeId = node.id;
        mesh.userData.sectionId = section.id;
        rec.group.add(mesh);
        mesh.userData.handle = true;
      }
    }

    function detachSectionHandles(sectionId) {
      const rec = sectionMeshes.get(sectionId);
      if (!rec) return;
      const remove = [];
      rec.group.traverse((obj) => {
        if (obj.userData.handle) remove.push(obj);
      });
      for (const obj of remove) {
        rec.group.remove(obj);
        if (obj.geometry && obj.geometry.type === "SphereBufferGeometry") {
          /* shared geom left on last */
        }
        disposeObject(obj);
      }
    }

    function syncSections(loftSet, selectedId, nodeIds) {
      selectedSectionId = selectedId || null;
      selectedNodeIds = nodeIds ? nodeIds.slice() : [];
      const sections = (loftSet && loftSet.sections) || [];
      const live = new Set(sections.map((s) => s.id));
      for (const id of Array.from(sectionMeshes.keys())) {
        if (!live.has(id)) disposeSectionMesh(id);
      }
      sections.forEach((section, index) => {
        let rec = sectionMeshes.get(section.id);
        if (!rec) rec = makeSectionMesh(section, loftSet, index);
        rec.group.userData.sectionId = section.id;
        rec.group.visible = sectionLayersVisible;
        rec.lines.visible = loftLinesVisible;
        rec.lines.material.opacity = section.id === selectedSectionId ? 1 : 0.86;
        rec.outline.visible = section.id === selectedSectionId;
        rec.plane.visible = !!sourcePlanesVisible;
        const tone = SECTION_TONES[index % SECTION_TONES.length];
        rec.lines.material.color.setHex(tone);
        rec.outline.material.color.setHex(tone);
        rec.plane.material.color.setHex(tone);
        applySectionObject(rec.group, section);
        rebuildSectionLines(section, loftSet);
        detachSectionHandles(section.id);
      });
      const selected = sections.find((s) => s.id === selectedSectionId) || null;
      if (selected) syncSectionHandles(selected, loftSet);
      attachGizmo();
    }

    function attachGizmo() {
      if (!transform) return;
      if (silhouetteMode) {
        if (transform.object) transform.detach();
        transform.visible = false;
        transform.enabled = false;
        return;
      }
      transform.enabled = true;
      if (editLines) {
        placeEditPivot();
        return;
      }
      if (editBranches) {
        if (transform.object) transform.detach();
        transform.visible = false;
        return;
      }
      let next = null;
      if (selectedSectionId) {
        const rec = sectionMeshes.get(selectedSectionId);
        if (rec && rec.group.visible) next = rec.group;
      }
      if (!next && selectedChunkId && sourceChunksVisible) {
        const rec = chunkMeshes.get(selectedChunkId);
        if (rec) next = rec.group;
      }
      if (!next) {
        if (transform.object) transform.detach();
        transform.visible = false;
        return;
      }
      if (transform.object !== next) transform.attach(next);
      transform.setMode(gizmoMode);
      transform.visible = true;
    }

    function applyLiveTransform(kind, target) {
      if (!target) return;
      if (kind === "section") {
        const rec = sectionMeshes.get(target.id);
        if (rec) applySectionObject(rec.group, target);
        return;
      }
      const rec = chunkMeshes.get(target.id);
      if (rec) applyObjectTransform(rec.group, target.transform);
    }

    function applyAxisConstraint() {
      if (!transform) return;
      const free = editAxis === "free" || !editLines;
      transform.showX = free || editAxis === "x";
      transform.showY = free || editAxis === "y";
      transform.showZ = free || editAxis === "z";
    }

    function transformNodeIdList() {
      const ids = new Set(editNodeIds);
      if (liveChunk) {
        for (const seg of liveChunk.segments || []) {
          if (editSegIds.indexOf(seg.id) >= 0) {
            ids.add(seg.a);
            ids.add(seg.b);
          }
        }
      }
      return Array.from(ids);
    }

    function selectedEditNodes() {
      if (!liveChunk) return [];
      const wanted = new Set(transformNodeIdList());
      return (liveChunk.nodes || []).filter((n) => wanted.has(n.id));
    }

    function captureEditSnapshot() {
      const rec = liveChunk && chunkMeshes.get(liveChunk.id);
      if (!rec) {
        editSnapshot = null;
        return;
      }
      rec.group.updateWorldMatrix(true, true);
      const nodes = selectedEditNodes();
      editSnapshot = {
        matrix: rec.group.matrixWorld.clone(),
        pivot: {
          position: editPivot.position.clone(),
          quaternion: editPivot.quaternion.clone(),
          scale: editPivot.scale.clone(),
        },
        nodes: nodes.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          z: n.z || 0,
        })),
      };
    }

    function applyEditPivotChange() {
      const rec = liveChunk && chunkMeshes.get(liveChunk.id);
      if (!rec || !editSnapshot || !editSnapshot.nodes.length) return;
      const byId = new Map((liveChunk.nodes || []).map((n) => [n.id, n]));
      const start = new THREE.Matrix4().compose(
        editSnapshot.pivot.position,
        editSnapshot.pivot.quaternion,
        editSnapshot.pivot.scale
      );
      const now = new THREE.Matrix4().compose(editPivot.position, editPivot.quaternion, editPivot.scale);
      const delta = now.clone().multiply(start.clone().invert());
      const invChunk = rec.group.matrixWorld.clone().invert();
      for (const snap of editSnapshot.nodes) {
        const node = byId.get(snap.id);
        if (!node) continue;
        const local = new THREE.Vector3(snap.x, snap.y, snap.z);
        const world = local.clone().applyMatrix4(editSnapshot.matrix);
        world.applyMatrix4(delta);
        world.applyMatrix4(invChunk);
        node.x = world.x;
        node.y = world.y;
        node.z = world.z;
      }
      rebuildBranchesFromGraph(liveChunk);
      refreshChunkLines(liveChunk);
      refreshEditOverlay({ keepPivot: true });
      if (typeof onLineEdit === "function") onLineEdit("live");
    }

    function placeEditPivot() {
      if (silhouetteMode) {
        if (transform) {
          if (transform.object) transform.detach();
          transform.visible = false;
          transform.enabled = false;
        }
        editPivot.visible = false;
        return;
      }
      const rec = liveChunk && chunkMeshes.get(liveChunk.id);
      const nodes = selectedEditNodes();
      if (!rec || !nodes.length) {
        if (transform) {
          if (transform.object) transform.detach();
          transform.visible = false;
        }
        editPivot.visible = false;
        return;
      }
      rec.group.updateWorldMatrix(true, true);
      const c = new THREE.Vector3();
      for (const n of nodes) {
        c.add(new THREE.Vector3(n.x, n.y, n.z || 0).applyMatrix4(rec.group.matrixWorld));
      }
      c.multiplyScalar(1 / nodes.length);
      editPivot.position.copy(c);
      editPivot.quaternion.identity();
      editPivot.scale.set(1, 1, 1);
      editPivot.visible = true;
      const mode = nodes.length < 2 ? "translate" : gizmoMode;
      if (transform) {
        transform.setSpace("world");
        transform.setMode(mode);
        if (transform.object !== editPivot) transform.attach(editPivot);
        transform.visible = true;
        applyAxisConstraint();
      }
    }

    function clearEditOverlay() {
      while (editOverlay.children.length) {
        const child = editOverlay.children[0];
        editOverlay.remove(child);
        disposeObject(child);
      }
    }

    function refreshChunkLines(chunk) {
      const rec = chunkMeshes.get(chunk.id);
      if (!rec || !rec.lines) return;
      const pos = [];
      for (const seg of chunk.branches || []) {
        pos.push(seg.ax, seg.ay, seg.az || 0, seg.bx, seg.by, seg.bz || 0);
      }
      rec.lines.geometry.dispose();
      const geom = new THREE.BufferGeometry();
      if (pos.length) geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      rec.lines.geometry = geom;
      rec.lines.visible = !editLines;
    }

    function refreshEditOverlay(options) {
      if (liveChunk) stripEditHandles(liveChunk.id);
      if (!editLines || !liveChunk) {
        if (transform && transform.object === editPivot) transform.detach();
        return;
      }
      const rec = chunkMeshes.get(liveChunk.id);
      if (!rec) return;
      rec.group.updateWorldMatrix(true, true);
      const byId = new Map((liveChunk.nodes || []).map((n) => [n.id, n]));
      for (const seg of liveChunk.segments || []) {
        const a = byId.get(seg.a);
        const b = byId.get(seg.b);
        if (!a || !b) continue;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute(
          "position",
          new THREE.Float32BufferAttribute([a.x, a.y, a.z || 0, b.x, b.y, b.z || 0], 3)
        );
        const selected = editSegIds.indexOf(seg.id) >= 0;
        const line = new THREE.LineSegments(geom, selected ? editLineSel : editLineIdle);
        line.userData.editSeg = true;
        line.userData.segId = seg.id;
        line.userData.a = seg.a;
        line.userData.b = seg.b;
        line.renderOrder = selected ? 12 : 8;
        rec.group.add(line);
      }
      const endpointIds = new Set(editNodeIds);
      for (const seg of liveChunk.segments || []) {
        if (editSegIds.indexOf(seg.id) >= 0) {
          endpointIds.add(seg.a);
          endpointIds.add(seg.b);
        }
      }
      for (const node of liveChunk.nodes || []) {
        const mesh = new THREE.Mesh(editSphereGeom, endpointIds.has(node.id) ? editMatSel : editMatIdle);
        mesh.position.set(node.x, node.y, node.z || 0);
        mesh.userData.editNode = true;
        mesh.userData.nodeId = node.id;
        mesh.renderOrder = 20;
        rec.group.add(mesh);
      }
      if (!options || !options.keepPivot) placeEditPivot();
    }

    function stripEditHandles(chunkId) {
      const rec = chunkMeshes.get(chunkId);
      if (!rec) return;
      const remove = rec.group.children.filter((c) => c.userData.editNode || c.userData.editSeg);
      for (const obj of remove) {
        rec.group.remove(obj);
        if (obj.userData.editSeg && obj.geometry) obj.geometry.dispose();
      }
    }

    function setEditLines(enabled, chunk) {
      editLines = !!enabled;
      liveChunk = chunk || liveChunk;
      if (editLines) {
        editBranches = false;
        if (liveChunk) {
          ensureGraphIds(liveChunk);
          rebuildBranchesFromGraph(liveChunk);
        }
        boxSelectMode = boxSelectMode;
      } else {
        boxSelectMode = false;
        moveSegmentMode = false;
        boxDrag = null;
        lineDrag = null;
        boxSelectEl.style.display = "none";
        editNodeIds = [];
        editSegIds = [];
        for (const id of chunkMeshes.keys()) stripEditHandles(id);
        if (transform) {
          transform.setSpace("local");
          transform.showX = true;
          transform.showY = true;
          transform.showZ = true;
        }
      }
      if (liveChunk) refreshChunkLines(liveChunk);
      refreshEditOverlay();
      attachGizmo();
    }

    function setEditSelection(nodeIds, segIds) {
      editNodeIds = (nodeIds || []).slice();
      editSegIds = (segIds || []).slice();
      refreshEditOverlay();
    }

    function pickEditNode(event) {
      if (!liveChunk) return null;
      const rec = chunkMeshes.get(liveChunk.id);
      if (!rec) return null;
      setPointer(event);
      const handles = rec.group.children.filter((c) => c.userData.editNode);
      raycaster.params.Line = raycaster.params.Line || {};
      const hits = raycaster.intersectObjects(handles, false);
      return hits.length ? hits[0].object : null;
    }

    function pickEditSeg(event) {
      if (!liveChunk) return null;
      const rec = chunkMeshes.get(liveChunk.id);
      if (!rec) return null;
      setPointer(event);
      raycaster.params.Line = { threshold: 0.28 };
      const segs = rec.group.children.filter((c) => c.userData.editSeg);
      const hits = raycaster.intersectObjects(segs, false);
      return hits.length ? hits[0].object : null;
    }

    function worldOnEditPlane(event, worldAnchor) {
      setPointer(event);
      const plane = new THREE.Plane();
      const camDir = new THREE.Vector3();
      activeCamera.getWorldDirection(camDir);
      plane.setFromNormalAndCoplanarPoint(camDir, worldAnchor);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      return hit;
    }

    function constrainWorldDelta(delta) {
      if (editAxis === "x") {
        delta.y = 0;
        delta.z = 0;
      } else if (editAxis === "y") {
        delta.x = 0;
        delta.z = 0;
      } else if (editAxis === "z") {
        delta.x = 0;
        delta.y = 0;
      }
      return delta;
    }

    function applyLineDrag(event) {
      if (!lineDrag || !liveChunk) return;
      const rec = chunkMeshes.get(liveChunk.id);
      if (!rec) return;
      const hit = worldOnEditPlane(event, lineDrag.anchor);
      if (!hit) return;
      const delta = constrainWorldDelta(hit.clone().sub(lineDrag.startHit));
      rec.group.updateWorldMatrix(true, true);
      const inv = rec.group.matrixWorld.clone().invert();
      const byId = new Map((liveChunk.nodes || []).map((n) => [n.id, n]));
      for (const snap of lineDrag.nodes) {
        const node = byId.get(snap.id);
        if (!node) continue;
        const world = snap.world.clone().add(delta);
        const local = world.applyMatrix4(inv);
        node.x = local.x;
        node.y = local.y;
        node.z = local.z;
      }
      rebuildBranchesFromGraph(liveChunk);
      refreshChunkLines(liveChunk);
      refreshEditOverlay({ keepPivot: true });
      if (typeof onLineEdit === "function") onLineEdit("live");
    }

    function beginLineDrag(event, nodeIds) {
      const rec = liveChunk && chunkMeshes.get(liveChunk.id);
      if (!rec || !nodeIds.length) return false;
      rec.group.updateWorldMatrix(true, true);
      const nodes = [];
      const byId = new Map((liveChunk.nodes || []).map((n) => [n.id, n]));
      const centroid = new THREE.Vector3();
      for (const id of nodeIds) {
        const node = byId.get(id);
        if (!node) continue;
        const world = new THREE.Vector3(node.x, node.y, node.z || 0).applyMatrix4(rec.group.matrixWorld);
        nodes.push({ id, world });
        centroid.add(world);
      }
      if (!nodes.length) return false;
      centroid.multiplyScalar(1 / nodes.length);
      const hit = worldOnEditPlane(event, centroid);
      if (!hit) return false;
      lineDrag = { nodes, startHit: hit.clone(), anchor: centroid.clone() };
      skipPick = true;
      if (event && event.pointerId != null && renderer.domElement.setPointerCapture) {
        try {
          renderer.domElement.setPointerCapture(event.pointerId);
        } catch (err) {}
      }
      if (typeof onLineEdit === "function") onLineEdit("begin");
      syncOrbitEnabled();
      return true;
    }

    function setPointer(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
      raycaster.setFromCamera(pointer, activeCamera);
    }

    function pickChunk(event) {
      setPointer(event);
      const pickables = [];
      for (const rec of chunkMeshes.values()) {
        if (rec.group.visible) pickables.push(rec.pick);
      }
      const hits = raycaster.intersectObjects(pickables, false);
      return hits.length ? hits[0].object.userData.chunkId : null;
    }

    function pickSection(event) {
      setPointer(event);
      const pickables = [];
      for (const rec of sectionMeshes.values()) {
        if (rec.group.visible) pickables.push(rec.pick);
      }
      const hits = raycaster.intersectObjects(pickables, false);
      return hits.length ? hits[0].object.userData.sectionId : null;
    }

    function pickNode(event) {
      setPointer(event);
      const handles = [];
      for (const rec of sectionMeshes.values()) {
        rec.group.traverse((obj) => {
          if (obj.userData.handle) handles.push(obj);
        });
      }
      const hits = raycaster.intersectObjects(handles, false);
      return hits.length ? hits[0].object : null;
    }

    function localOnSectionPlane(event, sectionId) {
      const rec = sectionMeshes.get(sectionId);
      if (!rec) return null;
      setPointer(event);
      rec.group.updateWorldMatrix(true, false);
      const n = new THREE.Vector3(0, 0, 1).transformDirection(rec.group.matrixWorld).normalize();
      const origin = new THREE.Vector3().setFromMatrixPosition(rec.group.matrixWorld);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, origin);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      return rec.group.worldToLocal(hit);
    }

    renderer.domElement.addEventListener("pointerdown", (event) => {
      if (!isViewportPointer(event)) return;
      if (isUIInteracting) return;
      if (event.button !== 0) return;
      if (transform && transform.dragging) return;
      pointerDown = { x: event.clientX, y: event.clientY };
      if (editLines) {
        if (transform && transform.axis != null) return;
        if (boxSelectMode) {
          boxDrag = { x: event.clientX, y: event.clientY };
          const rect = renderer.domElement.getBoundingClientRect();
          boxSelectEl.style.display = "block";
          boxSelectEl.style.left = `${event.clientX - rect.left}px`;
          boxSelectEl.style.top = `${event.clientY - rect.top}px`;
          boxSelectEl.style.width = "0px";
          boxSelectEl.style.height = "0px";
          skipPick = true;
          syncOrbitEnabled();
          return;
        }
        const handle = pickEditNode(event);
        if (handle) {
          const id = handle.userData.nodeId;
          let ids = editNodeIds.slice();
          if (event.shiftKey) {
            if (ids.indexOf(id) >= 0) ids = ids.filter((n) => n !== id);
            else ids.push(id);
          } else {
            ids = [id];
            editSegIds = [];
          }
          editNodeIds = ids;
          refreshEditOverlay();
          if (typeof onLineSelect === "function") onLineSelect(editNodeIds, editSegIds);
          skipPick = true;
          return;
        }
        const seg = pickEditSeg(event);
        if (seg) {
          const sid = seg.userData.segId;
          let segs = editSegIds.slice();
          if (event.shiftKey) {
            if (segs.indexOf(sid) >= 0) segs = segs.filter((n) => n !== sid);
            else segs.push(sid);
          } else {
            segs = [sid];
            editNodeIds = [];
          }
          editSegIds = segs;
          refreshEditOverlay();
          if (typeof onLineSelect === "function") onLineSelect(editNodeIds, editSegIds);
          skipPick = true;
          if (moveSegmentMode && !event.shiftKey) {
            beginLineDrag(event, [seg.userData.a, seg.userData.b]);
          }
          return;
        }
        return;
      }
      if (editBranches && selectedSectionId) {
        const handle = pickNode(event);
        if (handle) {
          const id = handle.userData.nodeId;
          let ids = selectedNodeIds.slice();
          if (event.shiftKey) {
            if (ids.indexOf(id) >= 0) ids = ids.filter((n) => n !== id);
            else ids.push(id);
          } else if (ids.indexOf(id) < 0) {
            ids = [id];
          }
          selectedNodeIds = ids;
          if (typeof onNodeSelect === "function") onNodeSelect(ids);
          const local = localOnSectionPlane(event, selectedSectionId);
          nodeDrag = {
            sectionId: selectedSectionId,
            ids,
            startLocal: local,
          };
          skipPick = true;
          syncOrbitEnabled();
        }
      }
    });
    renderer.domElement.addEventListener("pointermove", (event) => {
      if (isUIInteracting) return;
      if (boxDrag) {
        const rect = renderer.domElement.getBoundingClientRect();
        const x0 = Math.min(boxDrag.x, event.clientX);
        const y0 = Math.min(boxDrag.y, event.clientY);
        const x1 = Math.max(boxDrag.x, event.clientX);
        const y1 = Math.max(boxDrag.y, event.clientY);
        boxSelectEl.style.left = `${x0 - rect.left}px`;
        boxSelectEl.style.top = `${y0 - rect.top}px`;
        boxSelectEl.style.width = `${x1 - x0}px`;
        boxSelectEl.style.height = `${y1 - y0}px`;
        return;
      }
      if (lineDrag) {
        applyLineDrag(event);
        return;
      }
      if (!nodeDrag || !nodeDrag.startLocal) return;
      const local = localOnSectionPlane(event, nodeDrag.sectionId);
      if (!local) return;
      const dx = local.x - nodeDrag.startLocal.x;
      const dy = local.y - nodeDrag.startLocal.y;
      if (typeof onNodeMove === "function") {
        onNodeMove(nodeDrag.sectionId, nodeDrag.ids, dx, dy, true);
      }
    });
    renderer.domElement.addEventListener("pointerup", (event) => {
      if (lineDrag) {
        lineDrag = null;
        placeEditPivot();
        if (typeof onLineEdit === "function") onLineEdit("commit");
        skipPick = false;
        pointerDown = null;
        syncOrbitEnabled();
        return;
      }
      if (boxDrag) {
        const rec = liveChunk && chunkMeshes.get(liveChunk.id);
        if (rec && liveChunk) {
          const x0 = Math.min(boxDrag.x, event.clientX);
          const y0 = Math.min(boxDrag.y, event.clientY);
          const x1 = Math.max(boxDrag.x, event.clientX);
          const y1 = Math.max(boxDrag.y, event.clientY);
          rec.group.updateWorldMatrix(true, true);
          const ids = [];
          for (const node of liveChunk.nodes || []) {
            const world = new THREE.Vector3(node.x, node.y, node.z || 0).applyMatrix4(rec.group.matrixWorld);
            world.project(activeCamera);
            const box = renderer.domElement.getBoundingClientRect();
            const sx = (world.x * 0.5 + 0.5) * box.width + box.left;
            const sy = (-world.y * 0.5 + 0.5) * box.height + box.top;
            if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) ids.push(node.id);
          }
          if (event.shiftKey) {
            const set = new Set(editNodeIds.concat(ids));
            editNodeIds = Array.from(set);
          } else {
            editNodeIds = ids;
            editSegIds = [];
          }
          refreshEditOverlay();
          if (typeof onLineSelect === "function") onLineSelect(editNodeIds, editSegIds);
        }
        boxDrag = null;
        boxSelectEl.style.display = "none";
        pointerDown = null;
        skipPick = false;
        syncOrbitEnabled();
        return;
      }
      if (nodeDrag) {
        nodeDrag = null;
        syncOrbitEnabled();
        if (typeof onNodeDragEnd === "function") onNodeDragEnd();
      }
      if (isUIInteracting || !isViewportPointer(event)) {
        pointerDown = null;
        return;
      }
      if (!pointerDown) return;
      const dx = event.clientX - pointerDown.x;
      const dy = event.clientY - pointerDown.y;
      pointerDown = null;
      if (event.button !== 0) return;
      if (skipPick) {
        skipPick = false;
        return;
      }
      if (transform && transform.dragging) return;
      if (dx * dx + dy * dy > 16) return;
      if (editLines) {
        if (!event.shiftKey) {
          editNodeIds = [];
          editSegIds = [];
          refreshEditOverlay();
          if (typeof onLineSelect === "function") onLineSelect(editNodeIds, editSegIds);
        }
        return;
      }
      const sectionId = pickSection(event);
      if (sectionId) {
        if (typeof onSectionSelect === "function") onSectionSelect(sectionId);
        return;
      }
      const id = pickChunk(event);
      if (typeof onSelect === "function") onSelect(id);
    });

    let raf = 0;
    let running = false;

    function isMassFillMesh(obj) {
      if (!obj || !obj.isMesh) return false;
      if (obj.isLine || obj.isLineSegments || obj.isPoints) return false;
      const data = obj.userData || {};
      if (data.pick || data.outline || data.editNode || data.editSeg || data.sourcePlane || data.sourceBranch) {
        return false;
      }
      if (data.loft || data.voxels || data.mass) return true;
      let parent = obj.parent;
      while (parent) {
        if (parent === loftGroup || parent === massesGroup || parent === voxelsGroup) return true;
        parent = parent.parent;
      }
      return false;
    }

    function setSilhouetteMode(on) {
      silhouetteMode = !!on;
      if (silhouetteMode && boxSelectEl) boxSelectEl.style.display = "none";
      applySilhouetteMaterials();
      applyVoxelEdgeVisibility();
      applyLoftOverlayVisibility();
      applyMassOverlayVisibility();
      attachGizmo();
    }

    function setSilhouetteThickness(value) {
      const n = Math.round(Number(value));
      silhouetteThickness = Math.max(1, Math.min(8, Number.isFinite(n) ? n : 3));
    }

    function renderSilhouette(camera, width, height, options) {
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      const transparent = !!(options && options.transparent);
      const thicknessScale = options && options.thicknessScale != null ? Number(options.thicknessScale) : 1;
      const hidden = [];
      const hide = (obj) => {
        if (!obj || hidden.some((item) => item.obj === obj)) return;
        hidden.push({ obj, visible: obj.visible });
        obj.visible = false;
      };
      hide(transform);
      hide(editPivot);
      hide(handlesGroup);
      hide(cube);
      hide(chunksGroup);
      hide(sectionsGroup);
      const boxPrev = boxSelectEl ? boxSelectEl.style.display : "";
      if (boxSelectEl) boxSelectEl.style.display = "none";
      scene.traverse((obj) => {
        if (obj === scene) return;
        if (isPngHelper(obj)) hide(obj);
      });
      const prevBg = scene.background;
      const prevClear = renderer.getClearColor().clone();
      const prevAlpha = renderer.getClearAlpha();
      const prevOverride = scene.overrideMaterial;
      const prevAutoClear = renderer.autoClear;
      if (transparent) scene.background = null;
      renderer.setRenderTarget(null);
      renderer.setClearColor(transparent ? 0x000000 : prevClear, transparent ? 0 : prevAlpha);
      renderer.clear();
      renderer.render(scene, camera);

      const occHidden = [];
      const hideOcc = (obj) => {
        if (!obj || occHidden.some((item) => item.obj === obj) || hidden.some((item) => item.obj === obj)) return;
        occHidden.push({ obj, visible: obj.visible });
        obj.visible = false;
      };
      scene.traverse((obj) => {
        if (obj === scene) return;
        if ((obj.isLine || obj.isLineSegments || obj.isPoints) && obj.visible) hideOcc(obj);
        if (obj.isMesh && obj.visible && !isMassFillMesh(obj)) hideOcc(obj);
      });
      scene.background = null;
      silFillMat.color.setHex(0xffffff);
      scene.overrideMaterial = silFillMat;
      if (occRT.width !== w || occRT.height !== h) occRT.setSize(w, h);
      silUniforms.tOccupancy.value = occRT.texture;
      silUniforms.uResolution.value.set(w, h);
      silUniforms.uThickness.value = Math.max(1, Math.min(8, Math.max(1, silhouetteThickness) * Math.max(0.5, thicknessScale)));
      silUniforms.uTransparentBg.value = transparent ? 1 : 0;
      renderer.setRenderTarget(occRT);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      scene.overrideMaterial = prevOverride || null;
      for (let i = 0; i < occHidden.length; i++) occHidden[i].obj.visible = occHidden[i].visible;
      scene.background = prevBg;
      renderer.autoClear = false;
      renderer.render(silScene, silCamera);
      renderer.autoClear = prevAutoClear;
      for (let i = 0; i < hidden.length; i++) hidden[i].obj.visible = hidden[i].visible;
      if (boxSelectEl) boxSelectEl.style.display = boxPrev;
      renderer.setClearColor(prevClear, prevAlpha);
    }

    function presentFrame(camera) {
      if (silhouetteMode) {
        const size = renderer.getSize(new THREE.Vector2());
        const pr = renderer.getPixelRatio();
        renderSilhouette(camera, size.x * pr, size.y * pr, { transparent: false, thicknessScale: 1 });
      } else {
        renderer.render(scene, camera);
      }
    }

    function tick() {
      if (!running) return;
      if (turntablePreview) {
        const t = Math.min(1, (performance.now() - turntablePreview.start) / Math.max(1, turntablePreview.duration));
        applyTurntableAngle(turntablePreview.sign * t * Math.PI * 2);
        if (t >= 1) finishTurntablePreview(true);
      }
      if (!capturingPng && !capturingTurntable) {
        if (controls && !turntableLock) controls.update();
        presentFrame(turntableCamera || activeCamera);
      }
      raf = requestAnimationFrame(tick);
    }

    function disposeLoftWire() {
      if (!loftRec || !loftRec.wire) return;
      loftGroup.remove(loftRec.wire);
      disposeObject(loftRec.wire);
      loftRec.wire = null;
    }

    function attachLoftWire(geometry) {
      disposeLoftWire();
      if (!loftRec || !massWireframe || !geometry) return;
      const EdgesGeom = THREE.EdgesGeometry;
      if (!EdgesGeom) return;
      loftRec.wire = new THREE.LineSegments(
        new EdgesGeom(geometry, 28),
        new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.7 })
      );
      loftGroup.add(loftRec.wire);
      applyLoftWireVisibility();
    }

    function setLoft(geometry, opacity, options) {
      const op = opacity != null ? opacity : loftOpacity;
      const draft = !!(options && options.draft);
      if (!geometry) {
        if (loftRec) {
          loftGroup.remove(loftRec.mesh);
          disposeLoftWire();
          loftRec.mesh.traverse(disposeObject);
          loftRec = null;
        }
        return null;
      }
      if (loftRec && loftRec.mesh) {
        if (loftRec.mesh.geometry && loftRec.mesh.geometry !== geometry) {
          loftRec.mesh.geometry.dispose();
        }
        loftRec.mesh.geometry = geometry;
        applyMassOpacity(loftRec.material, op);
        if (draft) disposeLoftWire();
        else attachLoftWire(geometry);
        applySilhouetteMaterials();
        applyLoftOverlayVisibility();
        return loftRec;
      }
      const mat = new THREE.MeshStandardMaterial({
        color: 0xe6e2da,
        roughness: 0.78,
        metalness: 0.02,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 4,
        polygonOffsetUnits: 4,
      });
      applyMassOpacity(mat, op);
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.userData.loft = true;
      loftGroup.add(mesh);
      loftRec = { mesh, material: mat, wire: null };
      if (!draft) attachLoftWire(geometry);
      applySilhouetteMaterials();
      applyLoftOverlayVisibility();
      return loftRec;
    }

    function clearWorkspace() {
      endTransformPointer();
      nodeDrag = null;
      lineDrag = null;
      boxDrag = null;
      pointerDown = null;
      skipPick = false;
      isTransformDragging = false;
      editSnapshot = null;
      editNodeIds = [];
      editSegIds = [];
      selectedNodeIds = [];
      selectedSectionId = null;
      selectedChunkId = null;
      setEditLines(false);
      liveChunk = null;
      editBranches = false;
      boxSelectMode = false;
      moveSegmentMode = false;
      if (boxSelectEl) boxSelectEl.style.display = "none";
      if (transform) {
        transform.detach();
        transform.visible = false;
        transform.setMode("translate");
        transform.setSpace("local");
        transform.showX = true;
        transform.showY = true;
        transform.showZ = true;
      }
      gizmoMode = "translate";
      editAxis = "free";
      if (editPivot) editPivot.visible = false;
      for (const id of Array.from(chunkMeshes.keys())) disposeChunkMesh(id);
      for (const id of Array.from(sectionMeshes.keys())) disposeSectionMesh(id);
      for (const id of Array.from(massMeshes.keys())) removeMass(id);
      setLoft(null);
      clearVoxels();
      finishTurntablePreview(false);
      resetTurntablePose();
      endTurntablePresentation();
      capturingTurntable = false;
      turntableLock = false;
      clearHandles();
      applySectionCut(false);
      voxelResolution = 20;
      voxelOpacity = 1;
      voxelColorBySize = false;
      voxelEdges = true;
      voxelsVisible = true;
      massOpacity = 1;
      loftOpacity = 1;
      massWireframe = false;
      sourceBranchesVisible = true;
      sourcePlanesVisible = false;
      sourceChunksVisible = true;
      sectionLayersVisible = true;
      loftLinesVisible = true;
      loftSolidsVisible = true;
      massesVisible = true;
      applyViewMode("perspective", { reset: true });
    }

    applyViewMode("perspective", { reset: true });
    resize();

    function ancestorHidden(obj) {
      let parent = obj;
      while (parent) {
        if (parent.visible === false) return true;
        parent = parent.parent;
      }
      return false;
    }

    function visibleStudyBox() {
      const box = new THREE.Box3();
      const tmp = new THREE.Box3();
      let found = false;
      turntableGroup.updateWorldMatrix(true, true);
      turntableGroup.traverse((obj) => {
        if (ancestorHidden(obj)) return;
        if (!(obj.isMesh || obj.isLine || obj.isLineSegments || obj.isPoints || obj.isInstancedMesh)) return;
        const data = obj.userData || {};
        if (data.pick || data.outline || data.editNode || data.editSeg) return;
        tmp.setFromObject(obj);
        if (tmp.isEmpty()) return;
        if (!found) {
          box.copy(tmp);
          found = true;
        } else {
          box.union(tmp);
        }
      });
      return found ? box : null;
    }

    function resetTurntablePose() {
      turntableGroup.rotation.set(0, 0, 0);
      turntableGroup.position.set(0, 0, 0);
      for (let i = 0; i < turntableChildren.length; i++) {
        turntableChildren[i].position.set(0, 0, 0);
      }
      turntableGroup.updateMatrixWorld(true);
    }

    function beginTurntable(pivotMode) {
      resetTurntablePose();
      let pivot;
      if (pivotMode === "workspace") {
        pivot = workspaceCenter.clone();
      } else {
        const box = visibleStudyBox();
        pivot = box ? box.getCenter(new THREE.Vector3()) : workspaceCenter.clone();
      }
      turntablePivot.copy(pivot);
      turntableGroup.position.copy(pivot);
      for (let i = 0; i < turntableChildren.length; i++) {
        turntableChildren[i].position.set(-pivot.x, -pivot.y, -pivot.z);
      }
      turntableGroup.rotation.set(0, 0, 0);
      turntableGroup.updateMatrixWorld(true);
    }

    function applyTurntableAngle(radians) {
      turntableGroup.rotation.set(0, radians, 0);
      turntableGroup.updateMatrixWorld(true);
    }

    function eachWorkspaceCorner(fn) {
      for (let xi = 0; xi <= 1; xi++) {
        for (let yi = 0; yi <= 1; yi++) {
          for (let zi = 0; zi <= 1; zi++) {
            fn(new THREE.Vector3(xi ? CUBE : 0, yi ? CUBE : 0, zi ? CUBE : 0));
          }
        }
      }
    }

    function frameTurntableOrtho(cam, dir, aspect, margin) {
      const m = margin != null ? margin : TURNTABLE_MARGIN;
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
      eachWorkspaceCorner((corner) => {
        const p = corner.applyMatrix4(inv);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      });
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
      cam.far = Math.max(cam.near + 1, -minZ + CUBE);
      cam.zoom = 1;
      cam.updateProjectionMatrix();
    }

    function frameTurntablePerspective(cam, dir, fovDeg, margin) {
      const m = margin != null ? margin : TURNTABLE_MARGIN;
      const fovY = Math.max(8, Number(fovDeg) || 42);
      const fov = (fovY * Math.PI) / 180;
      const d = dir.clone().normalize();
      cam.fov = fovY;
      cam.aspect = 1;
      cam.position.copy(workspaceCenter).addScaledVector(d, CUBE * 3.5);
      setCameraUpForDirection(cam, d);
      cam.lookAt(workspaceCenter);
      cam.updateMatrixWorld(true);
      const lim = Math.tan(fov * 0.5) / m;
      let extra = -Infinity;
      const inv = cam.matrixWorldInverse;
      eachWorkspaceCorner((corner) => {
        const p = corner.applyMatrix4(inv);
        if (p.z >= -1e-4) {
          extra = Math.max(extra, p.z + CUBE);
          return;
        }
        extra = Math.max(extra, Math.abs(p.x) / lim + p.z, Math.abs(p.y) / lim + p.z);
      });
      if (Number.isFinite(extra) && Math.abs(extra) > 1e-6) {
        cam.position.addScaledVector(d, extra);
        cam.lookAt(workspaceCenter);
        cam.updateMatrixWorld(true);
      }
      let minZ = Infinity;
      let maxZ = -Infinity;
      const inv2 = cam.matrixWorldInverse;
      eachWorkspaceCorner((corner) => {
        const p = corner.applyMatrix4(inv2);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      });
      cam.near = Math.max(0.1, -maxZ - CUBE * 0.5);
      cam.far = Math.max(cam.near + 1, -minZ + CUBE);
      cam.updateProjectionMatrix();
    }

    function makeTurntableCamera() {
      if (usesOrtho(viewMode)) {
        const cam = orthoCamera.clone();
        frameTurntableOrtho(cam, viewDirection(viewMode), 1, TURNTABLE_MARGIN);
        return cam;
      }
      const cam = perspectiveCamera.clone();
      let dir = perspectiveCamera.position.clone().sub(workspaceCenter);
      if (dir.lengthSq() < 1e-8) dir.set(1, 0.8, 1);
      frameTurntablePerspective(cam, dir.normalize(), Number(perspectiveCamera.fov) || 42, TURNTABLE_MARGIN);
      return cam;
    }

    function containTurntableCamera(dest, squareSrc, aspect) {
      dest.copy(squareSrc);
      dest.matrixWorld.copy(squareSrc.matrixWorld);
      dest.matrixWorldInverse.copy(squareSrc.matrixWorldInverse);
      const a = Math.max(1e-6, aspect);
      if (dest.isOrthographicCamera) {
        const cx = (squareSrc.left + squareSrc.right) * 0.5;
        const cy = (squareSrc.top + squareSrc.bottom) * 0.5;
        const half = Math.max(squareSrc.right - squareSrc.left, squareSrc.top - squareSrc.bottom) * 0.5;
        let halfW = half;
        let halfH = half;
        if (a >= 1) halfW = half * a;
        else halfH = half / a;
        dest.left = cx - halfW;
        dest.right = cx + halfW;
        dest.top = cy + halfH;
        dest.bottom = cy - halfH;
        dest.near = squareSrc.near;
        dest.far = squareSrc.far;
        dest.zoom = 1;
      } else {
        dest.fov = squareSrc.fov;
        dest.aspect = a;
        dest.near = squareSrc.near;
        dest.far = squareSrc.far;
        if (a < 1) {
          const vFov = (Number(squareSrc.fov) * Math.PI) / 180;
          dest.fov = ((2 * Math.atan(Math.tan(vFov * 0.5) / a)) * 180) / Math.PI;
        }
      }
      dest.updateProjectionMatrix();
    }

    function beginTurntablePresentation() {
      turntableSquareCam = makeTurntableCamera();
      turntableCamera = turntableSquareCam.clone();
      const w = Math.max(8, container.clientWidth);
      const h = Math.max(8, container.clientHeight);
      containTurntableCamera(turntableCamera, turntableSquareCam, w / Math.max(1, h));
    }

    function endTurntablePresentation() {
      turntableCamera = null;
      turntableSquareCam = null;
    }

    function hideTurntableHelpers() {
      const hidden = [];
      const hide = (obj) => {
        if (!obj || hidden.some((item) => item.obj === obj)) return;
        hidden.push({ obj, visible: obj.visible });
        obj.visible = false;
      };
      hide(transform);
      hide(editPivot);
      hide(handlesGroup);
      hide(cube);
      scene.traverse((obj) => {
        if (isPngHelper(obj)) hide(obj);
      });
      const boxPrev = boxSelectEl ? boxSelectEl.style.display : "";
      if (boxSelectEl) boxSelectEl.style.display = "none";
      const prevEnabled = controls ? controls.enabled : true;
      turntableLock = true;
      if (transform) transform.enabled = false;
      syncOrbitEnabled();
      return () => {
        for (let i = 0; i < hidden.length; i++) hidden[i].obj.visible = hidden[i].visible;
        if (boxSelectEl) boxSelectEl.style.display = boxPrev;
        turntableLock = capturingTurntable;
        if (transform) transform.enabled = !capturingTurntable;
        if (controls) controls.enabled = prevEnabled && !turntableLock;
        syncOrbitEnabled();
      };
    }

    let turntablePreviewRestore = null;

    function finishTurntablePreview(completed) {
      if (!turntablePreview) return;
      const onDone = turntablePreview.onDone;
      turntablePreview = null;
      applyTurntableAngle(0);
      resetTurntablePose();
      if (typeof turntablePreviewRestore === "function") {
        turntablePreviewRestore();
        turntablePreviewRestore = null;
      }
      endTurntablePresentation();
      turntableLock = capturingTurntable;
      syncOrbitEnabled();
      if (typeof onDone === "function") onDone(!!completed);
    }

    function previewTurntable(options) {
      finishTurntablePreview(false);
      const duration = Math.max(1, Number(options && options.duration) || 10) * 1000;
      const sign = options && options.direction === "ccw" ? 1 : -1;
      beginTurntable(options && options.pivotMode === "workspace" ? "workspace" : "model");
      turntablePreviewRestore = hideTurntableHelpers();
      beginTurntablePresentation();
      turntablePreview = {
        start: performance.now(),
        duration,
        sign,
        onDone: options && options.onDone,
      };
      turntableLock = true;
      syncOrbitEnabled();
      return true;
    }

    function stopTurntablePreview() {
      finishTurntablePreview(false);
    }

    function renderTurntableFrame(exportCam, size, prevHeight) {
      if (silhouetteMode) {
        const refH = Math.max(1, prevHeight || size);
        renderSilhouette(exportCam, size, size, {
          transparent: false,
          thicknessScale: size / refH,
        });
      } else {
        renderer.render(scene, exportCam);
      }
      const gl = renderer.getContext && renderer.getContext();
      if (gl && gl.finish) gl.finish();
    }

    async function exportTurntable(options) {
      const lib = global.D7SpatialTurntable;
      if (!lib || !lib.encodeMp4) throw new Error("Turntable encoder did not load.");
      finishTurntablePreview(false);
      const duration = Math.max(1, Number(options && options.duration) || 10);
      const fps = Math.max(1, Math.round(Number(options && options.fps) || 30));
      const requested = Math.round(Number(options && options.size) || 1920);
      const gl = renderer.getContext && renderer.getContext();
      const maxBuf = (gl && gl.getParameter && gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || 4096;
      const size = Math.max(256, Math.min(requested, maxBuf, 4096));
      const frameCount = Math.max(1, Math.round(duration * fps));
      const sign = options && options.direction === "ccw" ? 1 : -1;
      const onProgress = options && options.onProgress;
      const signal = options && options.signal;
      capturingTurntable = true;
      turntableLock = true;
      const restoreHelpers = hideTurntableHelpers();
      beginTurntable(options && options.pivotMode === "workspace" ? "workspace" : "model");
      beginTurntablePresentation();
      const prevSize = renderer.getSize(new THREE.Vector2());
      const prevRatio = renderer.getPixelRatio();
      const prevClear = renderer.getClearColor().clone();
      const prevAlpha = renderer.getClearAlpha();
      const exportCam = turntableSquareCam;
      let restored = false;
      const restore = () => {
        if (restored) return;
        restored = true;
        applyTurntableAngle(0);
        resetTurntablePose();
        restoreHelpers();
        endTurntablePresentation();
        renderer.setPixelRatio(prevRatio);
        renderer.setSize(prevSize.x, prevSize.y, false);
        renderer.setClearColor(prevClear, prevAlpha);
        capturingTurntable = false;
        turntableLock = false;
        syncOrbitEnabled();
        presentFrame(activeCamera);
      };
      try {
        renderer.setPixelRatio(1);
        renderer.setSize(size, size, false);
        renderer.setClearColor(prevClear, prevAlpha);
        const blob = await lib.encodeMp4({
          canvas: renderer.domElement,
          width: size,
          height: size,
          fps,
          frameCount,
          signal,
          onProgress,
          renderFrame(index) {
            if (signal && signal.aborted) return;
            applyTurntableAngle((sign * index * Math.PI * 2) / frameCount);
            renderTurntableFrame(exportCam, size, prevSize.y * prevRatio);
          },
        });
        restore();
        return { blob, size, frameCount, fps, viewMode };
      } catch (err) {
        restore();
        throw err;
      }
    }

    function cameraForSquareExport(source) {
      const cam = source.clone();
      if (cam.isOrthographicCamera) {
        const w = cam.right - cam.left;
        const h = cam.top - cam.bottom;
        const cx = (cam.left + cam.right) * 0.5;
        const cy = (cam.top + cam.bottom) * 0.5;
        const half = Math.max(Math.abs(w), Math.abs(h)) * 0.5;
        cam.left = cx - half;
        cam.right = cx + half;
        cam.top = cy + half;
        cam.bottom = cy - half;
      } else {
        const aspect = Math.max(1e-6, Number(source.aspect) || 1);
        cam.aspect = 1;
        if (aspect > 1) {
          const vFov = (Number(source.fov) * Math.PI) / 180;
          const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * aspect);
          cam.fov = (hFov * 180) / Math.PI;
        }
      }
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      return cam;
    }

    function isPngHelper(obj) {
      if (!obj) return false;
      if (obj === transform || obj === editPivot || obj === handlesGroup) return true;
      const data = obj.userData || {};
      return !!(data.outline || data.editNode || data.editSeg);
    }

    function capturePng(options) {
      const requested = Math.round(Number(options && options.size) || 3000);
      const gl = renderer.getContext && renderer.getContext();
      const maxBuf = (gl && gl.getParameter && gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || 4096;
      const size = Math.max(256, Math.min(requested, maxBuf, 8192));
      const transparent = !!(options && options.transparent);
      capturingPng = true;
      const hidden = [];
      const hide = (obj) => {
        if (!obj || hidden.some((item) => item.obj === obj)) return;
        hidden.push({ obj, visible: obj.visible });
        obj.visible = false;
      };
      hide(transform);
      hide(editPivot);
      hide(handlesGroup);
      scene.traverse((obj) => {
        if (isPngHelper(obj)) hide(obj);
      });
      const boxPrev = boxSelectEl ? boxSelectEl.style.display : "";
      if (boxSelectEl) boxSelectEl.style.display = "none";
      const prevSize = renderer.getSize(new THREE.Vector2());
      const prevRatio = renderer.getPixelRatio();
      const prevClear = renderer.getClearColor().clone();
      const prevAlpha = renderer.getClearAlpha();
      const prevBg = scene.background;
      const exportCam = cameraForSquareExport(activeCamera);
      let restored = false;
      const restore = () => {
        if (restored) return;
        restored = true;
        for (let i = 0; i < hidden.length; i++) hidden[i].obj.visible = hidden[i].visible;
        if (boxSelectEl) boxSelectEl.style.display = boxPrev;
        scene.background = prevBg;
        renderer.setClearColor(prevClear, prevAlpha);
        renderer.setPixelRatio(prevRatio);
        renderer.setSize(prevSize.x, prevSize.y, false);
        capturingPng = false;
        presentFrame(activeCamera);
      };
      const blobFromCanvas = () => {
        const data = renderer.domElement.toDataURL("image/png");
        const raw = atob((data.split(",")[1]) || "");
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return new Blob([bytes], { type: "image/png" });
      };
      try {
        renderer.setPixelRatio(1);
        renderer.setSize(size, size, false);
        if (silhouetteMode) {
          const refH = Math.max(1, prevSize.y * prevRatio);
          renderSilhouette(exportCam, size, size, {
            transparent,
            thicknessScale: size / refH,
          });
        } else if (transparent) {
          scene.background = null;
          renderer.setClearColor(0x000000, 0);
          renderer.render(scene, exportCam);
        } else {
          renderer.setClearColor(prevClear, prevAlpha);
          renderer.render(scene, exportCam);
        }
        return new Promise((resolve, reject) => {
          const finish = (blob) => {
            restore();
            if (!blob) reject(new Error("PNG capture failed."));
            else resolve({ blob, size, viewMode });
          };
          try {
            if (typeof renderer.domElement.toBlob === "function") {
              renderer.domElement.toBlob((blob) => {
                if (blob) {
                  finish(blob);
                  return;
                }
                try {
                  finish(blobFromCanvas());
                } catch (err) {
                  restore();
                  reject(err);
                }
              }, "image/png");
              return;
            }
            finish(blobFromCanvas());
          } catch (err) {
            restore();
            reject(err);
          }
        });
      } catch (err) {
        restore();
        return Promise.reject(err);
      }
    }

    function getCameraState() {
      const cam = activeCamera;
      const target = controls && controls.target ? controls.target : workspaceCenter;
      return {
        viewMode,
        position: cam ? [cam.position.x, cam.position.y, cam.position.z] : [32, 24, 32],
        up: cam ? [cam.up.x, cam.up.y, cam.up.z] : [0, 1, 0],
        target: [target.x, target.y, target.z],
        zoom: cam && cam.zoom != null ? cam.zoom : 1,
      };
    }

    function applyCameraState(state) {
      if (!state) return;
      const mode = state.viewMode || "perspective";
      applyViewMode(mode, { reset: false });
      const cam = activeCamera;
      if (cam && Array.isArray(state.position) && state.position.length >= 3) {
        cam.position.set(Number(state.position[0]) || 0, Number(state.position[1]) || 0, Number(state.position[2]) || 0);
      }
      if (cam && Array.isArray(state.up) && state.up.length >= 3) {
        cam.up.set(Number(state.up[0]) || 0, Number(state.up[1]) || 0, Number(state.up[2]) || 1);
      }
      if (cam && state.zoom != null && Number.isFinite(Number(state.zoom))) {
        cam.zoom = Math.max(0.05, Number(state.zoom));
        cam.updateProjectionMatrix();
      }
      if (controls && Array.isArray(state.target) && state.target.length >= 3) {
        controls.target.set(Number(state.target[0]) || 10, Number(state.target[1]) || 10, Number(state.target[2]) || 10);
        controls.update();
      }
      if (cam && controls) cam.lookAt(controls.target);
    }

    return {
      resize,
      resetCamera,
      clearWorkspace,
      getViewMode() {
        return viewMode;
      },
      setViewMode(mode) {
        applyViewMode(mode, { reset: true });
      },
      getCameraState,
      applyCameraState,
      start() {
        running = true;
        syncOrbitEnabled();
        cancelAnimationFrame(raf);
        tick();
        resize();
      },
      stop() {
        running = false;
        cancelAnimationFrame(raf);
        endTransformPointer();
        if (controls) controls.enabled = false;
      },
      syncChunks,
      syncSections,
      applyLiveTransform,
      beginUiInteraction,
      endUiInteraction,
      setGizmoMode(mode) {
        gizmoMode = mode === "rotate" ? "rotate" : mode === "scale" ? "scale" : "translate";
        if (transform) transform.setMode(editLines && transformNodeIdList().length < 2 ? "translate" : gizmoMode);
        if (editLines) placeEditPivot();
      },
      setEditLines,
      setEditSelection,
      setEditAxis(axis) {
        editAxis = axis === "x" || axis === "y" || axis === "z" ? axis : "free";
        applyAxisConstraint();
      },
      setBoxSelect(enabled) {
        boxSelectMode = !!enabled;
        if (boxSelectMode) moveSegmentMode = false;
      },
      setMoveSegment(enabled) {
        moveSegmentMode = !!enabled;
        if (moveSegmentMode) boxSelectMode = false;
        if (moveSegmentMode) {
          gizmoMode = "translate";
          if (transform) transform.setMode("translate");
          placeEditPivot();
        }
      },
      setOnLineSelect(fn) {
        onLineSelect = fn;
      },
      setOnLineEdit(fn) {
        onLineEdit = fn;
      },
      setOnSelect(fn) {
        onSelect = fn;
      },
      setOnTransform(fn) {
        onTransform = fn;
      },
      setOnSectionSelect(fn) {
        onSectionSelect = fn;
      },
      setOnSectionTransform(fn) {
        onSectionTransform = fn;
      },
      setOnGizmoDragEnd(fn) {
        onGizmoDragEnd = fn;
      },
      setOnNodeSelect(fn) {
        onNodeSelect = fn;
      },
      setOnNodeMove(fn) {
        onNodeMove = fn;
      },
      setOnNodeDragEnd(fn) {
        onNodeDragEnd = fn;
      },
      setEditBranches(enabled) {
        editBranches = !!enabled;
        attachGizmo();
      },
      setSourceBranchesVisible(visible) {
        sourceBranchesVisible = !!visible;
        refreshSourceVisibility();
      },
      setSourcePlanesVisible(visible) {
        sourcePlanesVisible = !!visible;
        refreshSourceVisibility();
        for (const rec of sectionMeshes.values()) rec.plane.visible = !!sourcePlanesVisible;
      },
      setSourceChunksVisible(visible) {
        sourceChunksVisible = !!visible;
        refreshSourceVisibility();
        attachGizmo();
      },
      setSectionLayersVisible(visible) {
        sectionLayersVisible = !!visible;
        for (const rec of sectionMeshes.values()) rec.group.visible = sectionLayersVisible;
        attachGizmo();
      },
      setLoftLinesVisible(visible) {
        loftLinesVisible = !!visible;
        for (const rec of sectionMeshes.values()) rec.lines.visible = loftLinesVisible;
      },
      setLoftSolidsVisible(visible) {
        loftSolidsVisible = !!visible;
        applyLoftOverlayVisibility();
      },
      setSectionCut(enabled, chunk) {
        applySectionCut(enabled, chunk);
      },
      setMass,
      setMassOpacity,
      setLoftOpacity,
      setMassWireframe,
      setMassVisible,
      removeMass,
      hasMass(id) {
        return massMeshes.has(id);
      },
      setLoft,
      clearLoft() {
        setLoft(null);
      },
      hasLoft() {
        return !!loftRec;
      },
      getLoftGeometry,
      setVoxels,
      clearVoxels,
      hasVoxels() {
        return !!(voxelRec && voxelCells.length);
      },
      setVoxelsVisible,
      setVoxelOpacity,
      setVoxelEdges,
      setVoxelColorBySize,
      collectSolidGeometries,
      capturePng,
      previewTurntable,
      stopTurntablePreview,
      exportTurntable,
      isTurntableBusy() {
        return !!(capturingTurntable || turntablePreview);
      },
      setSilhouetteMode,
      setSilhouetteThickness,
      getSilhouetteMode() {
        return silhouetteMode;
      },
      getVoxelExportData() {
        return {
          cells: voxelCells.slice(),
          resolution: voxelResolution,
        };
      },
    };
  }

  function bindSlider(input, label, format) {
    if (!input) return;
    const paint = () => {
      if (label) label.textContent = format(input.value);
    };
    input.addEventListener("input", paint);
    paint();
  }

  function mount(api) {
    let booted = false;
    let viewer = null;
    const chunks = [];
    let nextChunkIndex = 1;
    let selectedChunkId = null;
    const loftSets = [];
    let nextLoftIndex = 1;
    let selectedLoftId = null;
    let selectedSectionId = null;
    let selectedNodeIds = [];
    let editBranches = false;
    let editLines = false;
    let lineAxis = "free";
    let boxSelectOn = false;
    let moveSegmentOn = false;
    let lineUndo = [];
    let lineRedo = [];
    let lineEditing = false;
    let displayLines = true;
    let displaySolids = true;
    let displayVoxels = true;
    let silhouetteOn = false;
    let turntableBusy = false;
    let turntableExporting = false;
    let turntableAbort = null;
    let voxelStale = false;
    let voxelStamp = "";
    let voxelInfo = null;
    let liveLoftOn = false;
    let liveVoxelsOn = false;
    let loftStale = false;
    let applyingSaved3d = false;
    let workspaceDirty = false;
    let openedVariationId = null;
    let openedVariationName = "";
    let save3dMode = "create";
    let pendingDelete3dId = null;
    let rename3dId = null;
    let saved3dRecords = [];
    let loftCapsules = [];
    let exportNameHint = "";
    let loftDraftAt = 0;
    let loftDraftQueued = false;
    let loftFinalTimer = 0;
    let selectedLineNodeIds = [];
    let selectedLineSegIds = [];
    let nodeOrigins = null;
    let nodeToolOrigins = null;
    const massSeeds = new Map();
    let selecting = false;
    let draft = null;
    let drag = null;
    let syncingUi = false;
    let hudInteracting = false;
    let gizmoMode = "translate";
    let viewModeUi = "perspective";
    function paintViewButtons() {
      const mode = viewer && viewer.getViewMode ? viewer.getViewMode() : viewModeUi;
      viewModeUi = mode;
      document.querySelectorAll(".space3d-viewport-bar .space3d-view-btn").forEach((btn) => {
        const on = btn.dataset.view === mode;
        btn.classList.toggle("active", on);
        btn.classList.toggle("primary", false);
        btn.classList.toggle("ghost", !on);
      });
      const hint = document.getElementById("space3dViewHint");
      if (hint) {
        hint.textContent =
          mode === "perspective"
            ? "Left-drag orbit \u00b7 Right-drag pan \u00b7 Scroll zoom"
            : "Right-drag pan \u00b7 Scroll zoom \u00b7 Rotation locked";
      }
    }

    function setViewMode(mode) {
      if (turntableBusy) return;
      viewModeUi = mode;
      if (viewer && viewer.setViewMode) viewer.setViewMode(mode);
      paintViewButtons();
      markWorkspaceDirty();
    }

    function isTypingTarget(el) {
      if (!el || !el.tagName) return false;
      const tag = el.tagName.toUpperCase();
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    }

    function space3dTabActive() {
      const view = document.getElementById("space3dView");
      return view && !view.classList.contains("hidden");
    }
    const stage = document.getElementById("space3dStage");
    const preview = document.getElementById("space3dPreviewCanvas");
    const overlay = document.getElementById("space3dPreviewOverlay");
    const previewWrap = document.getElementById("space3dPreviewWrap");
    const status = document.getElementById("space3dStatus");
    const chunkList = document.getElementById("space3dChunkList");

    const els = {
      resetView: document.getElementById("space3dResetView"),
      resetWorkspace: document.getElementById("space3dResetWorkspace"),
      resetDialog: document.getElementById("space3dResetDialog"),
      resetCancel: document.getElementById("space3dResetCancel"),
      resetConfirm: document.getElementById("space3dResetConfirm"),
      selectChunk: document.getElementById("space3dSelectChunk"),
      confirmChunk: document.getElementById("space3dConfirmChunk"),
      cancelChunk: document.getElementById("space3dCancelChunk"),
      deleteChunk: document.getElementById("space3dDeleteChunk"),
      duplicateChunk: document.getElementById("space3dDuplicateChunk"),
      editLines: document.getElementById("space3dEditLines"),
      lineMove: document.getElementById("space3dLineMove"),
      lineRotate: document.getElementById("space3dLineRotate"),
      lineScale: document.getElementById("space3dLineScale"),
      axisFree: document.getElementById("space3dAxisFree"),
      axisX: document.getElementById("space3dAxisX"),
      axisY: document.getElementById("space3dAxisY"),
      axisZ: document.getElementById("space3dAxisZ"),
      moveSegment: document.getElementById("space3dMoveSegment"),
      boxSelect: document.getElementById("space3dBoxSelect"),
      deleteLine: document.getElementById("space3dDeleteLine"),
      lineUndo: document.getElementById("space3dLineUndo"),
      lineRedo: document.getElementById("space3dLineRedo"),
      chunkSize: document.getElementById("space3dChunkSize"),
      previewSize: document.getElementById("space3dPreviewSize"),
      posX: document.getElementById("space3dPosX"),
      posY: document.getElementById("space3dPosY"),
      posZ: document.getElementById("space3dPosZ"),
      rotX: document.getElementById("space3dRotX"),
      rotY: document.getElementById("space3dRotY"),
      rotZ: document.getElementById("space3dRotZ"),
      scale: document.getElementById("space3dScale"),
      scaleVal: document.getElementById("space3dScaleVal"),
      moveMode: document.getElementById("space3dMoveMode"),
      rotateMode: document.getElementById("space3dRotateMode"),
      scaleMode: document.getElementById("space3dScaleMode"),
      generateMass: document.getElementById("space3dGenerateMass"),
      regenMass: document.getElementById("space3dRegenMass"),
      regenVar: document.getElementById("space3dRegenVar"),
      clearMass: document.getElementById("space3dClearMass"),
      fidelity: document.getElementById("space3dFidelity"),
      fidelityVal: document.getElementById("space3dFidelityVal"),
      massVariation: document.getElementById("space3dMassVariation"),
      massVariationVal: document.getElementById("space3dMassVariationVal"),
      solidWidth: document.getElementById("space3dSolidWidth"),
      solidWidthVal: document.getElementById("space3dSolidWidthVal"),
      solidDepth: document.getElementById("space3dSolidDepth"),
      solidDepthVal: document.getElementById("space3dSolidDepthVal"),
      spatialReach: document.getElementById("space3dSpatialReach"),
      spatialReachVal: document.getElementById("space3dSpatialReachVal"),
      solidOpacity: document.getElementById("space3dSolidOpacity"),
      solidOpacityVal: document.getElementById("space3dSolidOpacityVal"),
      useHierarchy: document.getElementById("space3dUseHierarchy"),
      showBranches: document.getElementById("space3dShowBranches"),
      showPlane: document.getElementById("space3dShowPlane"),
      showWireframe: document.getElementById("space3dShowWireframe"),
      createLoft: document.getElementById("space3dCreateLoft"),
      sectionList: document.getElementById("space3dSectionList"),
      dupSection: document.getElementById("space3dDupSection"),
      remorph: document.getElementById("space3dRemorph"),
      deleteSection: document.getElementById("space3dDeleteSection"),
      sectionUp: document.getElementById("space3dSectionUp"),
      sectionDown: document.getElementById("space3dSectionDown"),
      sectionSpacing: document.getElementById("space3dSectionSpacing"),
      sectionSpacingVal: document.getElementById("space3dSectionSpacingVal"),
      morphStrength: document.getElementById("space3dMorphStrength"),
      morphStrengthVal: document.getElementById("space3dMorphStrengthVal"),
      morphSmoothness: document.getElementById("space3dMorphSmoothness"),
      morphSmoothnessVal: document.getElementById("space3dMorphSmoothnessVal"),
      offset: document.getElementById("space3dOffset"),
      offsetVal: document.getElementById("space3dOffsetVal"),
      scaleX: document.getElementById("space3dScaleX"),
      scaleY: document.getElementById("space3dScaleY"),
      secScale: document.getElementById("space3dSecScale"),
      secScaleVal: document.getElementById("space3dSecScaleVal"),
      secScaleX: document.getElementById("space3dSecScaleX"),
      secScaleXVal: document.getElementById("space3dSecScaleXVal"),
      secScaleY: document.getElementById("space3dSecScaleY"),
      secScaleYVal: document.getElementById("space3dSecScaleYVal"),
      secRot: document.getElementById("space3dSecRot"),
      secRotVal: document.getElementById("space3dSecRotVal"),
      shiftX: document.getElementById("space3dShiftX"),
      shiftXVal: document.getElementById("space3dShiftXVal"),
      shiftY: document.getElementById("space3dShiftY"),
      shiftYVal: document.getElementById("space3dShiftYVal"),
      taper: document.getElementById("space3dTaper"),
      taperVal: document.getElementById("space3dTaperVal"),
      editBranches: document.getElementById("space3dEditBranches"),
      nodeX: document.getElementById("space3dNodeX"),
      nodeY: document.getElementById("space3dNodeY"),
      nodeRot: document.getElementById("space3dNodeRot"),
      nodeRotVal: document.getElementById("space3dNodeRotVal"),
      nodeScale: document.getElementById("space3dNodeScale"),
      nodeScaleVal: document.getElementById("space3dNodeScaleVal"),
      generateLoft: document.getElementById("space3dGenerateLoft"),
      liveLoft: document.getElementById("space3dLiveLoft"),
      regenLoft: document.getElementById("space3dRegenLoft"),
      clearLoft: document.getElementById("space3dClearLoft"),
      loftStatus: document.getElementById("space3dLoftStatus"),
      loftStyle: document.getElementById("space3dLoftStyle"),
      loftWidth: document.getElementById("space3dLoftWidth"),
      loftWidthVal: document.getElementById("space3dLoftWidthVal"),
      loftThick: document.getElementById("space3dLoftThick"),
      loftThickVal: document.getElementById("space3dLoftThickVal"),
      loftHierarchy: document.getElementById("space3dLoftHierarchy"),
      loftOpacity: document.getElementById("space3dLoftOpacity"),
      loftOpacityVal: document.getElementById("space3dLoftOpacityVal"),
      saveVar: document.getElementById("space3dSaveVar"),
      dupVar: document.getElementById("space3dDupVar"),
      varList: document.getElementById("space3dVarList"),
      showSourceChunk: document.getElementById("space3dShowSourceChunk"),
      showSections: document.getElementById("space3dShowSections"),
      showLoftLines: document.getElementById("space3dShowLoftLines"),
      showLoftSolids: document.getElementById("space3dShowLoftSolids"),
      showVoxels: document.getElementById("space3dShowVoxels"),
      dispLines: document.getElementById("space3dDispLines"),
      dispSolids: document.getElementById("space3dDispSolids"),
      dispVoxels: document.getElementById("space3dDispVoxels"),
      silhouette: document.getElementById("space3dSilhouette"),
      silhouetteThick: document.getElementById("space3dSilhouetteThick"),
      silhouetteThickVal: document.getElementById("space3dSilhouetteThickVal"),
      generateVoxels: document.getElementById("space3dGenerateVoxels"),
      liveVoxels: document.getElementById("space3dLiveVoxels"),
      regenVoxels: document.getElementById("space3dRegenVoxels"),
      clearVoxels: document.getElementById("space3dClearVoxels"),
      voxelStatus: document.getElementById("space3dVoxelStatus"),
      voxelRes: document.getElementById("space3dVoxelRes"),
      voxelSource: document.getElementById("space3dVoxelSource"),
      voxelTarget: document.getElementById("space3dVoxelTarget"),
      voxelOpacity: document.getElementById("space3dVoxelOpacity"),
      voxelOpacityVal: document.getElementById("space3dVoxelOpacityVal"),
      voxelFidelity: document.getElementById("space3dVoxelFidelity"),
      voxelFidelityVal: document.getElementById("space3dVoxelFidelityVal"),
      voxelColorBySize: document.getElementById("space3dVoxelColorBySize"),
      voxelEdges: document.getElementById("space3dVoxelEdges"),
      voxelStats: document.getElementById("space3dVoxelStats"),
      exportStatus: document.getElementById("space3dExportStatus"),
      exportLoft3dm: document.getElementById("space3dExportLoft3dm"),
      exportLoftObj: document.getElementById("space3dExportLoftObj"),
      exportVoxels3dm: document.getElementById("space3dExportVoxels3dm"),
      exportVoxelsObj: document.getElementById("space3dExportVoxelsObj"),
      pngRes: document.getElementById("space3dPngRes"),
      pngBg: document.getElementById("space3dPngBg"),
      pngSave: document.getElementById("space3dExportPng"),
      turnDur: document.getElementById("space3dTurnDur"),
      turnFps: document.getElementById("space3dTurnFps"),
      turnRes: document.getElementById("space3dTurnRes"),
      turnDir: document.getElementById("space3dTurnDir"),
      turnPivot: document.getElementById("space3dTurnPivot"),
      turnBg: document.getElementById("space3dTurnBg"),
      turnStatus: document.getElementById("space3dTurnStatus"),
      turnPreview: document.getElementById("space3dTurnPreview"),
      turnStop: document.getElementById("space3dTurnStop"),
      turnExport: document.getElementById("space3dTurnExport"),
      turnOverlay: document.getElementById("space3dTurnOverlay"),
      turnProgressTitle: document.getElementById("space3dTurnProgressTitle"),
      turnProgressDetail: document.getElementById("space3dTurnProgressDetail"),
      turnBar: document.getElementById("space3dTurnBar"),
      turnCancel: document.getElementById("space3dTurnCancel"),
      save3d: document.getElementById("space3dSave3d"),
      save3dUpdate: document.getElementById("space3dSave3dUpdate"),
      save3dAs: document.getElementById("space3dSave3dAs"),
      saved3dStatus: document.getElementById("space3dSaved3dStatus"),
      save3dPanel: document.getElementById("space3dSave3dPanel"),
      save3dName: document.getElementById("space3dSave3dName"),
      save3dConfirm: document.getElementById("space3dSave3dConfirm"),
      save3dCancel: document.getElementById("space3dSave3dCancel"),
      saved3dList: document.getElementById("space3dSaved3dList"),
      delete3dDialog: document.getElementById("space3dDelete3dDialog"),
      delete3dCancel: document.getElementById("space3dDelete3dCancel"),
      delete3dConfirm: document.getElementById("space3dDelete3dConfirm"),
    };

    function setStatus(message, kind) {
      if (!status) return;
      status.textContent = message;
      status.classList.toggle("active", kind === "active");
      status.classList.toggle("error", kind === "error");
    }

    function selectedChunk() {
      return chunks.find((item) => item.id === selectedChunkId) || null;
    }

    function selectedLoft() {
      if (selectedLoftId) return loftSets.find((item) => item.id === selectedLoftId) || null;
      const chunk = selectedChunk();
      if (chunk && chunk.loftSetId) return loftSets.find((item) => item.id === chunk.loftSetId) || null;
      return null;
    }

    function selectedSection() {
      const loft = selectedLoft();
      if (!loft) return null;
      return loft.sections.find((item) => item.id === selectedSectionId) || null;
    }

    function transformTarget() {
      return selectedSection() || selectedChunk();
    }

    function makeSection(loft, index, sourceSection) {
      const lib = global.D7SpatialLoft;
      const nodes = (sourceSection
        ? sourceSection.nodes
        : loft.topology.nodes
      ).map((node) => ({ id: node.id, x: node.x, y: node.y, z: node.z || 0 }));
      const transform = lib.copyTransform(
        sourceSection ? sourceSection.transform : selectedChunk() ? selectedChunk().transform : { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 }
      );
      const deform = sourceSection
        ? JSON.parse(JSON.stringify(sourceSection.deform || lib.defaultDeform()))
        : lib.defaultDeform();
      return {
        id: `${loft.id}-sec-${index}`,
        index,
        label: `Section ${pad2(index)}`,
        kind: sourceSection ? "morph" : "source",
        nodes,
        transform,
        offset: sourceSection ? Number(sourceSection.offset) || 0 : 0,
        deform,
        morphSeed: sourceSection ? null : 0,
      };
    }

    function refreshLoftView() {
      if (viewer && viewer.syncSections) {
        viewer.syncSections(selectedLoft(), selectedSectionId, selectedNodeIds);
      }
    }

    function paintArea() {
      const rect = draft || (selectedChunk() ? selectedChunk().bounds : null);
      const text =
        rect && rect.w >= 0.05 && rect.h >= 0.05
          ? `Selected Area: ${rect.w.toFixed(1)} × ${rect.h.toFixed(1)}`
          : "Selected Area: \u2014";
      if (els.chunkSize) els.chunkSize.textContent = text;
      if (els.previewSize) els.previewSize.textContent = text;
    }

    function eventToFt(event, canvas) {
      const box = canvas.getBoundingClientRect();
      const u = clamp((event.clientX - box.left) / Math.max(1, box.width), 0, 1);
      const v = clamp((event.clientY - box.top) / Math.max(1, box.height), 0, 1);
      return { x: u * CUBE, y: v * CUBE };
    }

    function rectFromPoints(a, b) {
      const x0 = clamp(Math.min(a.x, b.x), 0, CUBE);
      const y0 = clamp(Math.min(a.y, b.y), 0, CUBE);
      const x1 = clamp(Math.max(a.x, b.x), 0, CUBE);
      const y1 = clamp(Math.max(a.y, b.y), 0, CUBE);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    function hitHandle(pt, rect, canvas) {
      if (!rect) return null;
      const box = canvas.getBoundingClientRect();
      const tol = (10 / Math.max(1, box.width)) * CUBE;
      const spots = [
        ["nw", rect.x, rect.y],
        ["n", rect.x + rect.w * 0.5, rect.y],
        ["ne", rect.x + rect.w, rect.y],
        ["e", rect.x + rect.w, rect.y + rect.h * 0.5],
        ["se", rect.x + rect.w, rect.y + rect.h],
        ["s", rect.x + rect.w * 0.5, rect.y + rect.h],
        ["sw", rect.x, rect.y + rect.h],
        ["w", rect.x, rect.y + rect.h * 0.5],
      ];
      for (const [id, x, y] of spots) {
        if (Math.abs(pt.x - x) <= tol && Math.abs(pt.y - y) <= tol) return id;
      }
      return null;
    }

    function resizeFromHandle(origin, handle, pt) {
      let x0 = origin.x;
      let y0 = origin.y;
      let x1 = origin.x + origin.w;
      let y1 = origin.y + origin.h;
      const p = { x: clamp(pt.x, 0, CUBE), y: clamp(pt.y, 0, CUBE) };
      if (handle.indexOf("w") >= 0) x0 = p.x;
      if (handle.indexOf("e") >= 0) x1 = p.x;
      if (handle.indexOf("n") >= 0) y0 = p.y;
      if (handle.indexOf("s") >= 0) y1 = p.y;
      return rectFromPoints({ x: x0, y: y0 }, { x: x1, y: y1 });
    }

    function cursorForHandle(handle) {
      if (handle === "n" || handle === "s") return "ns-resize";
      if (handle === "e" || handle === "w") return "ew-resize";
      if (handle === "nw" || handle === "se") return "nwse-resize";
      if (handle === "ne" || handle === "sw") return "nesw-resize";
      if (handle === "move") return "move";
      return "crosshair";
    }

    function drawOverlay() {
      if (!overlay) return;
      const ctx = overlay.getContext("2d");
      if (!ctx) return;
      const w = overlay.width;
      const h = overlay.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      function ftToPx(x, y) {
        return { x: (x / CUBE) * w, y: (y / CUBE) * h };
      }
      function strokeRect(rect, color, width, dash, label, handles) {
        const a = ftToPx(rect.x, rect.y);
        const bw = (rect.w / CUBE) * w;
        const bh = (rect.h / CUBE) * h;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(dash || []);
        ctx.strokeRect(a.x + 0.5, a.y + 0.5, bw, bh);
        if (label) {
          ctx.setLineDash([]);
          ctx.fillStyle = color;
          ctx.font = "10px IBM Plex Mono, ui-monospace, monospace";
          ctx.fillText(label, a.x + 4, a.y + 12);
        }
        if (handles) {
          const spots = [
            [rect.x, rect.y],
            [rect.x + rect.w * 0.5, rect.y],
            [rect.x + rect.w, rect.y],
            [rect.x + rect.w, rect.y + rect.h * 0.5],
            [rect.x + rect.w, rect.y + rect.h],
            [rect.x + rect.w * 0.5, rect.y + rect.h],
            [rect.x, rect.y + rect.h],
            [rect.x, rect.y + rect.h * 0.5],
          ];
          ctx.setLineDash([]);
          ctx.fillStyle = "#111";
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1;
          for (const [x, y] of spots) {
            const p = ftToPx(x, y);
            ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
            ctx.strokeRect(p.x - 3, p.y - 3, 6, 6);
          }
        }
        ctx.restore();
      }
      for (const chunk of chunks) {
        const selected = chunk.id === selectedChunkId;
        strokeRect(
          chunk.bounds,
          selected ? "rgba(232,213,163,0.95)" : "rgba(200,196,188,0.55)",
          selected ? 1.6 : 1,
          [],
          pad2(chunk.index),
          false
        );
      }
      if (draft && selecting) {
        strokeRect(draft, "rgba(255,255,255,0.95)", 1.5, [5, 3], null, true);
      }
    }

    function updateSelectMode() {
      if (previewWrap) previewWrap.classList.toggle("is-selecting", selecting);
      if (els.selectChunk) {
        els.selectChunk.classList.toggle("primary", selecting);
        els.selectChunk.classList.toggle("ghost", !selecting);
      }
      if (els.confirmChunk) {
        els.confirmChunk.disabled = !selecting || !draft || draft.w < 0.4 || draft.h < 0.4;
      }
      if (els.cancelChunk) els.cancelChunk.disabled = !selecting;
      paintArea();
      drawOverlay();
    }

    function refreshChunks() {
      if (viewer && viewer.syncChunks) viewer.syncChunks(chunks, selectedChunkId);
      refreshLoftView();
      drawOverlay();
    }

    function snapshotLineGraph(chunk) {
      if (!chunk) return null;
      return JSON.parse(
        JSON.stringify({
          nodes: chunk.nodes,
          segments: chunk.segments,
          loft:
            chunk.loftSetId &&
            loftSets
              .filter((item) => item.id === chunk.loftSetId)
              .map((item) => ({
                id: item.id,
                topology: item.topology,
                sections: item.sections.map((sec) => ({ id: sec.id, nodes: sec.nodes })),
              }))[0],
        })
      );
    }

    function applyLineGraph(chunk, snap) {
      if (!chunk || !snap) return;
      chunk.nodes = JSON.parse(JSON.stringify(snap.nodes || []));
      chunk.segments = JSON.parse(JSON.stringify(snap.segments || []));
      rebuildBranchesFromGraph(chunk);
      if (snap.loft && chunk.loftSetId) {
        const loft = loftSets.find((item) => item.id === chunk.loftSetId);
        if (loft && snap.loft.topology) {
          loft.topology = JSON.parse(JSON.stringify(snap.loft.topology));
          const bySec = new Map((snap.loft.sections || []).map((sec) => [sec.id, sec.nodes]));
          for (const section of loft.sections) {
            if (bySec.has(section.id)) section.nodes = JSON.parse(JSON.stringify(bySec.get(section.id)));
          }
        }
      }
      syncLoftFromChunk(chunk);
    }

    function pushLineUndo(chunk) {
      if (!chunk) return;
      lineUndo.push(snapshotLineGraph(chunk));
      if (lineUndo.length > 40) lineUndo.shift();
      lineRedo = [];
    }

    function syncLoftFromChunk(chunk) {
      if (!chunk || !chunk.loftSetId) return;
      const loft = loftSets.find((item) => item.id === chunk.loftSetId);
      if (!loft) return;
      const lib = global.D7SpatialLoft;
      if (lib) {
        const topo = lib.topologyFromChunk(chunk);
        loft.topology.nodes = topo.nodes;
        loft.topology.segments = topo.segments;
      }
      const first = loft.sections[0];
      if (first) {
        const liveIds = new Set((chunk.nodes || []).map((n) => n.id));
        first.nodes = (chunk.nodes || []).map((node) => {
          const prev = first.nodes.find((n) => n.id === node.id);
          return {
            id: node.id,
            x: node.x,
            y: node.y,
            z: node.z || 0,
          };
        });
        for (let i = 1; i < loft.sections.length; i++) {
          loft.sections[i].nodes = loft.sections[i].nodes.filter((n) => liveIds.has(n.id));
        }
      }
    }

    function lineTransformCount() {
      const ids = new Set(selectedLineNodeIds);
      const chunk = selectedChunk();
      if (chunk) {
        for (const seg of chunk.segments || []) {
          if (selectedLineSegIds.indexOf(seg.id) >= 0) {
            ids.add(seg.a);
            ids.add(seg.b);
          }
        }
      }
      return ids.size;
    }

    function paintLineButtons() {
      const chunk = selectedChunk();
      const on = editLines && !!chunk;
      const view = document.getElementById("space3dView");
      if (view) view.classList.toggle("is-edit-lines", on);
      const badge = document.getElementById("space3dEditBadge");
      if (badge) badge.hidden = !on;
      const count = lineTransformCount();
      const toggle = (el, active, extra) => {
        if (!el) return;
        el.disabled = extra && extra.disabled != null ? extra.disabled : !chunk;
        el.classList.toggle("primary", !!active);
        el.classList.toggle("ghost", !active);
      };
      toggle(els.editLines, on, { disabled: !chunk });
      toggle(els.lineMove, on && gizmoMode === "translate", { disabled: !on });
      toggle(els.lineRotate, on && gizmoMode === "rotate", { disabled: !on || count < 2 });
      toggle(els.lineScale, on && gizmoMode === "scale", { disabled: !on || count < 2 });
      toggle(els.axisFree, on && lineAxis === "free", { disabled: !on });
      toggle(els.axisX, on && lineAxis === "x", { disabled: !on });
      toggle(els.axisY, on && lineAxis === "y", { disabled: !on });
      toggle(els.axisZ, on && lineAxis === "z", { disabled: !on });
      toggle(els.boxSelect, on && boxSelectOn, { disabled: !on });
      toggle(els.moveSegment, on && moveSegmentOn, { disabled: !on });
      if (els.deleteLine) els.deleteLine.disabled = !on || (!selectedLineNodeIds.length && !selectedLineSegIds.length);
      if (els.lineUndo) els.lineUndo.disabled = !on || !lineUndo.length;
      if (els.lineRedo) els.lineRedo.disabled = !on || !lineRedo.length;
    }

    function setLineAxis(axis) {
      lineAxis = axis;
      if (viewer && viewer.setEditAxis) viewer.setEditAxis(axis);
      paintLineButtons();
    }

    function toggleEditLines() {
      if (turntableBusy) return;
      const chunk = selectedChunk();
      if (!chunk) return;
      editLines = !editLines;
      if (editLines) {
        editBranches = false;
        if (viewer && viewer.setEditBranches) viewer.setEditBranches(false);
        ensureGraphIds(chunk);
        rebuildBranchesFromGraph(chunk);
        lineUndo = [];
        lineRedo = [];
        selectedLineNodeIds = [];
        selectedLineSegIds = [];
      } else {
        boxSelectOn = false;
        moveSegmentOn = false;
        if (viewer && viewer.setBoxSelect) viewer.setBoxSelect(false);
        if (viewer && viewer.setMoveSegment) viewer.setMoveSegment(false);
      }
      if (viewer && viewer.setEditLines) viewer.setEditLines(editLines, chunk);
      refreshChunks();
      paintLineButtons();
      fillTransformUi();
      setStatus(
        editLines
          ? "Edit Lines · click a node or segment. Shift-click adds to the selection. Delete removes geometry."
          : "Edit Lines off.",
        "active"
      );
    }

    function deleteSelectedLines() {
      const chunk = selectedChunk();
      if (!editLines || !chunk) return;
      if (!selectedLineNodeIds.length && !selectedLineSegIds.length) return;
      pushLineUndo(chunk);
      ensureGraphIds(chunk);
      const dropSeg = new Set(selectedLineSegIds);
      if (dropSeg.size) {
        chunk.segments = (chunk.segments || []).filter((seg) => !dropSeg.has(seg.id));
      }
      const dropNode = new Set(selectedLineNodeIds);
      if (dropNode.size) {
        chunk.segments = (chunk.segments || []).filter((seg) => !dropNode.has(seg.a) && !dropNode.has(seg.b));
        chunk.nodes = (chunk.nodes || []).filter((n) => !dropNode.has(n.id));
      }
      rebuildBranchesFromGraph(chunk);
      syncLoftFromChunk(chunk);
      selectedLineNodeIds = [];
      selectedLineSegIds = [];
      if (viewer && viewer.setEditSelection) viewer.setEditSelection([], []);
      refreshChunks();
      paintLineButtons();
      noteLoftGeometryChanged("commit");
      setStatus("Deleted selected line geometry. Other branches are unchanged.", "active");
    }

    function undoLineEdit() {
      const chunk = selectedChunk();
      if (!chunk || !lineUndo.length) return;
      lineRedo.push(snapshotLineGraph(chunk));
      applyLineGraph(chunk, lineUndo.pop());
      selectedLineNodeIds = [];
      selectedLineSegIds = [];
      if (viewer && viewer.setEditLines) viewer.setEditLines(true, chunk);
      refreshChunks();
      paintLineButtons();
      noteLoftGeometryChanged("commit");
    }

    function redoLineEdit() {
      const chunk = selectedChunk();
      if (!chunk || !lineRedo.length) return;
      lineUndo.push(snapshotLineGraph(chunk));
      applyLineGraph(chunk, lineRedo.pop());
      selectedLineNodeIds = [];
      selectedLineSegIds = [];
      if (viewer && viewer.setEditLines) viewer.setEditLines(true, chunk);
      refreshChunks();
      paintLineButtons();
      noteLoftGeometryChanged("commit");
    }

    function fillTransformUi() {
      if (hudInteracting) return;
      const section = selectedSection();
      const chunk = selectedChunk();
      const target = section || chunk;
      const enabled = !!target;
      const sectionOn = !!section;
      for (const key of ["posX", "posY", "posZ", "rotX", "rotY", "rotZ", "scale"]) {
        if (els[key]) els[key].disabled = !enabled;
      }
      for (const key of ["offset", "scaleX", "scaleY", "secScale", "secScaleX", "secScaleY", "secRot", "shiftX", "shiftY", "taper"]) {
        if (els[key]) els[key].disabled = !sectionOn;
      }
      if (els.deleteChunk) els.deleteChunk.disabled = !chunk;
      if (els.duplicateChunk) els.duplicateChunk.disabled = !chunk;
      if (els.createLoft) els.createLoft.disabled = !chunk;
      if (els.dupSection) els.dupSection.disabled = !sectionOn;
      if (els.remorph) els.remorph.disabled = !sectionOn;
      if (els.deleteSection) els.deleteSection.disabled = !sectionOn || (selectedLoft() && selectedLoft().sections.length < 2);
      const loft = selectedLoft();
      const idx = loft && section ? loft.sections.findIndex((item) => item.id === section.id) : -1;
      if (els.sectionUp) els.sectionUp.disabled = idx <= 0;
      if (els.sectionDown) els.sectionDown.disabled = !loft || idx < 0 || idx >= loft.sections.length - 1;
      if (els.editBranches) {
        els.editBranches.disabled = !sectionOn || editLines;
        els.editBranches.classList.toggle("primary", editBranches && sectionOn && !editLines);
        els.editBranches.classList.toggle("ghost", !(editBranches && sectionOn && !editLines));
      }
      paintLineButtons();
      paintDisplayButtons();
      paintVoxelButtons();
      paintLiveButtons();
      paintExportButtons();
      const hasMass = !!(chunk && viewer && viewer.hasMass && viewer.hasMass(chunk.id));
      if (els.generateMass) els.generateMass.disabled = !chunk;
      if (els.regenMass) els.regenMass.disabled = !hasMass;
      if (els.regenVar) els.regenVar.disabled = !hasMass;
      if (els.clearMass) els.clearMass.disabled = !hasMass;
      const canLoft = !!(loft && loft.sections.length >= 2);
      const hasLoft = !!(viewer && viewer.hasLoft && viewer.hasLoft());
      if (els.generateLoft) els.generateLoft.disabled = !canLoft;
      if (els.regenLoft) els.regenLoft.disabled = !hasLoft;
      if (els.clearLoft) els.clearLoft.disabled = !hasLoft;
      if (els.saveVar) els.saveVar.disabled = !loft;
      if (els.dupVar) els.dupVar.disabled = !(loft && loft.variations && loft.variations.length);
      const hasNodes = sectionOn && selectedNodeIds.length > 0;
      if (els.nodeX) els.nodeX.disabled = !hasNodes;
      if (els.nodeY) els.nodeY.disabled = !hasNodes;
      if (els.nodeRot) els.nodeRot.disabled = selectedNodeIds.length < 2;
      if (els.nodeScale) els.nodeScale.disabled = selectedNodeIds.length < 2;
      if (!target) {
        if (els.posX) els.posX.value = "0";
        if (els.posY) els.posY.value = "0";
        if (els.posZ) els.posZ.value = "0";
        if (els.rotX) els.rotX.value = "0";
        if (els.rotY) els.rotY.value = "0";
        if (els.rotZ) els.rotZ.value = "0";
        if (els.scale) els.scale.value = "1";
        if (els.scaleVal) els.scaleVal.textContent = "1.00";
        if (els.scaleX) els.scaleX.value = "1";
        if (els.scaleY) els.scaleY.value = "1";
        if (els.nodeX) els.nodeX.value = "0";
        if (els.nodeY) els.nodeY.value = "0";
        return;
      }
      const t = target.transform;
      syncingUi = true;
      if (els.posX) els.posX.value = Number(t.x).toFixed(2);
      if (els.posY) els.posY.value = Number(t.y).toFixed(2);
      if (els.posZ) els.posZ.value = Number(t.z).toFixed(2);
      if (els.rotX) els.rotX.value = Number(t.rx || 0).toFixed(1);
      if (els.rotY) els.rotY.value = Number(t.ry || 0).toFixed(1);
      if (els.rotZ) els.rotZ.value = Number(t.rz || 0).toFixed(1);
      if (els.scale) els.scale.value = String(t.scale != null ? t.scale : 1);
      if (els.scaleVal) els.scaleVal.textContent = Number(t.scale != null ? t.scale : 1).toFixed(2);
      if (sectionOn) {
        if (els.scaleX) els.scaleX.value = Number(t.sx != null ? t.sx : 1).toFixed(2);
        if (els.scaleY) els.scaleY.value = Number(t.sy != null ? t.sy : 1).toFixed(2);
        if (els.offset) els.offset.value = String(section.offset || 0);
        if (els.offsetVal) els.offsetVal.textContent = Number(section.offset || 0).toFixed(1);
        const d = section.deform || {};
        if (els.secScale) els.secScale.value = String(Math.round((d.scale || 1) * 100));
        if (els.secScaleVal) els.secScaleVal.textContent = `${Math.round((d.scale || 1) * 100)}%`;
        if (els.secScaleX) els.secScaleX.value = String(Math.round((d.scaleX || 1) * 100));
        if (els.secScaleXVal) els.secScaleXVal.textContent = `${Math.round((d.scaleX || 1) * 100)}%`;
        if (els.secScaleY) els.secScaleY.value = String(Math.round((d.scaleY || 1) * 100));
        if (els.secScaleYVal) els.secScaleYVal.textContent = `${Math.round((d.scaleY || 1) * 100)}%`;
        if (els.secRot) els.secRot.value = String(Math.round(d.rotation || 0));
        if (els.secRotVal) els.secRotVal.textContent = `${Math.round(d.rotation || 0)}°`;
        if (els.shiftX) els.shiftX.value = String(d.shiftX || 0);
        if (els.shiftXVal) els.shiftXVal.textContent = Number(d.shiftX || 0).toFixed(1);
        if (els.shiftY) els.shiftY.value = String(d.shiftY || 0);
        if (els.shiftYVal) els.shiftYVal.textContent = Number(d.shiftY || 0).toFixed(1);
        if (els.taper) els.taper.value = String(Math.round((d.taper != null ? d.taper : 1) * 100));
        if (els.taperVal) els.taperVal.textContent = `${Math.round((d.taper != null ? d.taper : 1) * 100)}%`;
        if (hasNodes) {
          const node = section.nodes.find((item) => item.id === selectedNodeIds[0]);
          if (node) {
            if (els.nodeX) els.nodeX.value = node.x.toFixed(2);
            if (els.nodeY) els.nodeY.value = node.y.toFixed(2);
          }
        }
      }
      syncingUi = false;
    }

    function applyTransformFromUi(event) {
      if (turntableBusy) return;
      const target = transformTarget();
      if (!target || syncingUi) return;
      markWorkspaceDirty();
      target.transform = {
        x: Number(els.posX?.value ?? target.transform.x),
        y: Number(els.posY?.value ?? target.transform.y),
        z: Number(els.posZ?.value ?? target.transform.z),
        rx: Number(els.rotX?.value ?? target.transform.rx),
        ry: Number(els.rotY?.value ?? target.transform.ry),
        rz: Number(els.rotZ?.value ?? target.transform.rz),
        scale: Math.max(0.05, Number(els.scale?.value ?? target.transform.scale)),
        sx: Math.max(0.05, Number(els.scaleX?.value ?? target.transform.sx ?? 1)),
        sy: Math.max(0.05, Number(els.scaleY?.value ?? target.transform.sy ?? 1)),
      };
      if (els.scaleVal) els.scaleVal.textContent = target.transform.scale.toFixed(2);
      const section = selectedSection();
      if (section) {
        section.offset = Number(els.offset?.value ?? section.offset ?? 0);
        if (els.offsetVal) els.offsetVal.textContent = Number(section.offset).toFixed(1);
        if (viewer && viewer.applyLiveTransform) viewer.applyLiveTransform("section", section);
        else refreshChunks();
        noteLoftGeometryChanged(event && event.type === "change" ? "commit" : "live");
        return;
      }
      if (viewer && viewer.applyLiveTransform) viewer.applyLiveTransform("chunk", target);
      else refreshChunks();
      markVoxelStale();
    }

    function applyDeformFromUi(event) {
      const section = selectedSection();
      if (!section || syncingUi) return;
      section.deform = {
        scale: Number(els.secScale?.value ?? 100) / 100,
        scaleX: Number(els.secScaleX?.value ?? 100) / 100,
        scaleY: Number(els.secScaleY?.value ?? 100) / 100,
        rotation: Number(els.secRot?.value ?? 0),
        shiftX: Number(els.shiftX?.value ?? 0),
        shiftY: Number(els.shiftY?.value ?? 0),
        taper: Number(els.taper?.value ?? 100) / 100,
      };
      refreshLoftView();
      noteLoftGeometryChanged(event && event.type === "change" ? "commit" : "live");
    }

    function renderChunkList() {
      if (!chunkList) return;
      chunkList.innerHTML = "";
      for (const chunk of chunks) {
        const item = document.createElement("li");
        item.className = chunk.id === selectedChunkId ? "selected" : "";
        item.innerHTML = `<span>${chunk.label} · ${chunk.width.toFixed(1)} × ${chunk.height.toFixed(1)}</span>`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          deleteChunk(chunk.id);
        });
        item.addEventListener("click", () => {
          selectedChunkId = chunk.id;
          selectedLoftId = chunk.loftSetId || null;
          if (!chunk.loftSetId) {
            selectedSectionId = null;
            selectedNodeIds = [];
          }
          refreshChunkUi();
          refreshChunks();
        });
        item.appendChild(remove);
        chunkList.appendChild(item);
      }
    }

    function renderSectionList() {
      const list = els.sectionList;
      if (!list) return;
      list.innerHTML = "";
      const loft = selectedLoft();
      if (!loft) return;
      loft.sections.forEach((section, index) => {
        const item = document.createElement("li");
        item.className = section.id === selectedSectionId ? "selected" : "";
        const kind = index === 0 && section.kind !== "morph" ? "Source" : `Morph ${String(index).padStart(2, "0")}`;
        item.innerHTML = `<span>${section.label} · ${kind} · offset ${Number(section.offset || 0).toFixed(1)}</span>`;
        item.addEventListener("click", () => {
          selectedSectionId = section.id;
          selectedNodeIds = [];
          refreshChunkUi();
          refreshChunks();
        });
        list.appendChild(item);
      });
    }

    function renderVarList() {
      const list = els.varList;
      if (!list) return;
      list.innerHTML = "";
      const loft = selectedLoft();
      if (!loft) return;
      for (const variation of loft.variations || []) {
        const item = document.createElement("li");
        item.innerHTML = `<span>${variation.label}</span>`;
        const load = document.createElement("button");
        load.type = "button";
        load.textContent = "Load";
        load.addEventListener("click", (event) => {
          event.stopPropagation();
          applyVariation(loft, variation);
        });
        item.appendChild(load);
        list.appendChild(item);
      }
    }

    function refreshChunkUi() {
      renderChunkList();
      renderSectionList();
      renderVarList();
      fillTransformUi();
      paintArea();
      paintSaved3dButtons();
    }

    function setGizmoMode(mode) {
      gizmoMode = mode;
      if (viewer) viewer.setGizmoMode(mode);
      if (els.moveMode) {
        els.moveMode.classList.toggle("primary", mode === "translate");
        els.moveMode.classList.toggle("ghost", mode !== "translate");
      }
      if (els.rotateMode) {
        els.rotateMode.classList.toggle("primary", mode === "rotate");
        els.rotateMode.classList.toggle("ghost", mode !== "rotate");
      }
      if (els.scaleMode) {
        els.scaleMode.classList.toggle("primary", mode === "scale");
        els.scaleMode.classList.toggle("ghost", mode !== "scale");
      }
      paintLineButtons();
    }

    function beginSelect() {
      selecting = true;
      draft = null;
      updateSelectMode();
      setStatus("Draw a rectangle on the 2D Reference. The full 20 × 20 field stays visible.", "active");
    }

    function cancelSelect() {
      selecting = false;
      draft = null;
      drag = null;
      updateSelectMode();
      setStatus("Selection cancelled.");
    }

    function confirmSelection() {
      if (!draft || draft.w < 0.4 || draft.h < 0.4) {
        setStatus("Draw a region on the 2D Reference first.", "error");
        return;
      }
      const source = api && api.capture2d ? api.capture2d() : null;
      if (!source || !source.nodes || !source.nodes.length) {
        setStatus("Grow a 2D simulation in Studio first. The chunk copies existing branches.", "error");
        return;
      }
      const index = nextChunkIndex++;
      const chunk = captureChunkFromSource(source, draft, {
        id: `chunk-${index}`,
        index,
        label: `Chunk ${pad2(index)}`,
      });
      if (!chunk) {
        setStatus("No branch geometry in that region.", "error");
        return;
      }
      chunks.push(chunk);
      selectedChunkId = chunk.id;
      selecting = false;
      draft = null;
      updateSelectMode();
      refreshChunkUi();
      refreshChunks();
      markWorkspaceDirty();
      setStatus(
        `${chunk.label} placed on the XY plane at Z = 0 · ${chunk.width.toFixed(1)} × ${chunk.height.toFixed(1)}`,
        "active"
      );
    }

    function deleteChunk(id) {
      const index = chunks.findIndex((item) => item.id === id);
      if (index < 0) return;
      const chunk = chunks[index];
      chunks.splice(index, 1);
      massSeeds.delete(id);
      if (viewer && viewer.removeMass) viewer.removeMass(id);
      if (chunk.loftSetId) {
        const li = loftSets.findIndex((item) => item.id === chunk.loftSetId);
        if (li >= 0) loftSets.splice(li, 1);
        if (viewer && viewer.clearLoft) viewer.clearLoft();
        if (selectedLoftId === chunk.loftSetId) {
          selectedLoftId = null;
          selectedSectionId = null;
          selectedNodeIds = [];
          editBranches = false;
          if (viewer && viewer.setEditBranches) viewer.setEditBranches(false);
        }
      }
      if (selectedChunkId === id) selectedChunkId = null;
      refreshChunkUi();
      refreshChunks();
      markVoxelStale();
      setStatus("3D chunk removed. The 2D simulation is unchanged.", "active");
    }

    function duplicateSelected() {
      const chunk = selectedChunk();
      if (!chunk) return;
      const index = nextChunkIndex++;
      const copy = cloneChunk(chunk, {
        id: `chunk-${index}`,
        index,
        label: `Chunk ${pad2(index)}`,
      });
      chunks.push(copy);
      selectedChunkId = copy.id;
      refreshChunkUi();
      refreshChunks();
      setStatus(`${copy.label} duplicated.`, "active");
    }

    function createLoftSet() {
      const chunk = selectedChunk();
      if (!chunk) {
        setStatus("Place a 2D chunk first.", "error");
        return;
      }
      const lib = global.D7SpatialLoft;
      if (!lib) {
        setStatus("Section loft module did not load.", "error");
        return;
      }
      if (chunk.loftSetId && loftSets.some((item) => item.id === chunk.loftSetId)) {
        selectedLoftId = chunk.loftSetId;
        const existing = selectedLoft();
        selectedSectionId = existing && existing.sections[0] ? existing.sections[0].id : null;
        refreshChunkUi();
        refreshChunks();
        setStatus(`${existing.label} already exists for this chunk.`, "active");
        return;
      }
      const topology = lib.topologyFromChunk(chunk);
      if (!topology.segments.length) {
        setStatus("That chunk has no connected branch topology to loft.", "error");
        return;
      }
      const index = nextLoftIndex++;
      const loft = {
        id: `loft-${index}`,
        label: `Loft Set ${pad2(index)}`,
        sourceChunkId: chunk.id,
        topology,
        width: chunk.width,
        height: chunk.height,
        sections: [],
        variations: [],
        nextSection: 2,
        nextVar: 1,
      };
      const section = makeSection(loft, 1, null);
      loft.sections.push(section);
      chunk.loftSetId = loft.id;
      loftSets.push(loft);
      selectedLoftId = loft.id;
      selectedSectionId = section.id;
      selectedNodeIds = [];
      exportNameHint = loft.label;
      refreshChunkUi();
      refreshChunks();
      setStatus(`${loft.label} · ${section.label} from ${chunk.label}. Add Morphed Section to evolve geometry, then Generate Loft when ready.`, "active");
    }

    function sectionSpacingValue() {
      return Math.max(0, Number(els.sectionSpacing?.value ?? 4));
    }

    function morphStrengthValue() {
      return clamp(Number(els.morphStrength?.value ?? 30) / 100, 0, 1);
    }

    function morphSmoothnessValue() {
      return clamp(Number(els.morphSmoothness?.value ?? 70) / 100, 0, 1);
    }

    function newMorphSeed() {
      return (Math.random() * 0xffffffff) >>> 0;
    }

    function morphNodesFrom(sourceNodes) {
      const lib = global.D7SpatialLoft;
      const seed = newMorphSeed();
      if (!lib || !lib.morphSectionNodes) {
        return { nodes: (sourceNodes || []).map((node) => ({ id: node.id, x: node.x, y: node.y, z: node.z || 0 })), seed };
      }
      return {
        nodes: lib.morphSectionNodes(sourceNodes, {
          strength: morphStrengthValue(),
          smoothness: morphSmoothnessValue(),
          seed,
        }),
        seed,
      };
    }

    function addMorphedSection() {
      const loft = selectedLoft();
      const section = selectedSection();
      if (!loft || !section) return;
      const index = loft.nextSection++;
      const copy = makeSection(loft, index, section);
      const morphed = morphNodesFrom(section.nodes);
      copy.kind = "morph";
      copy.morphSeed = morphed.seed;
      copy.nodes = morphed.nodes;
      copy.offset = (Number(section.offset) || 0) + sectionSpacingValue();
      const at = loft.sections.findIndex((item) => item.id === section.id);
      loft.sections.splice(at + 1, 0, copy);
      selectedSectionId = copy.id;
      selectedNodeIds = [];
      refreshChunkUi();
      refreshChunks();
      noteLoftGeometryChanged("commit");
      setStatus(
        `${copy.label} morphed from ${section.label} · offset ${copy.offset.toFixed(1)} along the local normal. Loft is not generated until you click Generate Loft.`,
        "active"
      );
    }

    function remorphSelected() {
      const loft = selectedLoft();
      const section = selectedSection();
      if (!loft || !section) return;
      const idx = loft.sections.findIndex((item) => item.id === section.id);
      const sourceNodes =
        idx > 0 ? loft.sections[idx - 1].nodes : (loft.topology && loft.topology.nodes) || section.nodes;
      const morphed = morphNodesFrom(sourceNodes);
      if (idx > 0) section.kind = "morph";
      section.morphSeed = morphed.seed;
      section.nodes = morphed.nodes;
      selectedNodeIds = [];
      refreshChunkUi();
      refreshChunks();
      noteLoftGeometryChanged("commit");
      setStatus(
        `${section.label} remorphed · topology and depth unchanged. Loft is not generated.`,
        "active"
      );
    }

    function deleteSection() {
      const loft = selectedLoft();
      if (!loft || loft.sections.length < 2) return;
      const index = loft.sections.findIndex((item) => item.id === selectedSectionId);
      if (index < 0) return;
      loft.sections.splice(index, 1);
      const next = loft.sections[Math.max(0, index - 1)];
      selectedSectionId = next ? next.id : null;
      selectedNodeIds = [];
      refreshChunkUi();
      refreshChunks();
      noteLoftGeometryChanged("commit");
      setStatus("Section removed. Source chunk and 2D simulation are unchanged.", "active");
    }

    function moveSection(dir) {
      const loft = selectedLoft();
      if (!loft) return;
      const index = loft.sections.findIndex((item) => item.id === selectedSectionId);
      const next = index + dir;
      if (index < 0 || next < 0 || next >= loft.sections.length) return;
      const [item] = loft.sections.splice(index, 1);
      loft.sections.splice(next, 0, item);
      refreshChunkUi();
      refreshChunks();
      noteLoftGeometryChanged("commit");
    }

    function toggleEditBranches() {
      if (!selectedSection()) return;
      editBranches = !editBranches;
      selectedNodeIds = [];
      nodeOrigins = null;
      if (viewer && viewer.setEditBranches) viewer.setEditBranches(editBranches);
      refreshChunkUi();
      refreshLoftView();
      setStatus(
        editBranches
          ? "Edit Branches · drag nodes in the section plane. Shift-click to add to the selection."
          : "Section transform mode.",
        "active"
      );
    }

    function snapshotNodes(section, ids) {
      const map = {};
      for (const id of ids) {
        const node = section.nodes.find((item) => item.id === id);
        if (node) map[id] = { x: node.x, y: node.y };
      }
      return map;
    }

    function applyNodeDelta(section, origins, dx, dy) {
      for (const id of Object.keys(origins)) {
        const node = section.nodes.find((item) => String(item.id) === String(id));
        if (!node) continue;
        node.x = origins[id].x + dx;
        node.y = origins[id].y + dy;
      }
    }

    function restDelta(section, loft, dx, dy) {
      const lib = global.D7SpatialLoft;
      const cx = loft.width * 0.5;
      const cy = loft.height * 0.5;
      const a = lib.invertDeformPoint(cx, cy, section, loft.width, loft.height);
      const b = lib.invertDeformPoint(cx + dx, cy + dy, section, loft.width, loft.height);
      return { x: b.x - a.x, y: b.y - a.y };
    }

    function applyNodeNumeric() {
      const section = selectedSection();
      if (!section || syncingUi || !selectedNodeIds.length) return;
      const node = section.nodes.find((item) => item.id === selectedNodeIds[0]);
      if (!node) return;
      const nx = Number(els.nodeX?.value ?? node.x);
      const ny = Number(els.nodeY?.value ?? node.y);
      const dx = nx - node.x;
      const dy = ny - node.y;
      for (const id of selectedNodeIds) {
        const rec = section.nodes.find((item) => item.id === id);
        if (!rec) continue;
        rec.x += dx;
        rec.y += dy;
      }
      refreshLoftView();
      fillTransformUi();
      noteLoftGeometryChanged("commit");
    }

    function beginNodeTool() {
      const section = selectedSection();
      if (!section || selectedNodeIds.length < 2) return;
      nodeToolOrigins = snapshotNodes(section, selectedNodeIds);
    }

    function applyNodeRotate() {
      const section = selectedSection();
      if (!section || !nodeToolOrigins) beginNodeTool();
      if (!section || !nodeToolOrigins) return;
      const ids = Object.keys(nodeToolOrigins);
      let cx = 0;
      let cy = 0;
      for (const id of ids) {
        cx += nodeToolOrigins[id].x;
        cy += nodeToolOrigins[id].y;
      }
      cx /= ids.length;
      cy /= ids.length;
      const ang = ((Number(els.nodeRot?.value ?? 0) * Math.PI) / 180);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      for (const id of ids) {
        const rec = section.nodes.find((item) => String(item.id) === String(id));
        if (!rec) continue;
        const px = nodeToolOrigins[id].x - cx;
        const py = nodeToolOrigins[id].y - cy;
        rec.x = cx + px * c - py * s;
        rec.y = cy + px * s + py * c;
      }
      if (els.nodeRotVal) els.nodeRotVal.textContent = `${Math.round(Number(els.nodeRot?.value ?? 0))}°`;
      refreshLoftView();
      noteLoftGeometryChanged("live");
    }

    function applyNodeScale() {
      const section = selectedSection();
      if (!section || !nodeToolOrigins) beginNodeTool();
      if (!section || !nodeToolOrigins) return;
      const ids = Object.keys(nodeToolOrigins);
      let cx = 0;
      let cy = 0;
      for (const id of ids) {
        cx += nodeToolOrigins[id].x;
        cy += nodeToolOrigins[id].y;
      }
      cx /= ids.length;
      cy /= ids.length;
      const s = Number(els.nodeScale?.value ?? 100) / 100;
      for (const id of ids) {
        const rec = section.nodes.find((item) => String(item.id) === String(id));
        if (!rec) continue;
        rec.x = cx + (nodeToolOrigins[id].x - cx) * s;
        rec.y = cy + (nodeToolOrigins[id].y - cy) * s;
      }
      if (els.nodeScaleVal) els.nodeScaleVal.textContent = `${Math.round(Number(els.nodeScale?.value ?? 100))}%`;
      refreshLoftView();
      noteLoftGeometryChanged("live");
    }

    function endNodeTool() {
      nodeToolOrigins = null;
      syncingUi = true;
      if (els.nodeRot) els.nodeRot.value = "0";
      if (els.nodeRotVal) els.nodeRotVal.textContent = "0°";
      if (els.nodeScale) els.nodeScale.value = "100";
      if (els.nodeScaleVal) els.nodeScaleVal.textContent = "100%";
      syncingUi = false;
      fillTransformUi();
      noteLoftGeometryChanged("commit");
    }

    function loftOpacityValue() {
      return Number(els.loftOpacity?.value ?? 100) / 100;
    }

    function hasExistingLoft() {
      return !!(viewer && viewer.hasLoft && viewer.hasLoft());
    }

    function setLoftStatus(message, kind) {
      if (!els.loftStatus) return;
      els.loftStatus.textContent = message;
      els.loftStatus.classList.toggle("active", kind === "active");
      els.loftStatus.classList.toggle("error", kind === "error");
    }

    function paintLiveButtons() {
      if (els.liveLoft) {
        els.liveLoft.classList.toggle("primary", liveLoftOn);
        els.liveLoft.classList.toggle("ghost", !liveLoftOn);
      }
      if (els.liveVoxels) {
        els.liveVoxels.classList.toggle("primary", liveVoxelsOn);
        els.liveVoxels.classList.toggle("ghost", !liveVoxelsOn);
      }
      const hasLoft = hasExistingLoft();
      if (els.regenLoft) {
        els.regenLoft.disabled = !hasLoft;
        els.regenLoft.classList.toggle("primary", hasLoft && loftStale);
        els.regenLoft.classList.toggle("ghost", !(hasLoft && loftStale));
      }
      if (hasLoft && loftStale) {
        setLoftStatus("Loft Needs Update", "error");
      } else if (hasLoft && liveLoftOn) {
        setLoftStatus("Live Loft · derived from current sections", "active");
      } else if (hasLoft) {
        setLoftStatus("Loft current", "active");
      } else if (selectedLoft() && selectedLoft().sections.length >= 2) {
        setLoftStatus("Sections ready · Generate Loft when you choose.");
      } else {
        setLoftStatus("No loft yet.");
      }
      paintExportButtons();
    }

    function setExportStatus(message, kind) {
      if (!els.exportStatus) return;
      els.exportStatus.textContent = message;
      els.exportStatus.classList.toggle("active", kind === "active");
      els.exportStatus.classList.toggle("error", kind === "error");
    }

    function paintExportButtons() {
      const hasLoft = hasExistingLoft();
      const hasVoxels = !!(viewer && viewer.hasVoxels && viewer.hasVoxels());
      if (els.exportLoft3dm) els.exportLoft3dm.disabled = !hasLoft;
      if (els.exportLoftObj) els.exportLoftObj.disabled = !hasLoft;
      if (els.exportVoxels3dm) els.exportVoxels3dm.disabled = !hasVoxels;
      if (els.exportVoxelsObj) els.exportVoxelsObj.disabled = !hasVoxels;
      if (!hasLoft && !hasVoxels) setExportStatus("Generate a loft or voxels to export.");
      else if (hasLoft && hasVoxels) setExportStatus("Ready · loft and voxels");
      else if (hasLoft) setExportStatus("Ready · loft");
      else setExportStatus("Ready · voxels");
    }

    function exportBaseName() {
      const lib = global.D7SpatialExport;
      const hint = exportNameHint || (selectedLoft() && selectedLoft().label) || "Loft_01";
      const raw = String(hint).replace(/Set\s+/i, "").replace(/\s+/g, "_");
      return lib && lib.sanitizeFilename ? lib.sanitizeFilename(raw) : raw.replace(/[^\w.-]+/g, "_") || "Loft_01";
    }

    function pngViewLabel(mode) {
      if (mode === "isometric") return "ISO";
      if (mode === "perspective") return "Persp";
      if (mode === "front") return "Front";
      if (mode === "back") return "Back";
      if (mode === "left") return "Left";
      if (mode === "right") return "Right";
      if (mode === "top") return "Top";
      if (mode === "bottom") return "Bottom";
      return "View";
    }

    function pngExportName(mode) {
      const lib = global.D7SpatialExport;
      const clean = (name) => {
        if (lib && lib.sanitizeFilename) return lib.sanitizeFilename(name);
        return String(name || "3D_Space").replace(/[^\w.-]+/g, "_") || "3D_Space";
      };
      const loft = selectedLoft();
      const study = (loft && loft.label) || exportNameHint || "";
      const base = study ? clean(String(study).replace(/Set\s+/i, "").replace(/\s+/g, "_")) : "3D_Space";
      const voxelsOn = !!(displayVoxels && viewer && viewer.hasVoxels && viewer.hasVoxels());
      const loftOn = !!(displaySolids && hasExistingLoft());
      const voxelTag = voxelsOn && !loftOn ? "_Voxels" : "";
      return clean(`${base}${voxelTag}_${pngViewLabel(mode)}`);
    }

    async function exportPng() {
      if (!viewer || !viewer.capturePng) {
        setStatus("3D view is not ready.", "error");
        return;
      }
      const size = Number(els.pngRes && els.pngRes.value) || 3000;
      const transparent = !!(els.pngBg && els.pngBg.value === "transparent");
      if (els.pngSave) els.pngSave.disabled = true;
      setExportStatus("Saving PNG\u2026", "active");
      try {
        const result = await viewer.capturePng({ size, transparent });
        const name = `${pngExportName(result && result.viewMode)}.png`;
        const lib = global.D7SpatialExport;
        if (lib && lib.downloadBlob) lib.downloadBlob(name, result.blob);
        else {
          const url = URL.createObjectURL(result.blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = name;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        }
        setExportStatus(`Saved ${name}`, "active");
        setStatus(`Saved ${name}`, "active");
      } catch (err) {
        const message = err && err.message ? err.message : "PNG export failed.";
        setExportStatus(message, "error");
        setStatus("PNG export failed.", "error");
      } finally {
        if (els.pngSave) els.pngSave.disabled = false;
      }
    }

    function setTurnStatus(message, kind) {
      if (!els.turnStatus) return;
      els.turnStatus.textContent = message;
      els.turnStatus.classList.toggle("active", kind === "active");
      els.turnStatus.classList.toggle("error", kind === "error");
    }

    function turntableSettings() {
      return {
        duration: Number(els.turnDur && els.turnDur.value) || 10,
        fps: Number(els.turnFps && els.turnFps.value) || 30,
        size: Number(els.turnRes && els.turnRes.value) || 1920,
        direction: els.turnDir && els.turnDir.value === "ccw" ? "ccw" : "cw",
        pivotMode: els.turnPivot && els.turnPivot.value === "workspace" ? "workspace" : "model",
      };
    }

    function paintTurntableButtons() {
      const previewing = !!(viewer && viewer.isTurntableBusy && viewer.isTurntableBusy() && !turntableExporting);
      const busy = turntableBusy || turntableExporting;
      if (els.turnPreview) els.turnPreview.disabled = busy;
      if (els.turnStop) els.turnStop.disabled = !previewing;
      if (els.turnExport) els.turnExport.disabled = busy;
      if (els.turnDur) els.turnDur.disabled = busy;
      if (els.turnFps) els.turnFps.disabled = busy;
      if (els.turnRes) els.turnRes.disabled = busy;
      if (els.turnDir) els.turnDir.disabled = busy;
      if (els.turnPivot) els.turnPivot.disabled = busy;
      if (els.turnBg) els.turnBg.disabled = busy;
      if (els.resetWorkspace) els.resetWorkspace.disabled = busy;
      const view = document.getElementById("space3dView");
      if (view) view.classList.toggle("is-turntable-busy", turntableExporting);
    }

    function showTurnOverlay(title, detail, ratio) {
      if (els.turnOverlay) els.turnOverlay.classList.remove("hidden");
      if (els.turnProgressTitle) els.turnProgressTitle.textContent = title;
      if (els.turnProgressDetail) els.turnProgressDetail.textContent = detail;
      if (els.turnBar) els.turnBar.style.width = `${Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)))}%`;
    }

    function hideTurnOverlay() {
      if (els.turnOverlay) els.turnOverlay.classList.add("hidden");
    }

    function turntableFileName() {
      const lib = global.D7SpatialExport;
      const clean = (name) => {
        if (lib && lib.sanitizeFilename) return lib.sanitizeFilename(name);
        return String(name || "3D_Space").replace(/[^\w.-]+/g, "_") || "3D_Space";
      };
      const loft = selectedLoft();
      const study = (loft && loft.label) || exportNameHint || "";
      const base = study ? clean(String(study).replace(/Set\s+/i, "").replace(/\s+/g, "_")) : "3D_Space";
      const voxelsOn = !!(displayVoxels && viewer && viewer.hasVoxels && viewer.hasVoxels());
      const loftOn = !!(displaySolids && hasExistingLoft());
      const voxelTag = voxelsOn && !loftOn ? "_Voxels" : "";
      const silTag = silhouetteOn ? "_Silhouette" : "";
      return clean(`${base}${voxelTag}${silTag}_360`);
    }

    function previewTurntable() {
      if (!viewer || !viewer.previewTurntable || turntableBusy) return;
      const opts = turntableSettings();
      turntableBusy = true;
      paintTurntableButtons();
      setTurnStatus(`Preview · ${opts.duration}s ${opts.direction === "ccw" ? "CCW" : "CW"}`, "active");
      setStatus("Turntable preview. Stop returns the study to its original orientation.", "active");
      viewer.previewTurntable({
        duration: opts.duration,
        direction: opts.direction,
        pivotMode: opts.pivotMode,
        onDone() {
          turntableBusy = false;
          paintTurntableButtons();
          setTurnStatus("Preview finished. Export MP4 when ready.", "active");
        },
      });
      paintTurntableButtons();
    }

    function stopTurntable() {
      if (viewer && viewer.stopTurntablePreview) viewer.stopTurntablePreview();
      turntableBusy = false;
      paintTurntableButtons();
      setTurnStatus("Preview stopped. Orientation restored.", "active");
      setStatus("Turntable preview stopped.", "active");
    }

    async function exportTurntableMp4() {
      if (!viewer || !viewer.exportTurntable || turntableBusy) return;
      const encoder = global.D7SpatialTurntable;
      if (!encoder || (encoder.canEncodeMp4 && !encoder.canEncodeMp4())) {
        setTurnStatus("This browser cannot write H.264 MP4. Use Chrome or Edge.", "error");
        setStatus("MP4 export needs Chrome or Edge.", "error");
        return;
      }
      const opts = turntableSettings();
      const frames = Math.round(opts.duration * opts.fps);
      turntableBusy = true;
      turntableExporting = true;
      turntableAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
      paintTurntableButtons();
      showTurnOverlay("Rendering 360 Video", `0 / ${frames} frames`, 0);
      setTurnStatus(`Rendering 360 Video · 0 / ${frames} frames`, "active");
      setStatus("Rendering 360 video. Editing is paused until export finishes.", "active");
      try {
        const result = await viewer.exportTurntable({
          duration: opts.duration,
          fps: opts.fps,
          size: opts.size,
          direction: opts.direction,
          pivotMode: opts.pivotMode,
          signal: turntableAbort && turntableAbort.signal,
          onProgress(done, total, phase) {
            if (phase === "encode") {
              showTurnOverlay("Encoding MP4...", `${done} / ${total} frames`, 1);
              setTurnStatus("Encoding MP4...", "active");
              return;
            }
            const pct = total ? Math.round((done / total) * 100) : 0;
            showTurnOverlay("Rendering 360 Video", `${done} / ${total} frames · ${pct}%`, done / Math.max(1, total));
            setTurnStatus(`Rendering 360 Video · ${done} / ${total} frames`, "active");
          },
        });
        const name = `${turntableFileName()}.mp4`;
        const lib = global.D7SpatialExport;
        if (lib && lib.downloadBlob) lib.downloadBlob(name, result.blob);
        else {
          const url = URL.createObjectURL(result.blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = name;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        }
        setTurnStatus(`Saved ${name}`, "active");
        setStatus(`Saved ${name}`, "active");
      } catch (err) {
        const aborted = err && (err.name === "AbortError" || /abort/i.test(err.message || ""));
        if (aborted) {
          setTurnStatus("Export cancelled. Orientation restored.", "active");
          setStatus("360 video cancelled.", "active");
        } else {
          const message = err && err.message ? err.message : "MP4 export failed.";
          setTurnStatus(message, "error");
          setStatus("MP4 export failed.", "error");
        }
      } finally {
        hideTurnOverlay();
        turntableBusy = false;
        turntableExporting = false;
        turntableAbort = null;
        paintTurntableButtons();
      }
    }

    function ensureLoftForExport() {
      if (!hasExistingLoft()) {
        setStatus("Generate a loft before exporting.", "error");
        return false;
      }
      if (loftStale) {
        const ok = rebuildLoftMesh({ draft: false, silent: true, final: true });
        if (!ok) {
          setStatus("Could not rebuild the loft for export.", "error");
          return false;
        }
      }
      const geom = viewer.getLoftGeometry && viewer.getLoftGeometry();
      if (!geom || !geom.attributes || !geom.attributes.position || !geom.attributes.position.count) {
        setStatus("The loft mesh is empty.", "error");
        return false;
      }
      return geom;
    }

    function currentVoxelMesh() {
      const lib = global.D7SpatialExport;
      if (!lib || !viewer || !viewer.getVoxelExportData) return null;
      const data = viewer.getVoxelExportData();
      if (!data || !data.cells || !data.cells.length) return null;
      return lib.voxelMeshFromCells(data.cells, data.resolution);
    }

    async function exportLoft(kind) {
      const lib = global.D7SpatialExport;
      if (!lib) {
        setStatus("Export module did not load.", "error");
        return;
      }
      const geom = ensureLoftForExport();
      if (!geom) return;
      const base = exportBaseName();
      try {
        if (kind === "3dm") {
          setStatus("Writing Rhino polysurface...", "active");
          const loftLib = global.D7SpatialLoft;
          const loft = selectedLoft();
          if (!loftLib || !loftLib.generateSolidRuns || !loft) {
            throw new Error("Polysurface generation failed");
          }
          const solids = loftLib.generateSolidRuns(global.THREE, loft, loftParams(false));
          if (!solids || !solids.runs || !solids.runs.length) {
            throw new Error("Polysurface generation failed");
          }
          const result = await lib.exportLoftPolysurface(solids.runs, `${base}.3dm`, "LOFT");
          const n = result && result.closed != null ? result.closed : result.added;
          setExportStatus(`Saved ${base}.3dm · ${n} closed polysurface${n === 1 ? "" : "s"}`, "active");
          setStatus(`Exported ${base}.3dm · Rhino Brep · units: feet.`, "active");
        } else {
          setStatus("Writing OBJ mesh...", "active");
          const text = lib.geometryToOBJ(geom, base);
          lib.exportOBJ(text, `${base}.obj`);
          setExportStatus(`Saved ${base}.obj · mesh`, "active");
          setStatus(`Exported ${base}.obj · mesh · units: feet.`, "active");
        }
      } catch (err) {
        const msg = err && err.message ? err.message : "Export failed.";
        setStatus(msg, "error");
        if (kind === "3dm") setExportStatus("Polysurface generation failed", "error");
      }
    }

    async function exportVoxels(kind) {
      const lib = global.D7SpatialExport;
      if (!lib) {
        setStatus("Export module did not load.", "error");
        return;
      }
      if (!viewer || !viewer.hasVoxels || !viewer.hasVoxels()) {
        setStatus("Generate voxels before exporting.", "error");
        return;
      }
      const base = `${exportBaseName()}_Voxels`;
      try {
        if (kind === "3dm") {
          setStatus("Writing voxel polysurface...", "active");
          const data = viewer.getVoxelExportData && viewer.getVoxelExportData();
          if (!data || !data.cells || !data.cells.length) {
            throw new Error("Polysurface generation failed");
          }
          const result = await lib.exportVoxelPolysurface(data.cells, data.resolution, `${base}.3dm`, "VOXELS");
          const n = result && result.closed != null ? result.closed : result.added;
          setExportStatus(`Saved ${base}.3dm · ${n} closed polysurface${n === 1 ? "" : "s"}`, "active");
          setStatus(`Exported ${base}.3dm · closed voxel Breps · units: feet.`, "active");
        } else {
          const mesh = currentVoxelMesh();
          if (!mesh || !mesh.quads || !mesh.quads.length) {
            setStatus("The voxel mesh is empty.", "error");
            return;
          }
          setStatus("Writing voxel OBJ mesh...", "active");
          lib.exportOBJ(lib.voxelToOBJ(mesh, base), `${base}.obj`);
          setExportStatus(`Saved ${base}.obj · mesh`, "active");
          setStatus(`Exported ${base}.obj · mesh · units: feet.`, "active");
        }
      } catch (err) {
        const msg = err && err.message ? err.message : "Voxel export failed.";
        setStatus(msg, "error");
        if (kind === "3dm") setExportStatus("Polysurface generation failed", "error");
      }
    }

    function loftParams(draft) {
      return {
        width: Number(els.loftWidth?.value ?? 28) / 100,
        thickness: Number(els.loftThick?.value ?? 32) / 100,
        style: els.loftStyle?.value === "linear" ? "linear" : "smooth",
        useHierarchy: !!(els.loftHierarchy && els.loftHierarchy.checked),
        draft: !!draft,
      };
    }

    function afterLoftCommitted() {
      loftStale = false;
      paintLiveButtons();
      if (applyingSaved3d) return;
      if (liveVoxelsOn && viewer && viewer.hasVoxels && viewer.hasVoxels()) {
        generateVoxels({ silent: true });
      } else {
        markVoxelStale();
      }
    }

    function rebuildLoftMesh(options) {
      if (turntableBusy) return false;
      const opts = options || {};
      const loft = selectedLoft();
      if (!loft || loft.sections.length < 2) {
        if (!opts.silent) setStatus("Duplicate at least one section before generating a loft.", "error");
        return false;
      }
      const lib = global.D7SpatialLoft;
      if (!lib || !global.THREE) {
        if (!opts.silent) setStatus("Section loft module did not load.", "error");
        return false;
      }
      if (!viewer) ensureViewer();
      const draft = !!opts.draft;
      const result = lib.generate(global.THREE, loft, loftParams(draft));
      if (!result.vertexCount) {
        loftCapsules = [];
        if (!opts.silent) {
          setStatus("No loft solids formed. Check that sections still share the same branches.", "error");
          refreshChunkUi();
        }
        return false;
      }
      const geom = new global.THREE.BufferGeometry();
      geom.setAttribute("position", new global.THREE.Float32BufferAttribute(result.positions, 3));
      geom.setAttribute("normal", new global.THREE.Float32BufferAttribute(result.normals, 3));
      viewer.setLoft(geom, loftOpacityValue(), { draft });
      loftCapsules = result.capsules || [];
      loftStale = false;
      applyDisplayToggles();
      if (!opts.silent) {
        const clip = result.clipped ? " · some faces met the 20 cube and were clipped" : "";
        const skip =
          result.skipped > 0 ? ` · skipped ${result.skipped} branch(es) missing from a section` : "";
        setStatus(
          `${loft.label} \u2192 Loft solids · ${result.triangleCount} faces · ${loft.sections.length} sections${clip}${skip}`,
          result.skipped > 0 ? "error" : "active"
        );
      }
      if (opts.final) afterLoftCommitted();
      else paintLiveButtons();
      return true;
    }

    function scheduleDraftLoft() {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const wait = Math.max(0, 45 - (now - loftDraftAt));
      if (wait > 0) {
        if (loftDraftQueued) return;
        loftDraftQueued = true;
        setTimeout(() => {
          loftDraftQueued = false;
          scheduleDraftLoft();
        }, wait);
        return;
      }
      loftDraftAt = now;
      rebuildLoftMesh({ draft: true, silent: true });
    }

    function scheduleFinalLoft() {
      clearTimeout(loftFinalTimer);
      loftFinalTimer = setTimeout(() => {
        rebuildLoftMesh({ draft: false, silent: true, final: true });
      }, 140);
    }

    function markWorkspaceDirty() {
      if (applyingSaved3d) return;
      if (!workspaceDirty) {
        workspaceDirty = true;
        paintSaved3dButtons();
      } else {
        workspaceDirty = true;
      }
    }

    function noteLoftGeometryChanged(kind) {
      markWorkspaceDirty();
      const loft = selectedLoft();
      if (!loft || loft.sections.length < 2) return;
      if (!hasExistingLoft()) return;
      if (!liveLoftOn) {
        loftStale = true;
        paintLiveButtons();
        fillTransformUi();
        markVoxelStale();
        return;
      }
      if (kind === "commit") {
        clearTimeout(loftFinalTimer);
        rebuildLoftMesh({ draft: false, silent: true, final: true });
        return;
      }
      scheduleDraftLoft();
      scheduleFinalLoft();
    }

    function generateLoft() {
      if (turntableBusy) return;
      if (!selectedLoft() || selectedLoft().sections.length < 2) {
        setStatus("Add at least one morphed section before generating a loft.", "error");
        return;
      }
      if (!viewer) ensureViewer();
      setStatus(`Generating loft from ${selectedLoft().sections.length} sections...`, "active");
      const run = () => {
        try {
          rebuildLoftMesh({ draft: false, silent: false, final: true });
          refreshChunkUi();
        } catch (err) {
          setStatus(err && err.message ? err.message : "Loft generation failed.", "error");
        }
      };
      requestAnimationFrame(run);
    }

    function clearLoft() {
      loftCapsules = [];
      loftStale = false;
      clearTimeout(loftFinalTimer);
      if (viewer && viewer.clearLoft) viewer.clearLoft();
      refreshChunkUi();
      paintLiveButtons();
      setStatus("Loft solids cleared. Section layers remain.", "active");
    }

    function toggleLiveLoft() {
      liveLoftOn = !liveLoftOn;
      paintLiveButtons();
      if (liveLoftOn && hasExistingLoft() && loftStale) {
        rebuildLoftMesh({ draft: false, silent: true, final: true });
      }
      setStatus(liveLoftOn ? "Live Loft on · section edits update the loft." : "Live Loft off · edits mark Loft Needs Update.", "active");
    }

    function toggleLiveVoxels() {
      liveVoxelsOn = !liveVoxelsOn;
      paintLiveButtons();
      if (liveVoxelsOn && viewer && viewer.hasVoxels && viewer.hasVoxels() && voxelStale) {
        generateVoxels({ silent: true });
      }
      setStatus(
        liveVoxelsOn
          ? "Live Voxels on · voxels rebuild once after loft edits finish."
          : "Live Voxels off · loft can update while voxels stay until Regenerated.",
        "active"
      );
    }

    function saveVariation() {
      const loft = selectedLoft();
      if (!loft) return;
      const index = loft.nextVar++;
      loft.variations.push({
        id: `${loft.id}-var-${index}`,
        label: `Variation ${pad2(index)}`,
        sections: JSON.parse(JSON.stringify(loft.sections)),
        settings: {
          width: Number(els.loftWidth?.value ?? 28),
          thickness: Number(els.loftThick?.value ?? 32),
          style: els.loftStyle?.value || "smooth",
          useHierarchy: !!(els.loftHierarchy && els.loftHierarchy.checked),
        },
      });
      refreshChunkUi();
      exportNameHint = loft.variations[loft.variations.length - 1].label;
      setStatus(`Saved ${loft.variations[loft.variations.length - 1].label}. The source chunk is unchanged.`, "active");
    }

    function duplicateLastVariation() {
      const loft = selectedLoft();
      if (!loft || !loft.variations.length) return;
      const src = loft.variations[loft.variations.length - 1];
      const index = loft.nextVar++;
      loft.variations.push({
        id: `${loft.id}-var-${index}`,
        label: `Variation ${pad2(index)}`,
        sections: JSON.parse(JSON.stringify(src.sections)),
        settings: JSON.parse(JSON.stringify(src.settings)),
      });
      refreshChunkUi();
      setStatus(`Duplicated as Variation ${pad2(index)}.`, "active");
    }

    function applyVariation(loft, variation) {
      loft.sections = JSON.parse(JSON.stringify(variation.sections));
      selectedSectionId = loft.sections[0] ? loft.sections[0].id : null;
      selectedNodeIds = [];
      if (variation.settings) {
        if (els.loftWidth) els.loftWidth.value = String(variation.settings.width);
        if (els.loftThick) els.loftThick.value = String(variation.settings.thickness);
        if (els.loftStyle) els.loftStyle.value = variation.settings.style || "smooth";
        if (els.loftHierarchy) els.loftHierarchy.checked = !!variation.settings.useHierarchy;
        if (els.loftWidthVal) els.loftWidthVal.textContent = `${Math.round(Number(els.loftWidth.value))}%`;
        if (els.loftThickVal) els.loftThickVal.textContent = `${Math.round(Number(els.loftThick.value))}%`;
      }
      refreshChunkUi();
      refreshChunks();
      generateLoft();
      exportNameHint = variation.label;
      setStatus(`Loaded ${variation.label}.`, "active");
    }

    function massParams() {
      return {
        fidelity: Number(els.fidelity?.value ?? 80) / 100,
        variation: Number(els.massVariation?.value ?? 22) / 100,
        width: Number(els.solidWidth?.value ?? 28) / 100,
        depth: Number(els.solidDepth?.value ?? 40) / 100,
        reach: Number(els.spatialReach?.value ?? 45) / 100,
        useHierarchy: !!(els.useHierarchy && els.useHierarchy.checked),
      };
    }

    function solidOpacityValue() {
      return Number(els.solidOpacity?.value ?? 100) / 100;
    }

    function voxelOpacityValue() {
      return Number(els.voxelOpacity?.value ?? 100) / 100;
    }

    function voxelTargetChunks() {
      const mode = els.voxelTarget ? els.voxelTarget.value : "selected";
      if (mode === "visible") return chunks.slice();
      const chunk = selectedChunk();
      return chunk ? [chunk] : [];
    }

    function currentVoxelStamp() {
      const lib = global.D7SpatialVoxels;
      const res = lib ? lib.clampRes(Number(els.voxelRes?.value ?? 20)) : 20;
      const source = els.voxelSource ? els.voxelSource.value : "loft";
      const target = els.voxelTarget ? els.voxelTarget.value : "selected";
      const width = Number(els.solidWidth?.value ?? 28);
      const hier = !!(els.useHierarchy && els.useHierarchy.checked);
      const fidelity = Math.round(Number(els.voxelFidelity?.value ?? 75));
      const parts = [`${res}|${source}|${target}|${width}|${hier ? 1 : 0}|${fidelity}`];
      const list = voxelTargetChunks();
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const t = c.transform || {};
        parts.push(c.id);
        parts.push(
          `${Number(t.x).toFixed(3)},${Number(t.y).toFixed(3)},${Number(t.z).toFixed(3)},${Number(t.rx || 0).toFixed(1)},${Number(t.ry || 0).toFixed(1)},${Number(t.rz || 0).toFixed(1)},${Number(t.scale || 1).toFixed(3)}`
        );
        const nodes = c.nodes || [];
        parts.push(String(nodes.length));
        for (let n = 0; n < nodes.length; n++) {
          const node = nodes[n];
          parts.push(`${node.id}:${Number(node.x).toFixed(3)},${Number(node.y).toFixed(3)},${Number(node.z || 0).toFixed(3)}`);
        }
        parts.push((c.segments || []).map((s) => s.id).join(","));
      }
      const loft = selectedLoft();
      if (loft) {
        parts.push(loft.id);
        parts.push(String((loft.sections || []).length));
        parts.push(`${els.loftWidth?.value || 28}|${els.loftThick?.value || 32}|${els.loftStyle?.value || "smooth"}|${els.loftHierarchy && els.loftHierarchy.checked ? 1 : 0}`);
        for (const sec of loft.sections || []) {
          const tr = sec.transform || {};
          const d = sec.deform || {};
          parts.push(
            `${sec.id}:${Number(tr.x).toFixed(3)},${Number(tr.y).toFixed(3)},${Number(tr.z).toFixed(3)},${Number(tr.rx || 0).toFixed(1)},${Number(tr.ry || 0).toFixed(1)},${Number(tr.rz || 0).toFixed(1)},${Number(tr.scale || 1).toFixed(3)},${Number(sec.offset || 0).toFixed(2)}`
          );
          parts.push(`${Number(d.scale || 1).toFixed(3)},${Number(d.scaleX || 1).toFixed(3)},${Number(d.scaleY || 1).toFixed(3)},${Number(d.rotation || 0).toFixed(1)},${Number(d.shiftX || 0).toFixed(2)},${Number(d.shiftY || 0).toFixed(2)},${Number(d.taper != null ? d.taper : 1).toFixed(3)}`);
          for (const node of sec.nodes || []) {
            parts.push(`${node.id}:${Number(node.x).toFixed(3)},${Number(node.y).toFixed(3)}`);
          }
        }
      }
      if (viewer) {
        for (const c of list) {
          parts.push(`m:${c.id}:${viewer.hasMass && viewer.hasMass(c.id) ? 1 : 0}`);
        }
        parts.push(`loftMesh:${viewer.hasLoft && viewer.hasLoft() ? 1 : 0}`);
      }
      return parts.join("|");
    }

    function setVoxelStatus(message, kind) {
      if (!els.voxelStatus) return;
      els.voxelStatus.textContent = message;
      els.voxelStatus.classList.toggle("active", kind === "active");
      els.voxelStatus.classList.toggle("error", kind === "error");
    }

    function paintDisplayButtons() {
      const toggle = (el, on) => {
        if (!el) return;
        el.classList.toggle("primary", !!on);
        el.classList.toggle("ghost", !on);
      };
      toggle(els.dispLines, displayLines);
      toggle(els.dispSolids, displaySolids);
      toggle(els.dispVoxels, displayVoxels);
      toggle(els.silhouette, silhouetteOn);
      if (els.showVoxels) els.showVoxels.checked = displayVoxels;
    }

    function paintVoxelButtons() {
      const hasChunks = chunks.length > 0;
      const hasModel = !!(viewer && viewer.hasVoxels && viewer.hasVoxels());
      if (els.generateVoxels) els.generateVoxels.disabled = !hasChunks;
      if (els.regenVoxels) {
        els.regenVoxels.disabled = !hasModel;
        els.regenVoxels.classList.toggle("primary", hasModel && voxelStale);
        els.regenVoxels.classList.toggle("ghost", !(hasModel && voxelStale));
      }
      if (els.clearVoxels) els.clearVoxels.disabled = !hasModel;
      if (hasModel && voxelStale) {
        setVoxelStatus("Voxel model outdated", "error");
      } else if (hasModel && voxelInfo) {
        const voidCount = voxelInfo.totalCount - voxelInfo.occupiedCount;
        setVoxelStatus(
          `${voxelInfo.resolution}³ · ${voxelInfo.voxelCount || voxelInfo.occupiedCount} voxels · ${voidCount} void`,
          "active"
        );
      } else if (!hasModel) {
        setVoxelStatus("No voxel model yet.");
      }
      if (els.voxelStats) {
        if (hasModel && voxelInfo) {
          els.voxelStats.textContent = `Small: ${voxelInfo.smallCount || 0} · Medium: ${voxelInfo.mediumCount || 0} · Large: ${voxelInfo.largeCount || 0} · Total: ${voxelInfo.voxelCount || 0} · Connected: ${voxelInfo.components || 1} · Isolated: ${voxelInfo.isolatedCount || 0}`;
        } else {
          els.voxelStats.textContent = "Small: 0 · Medium: 0 · Large: 0 · Total: 0 · Connected: 0 · Isolated: 0";
        }
      }
      paintExportButtons();
    }

    function markVoxelStale() {
      if (!viewer || !viewer.hasVoxels || !viewer.hasVoxels()) return;
      if (voxelStamp && currentVoxelStamp() === voxelStamp) {
        voxelStale = false;
        paintVoxelButtons();
        return;
      }
      voxelStale = true;
      paintVoxelButtons();
    }

    function applyDisplayToggles() {
      if (!viewer) return;
      const lines = displayLines;
      if (viewer.setSourceBranchesVisible) {
        viewer.setSourceBranchesVisible(lines && (!els.showBranches || els.showBranches.checked));
      }
      if (viewer.setSourcePlanesVisible) {
        viewer.setSourcePlanesVisible(!!(els.showPlane && els.showPlane.checked));
      }
      if (viewer.setMassWireframe) {
        viewer.setMassWireframe(!!(els.showWireframe && els.showWireframe.checked));
      }
      if (viewer.setSourceChunksVisible) {
        viewer.setSourceChunksVisible(lines && (!els.showSourceChunk || els.showSourceChunk.checked));
      }
      if (viewer.setSectionLayersVisible) {
        viewer.setSectionLayersVisible(!els.showSections || els.showSections.checked);
      }
      if (viewer.setLoftLinesVisible) {
        viewer.setLoftLinesVisible(!els.showLoftLines || els.showLoftLines.checked);
      }
      if (viewer.setMassVisible) {
        viewer.setMassVisible(displaySolids);
      }
      if (viewer.setLoftSolidsVisible) {
        viewer.setLoftSolidsVisible(displaySolids && (!els.showLoftSolids || els.showLoftSolids.checked));
      }
      if (viewer.setVoxelsVisible) {
        viewer.setVoxelsVisible(displayVoxels);
      }
      if (viewer.setSilhouetteMode) viewer.setSilhouetteMode(silhouetteOn);
      paintDisplayButtons();
      markWorkspaceDirty();
    }

    function generateVoxels(options) {
      if (turntableBusy) return;
      const silent = !!(options && options.silent);
      const lib = global.D7SpatialVoxels;
      if (!lib || !global.THREE) {
        if (!silent) setStatus("Voxel module did not load.", "error");
        return;
      }
      const source = els.voxelSource ? els.voxelSource.value : "loft";
      const targets = voxelTargetChunks();
      if (source !== "loft" && !targets.length) {
        if (!silent) setStatus("Select a chunk, or choose Visible Geometry.", "error");
        return;
      }
      if (!viewer) ensureViewer();
      const resolution = lib.clampRes(Number(els.voxelRes?.value ?? 20));
      const width = Number(els.solidWidth?.value ?? 28) / 100;
      const useHierarchy = !!(els.useHierarchy && els.useHierarchy.checked);
      const fidelity = Number(els.voxelFidelity?.value ?? 75) / 100;
      let segments = [];
      let geometries = [];
      let capsules = [];
      function collectLineSegments(loftList) {
        const out = [];
        if (lib.worldSegmentsFromLoftSet && loftList && loftList.length) {
          for (let i = 0; i < loftList.length; i++) {
            out.push.apply(out, lib.worldSegmentsFromLoftSet(global.THREE, loftList[i]));
          }
        }
        for (let i = 0; i < targets.length; i++) {
          out.push.apply(out, lib.worldSegmentsFromChunk(global.THREE, targets[i]));
        }
        return out;
      }
      if (source === "loft") {
        if (!hasExistingLoft()) {
          if (!silent) setStatus("Generate a loft before voxelizing the lofted solid.", "error");
          return;
        }
        const geom = viewer.getLoftGeometry ? viewer.getLoftGeometry() : null;
        if (geom) geometries.push(geom);
        capsules = loftCapsules || [];
        const loftList =
          els.voxelTarget && els.voxelTarget.value === "visible"
            ? loftSets.slice()
            : selectedLoft()
              ? [selectedLoft()]
              : loftSets.slice();
        segments = collectLineSegments(loftList);
        if (!geometries.length) {
          if (!silent) setStatus("Generate a loft before voxelizing the lofted solid.", "error");
          return;
        }
      } else if (source === "solids") {
        const selectedId = els.voxelTarget && els.voxelTarget.value === "selected" ? selectedChunkId : null;
        const loft = selectedLoft();
        const includeLoft = !!(viewer.hasLoft && viewer.hasLoft() && (!selectedId || (loft && loft.sourceChunkId === selectedId)));
        geometries = viewer.collectSolidGeometries ? viewer.collectSolidGeometries(selectedId, includeLoft) : [];
        const loftList = includeLoft && loft ? [loft] : [];
        segments = collectLineSegments(loftList);
        if (!geometries.length) {
          if (!silent) setStatus("Generate branch solids or a loft before voxelizing solids.", "error");
          return;
        }
      } else {
        for (let i = 0; i < targets.length; i++) {
          segments = segments.concat(lib.worldSegmentsFromChunk(global.THREE, targets[i]));
        }
        if (!segments.length) {
          if (!silent) setStatus("No branch geometry to voxelize. Place a chunk first.", "error");
          return;
        }
      }
      displayVoxels = true;
      if (els.showVoxels) els.showVoxels.checked = true;
      if (!silent) setStatus(`Voxelizing ${resolution} × ${resolution} × ${resolution}...`, "active");
      const run = () => {
        try {
          const result = lib.generate(global.THREE, {
            source,
            segments,
            geometries,
            capsules,
            resolution,
            width,
            useHierarchy,
            fidelity,
          });
          if (!result.occupiedCount) {
            if (viewer.clearVoxels) viewer.clearVoxels();
            voxelInfo = null;
            voxelStamp = "";
            voxelStale = false;
            if (!silent) setStatus("No occupied voxels. The source geometry may sit outside the 20 cube.", "error");
            paintVoxelButtons();
            return;
          }
          viewer.setVoxelOpacity(voxelOpacityValue());
          if (viewer.setVoxelEdges) viewer.setVoxelEdges(!els.voxelEdges || els.voxelEdges.checked);
          if (viewer.setVoxelColorBySize) {
            viewer.setVoxelColorBySize(!!(els.voxelColorBySize && els.voxelColorBySize.checked));
          }
          viewer.setVoxels(result);
          voxelInfo = result;
          voxelStamp = currentVoxelStamp();
          voxelStale = false;
          applyDisplayToggles();
          paintVoxelButtons();
          if (!silent) {
            setStatus(
              `Voxels · S ${result.smallCount || 0} · M ${result.mediumCount || 0} · L ${result.largeCount || 0} · connected ${result.components || 1} · isolated ${result.isolatedCount || 0}`,
              "active"
            );
          }
        } catch (err) {
          if (!silent) setStatus(err && err.message ? err.message : "Voxel generation failed.", "error");
        }
      };
      requestAnimationFrame(run);
    }

    function clearVoxels() {
      if (viewer && viewer.clearVoxels) viewer.clearVoxels();
      voxelInfo = null;
      voxelStamp = "";
      voxelStale = false;
      paintVoxelButtons();
      refreshChunkUi();
      setStatus("Voxels cleared. Lines, lofts, and solids are unchanged.", "active");
    }

    function generateSpatialMass(options) {
      if (turntableBusy) return;
      const chunk = selectedChunk();
      if (!chunk) {
        setStatus("Select a placed 2D chunk first.", "error");
        return;
      }
      if (!chunk.branches || !chunk.branches.length) {
        setStatus("That chunk has no branch geometry to convert into solids.", "error");
        return;
      }
      const lib = global.D7SpatialMass;
      if (!lib || !global.THREE) {
        setStatus("Branch-solid generator did not load.", "error");
        return;
      }
      if (!viewer) ensureViewer();
      let seed = massSeeds.get(chunk.id) || 1;
      if (options && options.newSeed) seed += 1;
      massSeeds.set(chunk.id, seed);
      const params = Object.assign(massParams(), { seed });
      setStatus(`Generating branch solids from ${chunk.label}...`, "active");
      const run = () => {
        try {
          const result = lib.generate(global.THREE, chunk, params);
          if (!result.vertexCount) {
            setStatus("No solid geometry formed from those branches.", "error");
            refreshChunkUi();
            return;
          }
          const geom = new global.THREE.BufferGeometry();
          geom.setAttribute("position", new global.THREE.Float32BufferAttribute(result.positions, 3));
          geom.setAttribute("normal", new global.THREE.Float32BufferAttribute(result.normals, 3));
          viewer.setMass(chunk.id, geom, chunk, solidOpacityValue());
          applyDisplayToggles();
          refreshChunkUi();
          markVoxelStale();
          setStatus(
            `${chunk.label} \u2192 Branch solids · ${result.triangleCount} faces · seed ${seed}`,
            "active"
          );
        } catch (err) {
          setStatus(err && err.message ? err.message : "Branch-solid generation failed.", "error");
        }
      };
      requestAnimationFrame(run);
    }

    function clearSelectedMass() {
      const chunk = selectedChunk();
      if (!chunk) {
        setStatus("Select a chunk with solids to clear.", "error");
        return;
      }
      if (!viewer || !viewer.hasMass || !viewer.hasMass(chunk.id)) {
        setStatus("That chunk has no solids to clear.", "error");
        return;
      }
      viewer.removeMass(chunk.id);
      refreshChunkUi();
      setStatus(`${chunk.label} solids cleared. Source branches remain.`, "active");
    }

    function drawPreview() {
      if (!preview || !api || !api.draw2dPreview) return;
      api.draw2dPreview(preview);
      drawOverlay();
    }

    function bindViewerEvents() {
      if (!viewer) return;
      viewer.setOnSelect((id) => {
        selectedChunkId = id;
        if (id) {
          const chunk = chunks.find((item) => item.id === id);
          selectedLoftId = chunk && chunk.loftSetId ? chunk.loftSetId : selectedLoftId;
        }
        selectedSectionId = null;
        selectedNodeIds = [];
        if (editLines) {
          selectedLineNodeIds = [];
          selectedLineSegIds = [];
          const chunk = selectedChunk();
          if (viewer && viewer.setEditLines) viewer.setEditLines(true, chunk);
        }
        refreshChunkUi();
        refreshChunks();
        applyDisplayToggles();
      });
      viewer.setOnTransform((id, transform) => {
        const chunk = chunks.find((item) => item.id === id);
        if (!chunk) return;
        chunk.transform = Object.assign({}, chunk.transform, transform);
        if (!hudInteracting) fillTransformUi();
        markVoxelStale();
      });
      viewer.setOnSectionSelect((id) => {
        const loft = loftSets.find((item) => item.sections.some((sec) => sec.id === id));
        if (loft) {
          selectedLoftId = loft.id;
          selectedChunkId = loft.sourceChunkId;
        }
        selectedSectionId = id;
        selectedNodeIds = [];
        refreshChunkUi();
        refreshChunks();
      });
      viewer.setOnSectionTransform((id, transform) => {
        const loft = selectedLoft() || loftSets.find((item) => item.sections.some((sec) => sec.id === id));
        const section = loft && loft.sections.find((item) => item.id === id);
        if (!section) return;
        section.transform = Object.assign({}, section.transform, transform);
        if (!hudInteracting) fillTransformUi();
        noteLoftGeometryChanged("live");
      });
      if (viewer.setOnGizmoDragEnd) {
        viewer.setOnGizmoDragEnd(() => {
          if (editLines) return;
          if (selectedSection()) noteLoftGeometryChanged("commit");
        });
      }
      viewer.setOnNodeSelect((ids) => {
        selectedNodeIds = ids || [];
        fillTransformUi();
        refreshLoftView();
      });
      viewer.setOnNodeMove((sectionId, ids, dx, dy) => {
        const loft = selectedLoft();
        const section = loft && loft.sections.find((item) => item.id === sectionId);
        if (!section || !loft) return;
        if (!nodeOrigins) nodeOrigins = snapshotNodes(section, ids);
        const rest = restDelta(section, loft, dx, dy);
        applyNodeDelta(section, nodeOrigins, rest.x, rest.y);
        refreshLoftView();
        noteLoftGeometryChanged("live");
      });
      viewer.setOnNodeDragEnd(() => {
        nodeOrigins = null;
        fillTransformUi();
        noteLoftGeometryChanged("commit");
      });
      if (viewer.setOnLineSelect) {
        viewer.setOnLineSelect((nodeIds, segIds) => {
          selectedLineNodeIds = nodeIds || [];
          selectedLineSegIds = segIds || [];
          paintLineButtons();
        });
      }
      if (viewer.setOnLineEdit) {
        viewer.setOnLineEdit((phase) => {
          const chunk = selectedChunk();
          if (!chunk) return;
          if (phase === "begin") {
            if (!lineEditing) {
              pushLineUndo(chunk);
              lineEditing = true;
            }
            return;
          }
          if (phase === "live") {
            rebuildBranchesFromGraph(chunk);
            syncLoftFromChunk(chunk);
            noteLoftGeometryChanged("live");
            return;
          }
          if (phase === "commit") {
            lineEditing = false;
            rebuildBranchesFromGraph(chunk);
            syncLoftFromChunk(chunk);
            refreshChunks();
            paintLineButtons();
            noteLoftGeometryChanged("commit");
          }
        });
      }
    }

    function ensureViewer() {
      if (viewer || !stage) return viewer;
      viewer = createViewer(stage);
      if (viewer) {
        bindViewerEvents();
        viewer.start();
        refreshChunks();
        refreshLoftView();
        setGizmoMode("translate");
        applyDisplayToggles();
        if (viewer.setSilhouetteThickness) {
          viewer.setSilhouetteThickness(els.silhouetteThick ? els.silhouetteThick.value : 3);
        }
        if (viewer.getViewMode && viewer.getViewMode() !== viewModeUi) {
          viewer.setViewMode(viewModeUi);
        }
        paintViewButtons();
      }
      return viewer;
    }

    bindSlider(els.fidelity, els.fidelityVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.massVariation, els.massVariationVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.solidWidth, els.solidWidthVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.solidDepth, els.solidDepthVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.spatialReach, els.spatialReachVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.solidOpacity, els.solidOpacityVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.loftOpacity, els.loftOpacityVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.offset, els.offsetVal, (v) => Number(v).toFixed(1));
    bindSlider(els.sectionSpacing, els.sectionSpacingVal, (v) => Number(v).toFixed(1));
    bindSlider(els.morphStrength, els.morphStrengthVal, (v) => `${Math.round(Number(v))}`);
    bindSlider(els.morphSmoothness, els.morphSmoothnessVal, (v) => `${Math.round(Number(v))}`);
    bindSlider(els.secScale, els.secScaleVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.secScaleX, els.secScaleXVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.secScaleY, els.secScaleYVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.secRot, els.secRotVal, (v) => `${Math.round(Number(v))}°`);
    bindSlider(els.shiftX, els.shiftXVal, (v) => Number(v).toFixed(1));
    bindSlider(els.shiftY, els.shiftYVal, (v) => Number(v).toFixed(1));
    bindSlider(els.taper, els.taperVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.loftWidth, els.loftWidthVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.loftThick, els.loftThickVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.voxelOpacity, els.voxelOpacityVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.voxelFidelity, els.voxelFidelityVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.silhouetteThick, els.silhouetteThickVal, (v) => `${Math.round(Number(v))}`);

    function setControl(el, value) {
      if (el) el.value = String(value);
    }

    function setSlider(el, label, value, format) {
      setControl(el, value);
      if (label) label.textContent = format(value);
    }

    function clonePlain(value) {
      if (value == null) return value;
      try {
        return JSON.parse(JSON.stringify(value));
      } catch (err) {
        return null;
      }
    }

    function saved3dStore() {
      return global.D7Saved3DVariations || null;
    }

    function formatSaved3dDate(ms) {
      if (!ms) return "";
      try {
        return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      } catch (err) {
        return "";
      }
    }

    function packVoxelCells(cells) {
      const out = [];
      for (const cell of cells || []) {
        out.push([
          Number(cell.ix) || 0,
          Number(cell.iy) || 0,
          Number(cell.iz) || 0,
          Math.max(1, Number(cell.size) || 1),
        ]);
      }
      return out;
    }

    function unpackVoxelCells(packed) {
      const cells = [];
      for (const item of packed || []) {
        if (Array.isArray(item)) {
          cells.push({
            ix: Number(item[0]) || 0,
            iy: Number(item[1]) || 0,
            iz: Number(item[2]) || 0,
            size: Math.max(1, Number(item[3]) || 1),
            occupied: true,
          });
        } else if (item && typeof item === "object") {
          cells.push({
            ix: Number(item.ix) || 0,
            iy: Number(item.iy) || 0,
            iz: Number(item.iz) || 0,
            size: Math.max(1, Number(item.size) || 1),
            occupied: true,
          });
        }
      }
      return cells;
    }

    function captureWorkspaceSnapshot() {
      const masses = {};
      for (const chunk of chunks) {
        const hasMass = !!(viewer && viewer.hasMass && viewer.hasMass(chunk.id));
        if (hasMass || massSeeds.has(chunk.id)) {
          masses[chunk.id] = {
            exists: hasMass,
            seed: massSeeds.get(chunk.id) || 1,
          };
        }
      }
      const voxelPayload = viewer && viewer.getVoxelExportData ? viewer.getVoxelExportData() : null;
      const voxelCellsPacked = packVoxelCells((voxelPayload && voxelPayload.cells) || []);
      const hasVoxels = !!(voxelCellsPacked.length && viewer && viewer.hasVoxels && viewer.hasVoxels());
      return {
        nextChunkIndex,
        nextLoftIndex,
        selectedChunkId,
        selectedLoftId,
        selectedSectionId,
        chunks: clonePlain(chunks) || [],
        loftSets: clonePlain(loftSets) || [],
        morph: {
          spacing: Number(els.sectionSpacing?.value ?? 4),
          strength: Number(els.morphStrength?.value ?? 30),
          smoothness: Number(els.morphSmoothness?.value ?? 70),
        },
        loft: {
          exists: hasExistingLoft(),
          stale: !!loftStale,
          style: els.loftStyle?.value || "smooth",
          width: Number(els.loftWidth?.value ?? 28),
          thickness: Number(els.loftThick?.value ?? 32),
          useHierarchy: !!(els.loftHierarchy && els.loftHierarchy.checked),
          opacity: Number(els.loftOpacity?.value ?? 100),
          live: !!liveLoftOn,
        },
        voxels: {
          exists: hasVoxels,
          stale: !!voxelStale,
          resolution: Number((voxelPayload && voxelPayload.resolution) || els.voxelRes?.value || 20),
          fidelity: Number(els.voxelFidelity?.value ?? 75),
          source: els.voxelSource?.value || "loft",
          target: els.voxelTarget?.value || "selected",
          cells: voxelCellsPacked,
          info: voxelInfo
            ? {
                occupiedCount: voxelInfo.occupiedCount,
                voxelCount: voxelInfo.voxelCount,
                smallCount: voxelInfo.smallCount,
                mediumCount: voxelInfo.mediumCount,
                largeCount: voxelInfo.largeCount,
                components: voxelInfo.components,
                isolatedCount: voxelInfo.isolatedCount,
                totalCount: voxelInfo.totalCount,
              }
            : null,
          opacity: Number(els.voxelOpacity?.value ?? 100),
          colorBySize: !!(els.voxelColorBySize && els.voxelColorBySize.checked),
          edges: !els.voxelEdges || els.voxelEdges.checked,
          live: !!liveVoxelsOn,
        },
        masses,
        massParams: {
          width: Number(els.solidWidth?.value ?? 28),
          depth: Number(els.solidDepth?.value ?? 40),
          reach: Number(els.spatialReach?.value ?? 45),
          fidelity: Number(els.fidelity?.value ?? 80),
          variation: Number(els.massVariation?.value ?? 22),
          useHierarchy: !!(els.useHierarchy && els.useHierarchy.checked),
          opacity: Number(els.solidOpacity?.value ?? 100),
        },
        display: {
          lines: !!displayLines,
          solids: !!displaySolids,
          voxels: !!displayVoxels,
          silhouette: !!silhouetteOn,
          silhouetteThickness: Number(els.silhouetteThick?.value ?? 3),
          showSourceChunk: !els.showSourceChunk || els.showSourceChunk.checked,
          showSections: !els.showSections || els.showSections.checked,
          showLoftLines: !els.showLoftLines || els.showLoftLines.checked,
          showLoftSolids: !els.showLoftSolids || els.showLoftSolids.checked,
          showVoxels: !els.showVoxels || els.showVoxels.checked,
          showBranches: !els.showBranches || els.showBranches.checked,
          showPlane: !!(els.showPlane && els.showPlane.checked),
          showWireframe: !!(els.showWireframe && els.showWireframe.checked),
        },
        camera: viewer && viewer.getCameraState ? viewer.getCameraState() : { viewMode: viewModeUi },
      };
    }

    function blobToDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    }

    async function captureSaved3dThumbnail() {
      try {
        if (!viewer || !viewer.capturePng) return "";
        const result = await viewer.capturePng({ size: 256, transparent: false });
        const blob = result && result.blob;
        if (!blob) return "";
        return await blobToDataUrl(blob);
      } catch (err) {
        return "";
      }
    }

    function setSaved3dStatus(message, kind) {
      if (!els.saved3dStatus) return;
      els.saved3dStatus.textContent = message;
      els.saved3dStatus.classList.toggle("active", kind === "active");
      els.saved3dStatus.classList.toggle("error", kind === "error");
      els.saved3dStatus.classList.toggle("space3d-saved-unsaved", kind === "unsaved");
    }

    function paintSaved3dButtons() {
      const hasStudy = chunks.length > 0;
      if (els.save3d) els.save3d.disabled = !hasStudy;
      if (els.save3dUpdate) els.save3dUpdate.disabled = !openedVariationId || !workspaceDirty;
      if (els.save3dAs) els.save3dAs.disabled = !openedVariationId;
      if (!hasStudy) {
        setSaved3dStatus("Save the current 3D study in this browser. It stays on this computer until you delete it.");
      } else if (openedVariationId && workspaceDirty) {
        setSaved3dStatus(`Unsaved Changes · ${openedVariationName || "3D Variation"}`, "unsaved");
      } else if (openedVariationId) {
        setSaved3dStatus(`Opened · ${openedVariationName || "3D Variation"}`, "active");
      } else {
        setSaved3dStatus("Current study is not saved yet.");
      }
    }

    function closeSave3dPanel() {
      if (els.save3dPanel) els.save3dPanel.classList.add("hidden");
      save3dMode = "create";
    }

    function openSave3dPanel(mode, presetName) {
      save3dMode = mode || "create";
      if (!els.save3dPanel) return;
      els.save3dPanel.classList.remove("hidden");
      if (els.save3dName) {
        els.save3dName.value = presetName || "";
        els.save3dName.focus();
        els.save3dName.select();
      }
      if (els.save3dConfirm) {
        els.save3dConfirm.textContent = mode === "rename" ? "Rename" : "Save";
      }
    }

    function closeDelete3dDialog() {
      pendingDelete3dId = null;
      if (els.delete3dDialog) els.delete3dDialog.classList.add("hidden");
    }

    function openDelete3dDialog(id) {
      pendingDelete3dId = id;
      if (els.delete3dDialog) els.delete3dDialog.classList.remove("hidden");
      if (els.delete3dCancel) els.delete3dCancel.focus();
    }

    function renderSaved3dList() {
      const list = els.saved3dList;
      if (!list) return;
      list.innerHTML = "";
      for (const record of saved3dRecords) {
        const item = document.createElement("li");
        if (record.id === openedVariationId) item.className = "active";
        if (record.thumbnail) {
          const img = document.createElement("img");
          img.alt = "";
          img.width = 72;
          img.height = 72;
          img.src = record.thumbnail;
          item.appendChild(img);
        }
        const body = document.createElement("div");
        body.className = "saved-sim-card-body";
        const title = document.createElement("strong");
        title.className = "saved-sim-card-title";
        title.textContent = record.name || "Untitled";
        const meta = document.createElement("div");
        meta.className = "saved-sim-card-meta";
        const created = formatSaved3dDate(record.createdAt);
        const updated = formatSaved3dDate(record.updatedAt);
        meta.innerHTML = created
          ? `Created ${created}${updated && updated !== created ? `<br>Modified ${updated}` : ""}`
          : "";
        const actions = document.createElement("div");
        actions.className = "saved-sim-card-actions";
        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.textContent = "Open";
        openBtn.addEventListener("click", () => openSaved3dVariation(record.id));
        const dupBtn = document.createElement("button");
        dupBtn.type = "button";
        dupBtn.textContent = "Duplicate";
        dupBtn.addEventListener("click", () => duplicateSaved3dVariation(record.id));
        const renameBtn = document.createElement("button");
        renameBtn.type = "button";
        renameBtn.textContent = "Rename";
        renameBtn.addEventListener("click", () => {
          rename3dId = record.id;
          openSave3dPanel("rename", record.name || "");
        });
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.textContent = "Delete";
        delBtn.addEventListener("click", () => openDelete3dDialog(record.id));
        actions.appendChild(openBtn);
        actions.appendChild(dupBtn);
        actions.appendChild(renameBtn);
        actions.appendChild(delBtn);
        body.appendChild(title);
        body.appendChild(meta);
        body.appendChild(actions);
        item.appendChild(body);
        list.appendChild(item);
      }
    }

    async function refreshSaved3dList() {
      const store = saved3dStore();
      if (!store) {
        setSaved3dStatus("Saved 3D Variations need IndexedDB in this browser.", "error");
        return;
      }
      try {
        saved3dRecords = await store.list();
        renderSaved3dList();
        paintSaved3dButtons();
      } catch (err) {
        setSaved3dStatus(err && err.message ? err.message : "Could not read saved 3D variations.", "error");
      }
    }

    async function persistSaved3dRecord(record) {
      const store = saved3dStore();
      if (!store) throw new Error("Saved 3D Variations need IndexedDB in this browser.");
      return store.put(record);
    }

    async function commitSaved3d(options) {
      const opts = options || {};
      if (!chunks.length) {
        setStatus("Place a 3D chunk before saving a variation.", "error");
        return;
      }
      const store = saved3dStore();
      if (!store) {
        setStatus("Saved 3D Variations need IndexedDB in this browser.", "error");
        return;
      }
      const asNew = !!opts.asNew;
      const renameOnly = !!opts.renameOnly;
      let name = String(opts.name != null ? opts.name : "").trim();
      try {
        const records = saved3dRecords.length ? saved3dRecords : await store.list();
        if (!name) name = store.nextDefaultName(records);
        let thumbnail = "";
        if (!renameOnly) {
          thumbnail = await captureSaved3dThumbnail();
        }
        const now = Date.now();
        let record;
        if (renameOnly) {
          const targetId = rename3dId || openedVariationId;
          if (!targetId) throw new Error("That saved 3D variation was not found.");
          const existing = await store.get(targetId);
          if (!existing) throw new Error("That saved 3D variation was not found.");
          record = { ...existing, name, updatedAt: now };
          rename3dId = null;
        } else if (!asNew && openedVariationId) {
          const existing = await store.get(openedVariationId);
          record = {
            ...(existing || {}),
            id: openedVariationId,
            name,
            createdAt: (existing && existing.createdAt) || now,
            updatedAt: now,
            version: store.DATA_VERSION || 1,
            thumbnail: thumbnail || (existing && existing.thumbnail) || "",
            workspace: captureWorkspaceSnapshot(),
          };
        } else {
          record = {
            id: store.createId(),
            name,
            createdAt: now,
            updatedAt: now,
            version: store.DATA_VERSION || 1,
            thumbnail: thumbnail || "",
            workspace: captureWorkspaceSnapshot(),
          };
        }
        await persistSaved3dRecord(record);
        if (renameOnly) {
          if (openedVariationId === record.id) openedVariationName = record.name;
          workspaceDirty = workspaceDirty;
        } else {
          openedVariationId = record.id;
          openedVariationName = record.name;
          workspaceDirty = false;
        }
        closeSave3dPanel();
        await refreshSaved3dList();
        setStatus(`Saved ${record.name}. It will remain after you close the browser.`, "active");
      } catch (err) {
        setStatus(err && err.message ? err.message : "Could not save the 3D variation.", "error");
      }
    }

    function applyControlSnapshot(workspace) {
      const morph = workspace.morph || {};
      setSlider(els.sectionSpacing, els.sectionSpacingVal, morph.spacing != null ? morph.spacing : 4, (v) => Number(v).toFixed(1));
      setSlider(els.morphStrength, els.morphStrengthVal, morph.strength != null ? morph.strength : 30, (v) => `${Math.round(Number(v))}`);
      setSlider(els.morphSmoothness, els.morphSmoothnessVal, morph.smoothness != null ? morph.smoothness : 70, (v) => `${Math.round(Number(v))}`);
      const loft = workspace.loft || {};
      if (els.loftStyle) els.loftStyle.value = loft.style || "smooth";
      setSlider(els.loftWidth, els.loftWidthVal, loft.width != null ? loft.width : 28, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.loftThick, els.loftThickVal, loft.thickness != null ? loft.thickness : 32, (v) => `${Math.round(Number(v))}%`);
      if (els.loftHierarchy) els.loftHierarchy.checked = !!loft.useHierarchy;
      setSlider(els.loftOpacity, els.loftOpacityVal, loft.opacity != null ? loft.opacity : 100, (v) => `${Math.round(Number(v))}%`);
      liveLoftOn = !!loft.live;
      const voxels = workspace.voxels || {};
      if (els.voxelRes) els.voxelRes.value = String(voxels.resolution || 20);
      setSlider(els.voxelFidelity, els.voxelFidelityVal, voxels.fidelity != null ? voxels.fidelity : 75, (v) => `${Math.round(Number(v))}%`);
      if (els.voxelSource) els.voxelSource.value = voxels.source || "loft";
      if (els.voxelTarget) els.voxelTarget.value = voxels.target || "selected";
      setSlider(els.voxelOpacity, els.voxelOpacityVal, voxels.opacity != null ? voxels.opacity : 100, (v) => `${Math.round(Number(v))}%`);
      if (els.voxelColorBySize) els.voxelColorBySize.checked = !!voxels.colorBySize;
      if (els.voxelEdges) els.voxelEdges.checked = voxels.edges !== false;
      liveVoxelsOn = !!voxels.live;
      const mass = workspace.massParams || {};
      setSlider(els.solidWidth, els.solidWidthVal, mass.width != null ? mass.width : 28, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.solidDepth, els.solidDepthVal, mass.depth != null ? mass.depth : 40, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.spatialReach, els.spatialReachVal, mass.reach != null ? mass.reach : 45, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.fidelity, els.fidelityVal, mass.fidelity != null ? mass.fidelity : 80, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.massVariation, els.massVariationVal, mass.variation != null ? mass.variation : 22, (v) => `${Math.round(Number(v))}%`);
      if (els.useHierarchy) els.useHierarchy.checked = !!mass.useHierarchy;
      setSlider(els.solidOpacity, els.solidOpacityVal, mass.opacity != null ? mass.opacity : 100, (v) => `${Math.round(Number(v))}%`);
      const display = workspace.display || {};
      displayLines = display.lines !== false;
      displaySolids = display.solids !== false;
      displayVoxels = display.voxels !== false;
      silhouetteOn = !!display.silhouette;
      setSlider(els.silhouetteThick, els.silhouetteThickVal, display.silhouetteThickness != null ? display.silhouetteThickness : 3, (v) => `${Math.round(Number(v))}`);
      if (els.showSourceChunk) els.showSourceChunk.checked = display.showSourceChunk !== false;
      if (els.showSections) els.showSections.checked = display.showSections !== false;
      if (els.showLoftLines) els.showLoftLines.checked = display.showLoftLines !== false;
      if (els.showLoftSolids) els.showLoftSolids.checked = display.showLoftSolids !== false;
      if (els.showVoxels) els.showVoxels.checked = display.showVoxels !== false;
      if (els.showBranches) els.showBranches.checked = display.showBranches !== false;
      if (els.showPlane) els.showPlane.checked = !!display.showPlane;
      if (els.showWireframe) els.showWireframe.checked = !!display.showWireframe;
    }

    function restoreMasses(workspace) {
      const lib = global.D7SpatialMass;
      const masses = workspace.masses || {};
      massSeeds.clear();
      if (!lib || !global.THREE || !viewer) return;
      for (const chunk of chunks) {
        const rec = masses[chunk.id];
        if (!rec) continue;
        massSeeds.set(chunk.id, rec.seed || 1);
        if (!rec.exists) continue;
        const result = lib.generate(global.THREE, chunk, Object.assign(massParams(), { seed: rec.seed || 1 }));
        if (!result || !result.vertexCount) continue;
        const geom = new global.THREE.BufferGeometry();
        geom.setAttribute("position", new global.THREE.Float32BufferAttribute(result.positions, 3));
        geom.setAttribute("normal", new global.THREE.Float32BufferAttribute(result.normals, 3));
        viewer.setMass(chunk.id, geom, chunk, solidOpacityValue());
      }
    }

    function restoreWorkspaceFromRecord(record) {
      const workspace = (record && record.workspace) || {};
      applyingSaved3d = true;
      try {
        resetWorkspace({ silent: true, skipCamera: true, keepSaved: true });
        const loadedChunks = clonePlain(workspace.chunks) || [];
        const loadedLofts = clonePlain(workspace.loftSets) || [];
        chunks.length = 0;
        for (const chunk of loadedChunks) {
          ensureGraphIds(chunk);
          chunks.push(chunk);
        }
        loftSets.length = 0;
        for (const loft of loadedLofts) loftSets.push(loft);
        nextChunkIndex = Math.max(Number(workspace.nextChunkIndex) || 1, chunks.reduce((max, item) => Math.max(max, Number(item.index) || 0), 0) + 1);
        nextLoftIndex = Math.max(Number(workspace.nextLoftIndex) || 1, loftSets.length + 1);
        selectedChunkId = workspace.selectedChunkId || (chunks[0] ? chunks[0].id : null);
        selectedLoftId = workspace.selectedLoftId || (loftSets[0] ? loftSets[0].id : null);
        selectedSectionId = workspace.selectedSectionId || null;
        if (selectedLoftId && !loftSets.some((item) => item.id === selectedLoftId)) {
          selectedLoftId = loftSets[0] ? loftSets[0].id : null;
        }
        const loft = selectedLoft();
        if (loft && selectedSectionId && !loft.sections.some((item) => item.id === selectedSectionId)) {
          selectedSectionId = loft.sections[0] ? loft.sections[0].id : null;
        }
        applyControlSnapshot(workspace);
        ensureViewer();
        refreshChunks();
        if (viewer) {
          if (viewer.setLoftOpacity) viewer.setLoftOpacity(loftOpacityValue());
          if (viewer.setVoxelOpacity) viewer.setVoxelOpacity(voxelOpacityValue());
          if (viewer.setMassOpacity) viewer.setMassOpacity(solidOpacityValue());
          if (viewer.setVoxelColorBySize) viewer.setVoxelColorBySize(!!(els.voxelColorBySize && els.voxelColorBySize.checked));
          if (viewer.setVoxelEdges) viewer.setVoxelEdges(!els.voxelEdges || els.voxelEdges.checked);
          if (viewer.setSilhouetteMode) viewer.setSilhouetteMode(silhouetteOn);
          if (viewer.setSilhouetteThickness) viewer.setSilhouetteThickness(els.silhouetteThick ? els.silhouetteThick.value : 3);
        }
        const loftState = workspace.loft || {};
        if (loftState.exists && loft && loft.sections.length >= 2) {
          rebuildLoftMesh({ draft: false, silent: true, final: true });
          loftStale = !!loftState.stale;
        } else {
          loftStale = false;
        }
        restoreMasses(workspace);
        const voxelState = workspace.voxels || {};
        const restoredCells = unpackVoxelCells(voxelState.cells);
        if (voxelState.exists && restoredCells.length && viewer && viewer.setVoxels) {
          const payload = {
            cells: restoredCells,
            resolution: voxelState.resolution || 20,
            occupiedCount: (voxelState.info && voxelState.info.occupiedCount) || restoredCells.length,
            voxelCount: (voxelState.info && voxelState.info.voxelCount) || restoredCells.length,
            smallCount: voxelState.info ? voxelState.info.smallCount : restoredCells.filter((c) => c.size <= 1).length,
            mediumCount: voxelState.info ? voxelState.info.mediumCount : restoredCells.filter((c) => c.size === 2).length,
            largeCount: voxelState.info ? voxelState.info.largeCount : restoredCells.filter((c) => c.size >= 3).length,
            components: voxelState.info ? voxelState.info.components : 1,
            isolatedCount: voxelState.info ? voxelState.info.isolatedCount : 0,
            totalCount: (voxelState.info && voxelState.info.totalCount) || 0,
          };
          viewer.setVoxels(payload);
          voxelInfo = payload;
          voxelStamp = currentVoxelStamp();
          voxelStale = !!voxelState.stale;
        }
        applyDisplayToggles();
        if (viewer && viewer.applyCameraState && workspace.camera) {
          viewer.applyCameraState(workspace.camera);
          viewModeUi = workspace.camera.viewMode || viewModeUi;
          paintViewButtons();
        }
        refreshChunkUi();
        paintLiveButtons();
        paintVoxelButtons();
        paintExportButtons();
      } finally {
        applyingSaved3d = false;
      }
    }

    async function openSaved3dVariation(id) {
      const store = saved3dStore();
      if (!store) {
        setStatus("Saved 3D Variations need IndexedDB in this browser.", "error");
        return;
      }
      try {
        const record = await store.get(id);
        if (!record) {
          setStatus("That saved 3D variation was not found.", "error");
          await refreshSaved3dList();
          return;
        }
        restoreWorkspaceFromRecord(record);
        openedVariationId = record.id;
        openedVariationName = record.name || "3D Variation";
        workspaceDirty = false;
        closeSave3dPanel();
        closeDelete3dDialog();
        await refreshSaved3dList();
        setStatus(`Opened ${openedVariationName}. Continue editing from this saved study.`, "active");
      } catch (err) {
        setStatus(err && err.message ? err.message : "Could not open the 3D variation.", "error");
      }
    }

    async function duplicateSaved3dVariation(id) {
      const store = saved3dStore();
      if (!store) return;
      try {
        const record = await store.get(id);
        if (!record) return;
        const now = Date.now();
        const copy = {
          ...clonePlain(record),
          id: store.createId(),
          name: store.duplicateName(record.name),
          createdAt: now,
          updatedAt: now,
        };
        await persistSaved3dRecord(copy);
        await refreshSaved3dList();
        setStatus(`Duplicated as ${copy.name}.`, "active");
      } catch (err) {
        setStatus(err && err.message ? err.message : "Could not duplicate the 3D variation.", "error");
      }
    }

    async function confirmDeleteSaved3d() {
      const id = pendingDelete3dId;
      closeDelete3dDialog();
      if (!id) return;
      const store = saved3dStore();
      if (!store) return;
      try {
        await store.remove(id);
        if (openedVariationId === id) {
          openedVariationId = null;
          openedVariationName = "";
          workspaceDirty = chunks.length > 0;
        }
        await refreshSaved3dList();
        setStatus("Saved 3D variation deleted. The current workspace and 2D simulation are unchanged.", "active");
      } catch (err) {
        setStatus(err && err.message ? err.message : "Could not delete the 3D variation.", "error");
      }
    }

    function beginSave3d(mode) {
      if (turntableBusy) return;
      if (!chunks.length && mode !== "rename") {
        setStatus("Place a 3D chunk before saving a variation.", "error");
        return;
      }
      const store = saved3dStore();
      const preset =
        mode === "rename"
          ? openedVariationName
          : mode === "update"
            ? openedVariationName
            : mode === "asNew"
              ? store
                ? store.duplicateName(openedVariationName || "3D Variation")
                : ""
              : "";
      openSave3dPanel(mode || "create", preset);
    }

    function submitSave3dPanel() {
      const name = els.save3dName ? els.save3dName.value : "";
      if (save3dMode === "rename") {
        commitSaved3d({ renameOnly: true, name });
        return;
      }
      if (save3dMode === "update") {
        commitSaved3d({ asNew: false, name });
        return;
      }
      commitSaved3d({ asNew: save3dMode === "asNew" || !openedVariationId, name });
    }

    function reset3dControls() {
      setControl(els.posX, "0");
      setControl(els.posY, "0");
      setControl(els.posZ, "0");
      setControl(els.rotX, "0");
      setControl(els.rotY, "0");
      setControl(els.rotZ, "0");
      setSlider(els.scale, els.scaleVal, 1, (v) => Number(v).toFixed(2));
      setControl(els.scaleX, "1");
      setControl(els.scaleY, "1");
      setSlider(els.offset, els.offsetVal, 0, (v) => Number(v).toFixed(1));
      setSlider(els.sectionSpacing, els.sectionSpacingVal, 4, (v) => Number(v).toFixed(1));
      setSlider(els.morphStrength, els.morphStrengthVal, 30, (v) => `${Math.round(Number(v))}`);
      setSlider(els.morphSmoothness, els.morphSmoothnessVal, 70, (v) => `${Math.round(Number(v))}`);
      setSlider(els.secScale, els.secScaleVal, 100, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.secScaleX, els.secScaleXVal, 100, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.secScaleY, els.secScaleYVal, 100, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.secRot, els.secRotVal, 0, (v) => `${Math.round(Number(v))}°`);
      setSlider(els.shiftX, els.shiftXVal, 0, (v) => Number(v).toFixed(1));
      setSlider(els.shiftY, els.shiftYVal, 0, (v) => Number(v).toFixed(1));
      setSlider(els.taper, els.taperVal, 100, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.nodeRot, els.nodeRotVal, 0, (v) => `${Math.round(Number(v))}°`);
      setSlider(els.nodeScale, els.nodeScaleVal, 100, (v) => `${Math.round(Number(v))}%`);
      setControl(els.nodeX, "0");
      setControl(els.nodeY, "0");
      setSlider(els.loftWidth, els.loftWidthVal, 28, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.loftThick, els.loftThickVal, 32, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.solidWidth, els.solidWidthVal, 28, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.solidDepth, els.solidDepthVal, 40, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.spatialReach, els.spatialReachVal, 45, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.fidelity, els.fidelityVal, 80, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.massVariation, els.massVariationVal, 22, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.solidOpacity, els.solidOpacityVal, 100, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.loftOpacity, els.loftOpacityVal, 100, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.voxelOpacity, els.voxelOpacityVal, 100, (v) => `${Math.round(Number(v))}%`);
      setSlider(els.voxelFidelity, els.voxelFidelityVal, 75, (v) => `${Math.round(Number(v))}%`);
      if (els.loftStyle) els.loftStyle.value = "smooth";
      if (els.voxelRes) els.voxelRes.value = "20";
      if (els.voxelSource) els.voxelSource.value = "loft";
      if (els.voxelTarget) els.voxelTarget.value = "selected";
      if (els.loftHierarchy) els.loftHierarchy.checked = false;
      if (els.useHierarchy) els.useHierarchy.checked = false;
      if (els.showBranches) els.showBranches.checked = true;
      if (els.showPlane) els.showPlane.checked = false;
      if (els.showWireframe) els.showWireframe.checked = false;
      if (els.showSourceChunk) els.showSourceChunk.checked = true;
      if (els.showSections) els.showSections.checked = true;
      if (els.showLoftLines) els.showLoftLines.checked = true;
      if (els.showLoftSolids) els.showLoftSolids.checked = true;
      if (els.showVoxels) els.showVoxels.checked = true;
      if (els.voxelColorBySize) els.voxelColorBySize.checked = false;
      if (els.voxelEdges) els.voxelEdges.checked = true;
      if (els.pngRes) els.pngRes.value = "3000";
      if (els.pngBg) els.pngBg.value = "current";
      setSlider(els.silhouetteThick, els.silhouetteThickVal, 3, (v) => `${Math.round(Number(v))}`);
      silhouetteOn = false;
    }

    function isResetDialogOpen() {
      return !!(els.resetDialog && !els.resetDialog.classList.contains("hidden"));
    }

    function closeResetDialog() {
      if (els.resetDialog) els.resetDialog.classList.add("hidden");
    }

    function openResetDialog() {
      if (turntableBusy) return;
      if (!els.resetDialog) return;
      els.resetDialog.classList.remove("hidden");
      if (els.resetCancel) els.resetCancel.focus();
    }

    function resetWorkspace(options) {
      if (turntableBusy) return;
      const silent = !!(options && options.silent);
      const keepSaved = !!(options && options.keepSaved);
      const skipCamera = !!(options && options.skipCamera);
      if (!silent) closeResetDialog();
      closeSave3dPanel();
      closeDelete3dDialog();
      selecting = false;
      draft = null;
      drag = null;
      editLines = false;
      editBranches = false;
      boxSelectOn = false;
      moveSegmentOn = false;
      lineUndo = [];
      lineRedo = [];
      lineEditing = false;
      lineAxis = "free";
      selectedLineNodeIds = [];
      selectedLineSegIds = [];
      selectedChunkId = null;
      selectedLoftId = null;
      selectedSectionId = null;
      selectedNodeIds = [];
      nodeOrigins = null;
      nodeToolOrigins = null;
      chunks.length = 0;
      loftSets.length = 0;
      nextChunkIndex = 1;
      nextLoftIndex = 1;
      massSeeds.clear();
      voxelInfo = null;
      voxelStamp = "";
      voxelStale = false;
      loftStale = false;
      loftCapsules = [];
      exportNameHint = "";
      loftDraftAt = 0;
      loftDraftQueued = false;
      if (loftFinalTimer) clearTimeout(loftFinalTimer);
      loftFinalTimer = 0;
      liveLoftOn = false;
      liveVoxelsOn = false;
      displayLines = true;
      displaySolids = true;
      displayVoxels = true;
      silhouetteOn = false;
      gizmoMode = "translate";
      hudInteracting = false;
      reset3dControls();
      if (viewer && viewer.clearWorkspace) viewer.clearWorkspace();
      else if (viewer && viewer.resetCamera) viewer.resetCamera();
      if (viewer) {
        if (viewer.setMassOpacity) viewer.setMassOpacity(solidOpacityValue());
        if (viewer.setLoftOpacity) viewer.setLoftOpacity(Number(els.loftOpacity?.value ?? 100) / 100);
        if (viewer.setVoxelOpacity) viewer.setVoxelOpacity(voxelOpacityValue());
        if (viewer.setVoxelColorBySize) viewer.setVoxelColorBySize(false);
        if (viewer.setVoxelEdges) viewer.setVoxelEdges(true);
        if (viewer.setSilhouetteMode) viewer.setSilhouetteMode(false);
        if (viewer.setSilhouetteThickness) viewer.setSilhouetteThickness(3);
        if (viewer.setMassWireframe) viewer.setMassWireframe(false);
        if (viewer.setEditBranches) viewer.setEditBranches(false);
        if (viewer.setBoxSelect) viewer.setBoxSelect(false);
        if (viewer.setMoveSegment) viewer.setMoveSegment(false);
        if (viewer.setEditSelection) viewer.setEditSelection([], []);
        if (viewer.setEditAxis) viewer.setEditAxis("free");
      }
      setGizmoMode("translate");
      if (!skipCamera) setViewMode("perspective");
      updateSelectMode();
      refreshChunks();
      applyDisplayToggles();
      refreshChunkUi();
      paintLiveButtons();
      paintVoxelButtons();
      paintLineButtons();
      paintExportButtons();
      setLoftStatus("No loft yet.");
      setVoxelStatus("No voxel model yet.");
      drawPreview();
      if (!keepSaved) {
        openedVariationId = null;
        openedVariationName = "";
        workspaceDirty = false;
        paintSaved3dButtons();
        renderSaved3dList();
      }
      if (!silent) {
        setStatus(
          "3D Space cleared. The 2D simulation and saved 3D variations are unchanged. Select a region of the full 20 \u00d7 20 2D simulation to place that exact geometry in 3D.",
          "active"
        );
      }
    }

    if (els.resetView) {
      els.resetView.addEventListener("click", () => {
        if (viewer) viewer.resetCamera();
      });
    }
    if (els.resetWorkspace) els.resetWorkspace.addEventListener("click", openResetDialog);
    if (els.resetCancel) els.resetCancel.addEventListener("click", closeResetDialog);
    if (els.resetConfirm) els.resetConfirm.addEventListener("click", () => resetWorkspace());
    if (els.resetDialog) {
      els.resetDialog.addEventListener("click", (event) => {
        if (event.target === els.resetDialog) closeResetDialog();
      });
    }
    if (els.save3d) {
      els.save3d.addEventListener("click", () => beginSave3d(openedVariationId ? "update" : "create"));
    }
    if (els.save3dUpdate) {
      els.save3dUpdate.addEventListener("click", () => {
        commitSaved3d({ asNew: false, name: openedVariationName });
      });
    }
    if (els.save3dAs) els.save3dAs.addEventListener("click", () => beginSave3d("asNew"));
    if (els.save3dConfirm) els.save3dConfirm.addEventListener("click", submitSave3dPanel);
    if (els.save3dCancel) els.save3dCancel.addEventListener("click", closeSave3dPanel);
    if (els.save3dName) {
      els.save3dName.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submitSave3dPanel();
        }
      });
    }
    if (els.delete3dCancel) els.delete3dCancel.addEventListener("click", closeDelete3dDialog);
    if (els.delete3dConfirm) els.delete3dConfirm.addEventListener("click", confirmDeleteSaved3d);
    if (els.delete3dDialog) {
      els.delete3dDialog.addEventListener("click", (event) => {
        if (event.target === els.delete3dDialog) closeDelete3dDialog();
      });
    }

    document.querySelectorAll(".space3d-viewport-bar .space3d-view-btn").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const mode = btn.dataset.view;
        if (mode) setViewMode(mode);
      });
    });

    window.addEventListener("keydown", (event) => {
      if (isResetDialogOpen()) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeResetDialog();
        }
        return;
      }
      if (els.delete3dDialog && !els.delete3dDialog.classList.contains("hidden")) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeDelete3dDialog();
        }
        return;
      }
      if (els.save3dPanel && !els.save3dPanel.classList.contains("hidden") && event.key === "Escape") {
        event.preventDefault();
        closeSave3dPanel();
        return;
      }
      if (!space3dTabActive() || isTypingTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey) {
        if (editLines && (event.key === "z" || event.key === "Z")) {
          event.preventDefault();
          if (event.shiftKey) redoLineEdit();
          else undoLineEdit();
        }
        return;
      }
      if (editLines && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        deleteSelectedLines();
        return;
      }
      if (event.key === "1") setViewMode("perspective");
      else if (event.key === "2") setViewMode("isometric");
      else if (event.key === "3") setViewMode("front");
      else if (event.key === "4") setViewMode("right");
      else if (event.key === "5") setViewMode("top");
    });

    if (els.selectChunk) {
      els.selectChunk.addEventListener("click", () => {
        if (selecting) cancelSelect();
        else beginSelect();
      });
    }
    if (els.confirmChunk) els.confirmChunk.addEventListener("click", confirmSelection);
    if (els.cancelChunk) els.cancelChunk.addEventListener("click", cancelSelect);
    if (els.deleteChunk) {
      els.deleteChunk.addEventListener("click", () => {
        if (selectedChunkId) deleteChunk(selectedChunkId);
      });
    }
    if (els.duplicateChunk) els.duplicateChunk.addEventListener("click", duplicateSelected);
    if (els.editLines) els.editLines.addEventListener("click", toggleEditLines);
    if (els.lineMove) els.lineMove.addEventListener("click", () => setGizmoMode("translate"));
    if (els.lineRotate) els.lineRotate.addEventListener("click", () => setGizmoMode("rotate"));
    if (els.lineScale) els.lineScale.addEventListener("click", () => setGizmoMode("scale"));
    if (els.axisFree) els.axisFree.addEventListener("click", () => setLineAxis("free"));
    if (els.axisX) els.axisX.addEventListener("click", () => setLineAxis("x"));
    if (els.axisY) els.axisY.addEventListener("click", () => setLineAxis("y"));
    if (els.axisZ) els.axisZ.addEventListener("click", () => setLineAxis("z"));
    if (els.boxSelect) {
      els.boxSelect.addEventListener("click", () => {
        if (!editLines) return;
        boxSelectOn = !boxSelectOn;
        if (boxSelectOn) moveSegmentOn = false;
        if (viewer && viewer.setBoxSelect) viewer.setBoxSelect(boxSelectOn);
        if (viewer && viewer.setMoveSegment) viewer.setMoveSegment(moveSegmentOn);
        paintLineButtons();
      });
    }
    if (els.moveSegment) {
      els.moveSegment.addEventListener("click", () => {
        if (!editLines) return;
        moveSegmentOn = !moveSegmentOn;
        if (moveSegmentOn) {
          boxSelectOn = false;
          setGizmoMode("translate");
        }
        if (viewer && viewer.setBoxSelect) viewer.setBoxSelect(boxSelectOn);
        if (viewer && viewer.setMoveSegment) viewer.setMoveSegment(moveSegmentOn);
        paintLineButtons();
        setStatus(
          moveSegmentOn
            ? "Move Segment · drag a branch to move both endpoints together."
            : "Move Segment off.",
          "active"
        );
      });
    }
    if (els.deleteLine) els.deleteLine.addEventListener("click", deleteSelectedLines);
    if (els.lineUndo) els.lineUndo.addEventListener("click", undoLineEdit);
    if (els.lineRedo) els.lineRedo.addEventListener("click", redoLineEdit);
    if (els.createLoft) els.createLoft.addEventListener("click", createLoftSet);
    if (els.dupSection) els.dupSection.addEventListener("click", addMorphedSection);
    if (els.remorph) els.remorph.addEventListener("click", remorphSelected);
    if (els.deleteSection) els.deleteSection.addEventListener("click", deleteSection);
    if (els.sectionUp) els.sectionUp.addEventListener("click", () => moveSection(-1));
    if (els.sectionDown) els.sectionDown.addEventListener("click", () => moveSection(1));
    if (els.editBranches) els.editBranches.addEventListener("click", toggleEditBranches);
    if (els.generateLoft) els.generateLoft.addEventListener("click", generateLoft);
    if (els.liveLoft) els.liveLoft.addEventListener("click", toggleLiveLoft);
    if (els.regenLoft) els.regenLoft.addEventListener("click", generateLoft);
    if (els.clearLoft) els.clearLoft.addEventListener("click", clearLoft);
    if (els.saveVar) els.saveVar.addEventListener("click", saveVariation);
    if (els.dupVar) els.dupVar.addEventListener("click", duplicateLastVariation);
    if (els.loftStyle) {
      els.loftStyle.addEventListener("change", () => {
        if (hasExistingLoft()) generateLoft();
      });
    }
    if (els.loftHierarchy) {
      els.loftHierarchy.addEventListener("change", () => {
        if (hasExistingLoft()) generateLoft();
      });
    }
    for (const key of ["loftWidth", "loftThick"]) {
      if (!els[key]) continue;
      els[key].addEventListener("input", () => noteLoftGeometryChanged("live"));
      els[key].addEventListener("change", () => {
        if (hasExistingLoft()) generateLoft();
      });
    }
    if (els.loftOpacity) {
      els.loftOpacity.addEventListener("input", () => {
        if (viewer && viewer.setLoftOpacity) viewer.setLoftOpacity(loftOpacityValue());
      });
    }
    for (const key of ["offset", "scaleX", "scaleY"]) {
      if (!els[key]) continue;
      els[key].addEventListener("input", applyTransformFromUi);
      els[key].addEventListener("change", applyTransformFromUi);
    }
    for (const key of ["secScale", "secScaleX", "secScaleY", "secRot", "shiftX", "shiftY", "taper"]) {
      if (!els[key]) continue;
      els[key].addEventListener("input", applyDeformFromUi);
      els[key].addEventListener("change", applyDeformFromUi);
    }
    if (els.nodeX) els.nodeX.addEventListener("change", applyNodeNumeric);
    if (els.nodeY) els.nodeY.addEventListener("change", applyNodeNumeric);
    if (els.nodeRot) {
      els.nodeRot.addEventListener("pointerdown", beginNodeTool);
      els.nodeRot.addEventListener("input", applyNodeRotate);
      els.nodeRot.addEventListener("change", endNodeTool);
    }
    if (els.nodeScale) {
      els.nodeScale.addEventListener("pointerdown", beginNodeTool);
      els.nodeScale.addEventListener("input", applyNodeScale);
      els.nodeScale.addEventListener("change", endNodeTool);
    }
    if (els.showSourceChunk) els.showSourceChunk.addEventListener("change", applyDisplayToggles);
    if (els.showSections) els.showSections.addEventListener("change", applyDisplayToggles);
    if (els.showLoftLines) els.showLoftLines.addEventListener("change", applyDisplayToggles);
    if (els.showLoftSolids) els.showLoftSolids.addEventListener("change", applyDisplayToggles);
    if (els.showVoxels) {
      els.showVoxels.addEventListener("change", () => {
        displayVoxels = !!els.showVoxels.checked;
        applyDisplayToggles();
      });
    }
    if (els.dispLines) {
      els.dispLines.addEventListener("click", () => {
        displayLines = !displayLines;
        applyDisplayToggles();
      });
    }
    if (els.dispSolids) {
      els.dispSolids.addEventListener("click", () => {
        displaySolids = !displaySolids;
        applyDisplayToggles();
      });
    }
    if (els.dispVoxels) {
      els.dispVoxels.addEventListener("click", () => {
        displayVoxels = !displayVoxels;
        applyDisplayToggles();
      });
    }
    if (els.silhouette) {
      els.silhouette.addEventListener("click", () => {
        silhouetteOn = !silhouetteOn;
        applyDisplayToggles();
      });
    }
    if (els.silhouetteThick) {
      const paintThick = () => {
        const n = Math.max(1, Math.min(8, Math.round(Number(els.silhouetteThick.value) || 3)));
        if (viewer && viewer.setSilhouetteThickness) viewer.setSilhouetteThickness(n);
      };
      els.silhouetteThick.addEventListener("input", paintThick);
      els.silhouetteThick.addEventListener("change", paintThick);
    }
    if (els.generateVoxels) els.generateVoxels.addEventListener("click", () => generateVoxels());
    if (els.liveVoxels) els.liveVoxels.addEventListener("click", toggleLiveVoxels);
    if (els.regenVoxels) els.regenVoxels.addEventListener("click", () => generateVoxels());
    if (els.clearVoxels) els.clearVoxels.addEventListener("click", clearVoxels);
    if (els.exportLoft3dm) els.exportLoft3dm.addEventListener("click", () => exportLoft("3dm"));
    if (els.exportLoftObj) els.exportLoftObj.addEventListener("click", () => exportLoft("obj"));
    if (els.exportVoxels3dm) els.exportVoxels3dm.addEventListener("click", () => exportVoxels("3dm"));
    if (els.exportVoxelsObj) els.exportVoxelsObj.addEventListener("click", () => exportVoxels("obj"));
    if (els.pngSave) els.pngSave.addEventListener("click", () => exportPng());
    if (els.turnPreview) els.turnPreview.addEventListener("click", previewTurntable);
    if (els.turnStop) els.turnStop.addEventListener("click", stopTurntable);
    if (els.turnExport) els.turnExport.addEventListener("click", () => exportTurntableMp4());
    if (els.turnCancel) {
      els.turnCancel.addEventListener("click", () => {
        if (turntableAbort) turntableAbort.abort();
      });
    }
    paintTurntableButtons();
    for (const key of ["voxelRes", "voxelSource", "voxelTarget", "voxelFidelity"]) {
      if (!els[key]) continue;
      els[key].addEventListener("change", () => {
        if (liveVoxelsOn && viewer && viewer.hasVoxels && viewer.hasVoxels()) generateVoxels({ silent: true });
        else markVoxelStale();
      });
    }
    if (els.voxelColorBySize) {
      els.voxelColorBySize.addEventListener("change", () => {
        if (viewer && viewer.setVoxelColorBySize) viewer.setVoxelColorBySize(els.voxelColorBySize.checked);
      });
    }
    if (els.voxelEdges) {
      els.voxelEdges.addEventListener("change", () => {
        if (viewer && viewer.setVoxelEdges) viewer.setVoxelEdges(els.voxelEdges.checked);
      });
    }
    if (els.voxelOpacity) {
      els.voxelOpacity.addEventListener("input", () => {
        if (viewer && viewer.setVoxelOpacity) viewer.setVoxelOpacity(voxelOpacityValue());
      });
    }
    if (els.generateMass) els.generateMass.addEventListener("click", () => generateSpatialMass());
    if (els.regenMass) els.regenMass.addEventListener("click", () => generateSpatialMass());
    if (els.regenVar) {
      els.regenVar.addEventListener("click", () => generateSpatialMass({ newSeed: true }));
    }
    for (const key of ["fidelity", "massVariation", "solidWidth", "solidDepth", "spatialReach"]) {
      if (!els[key]) continue;
      els[key].addEventListener("change", () => {
        const chunk = selectedChunk();
        if (chunk && viewer && viewer.hasMass && viewer.hasMass(chunk.id)) generateSpatialMass();
        markVoxelStale();
      });
    }
    if (els.useHierarchy) {
      els.useHierarchy.addEventListener("change", () => {
        const chunk = selectedChunk();
        if (chunk && viewer && viewer.hasMass && viewer.hasMass(chunk.id)) generateSpatialMass();
        markVoxelStale();
      });
    }
    if (els.solidOpacity) {
      els.solidOpacity.addEventListener("input", () => {
        if (viewer && viewer.setMassOpacity) viewer.setMassOpacity(solidOpacityValue());
      });
    }
    if (els.clearMass) els.clearMass.addEventListener("click", clearSelectedMass);
    if (els.showBranches) els.showBranches.addEventListener("change", applyDisplayToggles);
    if (els.showPlane) els.showPlane.addEventListener("change", applyDisplayToggles);
    if (els.showWireframe) els.showWireframe.addEventListener("change", applyDisplayToggles);
    if (els.moveMode) els.moveMode.addEventListener("click", () => setGizmoMode("translate"));
    if (els.rotateMode) els.rotateMode.addEventListener("click", () => setGizmoMode("rotate"));
    if (els.scaleMode) els.scaleMode.addEventListener("click", () => setGizmoMode("scale"));
    for (const key of ["posX", "posY", "posZ", "rotX", "rotY", "rotZ", "scale"]) {
      if (!els[key]) continue;
      els[key].addEventListener("input", applyTransformFromUi);
      els[key].addEventListener("change", applyTransformFromUi);
    }

    const hud = document.querySelector(".space3d-hud");
    function isHudFormControl(node) {
      if (!node || !node.closest) return false;
      return !!node.closest("input, select, textarea, button");
    }
    function endHudPointer(event) {
      if (!hudInteracting) return;
      hudInteracting = false;
      if (viewer && viewer.endUiInteraction) viewer.endUiInteraction();
      if (event && isHudFormControl(event.target)) return;
      fillTransformUi();
    }
    if (hud) {
      hud.addEventListener(
        "pointerdown",
        () => {
          hudInteracting = true;
          if (viewer && viewer.beginUiInteraction) viewer.beginUiInteraction();
        },
        true
      );
    }
    window.addEventListener("pointerup", endHudPointer);
    window.addEventListener("pointercancel", endHudPointer);

    if (overlay) {
      overlay.addEventListener("pointerdown", (event) => {
        if (!selecting) return;
        event.preventDefault();
        event.stopPropagation();
        try {
          overlay.setPointerCapture(event.pointerId);
        } catch (err) {}
        const pt = eventToFt(event, overlay);
        if (draft) {
          const handle = hitHandle(pt, draft, overlay);
          if (handle) {
            drag = { mode: "resize", handle, start: pt, origin: { ...draft } };
            return;
          }
          if (pointInRect(pt.x, pt.y, draft)) {
            drag = { mode: "move", start: pt, origin: { ...draft } };
            return;
          }
        }
        drag = { mode: "draw", start: pt };
        draft = { x: pt.x, y: pt.y, w: 0, h: 0 };
        updateSelectMode();
      });
      overlay.addEventListener("pointermove", (event) => {
        if (!selecting) return;
        const pt = eventToFt(event, overlay);
        if (!drag) {
          const handle = hitHandle(pt, draft, overlay);
          if (handle) overlay.style.cursor = cursorForHandle(handle);
          else if (draft && pointInRect(pt.x, pt.y, draft)) overlay.style.cursor = "move";
          else overlay.style.cursor = "crosshair";
          return;
        }
        if (drag.mode === "draw") draft = rectFromPoints(drag.start, pt);
        else if (drag.mode === "resize") draft = resizeFromHandle(drag.origin, drag.handle, pt);
        else if (drag.mode === "move") {
          draft = {
            x: clamp(drag.origin.x + (pt.x - drag.start.x), 0, CUBE - drag.origin.w),
            y: clamp(drag.origin.y + (pt.y - drag.start.y), 0, CUBE - drag.origin.h),
            w: drag.origin.w,
            h: drag.origin.h,
          };
        }
        updateSelectMode();
      });
      overlay.addEventListener("pointerup", (event) => {
        if (!selecting) return;
        try {
          if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
        } catch (err) {}
        if (draft && (draft.w < 0.4 || draft.h < 0.4)) draft = null;
        drag = null;
        updateSelectMode();
      });
    }

    refreshChunkUi();
    updateSelectMode();
    paintViewButtons();
    refreshSaved3dList();

    return {
      show() {
        const v = ensureViewer();
        if (!v) {
          setStatus("Three.js did not load \u2014 3D Studio cannot start.", "error");
          return;
        }
        v.start();
        v.resize();
        refreshChunks();
        refreshSaved3dList();
        if (!booted) {
          booted = true;
          setStatus("Select a region of the full 20 \u00d7 20 2D simulation to place that exact geometry in 3D.");
        }
        drawPreview();
      },
      hide() {
        if (viewer) viewer.stop();
      },
      resize() {
        if (viewer) viewer.resize();
        drawPreview();
      },
    };
  }

  global.D7Spatial3D = {
    CUBE,
    captureChunkFromSource,
    clipSegmentToRect,
    createViewer,
    mount,
  };
})(window);

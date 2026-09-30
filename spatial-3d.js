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

  const SECTION_TONES = [0xb8b4ac, 0xa8b0b4, 0xb4aca0, 0xa8aca4, 0xb0a8ac];

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
      segments.push({ a, b, order: order || 1, thickness, rootId });
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

  function createViewer(container) {
    const THREE = global.THREE;
    if (!THREE || !container) return null;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    const controls = THREE.OrbitControls
      ? new THREE.OrbitControls(camera, renderer.domElement)
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
    scene.add(cube);

    const chunksGroup = new THREE.Group();
    const sectionsGroup = new THREE.Group();
    const massesGroup = new THREE.Group();
    const loftGroup = new THREE.Group();
    const handlesGroup = new THREE.Group();
    scene.add(chunksGroup);
    scene.add(sectionsGroup);
    scene.add(massesGroup);
    scene.add(loftGroup);
    scene.add(handlesGroup);

    const chunkMeshes = new Map();
    const sectionMeshes = new Map();
    const massMeshes = new Map();
    let loftRec = null;
    let sourceBranchesVisible = true;
    let sourcePlanesVisible = false;
    let sourceChunksVisible = true;
    let sectionLayersVisible = true;
    let loftLinesVisible = true;
    let loftSolidsVisible = true;
    let sectionCutEnabled = false;
    let massOpacity = 1;
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
    let onNodeSelect = null;
    let onNodeMove = null;
    let onNodeDragEnd = null;
    let selectedChunkId = null;
    let pointerDown = null;
    let skipPick = false;
    let nodeDrag = null;
    let isTransformDragging = false;
    let isUIInteracting = false;

    function syncOrbitEnabled() {
      if (!controls) return;
      controls.enabled = !isTransformDragging && !nodeDrag && !isUIInteracting;
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
      THREE.TransformControls ? new THREE.TransformControls(camera, renderer.domElement) : null;
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
      });
      transform.addEventListener("mouseUp", () => {
        isTransformDragging = false;
        syncOrbitEnabled();
      });
      transform.addEventListener("objectChange", () => {
        if (isUIInteracting) return;
        const object = transform.object;
        if (!object) return;
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
      camera.position.set(32, 24, 32);
      if (controls) {
        controls.target.set(CUBE * 0.5, CUBE * 0.5, CUBE * 0.5);
        controls.update();
      } else {
        camera.lookAt(CUBE * 0.5, CUBE * 0.5, CUBE * 0.5);
      }
    }

    function resize() {
      const w = Math.max(8, container.clientWidth);
      const h = Math.max(8, container.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
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
              new THREE.LineBasicMaterial({ color: 0x8a8680, transparent: true, opacity: 0.7 })
            );
            loftGroup.add(loftRec.wire);
          }
        }
      }
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
      if (loftRec) applyMassOpacity(loftRec.material, massOpacity);
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
      return rec;
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
      if (pos.length) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        group.add(
          new THREE.LineSegments(
            geom,
            new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 1 })
          )
        );
        group.children[group.children.length - 1].userData.sourceBranch = true;
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
      chunkMeshes.set(chunk.id, { group, pick, outline, plane });
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
        new THREE.LineBasicMaterial({ color: tone, transparent: true, opacity: 0.88 })
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
        rec.outline.visible = section.id === selectedSectionId;
        rec.plane.visible = !!sourcePlanesVisible;
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

    function setPointer(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
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
    function tick() {
      if (!running) return;
      if (controls) controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }

    function setLoft(geometry, opacity) {
      if (loftRec) {
        loftGroup.remove(loftRec.mesh);
        if (loftRec.wire) loftGroup.remove(loftRec.wire);
        loftRec.mesh.traverse(disposeObject);
        if (loftRec.wire) disposeObject(loftRec.wire);
        loftRec = null;
      }
      if (!geometry) return null;
      const mat = new THREE.MeshStandardMaterial({
        color: 0xe6e2da,
        roughness: 0.78,
        metalness: 0.02,
        side: THREE.DoubleSide,
      });
      applyMassOpacity(mat, opacity != null ? opacity : massOpacity);
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.userData.loft = true;
      mesh.visible = loftSolidsVisible;
      loftGroup.add(mesh);
      loftRec = { mesh, material: mat, wire: null };
      if (massWireframe) {
        const EdgesGeom = THREE.EdgesGeometry;
        if (EdgesGeom) {
          loftRec.wire = new THREE.LineSegments(
            new EdgesGeom(geometry, 28),
            new THREE.LineBasicMaterial({ color: 0x8a8680, transparent: true, opacity: 0.7 })
          );
          loftGroup.add(loftRec.wire);
        }
      }
      return loftRec;
    }

    resetCamera();
    resize();

    return {
      resize,
      resetCamera,
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
        if (transform) transform.setMode(gizmoMode);
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
        if (loftRec) loftRec.mesh.visible = loftSolidsVisible;
        if (loftRec && loftRec.wire) loftRec.wire.visible = loftSolidsVisible;
      },
      setSectionCut(enabled, chunk) {
        applySectionCut(enabled, chunk);
      },
      setMass,
      setMassOpacity,
      setMassWireframe,
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
    let nodeOrigins = null;
    let nodeToolOrigins = null;
    const massSeeds = new Map();
    let selecting = false;
    let draft = null;
    let drag = null;
    let syncingUi = false;
    let hudInteracting = false;
    let gizmoMode = "translate";
    const stage = document.getElementById("space3dStage");
    const preview = document.getElementById("space3dPreviewCanvas");
    const overlay = document.getElementById("space3dPreviewOverlay");
    const previewWrap = document.getElementById("space3dPreviewWrap");
    const status = document.getElementById("space3dStatus");
    const chunkList = document.getElementById("space3dChunkList");

    const els = {
      resetView: document.getElementById("space3dResetView"),
      selectChunk: document.getElementById("space3dSelectChunk"),
      confirmChunk: document.getElementById("space3dConfirmChunk"),
      cancelChunk: document.getElementById("space3dCancelChunk"),
      deleteChunk: document.getElementById("space3dDeleteChunk"),
      duplicateChunk: document.getElementById("space3dDuplicateChunk"),
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
      deleteSection: document.getElementById("space3dDeleteSection"),
      sectionUp: document.getElementById("space3dSectionUp"),
      sectionDown: document.getElementById("space3dSectionDown"),
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
      regenLoft: document.getElementById("space3dRegenLoft"),
      clearLoft: document.getElementById("space3dClearLoft"),
      loftStyle: document.getElementById("space3dLoftStyle"),
      loftWidth: document.getElementById("space3dLoftWidth"),
      loftWidthVal: document.getElementById("space3dLoftWidthVal"),
      loftThick: document.getElementById("space3dLoftThick"),
      loftThickVal: document.getElementById("space3dLoftThickVal"),
      loftHierarchy: document.getElementById("space3dLoftHierarchy"),
      saveVar: document.getElementById("space3dSaveVar"),
      dupVar: document.getElementById("space3dDupVar"),
      varList: document.getElementById("space3dVarList"),
      showSourceChunk: document.getElementById("space3dShowSourceChunk"),
      showSections: document.getElementById("space3dShowSections"),
      showLoftLines: document.getElementById("space3dShowLoftLines"),
      showLoftSolids: document.getElementById("space3dShowLoftSolids"),
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
      ).map((node) => ({ id: node.id, x: node.x, y: node.y }));
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
        nodes,
        transform,
        offset: sourceSection ? Number(sourceSection.offset) || 0 : 0,
        deform,
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
      if (els.deleteSection) els.deleteSection.disabled = !sectionOn || (selectedLoft() && selectedLoft().sections.length < 2);
      const loft = selectedLoft();
      const idx = loft && section ? loft.sections.findIndex((item) => item.id === section.id) : -1;
      if (els.sectionUp) els.sectionUp.disabled = idx <= 0;
      if (els.sectionDown) els.sectionDown.disabled = !loft || idx < 0 || idx >= loft.sections.length - 1;
      if (els.editBranches) {
        els.editBranches.disabled = !sectionOn;
        els.editBranches.classList.toggle("primary", editBranches && sectionOn);
        els.editBranches.classList.toggle("ghost", !(editBranches && sectionOn));
      }
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
        if (els.scaleVal) els.scaleVal.textContent = "1.00";
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

    function applyTransformFromUi() {
      const target = transformTarget();
      if (!target || syncingUi) return;
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
        return;
      }
      if (viewer && viewer.applyLiveTransform) viewer.applyLiveTransform("chunk", target);
      else refreshChunks();
    }

    function applyDeformFromUi() {
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
      loft.sections.forEach((section) => {
        const item = document.createElement("li");
        item.className = section.id === selectedSectionId ? "selected" : "";
        item.innerHTML = `<span>${section.label} · offset ${Number(section.offset || 0).toFixed(1)}</span>`;
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
      refreshChunkUi();
      refreshChunks();
      setStatus(`${loft.label} · ${section.label} from ${chunk.label}. Duplicate the section to loft.`, "active");
    }

    function duplicateSection() {
      const loft = selectedLoft();
      const section = selectedSection();
      if (!loft || !section) return;
      const index = loft.nextSection++;
      const copy = makeSection(loft, index, section);
      copy.offset = (Number(section.offset) || 0) + 4;
      const at = loft.sections.findIndex((item) => item.id === section.id);
      loft.sections.splice(at + 1, 0, copy);
      selectedSectionId = copy.id;
      selectedNodeIds = [];
      refreshChunkUi();
      refreshChunks();
      setStatus(`${copy.label} added · offset ${copy.offset.toFixed(1)} along the local normal.`, "active");
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
    }

    function generateLoft() {
      const loft = selectedLoft();
      if (!loft || loft.sections.length < 2) {
        setStatus("Duplicate at least one section before generating a loft.", "error");
        return;
      }
      const lib = global.D7SpatialLoft;
      if (!lib || !global.THREE) {
        setStatus("Section loft module did not load.", "error");
        return;
      }
      if (!viewer) ensureViewer();
      const params = {
        width: Number(els.loftWidth?.value ?? 28) / 100,
        thickness: Number(els.loftThick?.value ?? 32) / 100,
        style: els.loftStyle?.value === "linear" ? "linear" : "smooth",
        useHierarchy: !!(els.loftHierarchy && els.loftHierarchy.checked),
      };
      setStatus(`Generating loft from ${loft.sections.length} sections...`, "active");
      const run = () => {
        try {
          const result = lib.generate(global.THREE, loft, params);
          if (!result.vertexCount) {
            setStatus("No loft solids formed. Check that sections still share the same branches.", "error");
            refreshChunkUi();
            return;
          }
          const geom = new global.THREE.BufferGeometry();
          geom.setAttribute("position", new global.THREE.Float32BufferAttribute(result.positions, 3));
          geom.setAttribute("normal", new global.THREE.Float32BufferAttribute(result.normals, 3));
          viewer.setLoft(geom, solidOpacityValue());
          applyDisplayToggles();
          refreshChunkUi();
          const clip = result.clipped ? " · some faces met the 20 cube and were clipped" : "";
          setStatus(
            `${loft.label} \u2192 Loft solids · ${result.triangleCount} faces · ${loft.sections.length} sections${clip}`,
            "active"
          );
        } catch (err) {
          setStatus(err && err.message ? err.message : "Loft generation failed.", "error");
        }
      };
      requestAnimationFrame(run);
    }

    function clearLoft() {
      if (viewer && viewer.clearLoft) viewer.clearLoft();
      refreshChunkUi();
      setStatus("Loft solids cleared. Section layers remain.", "active");
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

    function applyDisplayToggles() {
      if (!viewer) return;
      if (viewer.setSourceBranchesVisible) {
        viewer.setSourceBranchesVisible(!els.showBranches || els.showBranches.checked);
      }
      if (viewer.setSourcePlanesVisible) {
        viewer.setSourcePlanesVisible(!!(els.showPlane && els.showPlane.checked));
      }
      if (viewer.setMassWireframe) {
        viewer.setMassWireframe(!!(els.showWireframe && els.showWireframe.checked));
      }
      if (viewer.setSourceChunksVisible) {
        viewer.setSourceChunksVisible(!els.showSourceChunk || els.showSourceChunk.checked);
      }
      if (viewer.setSectionLayersVisible) {
        viewer.setSectionLayersVisible(!els.showSections || els.showSections.checked);
      }
      if (viewer.setLoftLinesVisible) {
        viewer.setLoftLinesVisible(!els.showLoftLines || els.showLoftLines.checked);
      }
      if (viewer.setLoftSolidsVisible) {
        viewer.setLoftSolidsVisible(!els.showLoftSolids || els.showLoftSolids.checked);
      }
    }

    function generateSpatialMass(options) {
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
        refreshChunkUi();
        refreshChunks();
        applyDisplayToggles();
      });
      viewer.setOnTransform((id, transform) => {
        const chunk = chunks.find((item) => item.id === id);
        if (!chunk) return;
        chunk.transform = Object.assign({}, chunk.transform, transform);
        if (!hudInteracting) fillTransformUi();
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
      });
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
      });
      viewer.setOnNodeDragEnd(() => {
        nodeOrigins = null;
        fillTransformUi();
      });
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
      }
      return viewer;
    }

    bindSlider(els.fidelity, els.fidelityVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.massVariation, els.massVariationVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.solidWidth, els.solidWidthVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.solidDepth, els.solidDepthVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.spatialReach, els.spatialReachVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.solidOpacity, els.solidOpacityVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.offset, els.offsetVal, (v) => Number(v).toFixed(1));
    bindSlider(els.secScale, els.secScaleVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.secScaleX, els.secScaleXVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.secScaleY, els.secScaleYVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.secRot, els.secRotVal, (v) => `${Math.round(Number(v))}°`);
    bindSlider(els.shiftX, els.shiftXVal, (v) => Number(v).toFixed(1));
    bindSlider(els.shiftY, els.shiftYVal, (v) => Number(v).toFixed(1));
    bindSlider(els.taper, els.taperVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.loftWidth, els.loftWidthVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.loftThick, els.loftThickVal, (v) => `${Math.round(Number(v))}%`);
    bindSlider(els.nodeRot, els.nodeRotVal, (v) => `${Math.round(Number(v))}°`);
    bindSlider(els.nodeScale, els.nodeScaleVal, (v) => `${Math.round(Number(v))}%`);

    if (els.resetView) {
      els.resetView.addEventListener("click", () => {
        if (viewer) viewer.resetCamera();
      });
    }

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
    if (els.createLoft) els.createLoft.addEventListener("click", createLoftSet);
    if (els.dupSection) els.dupSection.addEventListener("click", duplicateSection);
    if (els.deleteSection) els.deleteSection.addEventListener("click", deleteSection);
    if (els.sectionUp) els.sectionUp.addEventListener("click", () => moveSection(-1));
    if (els.sectionDown) els.sectionDown.addEventListener("click", () => moveSection(1));
    if (els.editBranches) els.editBranches.addEventListener("click", toggleEditBranches);
    if (els.generateLoft) els.generateLoft.addEventListener("click", generateLoft);
    if (els.regenLoft) els.regenLoft.addEventListener("click", generateLoft);
    if (els.clearLoft) els.clearLoft.addEventListener("click", clearLoft);
    if (els.saveVar) els.saveVar.addEventListener("click", saveVariation);
    if (els.dupVar) els.dupVar.addEventListener("click", duplicateLastVariation);
    if (els.loftStyle) {
      els.loftStyle.addEventListener("change", () => {
        if (viewer && viewer.hasLoft && viewer.hasLoft()) generateLoft();
      });
    }
    if (els.loftHierarchy) {
      els.loftHierarchy.addEventListener("change", () => {
        if (viewer && viewer.hasLoft && viewer.hasLoft()) generateLoft();
      });
    }
    for (const key of ["loftWidth", "loftThick"]) {
      if (!els[key]) continue;
      els[key].addEventListener("change", () => {
        if (viewer && viewer.hasLoft && viewer.hasLoft()) generateLoft();
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
      });
    }
    if (els.useHierarchy) {
      els.useHierarchy.addEventListener("change", () => {
        const chunk = selectedChunk();
        if (chunk && viewer && viewer.hasMass && viewer.hasMass(chunk.id)) generateSpatialMass();
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

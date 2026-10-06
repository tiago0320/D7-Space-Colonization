/**
 * Client-side loft / voxel export.
 * OBJ = triangulated mesh. 3DM = Rhino Brep / closed polysurface, or a mesh
 * when the source is a generated isosurface.
 * Coordinates stay in feet. 1 unit = 1 ft. Workspace is 20' × 20' × 20'.
 * The viewport cube is never written into the file.
 */
(function (global) {
  const CUBE = 20;
  const RHINO_CDN = "https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0";
  const RHINO_JS = `${RHINO_CDN}/rhino3dm.min.js`;
  let rhinoPromise = null;

  function sanitizeFilename(name) {
    const cleaned = String(name || "Loft_01")
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._]+|[._]+$/g, "");
    return cleaned || "Loft_01";
  }

  function fmt(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "0";
    return String(Math.round(v * 1e6) / 1e6);
  }

  function quantize(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.round(v * 1e4) / 1e4;
  }

  function hashGeometryState(payload) {
    const src = payload && typeof payload === "object" ? payload : {};
    let h = 5381;
    function feed(value) {
      const s = String(value);
      for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
    }
    function feedMesh(mesh) {
      if (!mesh) return;
      const pos = mesh.worldPositions || mesh.positions || [];
      const idx = mesh.worldIndices || mesh.indices || [];
      feed("m");
      feed(pos.length);
      feed(idx.length);
      for (let i = 0; i < pos.length; i++) feed(quantize(pos[i]));
      for (let i = 0; i < idx.length; i++) feed(idx[i] | 0);
      if (mesh.matrixWorld && mesh.matrixWorld.length) {
        for (let i = 0; i < mesh.matrixWorld.length; i++) feed(quantize(mesh.matrixWorld[i]));
      }
    }
    const branches = src.sourceBranches || src.guides || (src.displayGeometry && src.displayGeometry.branches) || [];
    feed("b");
    feed(branches.length);
    for (let i = 0; i < branches.length; i++) {
      const g = branches[i];
      feed(g.id || "");
      feed(g.startNodeId != null ? g.startNodeId : g.fromId != null ? g.fromId : "");
      feed(g.endNodeId != null ? g.endNodeId : g.toId != null ? g.toId : "");
      feed(quantize(g.ax));
      feed(quantize(g.ay));
      feed(quantize(g.az));
      feed(quantize(g.bx));
      feed(quantize(g.by));
      feed(quantize(g.bz));
    }
    const boxes = src.generatedBoxes || src.elements || (src.displayGeometry && src.displayGeometry.boxes) || [];
    feed("e");
    feed(boxes.length);
    for (let i = 0; i < boxes.length; i++) {
      feed(boxes[i] && boxes[i].id != null ? boxes[i].id : i);
      feedMesh(boxes[i]);
    }
    const surfs = src.surfaceGeometry || src.surfaces || (src.displayGeometry && src.displayGeometry.surfaces) || [];
    feed("s");
    feed(surfs.length);
    for (let i = 0; i < surfs.length; i++) {
      feed(surfs[i] && surfs[i].id != null ? surfs[i].id : i);
      feedMesh(surfs[i]);
    }
    return ("00000000" + h.toString(16)).slice(-8).toUpperCase();
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function trianglesFromGeometry(geometry) {
    if (!geometry || !geometry.attributes || !geometry.attributes.position) {
      return { positions: [], faces: [] };
    }
    const pos = geometry.attributes.position.array;
    const index = geometry.index ? geometry.index.array : null;
    const positions = [];
    const faces = [];
    const vertCount = pos.length / 3;
    for (let i = 0; i < vertCount; i++) {
      positions.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    }
    if (index) {
      for (let i = 0; i < index.length; i += 3) {
        faces.push(index[i], index[i + 1], index[i + 2]);
      }
    } else {
      for (let i = 0; i < vertCount; i += 3) {
        faces.push(i, i + 1, i + 2);
      }
    }
    return { positions, faces };
  }

  function unitHeader(kind) {
    return [
      "# D7-Space-Colonization",
      `# ${kind || "Mesh"}`,
      "# Coordinate units: feet",
      "# 1 file unit = 1 foot",
      "# Workspace: 20' W × 20' D × 20' H (8,000 cubic feet)",
      "# OBJ has no native units. Import into Rhino with document units = Feet.",
      "# Do not scale this file to a 0–1 cube.",
    ];
  }

  function geometryToOBJ(geometry, objectName) {
    const { positions, faces } = trianglesFromGeometry(geometry);
    if (!faces.length) return "";
    const lines = unitHeader("Generated solid mesh").concat([`o ${objectName || "Solid"}`]);
    for (let i = 0; i < positions.length; i += 3) {
      lines.push(`v ${fmt(positions[i])} ${fmt(positions[i + 1])} ${fmt(positions[i + 2])}`);
    }
    for (let i = 0; i < faces.length; i += 3) {
      lines.push(`f ${faces[i] + 1} ${faces[i + 1] + 1} ${faces[i + 2] + 1}`);
    }
    return lines.join("\n") + "\n";
  }

  function voxelMeshFromCells(cells, resolution) {
    const res = Math.max(1, Number(resolution) || 20);
    const cell = CUBE / res;
    const occupied = new Set();
    const blocks = cells || [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const span = Math.max(1, Number(b.size) || 1);
      for (let z = 0; z < span; z++) {
        for (let y = 0; y < span; y++) {
          for (let x = 0; x < span; x++) {
            occupied.add(`${b.ix + x},${b.iy + y},${b.iz + z}`);
          }
        }
      }
    }
    const vertIndex = new Map();
    const positions = [];
    const quads = [];
    const keyOf = (x, y, z) => `${fmt(x)},${fmt(y)},${fmt(z)}`;
    function vert(x, y, z) {
      const key = keyOf(x, y, z);
      if (vertIndex.has(key)) return vertIndex.get(key);
      const idx = positions.length / 3;
      positions.push(x, y, z);
      vertIndex.set(key, idx);
      return idx;
    }
    function emit(a, b, c, d) {
      quads.push(a, b, c, d);
    }
    function faceCovered(ix, iy, iz, span, dx, dy, dz) {
      for (let a = 0; a < span; a++) {
        for (let b = 0; b < span; b++) {
          let px;
          let py;
          let pz;
          if (dx) {
            px = dx > 0 ? ix + span : ix - 1;
            py = iy + a;
            pz = iz + b;
          } else if (dy) {
            px = ix + a;
            py = dy > 0 ? iy + span : iy - 1;
            pz = iz + b;
          } else {
            px = ix + a;
            py = iy + b;
            pz = dz > 0 ? iz + span : iz - 1;
          }
          if (!occupied.has(`${px},${py},${pz}`)) return false;
        }
      }
      return true;
    }
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const span = Math.max(1, Number(b.size) || 1);
      const x0 = b.ix * cell;
      const y0 = b.iy * cell;
      const z0 = b.iz * cell;
      const s = span * cell;
      const x1 = x0 + s;
      const y1 = y0 + s;
      const z1 = z0 + s;
      if (!faceCovered(b.ix, b.iy, b.iz, span, 1, 0, 0)) {
        emit(vert(x1, y0, z0), vert(x1, y1, z0), vert(x1, y1, z1), vert(x1, y0, z1));
      }
      if (!faceCovered(b.ix, b.iy, b.iz, span, -1, 0, 0)) {
        emit(vert(x0, y0, z0), vert(x0, y0, z1), vert(x0, y1, z1), vert(x0, y1, z0));
      }
      if (!faceCovered(b.ix, b.iy, b.iz, span, 0, 1, 0)) {
        emit(vert(x0, y1, z0), vert(x0, y1, z1), vert(x1, y1, z1), vert(x1, y1, z0));
      }
      if (!faceCovered(b.ix, b.iy, b.iz, span, 0, -1, 0)) {
        emit(vert(x0, y0, z0), vert(x1, y0, z0), vert(x1, y0, z1), vert(x0, y0, z1));
      }
      if (!faceCovered(b.ix, b.iy, b.iz, span, 0, 0, 1)) {
        emit(vert(x0, y0, z1), vert(x1, y0, z1), vert(x1, y1, z1), vert(x0, y1, z1));
      }
      if (!faceCovered(b.ix, b.iy, b.iz, span, 0, 0, -1)) {
        emit(vert(x0, y0, z0), vert(x0, y1, z0), vert(x1, y1, z0), vert(x1, y0, z0));
      }
    }
    const faces = [];
    for (let i = 0; i < quads.length; i += 4) {
      faces.push(quads[i], quads[i + 1], quads[i + 2], quads[i], quads[i + 2], quads[i + 3]);
    }
    return { positions, faces, quads };
  }

  function voxelToOBJ(mesh, objectName) {
    if (!mesh || !mesh.quads || !mesh.quads.length) return "";
    const lines = unitHeader("Voxel mesh").concat([`o ${objectName || "Voxels"}`]);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      lines.push(`v ${fmt(mesh.positions[i])} ${fmt(mesh.positions[i + 1])} ${fmt(mesh.positions[i + 2])}`);
    }
    for (let i = 0; i < mesh.quads.length; i += 4) {
      lines.push(
        `f ${mesh.quads[i] + 1} ${mesh.quads[i + 1] + 1} ${mesh.quads[i + 2] + 1} ${mesh.quads[i + 3] + 1}`
      );
    }
    return lines.join("\n") + "\n";
  }

  function sub3(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  function cross3(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  function dot3(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function len3(a) {
    return Math.hypot(a[0], a[1], a[2]);
  }

  function injectRhinoScript() {
    if (typeof global.rhino3dm === "function") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-rhino3dm]");
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("rhino3dm.js did not load.")));
        return;
      }
      const script = document.createElement("script");
      script.src = RHINO_JS;
      script.async = true;
      script.dataset.rhino3dm = "1";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("rhino3dm.js did not load."));
      document.head.appendChild(script);
    });
  }

  function loadRhino() {
    if (rhinoPromise) return rhinoPromise;
    rhinoPromise = injectRhinoScript()
      .then(() => {
        if (typeof global.rhino3dm !== "function") {
          throw new Error("rhino3dm.js did not load.");
        }
        return global.rhino3dm({
          locateFile: (file) => `${RHINO_CDN}/${file}`,
        });
      })
      .catch((err) => {
        rhinoPromise = null;
        throw err;
      });
    return rhinoPromise;
  }

  function setFeet(rhino, doc) {
    try {
      const settings = doc.settings();
      const feet = rhino.UnitSystem && rhino.UnitSystem.Feet != null ? rhino.UnitSystem.Feet : 9;
      if (settings && settings.modelUnitSystem != null) settings.modelUnitSystem = feet;
      else if (settings && typeof settings.setModelUnitSystem === "function") settings.setModelUnitSystem(feet);
    } catch (err) {}
  }

  function addLayer(rhino, doc, name) {
    try {
      const layer = new rhino.Layer();
      layer.name = name;
      const index = doc.layers().add(layer);
      const attrs = new rhino.ObjectAttributes();
      attrs.layerIndex = index;
      return attrs;
    } catch (err) {
      return null;
    }
  }

  function isClosedBrep(geom) {
    if (!geom) return false;
    const name = geom.constructor && geom.constructor.name;
    if (name && name !== "Brep") return false;
    if (geom.isSolid) return true;
    return !!(geom.isValid && geom.isManifold && geom.faces && geom.faces().count >= 1);
  }

  function closedBrepFromEdges(rhino, origin, x, y, z) {
    const vol = dot3(z, cross3(x, y));
    if (!Number.isFinite(vol) || Math.abs(vol) < 1e-12) return null;
    let ax = x;
    let ay = y;
    let az = z;
    if (vol < 0) {
      ay = z;
      az = y;
    }
    const cube = rhino.Brep.createFromBoundingBox(new rhino.BoundingBox([0, 0, 0], [1, 1, 1]));
    if (!cube) return null;
    const T = rhino.Transform.identity();
    T.m00 = ax[0];
    T.m10 = ax[1];
    T.m20 = ax[2];
    T.m30 = 0;
    T.m01 = ay[0];
    T.m11 = ay[1];
    T.m21 = ay[2];
    T.m31 = 0;
    T.m02 = az[0];
    T.m12 = az[1];
    T.m22 = az[2];
    T.m32 = 0;
    T.m03 = origin[0];
    T.m13 = origin[1];
    T.m23 = origin[2];
    T.m33 = 1;
    if (!cube.transform(T)) {
      try {
        if (cube.delete) cube.delete();
      } catch (err) {}
      return null;
    }
    if (!cube.isValid || !cube.isSolid) {
      try {
        if (cube.delete) cube.delete();
      } catch (err) {}
      return null;
    }
    return cube;
  }

  function closedBrepFromMesh(rhino, positions, indices) {
    if (!positions || !indices || indices.length < 12) return null;
    const mesh = fillRhinoMesh(rhino, positions, indices);
    if (!mesh) return null;
    try {
      if (rhino.Brep && rhino.Brep.createFromMesh) {
        let brep = rhino.Brep.createFromMesh(mesh, true);
        if (brep && (brep.isSolid || (brep.isValid && brep.isManifold))) return brep;
        brep = rhino.Brep.createFromMesh(mesh, false);
        if (brep && (brep.isSolid || (brep.isValid && brep.isManifold))) return brep;
      }
    } catch (err) {}
    return null;
  }

  function closedBrepFromMatrix(rhino, matrixWorld) {
    const m = matrixWorld;
    if (!m || m.length < 16) return null;
    const axisU = [m[0], m[1], m[2]];
    const axisW = [m[4], m[5], m[6]];
    const axisT = [m[8], m[9], m[10]];
    const center = [m[12], m[13], m[14]];
    if (len3(axisU) < 1e-8 || len3(axisW) < 1e-8 || len3(axisT) < 1e-8) return null;
    const origin = [
      center[0] - axisU[0] * 0.5 - axisW[0] * 0.5 - axisT[0] * 0.5,
      center[1] - axisU[1] * 0.5 - axisW[1] * 0.5 - axisT[1] * 0.5,
      center[2] - axisU[2] * 0.5 - axisW[2] * 0.5 - axisT[2] * 0.5,
    ];
    return closedBrepFromEdges(rhino, origin, axisU, axisW, axisT);
  }

  function closedBrepFromViewportBox(rhino, el) {
    if (!el) return null;
    if (el.matrixWorld && el.matrixWorld.length >= 16) {
      const fromMatrix = closedBrepFromMatrix(rhino, el.matrixWorld);
      if (fromMatrix) return fromMatrix;
    }
    if (el.center && el.U && el.W && el.T && el.hu != null && el.hw != null && el.ht != null) {
      const U = el.U;
      const W = el.W;
      const T = el.T;
      const hu = Number(el.hu);
      const hw = Number(el.hw);
      const ht = Number(el.ht);
      const origin = [
        el.center.x - U.x * hu - W.x * hw - T.x * ht,
        el.center.y - U.y * hu - W.y * hw - T.y * ht,
        el.center.z - U.z * hu - W.z * hw - T.z * ht,
      ];
      return closedBrepFromEdges(
        rhino,
        origin,
        [U.x * hu * 2, U.y * hu * 2, U.z * hu * 2],
        [W.x * hw * 2, W.y * hw * 2, W.z * hw * 2],
        [T.x * ht * 2, T.y * ht * 2, T.z * ht * 2]
      );
    }
    return null;
  }

  function closedBrepFromBoxCorners(rhino, corners) {
    if (!corners || corners.length < 8) return null;
    const origin = corners[2];
    const x = sub3(corners[3], origin);
    const y = sub3(corners[6], origin);
    const z = sub3(corners[1], origin);
    if (len3(x) < 1e-8 || len3(y) < 1e-8 || len3(z) < 1e-8) return null;
    return closedBrepFromEdges(rhino, origin, x, y, z);
  }

  function loftBrepsFromRuns(rhino, runs) {
    const breps = [];
    for (let r = 0; r < (runs || []).length; r++) {
      const boxes = runs[r].boxes || [];
      if (boxes.length < 2) continue;
      for (let i = 0; i < boxes.length - 1; i++) {
        const a = boxes[i];
        const b = boxes[i + 1];
        const origin = a[2];
        const x = sub3(a[3], origin);
        const y = sub3(a[6], origin);
        const z = sub3(b[2], origin);
        let brep = null;
        if (len3(z) >= 1e-8) brep = closedBrepFromEdges(rhino, origin, x, y, z);
        if (!brep) brep = closedBrepFromBoxCorners(rhino, a);
        if (brep) breps.push(brep);
      }
      const last = closedBrepFromBoxCorners(rhino, boxes[boxes.length - 1]);
      if (last) breps.push(last);
    }
    return breps;
  }

  function voxelBrepsFromCells(rhino, cells, resolution) {
    const res = Math.max(1, Number(resolution) || 20);
    const unit = CUBE / res;
    const breps = [];
    for (let i = 0; i < (cells || []).length; i++) {
      const c = cells[i];
      const span = Math.max(1, Number(c.size) || 1);
      const min = [c.ix * unit, c.iy * unit, c.iz * unit];
      const max = [(c.ix + span) * unit, (c.iy + span) * unit, (c.iz + span) * unit];
      const box = new rhino.BoundingBox(min, max);
      const brep = rhino.Brep.createFromBoundingBox(box);
      if (brep && brep.isValid && brep.isSolid) breps.push(brep);
    }
    return breps;
  }

  function addBrepObject(doc, brep, attrs) {
    const objects = doc.objects();
    if (attrs && objects.addBrep) objects.addBrep(brep, attrs);
    else if (objects.addBrep) objects.addBrep(brep);
    else if (objects.add) objects.add(brep, attrs || null);
    else throw new Error("Polysurface generation failed");
  }

  async function write3dmBreps(breps, layerName) {
    if (!breps || !breps.length) throw new Error("Polysurface generation failed");
    const rhino = await loadRhino();
    const doc = new rhino.File3dm();
    setFeet(rhino, doc);
    const attrs = addLayer(rhino, doc, layerName || "Default");
    let added = 0;
    let closed = 0;
    for (let i = 0; i < breps.length; i++) {
      const brep = breps[i];
      if (!isClosedBrep(brep) && !(brep && brep.isValid && brep.constructor && brep.constructor.name === "Brep")) {
        continue;
      }
      addBrepObject(doc, brep, attrs);
      added += 1;
      if (brep.isSolid) closed += 1;
    }
    const bytes = (() => {
      try {
        return doc.toByteArray();
      } catch (err) {
        return doc.toByteArrayBuffer ? doc.toByteArrayBuffer() : null;
      }
    })();
    try {
      if (doc.delete) doc.delete();
    } catch (err) {}
    if (!added || !bytes) throw new Error("Polysurface generation failed");
    const copy = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes);
    return {
      blob: new Blob([copy], { type: "application/octet-stream" }),
      added,
      closed,
    };
  }

  async function exportLoftPolysurface(runs, filename, layerName) {
    const rhino = await loadRhino();
    const breps = loftBrepsFromRuns(rhino, runs);
    if (!breps.length) throw new Error("Polysurface generation failed");
    const result = await write3dmBreps(breps, layerName || "LOFT");
    downloadBlob(filename, result.blob);
    return result;
  }

  async function exportVoxelPolysurface(cells, resolution, filename, layerName) {
    const rhino = await loadRhino();
    const breps = voxelBrepsFromCells(rhino, cells, resolution);
    if (!breps.length) throw new Error("Polysurface generation failed");
    const result = await write3dmBreps(breps, layerName || "VOXELS");
    downloadBlob(filename, result.blob);
    return result;
  }

  function addMeshObject(doc, mesh, attrs) {
    const objects = doc.objects();
    if (attrs && objects.addMesh) objects.addMesh(mesh, attrs);
    else if (objects.addMesh) objects.addMesh(mesh);
    else throw new Error("Mesh export failed");
  }

  async function exportGeometryMesh3dm(geometry, filename, layerName) {
    const { positions, faces } = trianglesFromGeometry(geometry);
    if (!faces.length) throw new Error("The generated mesh is empty.");
    const rhino = await loadRhino();
    const doc = new rhino.File3dm();
    setFeet(rhino, doc);
    const attrs = addLayer(rhino, doc, layerName || "MESH");
    const mesh = new rhino.Mesh();
    const verts = typeof mesh.vertices === "function" ? mesh.vertices() : mesh.vertices;
    const vcount = positions.length / 3;
    for (let i = 0; i < vcount; i++) {
      verts.add(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    }
    const rhFaces = typeof mesh.faces === "function" ? mesh.faces() : mesh.faces;
    for (let i = 0; i < faces.length; i += 3) {
      if (rhFaces.addTriFace) rhFaces.addTriFace(faces[i], faces[i + 1], faces[i + 2]);
      else rhFaces.add(faces[i], faces[i + 1], faces[i + 2]);
    }
    try {
      const normals = typeof mesh.normals === "function" ? mesh.normals() : mesh.normals;
      if (normals && normals.computeNormals) normals.computeNormals();
    } catch (err) {}
    addMeshObject(doc, mesh, attrs);
    const bytes = (() => {
      try {
        return doc.toByteArray();
      } catch (err) {
        return doc.toByteArrayBuffer ? doc.toByteArrayBuffer() : null;
      }
    })();
    try {
      if (doc.delete) doc.delete();
    } catch (err) {}
    if (!bytes) throw new Error("Mesh export failed");
    const copy = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes);
    downloadBlob(filename, new Blob([copy], { type: "application/octet-stream" }));
    return { added: 1, closed: 0, kind: "mesh" };
  }

  function exportOBJ(text, filename) {
    if (!text) throw new Error("Nothing to export.");
    downloadBlob(filename, new Blob([text], { type: "text/plain" }));
  }

  function normalizeExportWhich(which, objectName) {
    const w = String(which || "").toLowerCase();
    if (w === "surface") return "surface";
    if (w === "both") return "both";
    if (w === "geometry" || w === "solids") return "geometry";
    const n = String(objectName || "");
    if (n === "LINE_SURFACE" || n === "DEVELOPED_SURFACE" || n === "SPACE_MESH") return "surface";
    return "geometry";
  }

  function appendMeshOBJ(lines, name, positions, indices, vertOffset) {
    if (!positions || !indices || !indices.length) return vertOffset;
    lines.push(`o ${name}`);
    for (let i = 0; i < positions.length; i += 3) {
      lines.push(`v ${fmt(positions[i])} ${fmt(positions[i + 1])} ${fmt(positions[i + 2])}`);
    }
    for (let i = 0; i < indices.length; i += 3) {
      lines.push(`f ${indices[i] + 1 + vertOffset} ${indices[i + 1] + 1 + vertOffset} ${indices[i + 2] + 1 + vertOffset}`);
    }
    return vertOffset + positions.length / 3;
  }

  function appendPolylineOBJ(lines, name, pairs, vertOffset) {
    if (!pairs || !pairs.length) return vertOffset;
    lines.push(`o ${name}`);
    for (let i = 0; i < pairs.length; i++) {
      const g = pairs[i];
      lines.push(`v ${fmt(g.ax)} ${fmt(g.ay)} ${fmt(g.az)}`);
      lines.push(`v ${fmt(g.bx)} ${fmt(g.by)} ${fmt(g.bz)}`);
      const a = vertOffset + i * 2 + 1;
      lines.push(`l ${a} ${a + 1}`);
    }
    return vertOffset + pairs.length * 2;
  }

  function selectionBoxEdges(box) {
    if (!box) return [];
    const minx = Number(box.minx);
    const maxx = Number(box.maxx);
    const miny = Number(box.miny);
    const maxy = Number(box.maxy);
    const minz = Number(box.minz);
    const maxz = Number(box.maxz);
    if (![minx, maxx, miny, maxy, minz, maxz].every(Number.isFinite)) return [];
    const c = [
      [minx, miny, minz],
      [maxx, miny, minz],
      [maxx, maxy, minz],
      [minx, maxy, minz],
      [minx, miny, maxz],
      [maxx, miny, maxz],
      [maxx, maxy, maxz],
      [minx, maxy, maxz],
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
    const out = [];
    for (let i = 0; i < e.length; i++) {
      const a = c[e[i][0]];
      const b = c[e[i][1]];
      out.push({ ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2] });
    }
    return out;
  }

  function gridSpaceToOBJ(result, objectName, options) {
    const opts = options && typeof options === "object" ? options : typeof objectName === "object" ? objectName : {};
    const which = normalizeExportWhich(opts.which, typeof objectName === "string" ? objectName : "");
    const includeGeom = which === "geometry" || which === "both";
    const includeSurf = which === "surface" || which === "both";
    const lines = unitHeader(
      which === "both"
        ? "Rectangular geometry and developed surfaces. 1 unit = 1 foot."
        : which === "surface"
          ? "Developed surfaces. 1 unit = 1 foot."
          : "Connected rectangular solids. 1 unit = 1 foot."
    );
    let vertOffset = 0;
    let wrote = false;
    if (includeGeom) {
      const elements = result && result.elements ? result.elements : [];
      for (let e = 0; e < elements.length; e++) {
        const el = elements[e];
        const pos = el.worldPositions || el.positions;
        const idx = el.worldIndices || el.indices;
        if (!pos || !idx || !idx.length) continue;
        wrote = true;
        const name =
          "GENERATED_GEOMETRY_" +
          (el.kind || "solid") +
          "_" +
          String(el.id || e + 1).replace(/[^A-Za-z0-9_:-]/g, "_");
        vertOffset = appendMeshOBJ(lines, name, pos, idx, vertOffset);
      }
      if (!wrote && result && result.positions && result.indices && result.indices.length) {
        wrote = true;
        vertOffset = appendMeshOBJ(lines, "GENERATED_GEOMETRY", result.positions, result.indices, vertOffset);
      }
    }
    if (includeSurf) {
      const surfaces = result && result.surfaces ? result.surfaces : [];
      for (let e = 0; e < surfaces.length; e++) {
        const el = surfaces[e];
        const pos = el.worldPositions || el.positions;
        const idx = el.worldIndices || el.indices;
        if (!pos || !idx || !idx.length) continue;
        wrote = true;
        const name = "DEVELOPED_SURFACES_" + String(el.id || e + 1).replace(/[^A-Za-z0-9_:-]/g, "_");
        vertOffset = appendMeshOBJ(lines, name, pos, idx, vertOffset);
      }
      if (!surfaces.length && result && result.surfacePositions && result.surfaceIndices && result.surfaceIndices.length) {
        wrote = true;
        vertOffset = appendMeshOBJ(lines, "DEVELOPED_SURFACES", result.surfacePositions, result.surfaceIndices, vertOffset);
      }
    }
    const guides = result && result.guides ? result.guides : [];
    if (guides.length) {
      wrote = true;
      vertOffset = appendPolylineOBJ(lines, "SOURCE_BRANCHES", guides, vertOffset);
    }
    const boxEdges = selectionBoxEdges(result && result.box);
    if (boxEdges.length) {
      wrote = true;
      appendPolylineOBJ(lines, "SELECTION_BOX", boxEdges, vertOffset);
    }
    if (!wrote) return "";
    return lines.join("\n") + "\n";
  }

  function gridSurfacesToOBJ(result, objectName) {
    return gridSpaceToOBJ(result, objectName || "DEVELOPED_SURFACE", { which: "surface" });
  }

  function fillRhinoMesh(rhino, positions, indices) {
    const mesh = new rhino.Mesh();
    const verts = typeof mesh.vertices === "function" ? mesh.vertices() : mesh.vertices;
    for (let i = 0; i < positions.length; i += 3) {
      verts.add(positions[i], positions[i + 1], positions[i + 2]);
    }
    const rhFaces = typeof mesh.faces === "function" ? mesh.faces() : mesh.faces;
    for (let i = 0; i < indices.length; i += 3) {
      if (rhFaces.addTriFace) rhFaces.addTriFace(indices[i], indices[i + 1], indices[i + 2]);
      else rhFaces.add(indices[i], indices[i + 1], indices[i + 2]);
    }
    try {
      const normals = typeof mesh.normals === "function" ? mesh.normals() : mesh.normals;
      if (normals && normals.computeNormals) normals.computeNormals();
    } catch (err) {}
    return mesh;
  }

  function addNamedLayer(rhino, doc, name) {
    return addLayer(rhino, doc, name);
  }

  function addPlanarPatch(rhino, objects, attrs, corners) {
    if (!corners || corners.length < 3 || corners.length > 4) return false;
    if (!rhino.Brep || !rhino.Brep.createFromCornerPoints) return false;
    let brep = null;
    if (corners.length === 4) {
      brep = rhino.Brep.createFromCornerPoints(
        [corners[0].x, corners[0].y, corners[0].z],
        [corners[1].x, corners[1].y, corners[1].z],
        [corners[2].x, corners[2].y, corners[2].z],
        [corners[3].x, corners[3].y, corners[3].z],
        0.01
      );
    } else {
      brep = rhino.Brep.createFromCornerPoints(
        [corners[0].x, corners[0].y, corners[0].z],
        [corners[1].x, corners[1].y, corners[1].z],
        [corners[2].x, corners[2].y, corners[2].z],
        [corners[2].x, corners[2].y, corners[2].z],
        0.01
      );
    }
    if (brep && brep.isValid) {
      if (attrs && objects.addBrep) objects.addBrep(brep, attrs);
      else if (objects.addBrep) objects.addBrep(brep);
      return true;
    }
    return false;
  }

  function vec3(p) {
    return [p.x, p.y, p.z];
  }

  function addRhinoCurve(rhino, objects, attrs, ax, ay, az, bx, by, bz) {
    try {
      const curve = new rhino.LineCurve([ax, ay, az], [bx, by, bz]);
      if (attrs && objects.addCurve) objects.addCurve(curve, attrs);
      else if (objects.addCurve) objects.addCurve(curve);
      return true;
    } catch (err) {
      return false;
    }
  }

  function elementExportMesh(el) {
    if (!el) return null;
    const positions = el.worldPositions || el.positions;
    const indices = el.worldIndices || el.indices;
    if (!positions || !indices || !indices.length) return null;
    return { positions, indices };
  }

  function addExactMesh(rhino, objects, attrs, positions, indices) {
    if (!positions || !indices || !indices.length) return false;
    const mesh = fillRhinoMesh(rhino, positions, indices);
    if (!mesh) return false;
    if (attrs && objects.addMesh) objects.addMesh(mesh, attrs);
    else if (objects.addMesh) objects.addMesh(mesh);
    return true;
  }

  function addRhinoPoint(rhino, objects, attrs, x, y, z) {
    try {
      const pt = [Number(x) || 0, Number(y) || 0, Number(z) || 0];
      if (attrs && objects.addPoint) objects.addPoint(pt, attrs);
      else if (objects.addPoint) objects.addPoint(pt);
      else return false;
      return true;
    } catch (err) {
      return false;
    }
  }

  function addSolidElement(rhino, objects, geomAttrs, el) {
    let brep = null;
    if (!el.clipped) {
      try {
        brep = closedBrepFromViewportBox(rhino, el);
      } catch (err) {
        brep = null;
      }
    }
    if (!brep) {
      const mesh = elementExportMesh(el);
      if (mesh) {
        try {
          brep = closedBrepFromMesh(rhino, mesh.positions, mesh.indices);
        } catch (err) {
          brep = null;
        }
      }
    }
    if (brep && (brep.isValid || brep.isSolid)) {
      if (geomAttrs && objects.addBrep) objects.addBrep(brep, geomAttrs);
      else if (objects.addBrep) objects.addBrep(brep);
      return "brep";
    }
    return "";
  }

  async function exportGridSpace3dm(result, filename, options) {
    const opts = options && typeof options === "object" ? options : {};
    const which = normalizeExportWhich(opts.which, "");
    const includeGeom = which === "geometry" || which === "both";
    const includeSurf = which === "surface" || which === "both";
    if (!result || !result.ok) {
      throw new Error("Generate Geometry first.");
    }
    const hasGeom =
      !!(result.elements && result.elements.length) || !!(result.positions && result.indices && result.indices.length);
    const hasSurf =
      !!(result.surfaces && result.surfaces.length) ||
      !!(result.surfacePositions && result.surfaceIndices && result.surfaceIndices.length);
    if (includeGeom && !includeSurf && !hasGeom) throw new Error("No rectangular geometry to export.");
    if (includeSurf && !includeGeom && !hasSurf) throw new Error("No developed surface to export.");
    if (!includeGeom && !includeSurf) throw new Error("Nothing to export.");

    const rhino = await loadRhino();
    const doc = new rhino.File3dm();
    setFeet(rhino, doc);
    const objects = doc.objects();

    const geomAttrs = addNamedLayer(rhino, doc, "GENERATED_GEOMETRY");
    const surfAttrs = addNamedLayer(rhino, doc, "DEVELOPED_SURFACES");
    const branchAttrs = addNamedLayer(rhino, doc, "SOURCE_BRANCHES");
    const boxAttrs = addNamedLayer(rhino, doc, "SELECTION_BOX");
    const rootAttrs = addNamedLayer(rhino, doc, "ROOT_POINTS");

    let brepCount = 0;
    let meshCount = 0;
    let surfCount = 0;
    let rootCount = 0;
    if (includeGeom) {
      const elements = result.elements || [];
      for (let i = 0; i < elements.length; i++) {
        if (addSolidElement(rhino, objects, geomAttrs, elements[i]) === "brep") brepCount += 1;
      }
      if (!brepCount && result.positions && result.indices && result.indices.length) {
        const brep = closedBrepFromMesh(rhino, result.positions, result.indices);
        if (brep && objects.addBrep) {
          if (geomAttrs) objects.addBrep(brep, geomAttrs);
          else objects.addBrep(brep);
          brepCount = 1;
        }
      }
    }
    if (includeSurf) {
      const surfaces = result.surfaces || [];
      for (let i = 0; i < surfaces.length; i++) {
        const mesh = elementExportMesh(surfaces[i]);
        if (!mesh) continue;
        let brep = null;
        try {
          brep = closedBrepFromMesh(rhino, mesh.positions, mesh.indices);
        } catch (err) {
          brep = null;
        }
        if (brep && (brep.isValid || brep.isSolid)) {
          if (surfAttrs && objects.addBrep) objects.addBrep(brep, surfAttrs);
          else if (objects.addBrep) objects.addBrep(brep);
          surfCount += 1;
          continue;
        }
        if (addExactMesh(rhino, objects, surfAttrs, mesh.positions, mesh.indices)) {
          surfCount += 1;
          meshCount += 1;
        }
      }
      if (!surfCount && result.surfacePositions && result.surfaceIndices && result.surfaceIndices.length) {
        const brep = closedBrepFromMesh(rhino, result.surfacePositions, result.surfaceIndices);
        if (brep && objects.addBrep) {
          if (surfAttrs) objects.addBrep(brep, surfAttrs);
          else objects.addBrep(brep);
          surfCount = 1;
        } else if (addExactMesh(rhino, objects, surfAttrs, result.surfacePositions, result.surfaceIndices)) {
          surfCount = 1;
          meshCount = 1;
        }
      }
    }

    const guides = result.guides || result.sourceBranches || [];
    for (let i = 0; i < guides.length; i++) {
      const g = guides[i];
      addRhinoCurve(rhino, objects, branchAttrs, g.ax, g.ay, g.az, g.bx, g.by, g.bz);
    }
    const boxEdges = selectionBoxEdges(result.box);
    for (let i = 0; i < boxEdges.length; i++) {
      const g = boxEdges[i];
      addRhinoCurve(rhino, objects, boxAttrs, g.ax, g.ay, g.az, g.bx, g.by, g.bz);
    }
    const roots = result.roots || [];
    for (let i = 0; i < roots.length; i++) {
      const r = roots[i];
      if (addRhinoPoint(rhino, objects, rootAttrs, r.x, r.y, r.z)) rootCount += 1;
    }

    const geometryStateHash = result.geometryStateHash || hashGeometryState(result);
    const bytes = (() => {
      try {
        return doc.toByteArray();
      } catch (err) {
        return doc.toByteArrayBuffer ? doc.toByteArrayBuffer() : null;
      }
    })();
    try {
      if (doc.delete) doc.delete();
    } catch (err) {}
    if (!bytes) throw new Error("Geometry 3DM export failed");
    const copy = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes);
    downloadBlob(filename, new Blob([copy], { type: "application/octet-stream" }));
    return {
      added: brepCount + surfCount + guides.length + boxEdges.length + rootCount,
      closed: brepCount,
      meshCount,
      surfCount,
      rootCount,
      branchCount: guides.length,
      which,
      kind: brepCount ? "closed polysurface" : meshCount ? "mesh" : "curve",
      geometryStateHash,
    };
  }

  async function exportGridSurfaces3dm(result, filename) {
    return exportGridSpace3dm(result, filename, { which: "surface" });
  }

  function xmlEscape(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function viewBasis(view) {
    const mode = String(view || "front").toLowerCase();
    let dx = 0;
    let dy = 0;
    let dz = 1;
    let ux = 0;
    let uy = 1;
    let uz = 0;
    if (mode === "back") dz = -1;
    else if (mode === "right") {
      dx = 1;
      dz = 0;
    } else if (mode === "left") {
      dx = -1;
      dz = 0;
    } else if (mode === "top") {
      dy = 1;
      dz = 0;
      ux = 0;
      uy = 0;
      uz = -1;
    } else if (mode === "bottom") {
      dy = -1;
      dz = 0;
      ux = 0;
      uy = 0;
      uz = 1;
    } else if (mode === "isometric" || mode === "iso" || mode === "perspective" || mode === "persp") {
      dx = 1;
      dy = 1;
      dz = 1;
    }
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl;
    dy /= dl;
    dz /= dl;
    let xx = uy * dz - uz * dy;
    let xy = uz * dx - ux * dz;
    let xz = ux * dy - uy * dx;
    const xl = Math.hypot(xx, xy, xz);
    if (xl < 1e-8) {
      xx = 1;
      xy = 0;
      xz = 0;
    } else {
      xx /= xl;
      xy /= xl;
      xz /= xl;
    }
    const yx = dy * xz - dz * xy;
    const yy = dz * xx - dx * xz;
    const yz = dx * xy - dy * xx;
    return { xx, xy, xz, yx, yy, yz, name: mode === "perspective" || mode === "persp" ? "isometric" : mode };
  }

  function projectPoint(x, y, z, basis) {
    return {
      u: x * basis.xx + y * basis.xy + z * basis.xz,
      v: x * basis.yx + y * basis.yy + z * basis.yz,
    };
  }

  function clippedBranchesToSvg(graph, options) {
    const segs = (graph && graph.segs) || [];
    const box = (graph && graph.box) || { minx: 0, maxx: CUBE, miny: 0, maxy: CUBE, minz: 0, maxz: CUBE };
    const basis = viewBasis(options && options.view);
    const pts = [];
    function add(x, y, z) {
      pts.push(projectPoint(x, y, z, basis));
    }
    add(box.minx, box.miny, box.minz);
    add(box.maxx, box.miny, box.minz);
    add(box.maxx, box.maxy, box.minz);
    add(box.minx, box.maxy, box.minz);
    add(box.minx, box.miny, box.maxz);
    add(box.maxx, box.miny, box.maxz);
    add(box.maxx, box.maxy, box.maxz);
    add(box.minx, box.maxy, box.maxz);
    for (let i = 0; i < segs.length; i++) {
      add(segs[i].ax, segs[i].ay, segs[i].az);
      add(segs[i].bx, segs[i].by, segs[i].bz);
    }
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].u < minU) minU = pts[i].u;
      if (pts[i].u > maxU) maxU = pts[i].u;
      if (pts[i].v < minV) minV = pts[i].v;
      if (pts[i].v > maxV) maxV = pts[i].v;
    }
    const pad = 0.4;
    minU -= pad;
    maxU += pad;
    minV -= pad;
    maxV += pad;
    const w = Math.max(0.5, maxU - minU);
    const h = Math.max(0.5, maxV - minV);
    function svgPt(x, y, z) {
      const p = projectPoint(x, y, z, basis);
      return { x: p.u - minU, y: maxV - p.v };
    }
    const px = Math.round(Math.max(w, h) * 36);
    const parts = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${Math.round((h / w) * px)}" viewBox="0 0 ${fmt(w)} ${fmt(h)}">`
    );
    parts.push(`<title>D7 Grid Growth branches · ${xmlEscape(basis.name)}</title>`);
    parts.push(
      `<desc>1 SVG user unit = 1 foot. Branches clipped to the selection box. View: ${xmlEscape(basis.name)}. Box ${fmt(box.maxx - box.minx)} × ${fmt(box.maxz - box.minz)} × ${fmt(box.maxy - box.miny)} ft.</desc>`
    );
    parts.push(`<rect width="${fmt(w)}" height="${fmt(h)}" fill="#000000"/>`);
    const corners = [
      [box.minx, box.miny, box.minz],
      [box.maxx, box.miny, box.minz],
      [box.maxx, box.maxy, box.minz],
      [box.minx, box.maxy, box.minz],
      [box.minx, box.miny, box.maxz],
      [box.maxx, box.miny, box.maxz],
      [box.maxx, box.maxy, box.maxz],
      [box.minx, box.maxy, box.maxz],
    ];
    const edges = [
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
    parts.push(`<g id="SELECTION_BOX" fill="none" stroke="#5ad4e8" stroke-width="0.04" stroke-opacity="0.85">`);
    for (let i = 0; i < edges.length; i++) {
      const a = svgPt(corners[edges[i][0]][0], corners[edges[i][0]][1], corners[edges[i][0]][2]);
      const b = svgPt(corners[edges[i][1]][0], corners[edges[i][1]][1], corners[edges[i][1]][2]);
      parts.push(
        `<line x1="${fmt(a.x)}" y1="${fmt(a.y)}" x2="${fmt(b.x)}" y2="${fmt(b.y)}"/>`
      );
    }
    parts.push(`</g>`);
    parts.push(
      `<g id="SOURCE_BRANCHES" fill="none" stroke="#ffffff" stroke-width="0.06" stroke-linecap="round" stroke-linejoin="round">`
    );
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const a = svgPt(s.ax, s.ay, s.az);
      const b = svgPt(s.bx, s.by, s.bz);
      parts.push(
        `<line x1="${fmt(a.x)}" y1="${fmt(a.y)}" x2="${fmt(b.x)}" y2="${fmt(b.y)}"/>`
      );
    }
    parts.push(`</g>`);
    parts.push(`</svg>`);
    return parts.join("\n");
  }

  function exportClippedBranchesSvg(graph, filename, options) {
    const segs = graph && graph.segs ? graph.segs : [];
    if (!segs.length) throw new Error("No branches inside the selection box.");
    const text = clippedBranchesToSvg(graph, options || {});
    let name = sanitizeFilename(String(filename || "D7_Grid_Branches").replace(/\.svg$/i, ""));
    if (!name) name = "D7_Grid_Branches";
    name += ".svg";
    downloadBlob(name, new Blob([text], { type: "image/svg+xml" }));
    return { filename: name, count: segs.length, view: viewBasis(options && options.view).name };
  }

  global.D7SpatialExport = {
    CUBE,
    sanitizeFilename,
    trianglesFromGeometry,
    geometryToOBJ,
    voxelMeshFromCells,
    voxelToOBJ,
    loftBrepsFromRuns,
    exportLoftPolysurface,
    exportVoxelPolysurface,
    exportGeometryMesh3dm,
    exportOBJ,
    gridSpaceToOBJ,
    gridSurfacesToOBJ,
    exportGridSpace3dm,
    exportGridSurfaces3dm,
    clippedBranchesToSvg,
    exportClippedBranchesSvg,
    hashGeometryState,
    downloadBlob,
  };
})(window);

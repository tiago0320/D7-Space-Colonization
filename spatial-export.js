/**
 * Client-side loft / voxel export.
 * OBJ = triangulated mesh. 3DM = Rhino Brep / closed polysurface.
 * Coordinates stay in feet (20 × 20 × 20 workspace).
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

  function geometryToOBJ(geometry, objectName) {
    const { positions, faces } = trianglesFromGeometry(geometry);
    if (!faces.length) return "";
    const lines = [
      "# D7-Space-Colonization",
      "# Units: feet (1 unit = 1 ft)",
      `o ${objectName || "Loft"}`,
    ];
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
    const lines = [
      "# D7-Space-Colonization voxels",
      "# Units: feet (1 unit = 1 ft)",
      `o ${objectName || "Voxels"}`,
    ];
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

  function exportOBJ(text, filename) {
    if (!text) throw new Error("Nothing to export.");
    downloadBlob(filename, new Blob([text], { type: "text/plain" }));
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
    exportOBJ,
    downloadBlob,
  };
})(window);

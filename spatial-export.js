/**
 * Client-side OBJ / Rhino 3DM / SVG export.
 * Grid Growth writes branch curves. Plank Builder writes one joined open Brep
 * plus the same branch centerlines on a second layer.
 * Coordinates stay in feet. 1 unit = 1 ft. Workspace is 20' × 20' × 20'.
 * The viewport cube is never written into the file.
 * Do not rescale. Do not thicken plank faces.
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
    const roots = src.roots || (src.displayGeometry && src.displayGeometry.roots) || [];
    feed("r");
    feed(roots.length);
    for (let i = 0; i < roots.length; i++) {
      feed(roots[i] && roots[i].id != null ? roots[i].id : i);
      feed(quantize(roots[i] && roots[i].x));
      feed(quantize(roots[i] && roots[i].y));
      feed(quantize(roots[i] && roots[i].z));
    }
    const box = src.box || src.selectionBox || {};
    feed("x");
    feed(quantize(box.minx));
    feed(quantize(box.maxx));
    feed(quantize(box.miny));
    feed(quantize(box.maxy));
    feed(quantize(box.minz));
    feed(quantize(box.maxz));
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

  function unitHeader(kind) {
    return [
      "# D7-Space-Colonization",
      `# ${kind || "Branches"}`,
      "# Coordinate units: feet",
      "# 1 file unit = 1 foot",
      "# Workspace: 20' W × 20' D × 20' H (8,000 cubic feet)",
      "# OBJ has no native units. Import into Rhino with document units = Feet.",
      "# Do not scale this file to a 0–1 cube.",
    ];
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

  function addNamedLayer(rhino, doc, name) {
    return addLayer(rhino, doc, name);
  }

  function namedObjectAttrs(rhino, layerAttrs, name) {
    try {
      const attrs = new rhino.ObjectAttributes();
      if (layerAttrs && layerAttrs.layerIndex != null) attrs.layerIndex = layerAttrs.layerIndex;
      if (name) {
        attrs.name = name;
        if (attrs.objectName != null) attrs.objectName = name;
      }
      return attrs;
    } catch (err) {
      return layerAttrs || null;
    }
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

  function collectBranchPayload(payload) {
    const src = payload && typeof payload === "object" ? payload : {};
    const branches =
      src.sourceBranches ||
      src.guides ||
      src.segs ||
      (src.displayGeometry && src.displayGeometry.branches) ||
      [];
    const roots = src.roots || (src.displayGeometry && src.displayGeometry.roots) || [];
    const box =
      src.box ||
      (src.selectionBox && src.selectionBox.bounds) ||
      src.selectionBox ||
      { minx: 0, maxx: CUBE, miny: 0, maxy: CUBE, minz: 0, maxz: CUBE };
    return { branches, roots, box };
  }

  function gridBranchesToOBJ(payload) {
    const { branches, roots, box } = collectBranchPayload(payload);
    const lines = unitHeader("Branches");
    let vert = 0;
    vert = appendPolylineOBJ(lines, "SOURCE_BRANCHES", branches, vert);
    vert = appendPolylineOBJ(lines, "SELECTION_BOX", selectionBoxEdges(box), vert);
    if (roots && roots.length) {
      lines.push("o ROOT_POINTS");
      for (let i = 0; i < roots.length; i++) {
        const r = roots[i];
        lines.push(`v ${fmt(r.x)} ${fmt(r.y)} ${fmt(r.z)}`);
      }
    }
    return lines.join("\n") + "\n";
  }

  async function exportGridBranches3dm(payload, filename) {
    const { branches, roots, box } = collectBranchPayload(payload);
    if (!branches.length) throw new Error("No branches inside the selection box.");
    const rhino = await loadRhino();
    const doc = new rhino.File3dm();
    setFeet(rhino, doc);
    const objects = doc.objects();
    const branchAttrs = addNamedLayer(rhino, doc, "SOURCE_BRANCHES");
    const boxAttrs = addNamedLayer(rhino, doc, "SELECTION_BOX");
    const rootAttrs = addNamedLayer(rhino, doc, "ROOT_POINTS");
    let branchCount = 0;
    for (let i = 0; i < branches.length; i++) {
      const g = branches[i];
      const attrs = namedObjectAttrs(rhino, branchAttrs, g.id || "branch_" + String(i + 1).padStart(3, "0"));
      if (addRhinoCurve(rhino, objects, attrs, g.ax, g.ay, g.az, g.bx, g.by, g.bz)) branchCount += 1;
    }
    const edges = selectionBoxEdges(box);
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      addRhinoCurve(rhino, objects, boxAttrs, e.ax, e.ay, e.az, e.bx, e.by, e.bz);
    }
    let rootCount = 0;
    for (let i = 0; i < roots.length; i++) {
      const r = roots[i];
      const attrs = namedObjectAttrs(rhino, rootAttrs, r.stableId || r.id || "root_" + String(i + 1).padStart(3, "0"));
      if (addRhinoPoint(rhino, objects, attrs, r.x, r.y, r.z)) rootCount += 1;
    }
    const bytes = doc.toByteArray();
    let name = sanitizeFilename(String(filename || "D7_Grid_Branches").replace(/\.3dm$/i, ""));
    if (!name) name = "D7_Grid_Branches";
    downloadBlob(name + ".3dm", new Blob([bytes], { type: "application/octet-stream" }));
    const objName = name + ".obj";
    downloadBlob(objName, new Blob([gridBranchesToOBJ(payload)], { type: "text/plain" }));
    const geometryStateHash = hashGeometryState(payload);
    return { filename: name + ".3dm", obj: objName, branchCount, rootCount, geometryStateHash };
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
      parts.push(`<line x1="${fmt(a.x)}" y1="${fmt(a.y)}" x2="${fmt(b.x)}" y2="${fmt(b.y)}"/>`);
    }
    parts.push(`</g>`);
    parts.push(
      `<g id="SOURCE_BRANCHES" fill="none" stroke="#ffffff" stroke-width="0.06" stroke-linecap="round" stroke-linejoin="round">`
    );
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const a = svgPt(s.ax, s.ay, s.az);
      const b = svgPt(s.bx, s.by, s.bz);
      parts.push(`<line x1="${fmt(a.x)}" y1="${fmt(a.y)}" x2="${fmt(b.x)}" y2="${fmt(b.y)}"/>`);
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

  function plankEdgeKey(a, b) {
    return a < b ? a + "_" + b : b + "_" + a;
  }

  function plankFaceArea(verts, ids) {
    const A = verts[ids[0]];
    const B = verts[ids[1]];
    const C = verts[ids[2]];
    const D = verts[ids[3]];
    const abx = B.x - A.x;
    const aby = B.y - A.y;
    const abz = B.z - A.z;
    const acx = C.x - A.x;
    const acy = C.y - A.y;
    const acz = C.z - A.z;
    const adx = D.x - A.x;
    const ady = D.y - A.y;
    const adz = D.z - A.z;
    const c1x = aby * acz - abz * acy;
    const c1y = abz * acx - abx * acz;
    const c1z = abx * acy - aby * acx;
    const c2x = acy * adz - acz * ady;
    const c2y = acz * adx - acx * adz;
    const c2z = acx * ady - acy * adx;
    return 0.5 * (Math.hypot(c1x, c1y, c1z) + Math.hypot(c2x, c2y, c2z));
  }

  function validatePlankJoinGraph(verts, quads) {
    const issues = [];
    const valid = [];
    const seen = new Set();
    for (let f = 0; f < quads.length; f++) {
      const ids = quads[f];
      const tag = "FACE_" + String(f).padStart(3, "0");
      if (!ids || ids.length !== 4) {
        issues.push("PLANK_SYSTEM join failed at " + tag + " (not a quad)");
        continue;
      }
      const a = ids[0];
      const b = ids[1];
      const c = ids[2];
      const d = ids[3];
      if ([a, b, c, d].some((id) => id == null || !verts[id])) {
        issues.push("PLANK_SYSTEM join failed at " + tag + " (missing vertex)");
        continue;
      }
      if (new Set([a, b, c, d]).size !== 4) {
        issues.push("PLANK_SYSTEM join failed at " + tag + " (degenerate vertices)");
        continue;
      }
      const sig = [a, b, c, d].slice().sort((x, y) => x - y).join(":");
      if (seen.has(sig)) {
        issues.push("PLANK_SYSTEM join failed at " + tag + " (duplicated overlapping face)");
        continue;
      }
      seen.add(sig);
      if (plankFaceArea(verts, ids) < 1e-10) {
        issues.push("PLANK_SYSTEM join failed at " + tag + " (zero-area face)");
        continue;
      }
      valid.push({ index: f, ids: [a, b, c, d] });
    }

    const edgeMap = new Map();
    for (let i = 0; i < valid.length; i++) {
      const ids = valid[i].ids;
      const loops = [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[3]], [ids[3], ids[0]]];
      for (let e = 0; e < 4; e++) {
        const key = plankEdgeKey(loops[e][0], loops[e][1]);
        let rec = edgeMap.get(key);
        if (!rec) {
          rec = {
            id: "EDGE_" + String(edgeMap.size).padStart(3, "0"),
            a: loops[e][0],
            b: loops[e][1],
            faces: [],
          };
          edgeMap.set(key, rec);
        }
        rec.faces.push(valid[i].index);
      }
    }

    const parent = valid.map((_, i) => i);
    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    }
    const indexOfFace = new Map();
    valid.forEach((face, i) => indexOfFace.set(face.index, i));
    const shared = [];
    const crowded = [];
    edgeMap.forEach((rec) => {
      if (rec.faces.length > 2) {
        crowded.push(rec);
        console.warn("[Plank Builder] PLANK_SYSTEM non-manifold edge " + rec.id + " shared by " + rec.faces.length + " faces");
      }
      if (rec.faces.length < 2) return;
      const va = verts[rec.a];
      const vb = verts[rec.b];
      const dx = va.x - vb.x;
      const dy = va.y - vb.y;
      const dz = va.z - vb.z;
      if (dx * dx + dy * dy + dz * dz < 1e-16) {
        issues.push("PLANK_SYSTEM join failed at edge " + rec.id + " (zero-length shared edge)");
        return;
      }
      shared.push(rec);
      for (let i = 1; i < rec.faces.length; i++) {
        const ia = indexOfFace.get(rec.faces[0]);
        const ib = indexOfFace.get(rec.faces[i]);
        if (ia != null && ib != null && find(ia) !== find(ib)) parent[find(ib)] = find(ia);
      }
    });

    if (valid.length > 1 && shared.length === 0) {
      issues.push("PLANK_SYSTEM join failed: no shared edges between plank faces");
    }

    return { issues, valid, shared, crowded };
  }

  function listJoinMethods(rhino) {
    const names = [];
    if (!rhino || !rhino.Brep) return names;
    const keys = [];
    try {
      keys.push.apply(keys, Object.keys(rhino.Brep));
    } catch (_err) {}
    try {
      keys.push.apply(keys, Object.getOwnPropertyNames(rhino.Brep));
    } catch (_err) {}
    for (let i = 0; i < keys.length; i++) {
      if (/join/i.test(keys[i]) && typeof rhino.Brep[keys[i]] === "function") names.push(keys[i]);
    }
    if (typeof rhino.Brep.joinBreps === "function" && names.indexOf("joinBreps") < 0) names.push("joinBreps");
    if (typeof rhino.Brep.JoinBreps === "function" && names.indexOf("JoinBreps") < 0) names.push("JoinBreps");
    return names;
  }

  function asBrepList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value.faces) return [value];
    const n =
      typeof value.count === "function" ? value.count() :
      typeof value.count === "number" ? value.count :
      typeof value.length === "number" ? value.length : 0;
    const out = [];
    for (let i = 0; i < n; i++) {
      const item = value.get ? value.get(i) : value[i];
      if (item) out.push(item);
    }
    return out;
  }

  function tryJoinBreps(rhino, breps, tolerance) {
    const names = listJoinMethods(rhino);
    for (let i = 0; i < names.length; i++) {
      try {
        const joined = rhino.Brep[names[i]](breps, tolerance);
        const list = asBrepList(joined);
        if (list.length) return list;
      } catch (_err) {}
    }
    return null;
  }

  function planarFaceBrep(rhino, corners) {
    const pts3 = corners.map((v) => [v.x, v.y, v.z]);
    const pts4 = corners.map((v) => [v.x, v.y, v.z, 1]);
    if (typeof rhino.Brep.createFromCornerPoints === "function") {
      try {
        const brep = rhino.Brep.createFromCornerPoints(pts3[0], pts3[1], pts3[2], pts3[3], 1e-6);
        if (brep && brep.faces && brep.faces().count > 0) return brep;
      } catch (_err) {}
    }
    if (typeof rhino.NurbsSurface.create === "function") {
      try {
        const srf = rhino.NurbsSurface.create(3, false, 2, 2, 2, 2);
        const cv = srf.points();
        try {
          cv.set(0, 0, pts3[0]);
          cv.set(1, 0, pts3[1]);
          cv.set(1, 1, pts3[2]);
          cv.set(0, 1, pts3[3]);
        } catch (_needW) {
          cv.set(0, 0, pts4[0]);
          cv.set(1, 0, pts4[1]);
          cv.set(1, 1, pts4[2]);
          cv.set(0, 1, pts4[3]);
        }
        if (srf.knotsU && typeof srf.knotsU().createUniformKnots === "function") {
          srf.knotsU().createUniformKnots(1);
          srf.knotsV().createUniformKnots(1);
        }
        const brep = rhino.Brep.createFromSurface(srf);
        if (brep && brep.faces && brep.faces().count > 0) return brep;
      } catch (_err) {}
    }
    try {
      if (rhino.NurbsCurve && typeof rhino.NurbsCurve.createFromPoints === "function" &&
          typeof rhino.NurbsSurface.createRuledSurface === "function") {
        const a = rhino.NurbsCurve.createFromPoints([pts3[0], pts3[1]], 1);
        const b = rhino.NurbsCurve.createFromPoints([pts3[3], pts3[2]], 1);
        const ruled = rhino.NurbsSurface.createRuledSurface(a, b);
        const brep = rhino.Brep.createFromSurface(ruled);
        if (brep && brep.faces && brep.faces().count > 0) return brep;
      }
    } catch (_err) {}
    return null;
  }

  function meshFromQuads(rhino, verts, faces) {
    const mesh = new rhino.Mesh();
    const mv = mesh.vertices();
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      mv.add(v.x, v.y, v.z);
    }
    const mf = mesh.faces();
    for (let i = 0; i < faces.length; i++) {
      const q = faces[i].ids;
      if (typeof mf.addQuadFace === "function") mf.addQuadFace(q[0], q[1], q[2], q[3]);
      else if (typeof mf.addFace === "function") mf.addFace(q[0], q[1], q[2], q[3]);
      else throw new Error("PLANK_SYSTEM join failed: rhino3dm cannot add quad faces");
    }
    try {
      if (mesh.normals && mesh.normals().computeNormals) mesh.normals().computeNormals();
    } catch (_err) {}
    try {
      if (typeof mesh.compact === "function") mesh.compact();
    } catch (_err) {}
    return mesh;
  }

  function brepFromMesh(rhino, mesh) {
    const attempts = [];
    if (typeof rhino.Brep.createFromMesh === "function") {
      attempts.push(() => rhino.Brep.createFromMesh(mesh, false));
      attempts.push(() => rhino.Brep.createFromMesh(mesh, true));
      attempts.push(() => rhino.Brep.createFromMesh(mesh));
    }
    if (mesh && typeof mesh.toBrep === "function") {
      attempts.push(() => mesh.toBrep(false));
      attempts.push(() => mesh.toBrep(true));
    }
    if (typeof rhino.Brep.tryConvertBrep === "function") {
      attempts.push(() => rhino.Brep.tryConvertBrep(mesh));
    }
    for (let i = 0; i < attempts.length; i++) {
      try {
        const brep = attempts[i]();
        if (brep && brep.faces && brep.faces().count > 0) return brep;
      } catch (_err) {}
    }
    return null;
  }

  function brepFaceCount(brep) {
    try {
      if (!brep || !brep.faces) return 0;
      const faces = brep.faces();
      if (typeof faces.count === "number") return faces.count;
      if (typeof faces.count === "function") return faces.count();
    } catch (_err) {}
    return 0;
  }

  function brepIsSolid(brep) {
    try {
      if (typeof brep.isSolid === "boolean") return brep.isSolid;
      if (typeof brep.isSolid === "function") return !!brep.isSolid();
    } catch (_err) {}
    return false;
  }

  function fileObjectCount(doc) {
    try {
      const objs = doc.objects();
      if (typeof objs.count === "number") return objs.count;
      if (typeof objs.count === "function") return objs.count();
    } catch (_err) {}
    return -1;
  }

  function pickUnifiedBrep(rhino, verts, graph) {
    const wanted = graph.valid.length;
    const mesh = meshFromQuads(rhino, verts, graph.valid);
    const fromMesh = brepFromMesh(rhino, mesh);
    if (fromMesh && brepFaceCount(fromMesh) === wanted && !brepIsSolid(fromMesh)) {
      return fromMesh;
    }

    const joinNames = listJoinMethods(rhino);
    if (joinNames.length) {
      const faceBreps = [];
      for (let i = 0; i < graph.valid.length; i++) {
        const ids = graph.valid[i].ids;
        const face = planarFaceBrep(rhino, [verts[ids[0]], verts[ids[1]], verts[ids[2]], verts[ids[3]]]);
        if (!face) {
          throw new Error("PLANK_SYSTEM join failed at FACE_" + String(graph.valid[i].index).padStart(3, "0"));
        }
        faceBreps.push(face);
      }
      const joined = tryJoinBreps(rhino, faceBreps, 1e-6);
      if (joined && joined.length === 1 && brepFaceCount(joined[0]) === wanted && !brepIsSolid(joined[0])) {
        return joined[0];
      }
      if (joined && joined.length > 1) {
        const failed = graph.shared[0];
        throw new Error(
          "PLANK_SYSTEM join failed at edge " +
            (failed ? failed.id : "EDGE_000") +
            " (produced " + joined.length + " separate Breps)"
        );
      }
    }

    if (fromMesh && brepIsSolid(fromMesh)) {
      throw new Error("PLANK_SYSTEM join failed: result is a closed solid (must remain an open polysurface)");
    }
    if (fromMesh && brepFaceCount(fromMesh) && brepFaceCount(fromMesh) !== wanted) {
      throw new Error(
        "PLANK_SYSTEM join failed: joined Brep has " +
          brepFaceCount(fromMesh) +
          " faces but the plank system has " +
          wanted +
          " quads"
      );
    }
    const failed = (graph.crowded && graph.crowded[0]) || graph.shared[0];
    throw new Error("PLANK_SYSTEM join failed at edge " + (failed ? failed.id : "EDGE_000"));
  }

  /**
   * Export the live Plank Builder quads as one open polysurface named PLANK_SYSTEM,
   * plus the viewport branch centerlines on layer 02_BRANCH_LINES.
   * Uses the exact verts/quads already on screen. Does not rebuild branching.
   */
  async function exportUnifiedPlank3dm(system, filename) {
    const verts = system && system.verts;
    const quads = system && system.quads;
    if (!verts || !quads || !quads.length) {
      throw new Error("No plank surfaces to export.");
    }

    const graph = validatePlankJoinGraph(verts, quads);
    if (graph.issues.length) {
      graph.issues.forEach((msg) => console.warn("[Plank Builder]", msg));
      throw new Error(graph.issues[0] + (graph.issues.length > 1 ? " (+" + (graph.issues.length - 1) + " more)" : ""));
    }
    if (!graph.valid.length) {
      throw new Error("PLANK_SYSTEM join failed: no valid quad faces");
    }

    const rhino = await loadRhino();
    const unified = pickUnifiedBrep(rhino, verts, graph);
    if (brepIsSolid(unified)) {
      throw new Error("PLANK_SYSTEM join failed: result is a closed solid (must remain an open polysurface)");
    }

    const segs = (system && system.branchSegs) || [];
    const doc = new rhino.File3dm();
    setFeet(rhino, doc);
    const layerAttrs = addLayer(rhino, doc, "01_PLANK_SYSTEM");
    const attrs = namedObjectAttrs(rhino, layerAttrs, "PLANK_SYSTEM");
    doc.objects().addBrep(unified, attrs);
    const objects = doc.objects();
    const branchLayer = addLayer(rhino, doc, "02_BRANCH_LINES");
    let branchCount = 0;
    for (let i = 0; i < segs.length; i++) {
      const g = segs[i];
      const curveAttrs = namedObjectAttrs(
        rhino,
        branchLayer,
        g.id || "branch_" + String(i + 1).padStart(3, "0")
      );
      if (addRhinoCurve(rhino, objects, curveAttrs, g.ax, g.ay, g.az, g.bx, g.by, g.bz)) branchCount += 1;
    }
    const objectCount = fileObjectCount(doc);
    const expected = 1 + branchCount;
    if (objectCount > 0 && objectCount !== expected) {
      throw new Error(
        "PLANK_SYSTEM join failed: file contains " +
          objectCount +
          " objects instead of " +
          expected +
          " (1 plank polysurface + " +
          branchCount +
          " branch lines)"
      );
    }

    const bytes = doc.toByteArray();
    let name = sanitizeFilename(String(filename || "D7_Plank_System").replace(/\.3dm$/i, ""));
    if (!name) name = "D7_Plank_System";
    downloadBlob(name + ".3dm", new Blob([bytes], { type: "application/octet-stream" }));
    return {
      filename: name + ".3dm",
      faceCount: brepFaceCount(unified),
      objectCount: objectCount < 0 ? expected : objectCount,
      quadCount: graph.valid.length,
      branchCount: branchCount,
    };
  }

  global.D7SpatialExport = {
    CUBE,
    sanitizeFilename,
    gridBranchesToOBJ,
    exportGridBranches3dm,
    exportUnifiedPlank3dm,
    clippedBranchesToSvg,
    exportClippedBranchesSvg,
    hashGeometryState,
    downloadBlob,
  };
})(window);

/**
 * Client-side OBJ / Rhino 3DM / SVG export for 3D Grid Growth branches.
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

  global.D7SpatialExport = {
    CUBE,
    sanitizeFilename,
    gridBranchesToOBJ,
    exportGridBranches3dm,
    clippedBranchesToSvg,
    exportClippedBranchesSvg,
    hashGeometryState,
    downloadBlob,
  };
})(window);

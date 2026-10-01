/**
 * Section loft: corresponding 2D branch segments become 3D solids.
 * Open space between lofted branches stays void.
 */
(function (global) {
  const CUBE = 20;

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(t) {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function applyMat4(e, x, y, z, out) {
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    const iw = Math.abs(w) > 1e-12 ? 1 / w : 1;
    out[0] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * iw;
    out[1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * iw;
    out[2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * iw;
    return out;
  }

  function defaultDeform() {
    return {
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      shiftX: 0,
      shiftY: 0,
      taper: 1,
    };
  }

  function copyTransform(t) {
    return {
      x: t.x || 0,
      y: t.y || 0,
      z: t.z || 0,
      rx: t.rx || 0,
      ry: t.ry || 0,
      rz: t.rz || 0,
      scale: t.scale != null ? t.scale : 1,
      sx: t.sx != null ? t.sx : 1,
      sy: t.sy != null ? t.sy : 1,
    };
  }

  function topologyFromChunk(chunk) {
    const nodes = (chunk.nodes || []).map((node, i) => ({
      id: node.id != null ? node.id : i,
      x: node.x,
      y: node.y,
      z: node.z || 0,
      parentIndex: node.parentIndex,
      order: node.order || 1,
      thickness: node.thickness,
      rootId: node.rootId,
    }));
    const segments = [];
    const seen = new Set();
    function addSeg(a, b, order, thickness, rootId, id) {
      if (a == null || b == null || a < 0 || b < 0 || a === b) return;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) return;
      seen.add(key);
      segments.push({
        id: id || `${a}:${b}`,
        a,
        b,
        startNodeId: a,
        endNodeId: b,
        order: order || 1,
        thickness,
        rootId,
      });
    }
    if (chunk.segments && chunk.segments.length) {
      for (const seg of chunk.segments) addSeg(seg.a, seg.b, seg.order, seg.thickness, seg.rootId, seg.id);
    } else {
      for (let i = 0; i < nodes.length; i++) {
        addSeg(nodes[i].parentIndex, i, nodes[i].order, nodes[i].thickness, nodes[i].rootId);
      }
    }
    return {
      nodes,
      segments,
      width: chunk.width,
      height: chunk.height,
    };
  }

  function deformLocal(section, width, height) {
    const cx = width * 0.5;
    const cy = height * 0.5;
    const d = section.deform || defaultDeform();
    const s = (d.scale || 1) * (d.taper != null ? d.taper : 1);
    const sx = s * (d.scaleX || 1);
    const sy = s * (d.scaleY || 1);
    const rot = ((d.rotation || 0) * Math.PI) / 180;
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    const shx = d.shiftX || 0;
    const shy = d.shiftY || 0;
    return (section.nodes || []).map((node) => {
      let px = node.x - cx + shx;
      let py = node.y - cy + shy;
      const rx = px * c - py * sn;
      const ry = px * sn + py * c;
      return { id: node.id, x: cx + rx * sx, y: cy + ry * sy, z: node.z || 0 };
    });
  }

  function invertDeformPoint(x, y, section, width, height) {
    const cx = width * 0.5;
    const cy = height * 0.5;
    const d = section.deform || defaultDeform();
    const s = (d.scale || 1) * (d.taper != null ? d.taper : 1);
    const sx = Math.max(1e-6, s * (d.scaleX || 1));
    const sy = Math.max(1e-6, s * (d.scaleY || 1));
    const rot = ((d.rotation || 0) * Math.PI) / 180;
    const c = Math.cos(-rot);
    const sn = Math.sin(-rot);
    let px = (x - cx) / sx;
    let py = (y - cy) / sy;
    const rx = px * c - py * sn;
    const ry = px * sn + py * c;
    return { x: rx + cx - (d.shiftX || 0), y: ry + cy - (d.shiftY || 0) };
  }

  function sectionMatrix(THREE, section) {
    const t = section.transform || {};
    const euler = new THREE.Euler(
      ((t.rx || 0) * Math.PI) / 180,
      ((t.ry || 0) * Math.PI) / 180,
      ((t.rz || 0) * Math.PI) / 180,
      "XYZ"
    );
    const q = new THREE.Quaternion().setFromEuler(euler);
    const us = Math.max(0.05, Number(t.scale) || 1);
    const sx = Math.max(0.05, Number(t.sx) || 1);
    const sy = Math.max(0.05, Number(t.sy) || 1);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
    const pos = new THREE.Vector3(t.x || 0, t.y || 0, t.z || 0).addScaledVector(
      normal,
      Number(section.offset) || 0
    );
    return new THREE.Matrix4().compose(pos, q, new THREE.Vector3(us * sx, us * sy, us));
  }

  function sectionPlacement(THREE, section) {
    const t = section.transform || {};
    const euler = new THREE.Euler(
      ((t.rx || 0) * Math.PI) / 180,
      ((t.ry || 0) * Math.PI) / 180,
      ((t.rz || 0) * Math.PI) / 180,
      "XYZ"
    );
    const q = new THREE.Quaternion().setFromEuler(euler);
    const us = Math.max(0.05, Number(t.scale) || 1);
    const sx = Math.max(0.05, Number(t.sx) || 1);
    const sy = Math.max(0.05, Number(t.sy) || 1);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
    const pos = new THREE.Vector3(t.x || 0, t.y || 0, t.z || 0).addScaledVector(
      normal,
      Number(section.offset) || 0
    );
    return {
      position: pos,
      quaternion: q,
      scale: new THREE.Vector3(us * sx, us * sy, us),
      normal,
    };
  }

  function evaluateSection(THREE, section, width, height) {
    const local = deformLocal(section, width, height);
    const matrix = sectionMatrix(THREE, section);
    const e = matrix.elements;
    const tmp = [0, 0, 0];
    const nodes = {};
    for (const node of local) {
      applyMat4(e, node.x, node.y, node.z || 0, tmp);
      nodes[node.id] = { x: tmp[0], y: tmp[1], z: tmp[2] };
    }
    const xAxis = new THREE.Vector3(1, 0, 0).transformDirection(matrix).normalize();
    const yAxis = new THREE.Vector3(0, 1, 0).transformDirection(matrix).normalize();
    const zAxis = new THREE.Vector3(0, 0, 1).transformDirection(matrix).normalize();
    return { nodes, xAxis, yAxis, zAxis, local };
  }

  function lerpEval(a, b, t) {
    const nodes = {};
    for (const id of Object.keys(a.nodes)) {
      const pa = a.nodes[id];
      const pb = b.nodes[id];
      if (!pa || !pb) continue;
      nodes[id] = {
        x: lerp(pa.x, pb.x, t),
        y: lerp(pa.y, pb.y, t),
        z: lerp(pa.z, pb.z, t),
      };
    }
    const zAxis = a.zAxis.clone().lerp(b.zAxis, t).normalize();
    let xAxis = a.xAxis.clone().lerp(b.xAxis, t);
    if (xAxis.lengthSq() < 1e-8) xAxis = a.xAxis.clone();
    xAxis.normalize();
    const yAxis = zAxis.clone().cross(xAxis).normalize();
    xAxis = yAxis.clone().cross(zAxis).normalize();
    return { nodes, xAxis, yAxis, zAxis };
  }

  function samplePath(THREE, sections, width, height, style, extraSteps) {
    const evaluated = sections.map((section) => evaluateSection(THREE, section, width, height));
    const steps =
      extraSteps != null ? extraSteps : style === "smooth" ? 2 : 0;
    if (evaluated.length < 2 || steps < 1) return evaluated;
    const out = [];
    for (let i = 0; i < evaluated.length - 1; i++) {
      const a = evaluated[i];
      const b = evaluated[i + 1];
      for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
        out.push(lerpEval(a, b, style === "smooth" ? smoothstep(k / steps) : k / steps));
      }
    }
    return out;
  }

  function orderScale(order, useHierarchy) {
    if (!useHierarchy) return 1;
    const o = Number(order) || 1;
    if (o >= 3) return 0.46;
    if (o >= 2) return 0.7;
    return 1;
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

  function barCorners(A, B, normal, halfW, halfT) {
    let dx = B.x - A.x;
    let dy = B.y - A.y;
    let dz = B.z - A.z;
    const nx = normal.x;
    const ny = normal.y;
    const nz = normal.z;
    let wx = ny * dz - nz * dy;
    let wy = nz * dx - nx * dz;
    let wz = nx * dy - ny * dx;
    let wlen = Math.hypot(wx, wy, wz);
    if (wlen < 1e-8) {
      wx = 1;
      wy = 0;
      wz = 0;
      wlen = 1;
    }
    wx = (wx / wlen) * halfW;
    wy = (wy / wlen) * halfW;
    wz = (wz / wlen) * halfW;
    const tx = nx * halfT;
    const ty = ny * halfT;
    const tz = nz * halfT;
    function corner(P, sw, st) {
      return [P.x + wx * sw + tx * st, P.y + wy * sw + ty * st, P.z + wz * sw + tz * st];
    }
    return [
      corner(A, 1, 1),
      corner(A, -1, 1),
      corner(A, -1, -1),
      corner(A, 1, -1),
      corner(B, 1, 1),
      corner(B, -1, 1),
      corner(B, -1, -1),
      corner(B, 1, -1),
    ];
  }

  function stitchPrism(pos, nrm, a, b, capStart, capEnd) {
    if (capStart) {
      pushQuad(pos, nrm, a[0], a[1], a[2], a[3]);
      pushQuad(pos, nrm, a[4], a[7], a[6], a[5]);
    }
    if (capEnd) {
      pushQuad(pos, nrm, b[0], b[3], b[2], b[1]);
      pushQuad(pos, nrm, b[4], b[5], b[6], b[7]);
    }
    const pairs = [
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
    for (const [i, j] of pairs) {
      pushQuad(pos, nrm, a[i], a[j], b[j], b[i]);
    }
  }

  function clipPositions(positions) {
    let outside = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      if (x < 0 || x > CUBE || y < 0 || y > CUBE || z < 0 || z > CUBE) outside += 1;
      positions[i] = clamp(x, 0, CUBE);
      positions[i + 1] = clamp(y, 0, CUBE);
      positions[i + 2] = clamp(z, 0, CUBE);
    }
    return outside;
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

  function stitchBoxRun(positions, normals, boxes) {
    if (!boxes || boxes.length < 2) return false;
    for (let i = 0; i < boxes.length - 1; i++) {
      stitchPrism(positions, normals, boxes[i], boxes[i + 1], i === 0, i === boxes.length - 2);
    }
    return true;
  }

  function collectBarRuns(THREE, loftSet, params) {
    params = params || {};
    const empty = { ok: false, runs: [], capsules: [], skipped: 0, samples: [] };
    const sections = (loftSet && loftSet.sections) || [];
    const topology = loftSet && loftSet.topology;
    if (!THREE || sections.length < 2 || !topology || !topology.segments || !topology.segments.length) {
      return empty;
    }
    const width = loftSet.width;
    const height = loftSet.height;
    const style = params.style === "linear" ? "linear" : "smooth";
    const halfW0 = 0.04 + clamp(params.width, 0, 1) * 0.42;
    const halfT0 = 0.03 + clamp(params.thickness, 0, 1) * 0.38;
    const useHierarchy = !!params.useHierarchy;
    const extraSteps = params.draft ? 0 : params.steps != null ? params.steps : style === "smooth" ? 2 : 0;
    const samples = samplePath(THREE, sections, width, height, style, extraSteps);
    if (samples.length < 2) return empty;

    const runs = [];
    const capsules = [];
    let skipped = 0;

    for (const seg of topology.segments) {
      const hw = halfW0 * orderScale(seg.order, useHierarchy);
      const ht = halfT0 * orderScale(seg.order, useHierarchy);
      const radius = Math.max(hw, ht);
      const ia = seg.a != null ? seg.a : seg.startNodeId;
      const ib = seg.b != null ? seg.b : seg.endNodeId;
      let boxes = [];
      let formed = false;
      let prevA = null;
      let prevB = null;
      function flush() {
        if (boxes.length >= 2) {
          runs.push({ boxes: boxes.slice(), hw, ht });
          formed = true;
        }
        boxes = [];
        prevA = null;
        prevB = null;
      }
      for (const sample of samples) {
        const A = sample.nodes[ia];
        const B = sample.nodes[ib];
        if (!A || !B) {
          flush();
          continue;
        }
        if (Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z) < 1e-4) {
          flush();
          continue;
        }
        boxes.push(barCorners(A, B, sample.zAxis, hw, ht));
        capsules.push({
          ax: A.x,
          ay: A.y,
          az: A.z,
          bx: B.x,
          by: B.y,
          bz: B.z,
          radius,
        });
        if (prevA && prevB) {
          capsules.push({
            ax: prevA.x,
            ay: prevA.y,
            az: prevA.z,
            bx: A.x,
            by: A.y,
            bz: A.z,
            radius,
          });
          capsules.push({
            ax: prevB.x,
            ay: prevB.y,
            az: prevB.z,
            bx: B.x,
            by: B.y,
            bz: B.z,
            radius,
          });
        }
        prevA = A;
        prevB = B;
      }
      flush();
      if (!formed) skipped += 1;
    }

    return { ok: true, runs, capsules, skipped, samples, draft: !!params.draft };
  }

  function generate(THREE, loftSet, params) {
    const collected = collectBarRuns(THREE, loftSet, params);
    if (!collected.ok) {
      return { positions: [], normals: [], vertexCount: 0, triangleCount: 0, clipped: false, outside: 0, skipped: 0 };
    }

    const positions = [];
    const normals = [];
    for (const run of collected.runs) {
      stitchBoxRun(positions, normals, run.boxes);
    }

    const outside = clipPositions(positions);
    recomputeNormals(positions, normals);
    return {
      positions,
      normals,
      capsules: collected.capsules,
      vertexCount: positions.length / 3,
      triangleCount: positions.length / 9,
      clipped: outside > 0,
      outside,
      skipped: collected.skipped,
      draft: collected.draft,
    };
  }

  function generateSolidRuns(THREE, loftSet, params) {
    const collected = collectBarRuns(THREE, loftSet, params);
    if (!collected.ok) return { runs: [], skipped: 0 };
    return { runs: collected.runs, skipped: collected.skipped };
  }

  global.D7SpatialLoft = {
    CUBE,
    defaultDeform,
    copyTransform,
    topologyFromChunk,
    deformLocal,
    invertDeformPoint,
    sectionMatrix,
    sectionPlacement,
    evaluateSection,
    samplePath,
    generate,
    generateSolidRuns,
  };
})(window);

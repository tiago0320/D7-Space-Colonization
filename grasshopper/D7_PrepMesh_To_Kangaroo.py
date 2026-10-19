# coding: utf-8
"""D7 Grid Growth -- prep mesh to Kangaroo soap-film starter.

Open D7_Grasshopper_Package.3dm in Rhino first (units = Feet), then run this
from the accompanying .ghx or paste it into a Grasshopper Python component.

Grasshopper inputs (item access, all optional):
  run          1 = remesh + relax, 0 = read layers only
  rotate_zup   1 = rotate website Y-up mesh to Rhino Z-up (90 deg about X)
  target_len   remesh edge length in feet (0.5 is a good start)
  soap         Kangaroo SoapFilm strength
  pressure     Kangaroo Pressure strength (keep small)
  anchor_s     naked-vertex Anchor stiffness
  iters        solver iterations

Outputs:
  remesh       triangulated remesh
  relaxed      soap-film / laplacian result
  anchors      pinned naked vertices
  branches     curves from 01_SOURCE_BRANCHES
"""

from __future__ import division

import math

import Rhino
import Rhino.Geometry as rg
import System


LAYER_PREP = "03_PREP_MESH"
LAYER_BRANCHES = "01_SOURCE_BRANCHES"
LAYER_BOUNDARY = "04_MODULE_BOUNDARY"


def _num(value, default):
    if value is None:
        return default
    try:
        return float(value)
    except Exception:
        return default


def _int(value, default):
    return int(round(_num(value, default)))


def _on(value):
    n = _num(value, 0.0)
    return n > 0.5


def _layer_index(doc, name):
    if doc is None:
        return -1
    i = doc.Layers.FindByFullPath(name, -1)
    if i >= 0:
        return i
    for layer in doc.Layers:
        if layer.Name == name or layer.FullPath == name:
            return layer.Index
    return -1


def _geom_on_layer(doc, name, geom_type):
    found = []
    if doc is None:
        return found
    idx = _layer_index(doc, name)
    if idx < 0:
        return found
    for obj in doc.Objects:
        if obj is None or obj.Attributes is None:
            continue
        if obj.Attributes.LayerIndex != idx:
            continue
        g = obj.Geometry
        if g is None:
            continue
        if isinstance(g, geom_type):
            found.append(g)
        elif isinstance(g, rg.InstanceReferenceGeometry):
            continue
        elif hasattr(g, "DuplicateMesh") and geom_type is rg.Mesh:
            try:
                m = g.DuplicateMesh()
                if m is not None:
                    found.append(m)
            except Exception:
                pass
    return found


def _meshes_on_layer(doc, name):
    meshes = []
    if doc is None:
        return meshes
    idx = _layer_index(doc, name)
    if idx < 0:
        return meshes
    for obj in doc.Objects:
        if obj is None or obj.Attributes is None:
            continue
        if obj.Attributes.LayerIndex != idx:
            continue
        g = obj.Geometry
        if g is None:
            continue
        if isinstance(g, rg.Mesh):
            meshes.append(g.DuplicateMesh())
        elif isinstance(g, rg.Brep):
            brep_meshes = rg.Mesh.CreateFromBrep(g, rg.MeshingParameters.Default)
            if brep_meshes:
                for m in brep_meshes:
                    meshes.append(m)
        elif isinstance(g, rg.Extrusion):
            brep = g.ToBrep()
            if brep:
                brep_meshes = rg.Mesh.CreateFromBrep(brep, rg.MeshingParameters.Default)
                if brep_meshes:
                    for m in brep_meshes:
                        meshes.append(m)
    return meshes


def _curves_on_layer(doc, name):
    curves = []
    if doc is None:
        return curves
    idx = _layer_index(doc, name)
    if idx < 0:
        return curves
    for obj in doc.Objects:
        if obj is None or obj.Attributes is None:
            continue
        if obj.Attributes.LayerIndex != idx:
            continue
        g = obj.Geometry
        if isinstance(g, rg.Curve):
            curves.append(g.DuplicateCurve())
        elif isinstance(g, rg.LineCurve):
            curves.append(g.DuplicateCurve())
        elif isinstance(g, rg.PolylineCurve):
            curves.append(g.DuplicateCurve())
        elif isinstance(g, rg.NurbsCurve):
            curves.append(g.DuplicateCurve())
    return curves


def _join_meshes(meshes):
    usable = [m for m in meshes if m is not None and m.Vertices.Count > 0]
    if not usable:
        return None
    if len(usable) == 1:
        return usable[0]
    joined = rg.Mesh()
    for m in usable:
        joined.Append(m)
    joined.Weld(math.pi)
    joined.Compact()
    return joined


def _rotate_yup_to_zup(geom):
    xf = rg.Transform.Rotation(math.pi * 0.5, rg.Vector3d.XAxis, rg.Point3d.Origin)
    dup = geom.Duplicate()
    dup.Transform(xf)
    return dup


def _bbox_of(geoms):
    box = rg.BoundingBox.Empty
    for g in geoms:
        if g is None:
            continue
        box.Union(g.GetBoundingBox(True))
    return box


def _remesh(mesh, target_len):
    m = mesh.DuplicateMesh()
    m.Faces.ConvertQuadsToTriangles()
    m.Weld(math.pi)
    m.Compact()
    edge = max(0.15, float(target_len))
    amp = rg.AreaMassProperties.Compute(m)
    area = amp.Area if amp is not None else 1.0
    tri_area = 0.43301270189 * edge * edge
    count = int(area / max(tri_area, 1e-6))
    if count < 200:
        count = 200
    if count > 8000:
        count = 8000
    remeshed = None
    try:
        qp = rg.QuadRemeshParameters()
        qp.TargetQuadCount = count
        qp.AdaptiveQuadCount = True
        qp.AdaptiveSize = 50
        qp.DetectHardEdges = False
        remeshed = m.QuadRemesh(qp)
    except Exception:
        remeshed = None
    if remeshed is None:
        remeshed = m
    remeshed.Faces.ConvertQuadsToTriangles()
    remeshed.Weld(math.pi)
    remeshed.Compact()
    remeshed.Normals.ComputeNormals()
    remeshed.UnifyNormals()
    remeshed.FaceNormals.ComputeFaceNormals()
    return remeshed


def _naked_indices(mesh):
    flags = mesh.GetNakedEdgePointStatus()
    idx = []
    if flags is None:
        return idx
    for i in range(flags.Length):
        if flags[i]:
            idx.append(i)
    return idx


def _load_kangaroo():
    try:
        import clr
        clr.AddReference("KangarooSolver")
        import KangarooSolver
        return KangarooSolver
    except Exception:
        return None


def _goal(ctor, *args):
    try:
        return ctor(*args)
    except Exception:
        return None


def _kangaroo_relax(mesh, naked_idx, soap, pressure, anchor_s, iters):
    ks = _load_kangaroo()
    if ks is None:
        return None, "Kangaroo2 not found -- using Laplacian fallback"
    goals = []
    verts = [rg.Point3d(mesh.Vertices[i]) for i in range(mesh.Vertices.Count)]
    soap_cls = getattr(ks.Goals, "SoapFilm", None)
    press_cls = getattr(ks.Goals, "Pressure", None)
    anchor_cls = getattr(ks.Goals, "Anchor", None)
    if soap_cls is None or anchor_cls is None:
        return None, "Kangaroo2 Goals.SoapFilm / Anchor missing -- using Laplacian"

    for i in naked_idx:
        g = _goal(anchor_cls, verts[i], float(anchor_s))
        if g is not None:
            goals.append(g)

    for fi in range(mesh.Faces.Count):
        face = mesh.Faces.GetFace(fi)
        a = verts[face.A]
        b = verts[face.B]
        c = verts[face.C]
        pts = System.Array[rg.Point3d]([a, b, c])
        g = _goal(soap_cls, pts, float(soap))
        if g is None:
            g = _goal(soap_cls, a, b, c, float(soap))
        if g is not None:
            goals.append(g)
        if pressure > 1e-8 and press_cls is not None:
            p = _goal(press_cls, pts, float(pressure))
            if p is None:
                p = _goal(press_cls, a, b, c, float(pressure))
            if p is not None:
                goals.append(p)

    if len(goals) == 0:
        return None, "No Kangaroo goals built -- using Laplacian"

    system = ks.PhysicalSystem()
    for g in goals:
        system.AssignPIndex(g, 0.0001)

    n = max(1, int(iters))
    for _step in range(n):
        try:
            system.Step(goals, True, 0.1)
        except TypeError:
            system.Step(True)

    positions = None
    try:
        positions = list(system.GetPositions())
    except Exception:
        try:
            positions = list(system.GetPositionArray())
        except Exception:
            positions = None
    if positions is None or len(positions) < 3:
        return None, "Kangaroo returned no positions -- using Laplacian"

    out = mesh.DuplicateMesh()
    count = min(out.Vertices.Count, len(positions))
    for i in range(count):
        out.Vertices.SetVertex(i, positions[i])
    out.Vertices.CullUnused()
    out.Compact()
    out.Normals.ComputeNormals()
    out.UnifyNormals()
    return out, "Kangaroo2 SoapFilm + Anchor + Pressure (%d iterations)" % n


def _laplacian(mesh, naked_idx, iters, strength):
    out = mesh.DuplicateMesh()
    pin = set(naked_idx)
    nvert = out.Vertices.Count
    steps = max(1, int(iters))
    t = min(1.0, max(0.05, float(strength)))
    for _step in range(steps):
        nxt = [rg.Point3d(out.Vertices[i]) for i in range(nvert)]
        for i in range(nvert):
            if i in pin:
                continue
            nbrs = out.Vertices.GetConnectedVertices(i)
            if nbrs is None or nbrs.Length == 0:
                continue
            sx = 0.0
            sy = 0.0
            sz = 0.0
            for n in nbrs:
                p = out.Vertices[n]
                sx += p.X
                sy += p.Y
                sz += p.Z
            c = float(nbrs.Length)
            avg = rg.Point3d(sx / c, sy / c, sz / c)
            cur = rg.Point3d(out.Vertices[i])
            nxt[i] = cur + (avg - cur) * t
        for i in range(nvert):
            out.Vertices.SetVertex(i, nxt[i])
    out.Normals.ComputeNormals()
    out.UnifyNormals()
    out.Compact()
    return out


def _clamp_to_box(mesh, box, amount):
    if not box.IsValid:
        return mesh
    out = mesh.DuplicateMesh()
    pad = max(0.0, float(amount))
    xmin = box.Min.X - pad
    ymin = box.Min.Y - pad
    zmin = box.Min.Z - pad
    xmax = box.Max.X + pad
    ymax = box.Max.Y + pad
    zmax = box.Max.Z + pad
    for i in range(out.Vertices.Count):
        p = out.Vertices[i]
        x = min(max(p.X, xmin), xmax)
        y = min(max(p.Y, ymin), ymax)
        z = min(max(p.Z, zmin), zmax)
        out.Vertices.SetVertex(i, x, y, z)
    out.Normals.ComputeNormals()
    return out


def run_d7(
    run=1,
    rotate_zup=1,
    target_len=0.5,
    soap=1.0,
    pressure=0.25,
    anchor_s=10000.0,
    iters=40,
):
    notes = []
    remesh = None
    relaxed = None
    anchors = []
    branches = []

    doc = Rhino.RhinoDoc.ActiveDoc
    if doc is None:
        notes.append("No active Rhino document. Open D7_Grasshopper_Package.3dm first.")
        return remesh, relaxed, anchors, branches, notes

    notes.append("Document: %s" % (doc.Name or "(unsaved)"))
    notes.append("Units must be Feet. Layers: %s / %s / %s" % (LAYER_PREP, LAYER_BRANCHES, LAYER_BOUNDARY))

    meshes = _meshes_on_layer(doc, LAYER_PREP)
    branches = _curves_on_layer(doc, LAYER_BRANCHES)
    boundary = _meshes_on_layer(doc, LAYER_BOUNDARY)
    if len(boundary) == 0:
        breps = _geom_on_layer(doc, LAYER_BOUNDARY, rg.Brep)
        for b in breps:
            mm = rg.Mesh.CreateFromBrep(b, rg.MeshingParameters.Default)
            if mm:
                boundary.extend(list(mm))

    if _on(rotate_zup):
        meshes = [_rotate_yup_to_zup(m) for m in meshes]
        branches = [_rotate_yup_to_zup(c) for c in branches]
        boundary = [_rotate_yup_to_zup(m) for m in boundary]
        notes.append("Rotated 90 deg about X (website Y-up -> Rhino Z-up)")

    joined = _join_meshes(meshes)
    if joined is None:
        notes.append("No mesh on layer %s. Export Grasshopper Package from the website, then open that 3DM." % LAYER_PREP)
        return remesh, relaxed, anchors, branches, notes

    notes.append("Prep mesh: %d vertices, %d faces" % (joined.Vertices.Count, joined.Faces.Count))

    remesh = _remesh(joined, _num(target_len, 0.5))
    notes.append("Remesh: %d vertices, %d faces (target_len=%.2f ft)" % (remesh.Vertices.Count, remesh.Faces.Count, _num(target_len, 0.5)))

    naked = _naked_indices(remesh)
    anchors = [rg.Point3d(remesh.Vertices[i]) for i in naked]
    notes.append("Naked vertices anchored: %d" % len(anchors))

    box = _bbox_of(boundary) if len(boundary) else remesh.GetBoundingBox(True)

    if not _on(run):
        notes.append("run=0 -- remesh only. Set run=1 to relax.")
        relaxed = remesh
        return remesh, relaxed, anchors, branches, notes

    relaxed, method = _kangaroo_relax(
        remesh,
        naked,
        _num(soap, 1.0),
        _num(pressure, 0.25),
        _num(anchor_s, 10000.0),
        _int(iters, 40),
    )
    notes.append(method)
    if relaxed is None:
        relaxed = _laplacian(remesh, naked, _int(iters, 40), 0.45)
        notes.append("Laplacian smooth with pinned naked vertices")

    relaxed = _clamp_to_box(relaxed, box, 0.0)
    notes.append("Clamped vertices to 04_MODULE_BOUNDARY bbox")
    relaxed.FaceNormals.ComputeFaceNormals()
    relaxed.Normals.ComputeNormals()
    return remesh, relaxed, anchors, branches, notes


# Grasshopper / paste-in entry. Missing names fall back to defaults.
try:
    _run = run
except NameError:
    _run = 1
try:
    _rotate = rotate_zup
except NameError:
    _rotate = 1
try:
    _len = target_len
except NameError:
    _len = 0.5
try:
    _soap = soap
except NameError:
    _soap = 1.0
try:
    _pressure = pressure
except NameError:
    _pressure = 0.25
try:
    _anchor = anchor_s
except NameError:
    _anchor = 10000.0
try:
    _iters = iters
except NameError:
    _iters = 40

remesh, relaxed, anchors, branches, _notes = run_d7(
    _run, _rotate, _len, _soap, _pressure, _anchor, _iters
)
info = "\n".join(_notes)
print(info)

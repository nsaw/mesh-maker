#! python 2
# Executes, inside Rhino, the claims the references make that reflection cannot prove:
# out-parameter return shapes, transform order, GetOutlines on a real mesh, headless docs,
# ghcomp function names. Run with scripts/rhino-run.sh. Writes JSON, then exits ITS OWN Rhino.
# NEVER run this through -_RunPythonScript in Nick's open session: the last line exits Rhino
# without saving. Not yet executed as of 2026-11-10 (see rhino-mac-execution-and-mesh.md).
import json, traceback
import os
OUT = os.environ.get("RHINO_PROBE_OUT") or os.path.expanduser("~/rhino-probe-out.json")
r = {}
def step(name, fn):
    try: r[name] = fn()
    except Exception: r[name] = 'ERROR ' + traceback.format_exc().splitlines()[-1]
try:
    import Rhino, clr, System, sys
    import Rhino.Geometry as rg
    from Rhino.Geometry.Intersect import Intersection
    r['version'] = str(Rhino.RhinoApp.Version); r['ipy'] = sys.version.split()[0]
    sph = rg.Mesh.CreateFromSphere(rg.Sphere(rg.Point3d(0,0,0), 2.0), 24, 24)
    def outlines():
        o = sph.GetOutlines(rg.Plane.WorldXY)
        return dict(count=len(o), closed=[bool(p.IsClosed) for p in o], pts=[p.Count for p in o],
                    bbox=[round(v,3) for v in (o[0].BoundingBox.Min.X, o[0].BoundingBox.Max.X, o[0].BoundingBox.Min.Y, o[0].BoundingBox.Max.Y)])
    step('GetOutlines_sphere_r2', outlines)
    step('mesh_checks', lambda: dict(closed=bool(sph.IsClosed), manifold=[bool(x) for x in sph.IsManifold(True)], naked=(None if sph.GetNakedEdges() is None else len(sph.GetNakedEdges())), volume=round(sph.Volume(),3), unify=sph.UnifyNormals()))
    line = rg.Line(rg.Point3d(0,0,-5), rg.Point3d(0.1,0.1,5))
    def meshline():
        ids = clr.Reference[System.Array[int]]()
        pts = Intersection.MeshLine(sph, line, ids)
        return dict(points=len(pts), face_ids=list(ids.Value))
    step('MeshLine_clr_Reference', meshline)
    step('MeshLine_2arg_type', lambda: type(Intersection.MeshLine(sph, line)).__name__)
    step('ClosestPoint_2arg', lambda: [type(x).__name__ for x in sph.ClosestPoint(rg.Point3d(5,0,0), 0.0)])
    step('ClosestPoint_1arg', lambda: type(sph.ClosestPoint(rg.Point3d(5,0,0))).__name__)
    step('transform_order', lambda: [round(v,3) for v in (lambda p: (p.X,p.Y,p.Z))((rg.Transform.Rotation(1.5707963267948966, rg.Vector3d.ZAxis, rg.Point3d.Origin) * rg.Transform.Translation(1,0,0)) * rg.Point3d(0,0,0))])
    step('Line_Direction_len', lambda: round(rg.Line(rg.Point3d(0,0,0), rg.Point3d(3,4,0)).Direction.Length,3))
    def counter():
        from collections import Counter
        return dict(Counter('aab'))
    step('Counter', counter)
    step('CreateHeadless', lambda: (lambda d: (d is not None, d.Dispose() if d else None)[0])(Rhino.RhinoDoc.CreateHeadless(None)))
    def crvbrep():
        b = rg.Sphere(rg.Point3d(0,0,0), 2.0).ToBrep(); c = rg.LineCurve(rg.Point3d(0,0,-5), rg.Point3d(0,0,5))
        res = Intersection.CurveBrep(c, b, 0.001)
        return [type(x).__name__ for x in res] if isinstance(res, tuple) else type(res).__name__
    step('CurveBrep_3arg', crvbrep)
    step('RemapToPlaneSpace', lambda: [type(x).__name__ for x in rg.Plane.WorldXY.RemapToPlaneSpace(rg.Point3d(1,2,3))])
    step('CapPlanarHoles_returns', lambda: type(rg.Cylinder(rg.Circle(rg.Plane.WorldXY, 1.0), 2.0).ToBrep(False, False).CapPlanarHoles(0.001)).__name__)
    def gh():
        import ghpythonlib.components as g
        return dict((n, hasattr(g, n)) for n in ('BrepXBrep','BrepBrep','RemapNumbers','Remap','Isotrim','IsoTrim','DeconstructBrep','trees'))
    step('ghcomp_names', gh)
except Exception:
    r['fatal'] = traceback.format_exc()
try:
    text = json.dumps(r, indent=1, default=repr)
except Exception:
    text = repr(r) + '\nJSON-ERROR ' + traceback.format_exc()
f = open(OUT, 'w'); f.write(text); f.close()
try:
    import Rhino
    Rhino.RhinoApp.RunScript("_-Exit _No", False)
except Exception: pass

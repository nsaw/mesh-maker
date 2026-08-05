# rhinoscriptsyntax (rs) API Reference

## Overview
`rhinoscriptsyntax` wraps RhinoCommon into simple procedural functions. Functions typically return GUIDs (object references in the active document) rather than geometry objects. Import as:

```python
import rhinoscriptsyntax as rs
```

**Key concept:** rs functions operate on `scriptcontext.doc`. In Grasshopper, set `sc.doc = ghdoc` for Grasshopper operations or `sc.doc = Rhino.RhinoDoc.ActiveDoc` for Rhino document operations.

---

## Type Coercion Functions

These convert between GUIDs, geometry objects, and other types. Essential when mixing rs with RhinoCommon.

```python
rs.coerce3dpoint(input)          # convert to Point3d
rs.coerce3dvector(input)         # convert to Vector3d
rs.coerceplane(input)            # convert to Plane
rs.coercecurve(input, segment)   # GUID -> Curve geometry
rs.coercesurface(input)          # GUID -> Surface geometry
rs.coercebrep(input)             # GUID -> Brep geometry
rs.coercemesh(input)             # GUID -> Mesh geometry
rs.coerceline(input)             # convert to Line
rs.coerceguid(input)             # convert to System.Guid
rs.coercegeometry(input)         # GUID -> GeometryBase
```

---

## Point and Vector Operations

```python
# Creation
pt_id = rs.AddPoint(x, y, z)
pt_id = rs.AddPoint(point3d)
pts = rs.AddPoints(point_list)

# Math
rs.PointAdd(pt, vec_or_pt)
rs.PointSubtract(pt1, pt2)       # returns vector
rs.PointScale(pt, scale)
rs.PointDivide(pt, divisor)
rs.PointCompare(pt1, pt2, tol)   # True if within tolerance
rs.Distance(pt1, pt2)

# Vectors
rs.VectorAdd(v1, v2)
rs.VectorSubtract(v1, v2)
rs.VectorScale(vec, scale)
rs.VectorLength(vec)
rs.VectorUnitize(vec)
rs.VectorReverse(vec)
rs.VectorRotate(vec, angle_deg, axis)
rs.VectorCrossProduct(v1, v2)
rs.VectorDotProduct(v1, v2)
rs.VectorAngle(v1, v2)

# Coordinate transforms
rs.PointClosestObject(pt, objects)  # nearest object
rs.ProjectPointToSurface(pts, srfs, direction)
rs.ProjectPointToMesh(pts, meshes, direction)
```

---

## Curve Functions

```python
# Creation
rs.AddLine(start, end)
rs.AddPolyline(points)
rs.AddCircle(center_or_plane, radius)
rs.AddArc3Pt(start, end, pt_on_arc)
rs.AddArcPtTanPt(start, direction, end)
rs.AddEllipse(plane, rx, ry)
rs.AddCurve(points, degree)       # NURBS through points
rs.AddInterpCurve(points, degree, knotstyle, start_tan, end_tan)
rs.AddNurbsCurve(points, knots, degree, weights)
rs.AddFilletCurve(crv0, crv1, radius, pt0, pt1)
rs.AddRectangle(plane, width, height)

# Properties
rs.CurveLength(crv_id)
rs.CurveDegree(crv_id)
rs.CurveDomain(crv_id)           # [start, end] parameters
rs.IsCurveClosed(crv_id)
rs.IsCurvePlanar(crv_id)
rs.IsCurveLinear(crv_id)
rs.CurveStartPoint(crv_id)
rs.CurveEndPoint(crv_id)
rs.CurveMidPoint(crv_id)

# Evaluation
rs.EvaluateCurve(crv_id, param)  # Point3d at parameter
rs.CurveTangent(crv_id, param)
rs.CurveCurvature(crv_id, param)
rs.CurveClosestPoint(crv_id, pt)
rs.CurveFrame(crv_id, param)     # Plane at parameter

# Division
rs.DivideCurve(crv_id, segments, create_pts, return_pts)
rs.DivideCurveLength(crv_id, length, create_pts, return_pts)
rs.DivideCurveEquidistant(crv_id, distance, create_pts, return_pts)

# Modification
rs.ReverseCurve(crv_id)
rs.CloseCurve(crv_id)
rs.OffsetCurve(crv_id, direction, distance)
rs.ExtendCurve(crv_id, extension_type, side, boundary)
rs.TrimCurve(crv_id, interval)
rs.SplitCurve(crv_id, params)
rs.JoinCurves(crv_ids, delete)
rs.RebuildCurve(crv_id, degree, point_count)
rs.SimplifyCurve(crv_id)
rs.ExplodeCurves(crv_ids, delete)

# Boolean (2D, planar curves)
rs.CurveBooleanUnion(crv_ids)
rs.CurveBooleanDifference(crv_a, crv_b)
rs.CurveBooleanIntersection(crv_a, crv_b)
```

---

## Surface Functions

```python
# Creation
rs.AddPlanarSrf(curves)
rs.AddSrfPt(points)              # 3 or 4 point surface
rs.AddLoftSrf(curves, start, end, loft_type, simplify, value, closed)
rs.AddSweep1(rail, shapes, closed)
rs.AddSweep2(rails, shapes, closed)
rs.AddRevSrf(curve, axis, start_angle, end_angle)
rs.AddPipe(curve, parameters, radii, blend, cap, fit)
rs.AddPatch(object_ids, uv_spans, tolerance)
rs.AddEdgeSrf(curve_ids)
rs.ExtrudeCurve(curve_id, path_id)
rs.ExtrudeCurveStraight(curve_id, start_pt, end_pt)
rs.ExtrudeSurface(surface_id, curve_id, cap)

# Primitives
rs.AddSphere(center_or_plane, radius)
rs.AddCylinder(base, height, radius, cap)
rs.AddCone(base, height, radius, cap)
rs.AddTorus(base, major_radius, minor_radius)
rs.AddBox(corners)

# Properties
rs.SurfaceArea(srf_id)
rs.SurfaceAreaCentroid(srf_id)
rs.SurfaceVolume(srf_id)         # closed surfaces only
rs.SurfaceDomain(srf_id, direction)
rs.SurfaceNormal(srf_id, uv)
rs.SurfaceFrame(srf_id, uv)
rs.IsSurfaceClosed(srf_id, direction)
rs.IsSurfacePlanar(srf_id)
rs.IsSurfaceTrimmed(srf_id)

# Evaluation
rs.EvaluateSurface(srf_id, u, v)
rs.SurfaceClosestPoint(srf_id, pt)
rs.SurfaceCurvature(srf_id, uv)

# Modification
rs.OffsetSurface(srf_id, distance, tolerance, both_sides, create_solid)
rs.RebuildSurface(srf_id, degree, point_count)
rs.ShrinkTrimmedSurface(srf_id)
rs.FlipSurface(srf_id, flip)
rs.SplitBrep(brep_id, cutter_id, delete)
rs.TrimBrep(brep_id, cutter_id, curve_id)

# Boolean (3D)
rs.BooleanUnion(brep_ids, delete)
rs.BooleanDifference(input0, input1, delete)
rs.BooleanIntersection(input0, input1, delete)
```

---

## Mesh Functions

```python
# Creation
rs.AddMesh(vertices, face_vertices, vertex_normals, texture_coords, vertex_colors)
rs.MeshFromSurface(surface_id)

# Properties
rs.MeshVertices(mesh_id)
rs.MeshFaces(mesh_id, as_vertices)
rs.MeshFaceNormals(mesh_id)
rs.MeshVertexNormals(mesh_id)
rs.MeshFaceCount(mesh_id)
rs.MeshVertexCount(mesh_id)
rs.MeshArea(mesh_id)
rs.MeshVolume(mesh_id)
rs.IsMeshClosed(mesh_id)

# Boolean
rs.MeshBooleanUnion(mesh_ids)
rs.MeshBooleanDifference(input0, input1)
rs.MeshBooleanIntersection(input0, input1)
rs.MeshBooleanSplit(input0, input1)

# Modification
rs.ExplodeMeshes(mesh_ids, delete)
rs.MeshOffset(mesh_id, distance)
```

---

## Object Manipulation

```python
# Transformations (operate on GUIDs)
rs.MoveObject(obj_id, translation)
rs.MoveObjects(obj_ids, translation)
rs.CopyObject(obj_id, translation)
rs.CopyObjects(obj_ids, translation)
rs.RotateObject(obj_id, center, angle_deg, axis, copy)
rs.ScaleObject(obj_id, origin, scale, copy)
rs.MirrorObject(obj_id, start_pt, end_pt, copy)
rs.OrientObject(obj_id, reference, target, flags)

# Selection
rs.GetObject(message, filter, preselect, select, custom_filter)
rs.GetObjects(message, filter, group, preselect, select, min, max)
rs.GetCurveObject(message)       # returns (id, preselect, selection_method, pick_point, edge_index)
rs.GetSurfaceObject(message)
rs.GetMeshFace(mesh_id)
rs.SelectedObjects()
rs.SelectObject(obj_id)
rs.UnselectAllObjects()

# Properties
rs.ObjectName(obj_id, name)      # get/set name
rs.ObjectLayer(obj_id, layer)    # get/set layer
rs.ObjectColor(obj_id, color)    # get/set color
rs.ObjectMaterialIndex(obj_id)   # material index
rs.ObjectDescription(obj_id)     # object type description
rs.IsObject(obj_id)
rs.IsObjectHidden(obj_id)
rs.IsObjectLocked(obj_id)
rs.IsObjectInGroup(obj_id, group)

# Visibility
rs.ShowObject(obj_id)
rs.HideObject(obj_id)
rs.LockObject(obj_id)
rs.UnlockObject(obj_id)

# Deletion
rs.DeleteObject(obj_id)
rs.DeleteObjects(obj_ids)
```

---

## Layers

```python
rs.AddLayer(name, color, visible, locked, parent)
rs.DeleteLayer(name)
rs.CurrentLayer(name)            # get/set current layer
rs.LayerCount()
rs.LayerNames()
rs.LayerColor(name, color)       # get/set color
rs.LayerVisible(name, visible)   # get/set visibility
rs.LayerLocked(name, locked)
rs.ObjectsByLayer(name, select)
rs.IsLayer(name)
rs.IsLayerEmpty(name)
rs.IsLayerVisible(name)
rs.ParentLayer(name)
rs.LayerChildCount(name)
```

---

## Document and View

```python
# Units and tolerances
rs.UnitSystem(unit_system)       # get/set
rs.UnitAbsoluteTolerance(tol)    # get/set
rs.UnitAngleTolerance(tol)
rs.UnitDistanceDisplayPrecision(precision)

# Views
rs.CurrentView(view_name)
rs.ViewNames()
rs.ZoomExtents(view, all_views)
rs.ZoomSelected()
rs.Redraw()
rs.EnableRedraw(enable)          # IMPORTANT: disable during batch ops for speed

# Document info
rs.DocumentName()
rs.DocumentPath()
```

---

## Utility Functions

```python
# Input
rs.GetString(message, default, strings)
rs.GetReal(message, default, min, max)
rs.GetInteger(message, default, min, max)
rs.GetPoint(message, base_point)
rs.GetPoints(draw_lines, in_plane, message1, message2, max_count, base_point)

# Output
rs.MessageBox(message, buttons, title)
rs.TextOut(message, title)

# Math
rs.Angle(pt1, pt2)
rs.Angle2(line1, line2)
rs.Distance(pt1, pt2)
rs.XformIdentity()
rs.XformTranslation(vector)
rs.XformRotation1(angle, axis, point)
rs.XformScale(scale)
rs.XformMirror(mirror_plane_point, mirror_plane_normal)
```

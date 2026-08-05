# RhinoCommon Geometry Reference (Rhino 7)

## Table of Contents
1. [Primitives and Value Types](#primitives)
2. [Curves](#curves)
3. [Surfaces](#surfaces)
4. [Breps](#breps)
5. [Meshes](#meshes)
6. [Transforms](#transforms)
7. [Intersections](#intersections)
8. [Bounding Boxes and Planes](#bounding-boxes-and-planes)

---

## Primitives

### Point3d (struct)
```python
import Rhino.Geometry as rg

pt = rg.Point3d(x, y, z)
pt.X, pt.Y, pt.Z              # coordinate access
pt.DistanceTo(other_pt)        # distance between points
rg.Point3d.Origin              # (0, 0, 0)
rg.Point3d.Unset               # sentinel for "no point"
pt + vec                       # point + vector = point
pt - other_pt                  # point - point = vector
```

### Vector3d (struct)
```python
vec = rg.Vector3d(x, y, z)
vec.Length                      # magnitude
vec.Unitize()                   # normalize in place, returns True/False
vec.IsZero                      # check for zero vector
vec.Reverse()                   # flip direction in place
rg.Vector3d.XAxis               # (1, 0, 0)
rg.Vector3d.YAxis               # (0, 1, 0)
rg.Vector3d.ZAxis               # (0, 0, 1)
rg.Vector3d.CrossProduct(a, b)  # cross product (static)
a * b                           # dot product (operator overload)
vec * scalar                    # scale vector
```

### Plane
```python
plane = rg.Plane(origin_pt, normal_vec)
plane = rg.Plane(origin, x_axis, y_axis)
rg.Plane.WorldXY                # Z-up world plane
rg.Plane.WorldYZ
rg.Plane.WorldZX
plane.Origin                    # origin point
plane.Normal                    # normal vector
plane.XAxis, plane.YAxis        # basis vectors
plane.ClosestPoint(pt)          # project point onto plane
plane.DistanceTo(pt)            # signed distance
plane.RemapToPlaneSpace(pt)     # convert world pt to plane coordinates
```

### Line (struct)
```python
line = rg.Line(pt_from, pt_to)
line = rg.Line(pt_from, direction, length)
line.From, line.To              # endpoints
line.Length                      # length
line.Direction                   # unit direction vector
line.PointAt(t)                  # parameter 0.0 = From, 1.0 = To
line.ClosestPoint(pt, limited)   # nearest point on line
line.DistanceTo(pt, limited)     # distance from point
line.ToNurbsCurve()              # convert to NurbsCurve
```

### Circle (struct)
```python
circle = rg.Circle(plane, radius)
circle = rg.Circle(pt1, pt2, pt3)     # through 3 points
circle.Center                           # center point
circle.Radius                           # radius
circle.Normal                           # normal vector
circle.Plane                            # construction plane
circle.PointAt(t)                       # 0.0 to 2*pi
circle.ToNurbsCurve()                   # convert to NurbsCurve
circle.ClosestPoint(pt)                 # nearest point
```

### Arc (struct)
```python
arc = rg.Arc(circle, angle_radians)
arc = rg.Arc(pt_start, pt_interior, pt_end)
arc.Center, arc.Radius
arc.Angle                               # sweep angle in radians
arc.StartPoint, arc.EndPoint, arc.MidPoint
arc.ToNurbsCurve()
```

### Sphere, Cylinder, Cone, Torus (structs)
```python
sphere = rg.Sphere(center_pt, radius)
cylinder = rg.Cylinder(circle, height)
cone = rg.Cone(plane, height, radius)
torus = rg.Torus(plane, major_radius, minor_radius)

# All have .ToBrep() or .ToRevSurface() for conversion
brep = sphere.ToBrep()
```

---

## Curves

### Curve Base Class
All curve types inherit from `Rhino.Geometry.Curve`. Key methods:

```python
crv.Domain                      # Interval(start, end) parameter range
crv.PointAtStart, crv.PointAtEnd
crv.PointAt(t)                  # evaluate at parameter
crv.TangentAt(t)                # tangent vector at parameter
crv.CurvatureAt(t)              # curvature vector
crv.FrameAt(t)                  # full frame (plane) at parameter
crv.GetLength()                 # total arc length
crv.IsClosed                    # True if closed
crv.IsPeriodic                  # True if periodic (seamlessly closed)
crv.IsLinear(tol)               # True if effectively a line
crv.IsPlanar(tol)               # True if lies in a plane
crv.Degree                      # polynomial degree
crv.SpanCount                   # number of spans
crv.ClosestPoint(pt)            # returns (success, parameter)
crv.PointAtNormalizedLength(t)  # t in [0,1] based on arc length

# Modification
crv.Trim(interval)              # extract segment by parameter interval
crv.Split(t)                    # split at parameter, returns array
crv.Reverse()                   # flip direction
crv.Offset(plane, dist, tol, corner_style)  # offset curve
crv.Extend(curve_end, style, geometry)      # extend curve end
crv.Rebuild(pointCount, degree, preserveTangent)  # rebuild with new point count

# Sampling
crv.DivideByCount(count, include_ends)   # returns parameter array
crv.DivideByLength(length, include_ends)  # returns parameter array
crv.DivideEquidistant(distance)           # returns Point3d array

# Conversion
crv.ToNurbsCurve()              # convert any curve to NURBS
```

### NurbsCurve
```python
# Create from control points
nc = rg.NurbsCurve.Create(is_periodic, degree, control_points)

# Create interpolated (through points)
nc = rg.Curve.CreateInterpolatedCurve(points, degree)
nc = rg.Curve.CreateInterpolatedCurve(points, degree, knot_style, start_tan, end_tan)

# Create fitted
nc = rg.Curve.CreateFitCurve(points, degree, tolerance)

# Properties
nc.Degree                       # polynomial degree
nc.Points                       # NurbsCurvePointList (control points)
nc.Points.Count                 # number of control points
nc.Points[i]                    # ControlPoint at index
nc.Points[i].Location           # Point3d location
nc.Points[i].Weight             # weight (1.0 for non-rational)
nc.Knots                        # NurbsCurveKnotList
nc.IsRational                   # True if weighted
nc.Order                        # Degree + 1

# Editing
nc.Points.SetPoint(index, point)
nc.Points.SetPoint(index, point, weight)
nc.IncreaseDegree(new_degree)
nc.Knots.InsertKnot(parameter, multiplicity)
```

### PolyCurve (composite curve)
```python
pc = rg.PolyCurve()
pc.Append(line_curve)
pc.Append(arc_curve)
pc.SegmentCount                  # number of segments
pc.SegmentCurve(index)           # get individual segment
```

### Polyline
```python
polyline = rg.Polyline(point_list)
polyline.Count                   # number of points
polyline[i]                      # Point3d at index
polyline.ToNurbsCurve()          # convert to curve
polyline.Length                   # total length
polyline.ClosestPoint(pt)        # nearest point
```

### Static Curve Utilities
```python
rg.Curve.JoinCurves(curves, tolerance)    # join curves end-to-end
rg.Curve.CreateFilletCurves(c1, pt1, c2, pt2, radius, join, trim, arc_ext, tolerance, angle_tol)
rg.Curve.CreateBooleanUnion(curves, plane)
rg.Curve.CreateBooleanDifference(curve1, curves2, plane)
rg.Curve.CreateBooleanIntersection(curve1, curve2, plane)
rg.Curve.ProjectToBrep(curves, breps, direction, tolerance)
rg.Curve.PullToBrepFace(curve, face, tolerance)
```

---

## Surfaces

### Surface Base Class
```python
srf.Domain(direction)            # 0 = U, 1 = V
srf.PointAt(u, v)                # evaluate at (u,v)
srf.NormalAt(u, v)               # surface normal
srf.FrameAt(u, v)                # full frame at (u,v)
srf.IsoCurve(direction, param)   # extract iso-parametric curve
srf.GetBoundingBox(accurate)     # bounding box
srf.IsSolid                      # True if closed solid
srf.Reverse(direction)           # flip orientation (0=U, 1=V)
srf.Transpose()                  # swap U and V
srf.ClosestPoint(pt)             # returns (success, u, v)
srf.GetSurfaceSize()             # returns (success, width, height)
```

### NurbsSurface
```python
# Create from corners (planar)
ns = rg.NurbsSurface.CreateFromCorners(pt1, pt2, pt3, pt4)
ns = rg.NurbsSurface.CreateFromCorners(pt1, pt2, pt3)  # triangular

# Create through points
ns = rg.NurbsSurface.CreateThroughPoints(points, u_count, v_count, u_degree, v_degree, u_closed, v_closed)

# Properties
ns.Degree(direction)             # 0=U, 1=V
ns.Points                        # NurbsSurfacePointList (2D grid)
ns.Points.CountU, ns.Points.CountV
ns.Points.GetControlPoint(u, v)
ns.KnotsU, ns.KnotsV
ns.IsRational
```

### Surface Creation Methods
```python
# Extrusion
rg.Surface.CreateExtrusion(profile, direction)

# Revolution
rg.RevSurface.Create(profile_curve, axis_line, start_angle, end_angle)

# Loft
breps = rg.Brep.CreateFromLoft(curves, start_pt, end_pt, loft_type, closed)
# loft_type: rg.LoftType.Normal, .Loose, .Tight, .Straight, .Uniform

# Sweep
rg.Brep.CreateFromSweep(rail, shapes, closed, tolerance)
rg.Brep.CreateFromSweep(rail1, rail2, shapes, closed, tolerance)

# Patch
rg.Brep.CreatePatch(geometry, start_srf, spans, flexibility, trim, tangency, tolerance)

# Edge surface (from 2, 3, or 4 edge curves)
rg.Brep.CreateEdgeSurface(curves)

# Pipe
rg.Brep.CreatePipe(rail, radius, local_blending, cap, fit_rail, abs_tol, angle_tol)
rg.Brep.CreatePipe(rail, rail_params, radii, local_blending, cap, fit_rail, abs_tol, angle_tol)
```

---

## Breps

### Brep Structure
A Brep (Boundary Representation) has: Vertices, Edges, Faces, Trims, Loops.

```python
brep.Faces.Count                 # number of faces
brep.Edges.Count                 # number of edges
brep.Vertices.Count              # number of vertices
brep.IsSolid                     # closed solid?
brep.IsValid                     # ALWAYS check this before operations

# Access components
face = brep.Faces[i]
edge = brep.Edges[i]
vertex = brep.Vertices[i]

# Face operations
face.DuplicateSurface()          # underlying untrimmed surface
face.OuterLoop                   # outer trim loop
face.Loops                       # all trim loops
face.IsReversed                  # face orientation vs surface

# Edge operations
edge.DuplicateCurve()            # 3D edge curve
edge.AdjacentFaces()             # connected face indices
```

### Brep Creation
```python
# From surface
brep = rg.Brep.CreateFromSurface(surface)

# Box
brep = rg.Brep.CreateFromBox(bounding_box)
brep = rg.Brep.CreateFromBox(corners)  # 8 corner points

# Join multiple breps
joined = rg.Brep.JoinBreps(breps, tolerance)

# Cap planar holes
brep.CapPlanarHoles(tolerance)

# Offset surface
rg.Brep.CreateOffsetBrep(brep, distance, solid, extend, tolerance)
```

### Brep Booleans
```python
# All boolean methods return Brep[] (array) or None on failure

# Union -- takes a collection of breps
union = rg.Brep.CreateBooleanUnion(breps, tolerance)

# Difference -- two overloads:
# Overload 1: single vs single
diff = rg.Brep.CreateBooleanDifference(brep_a, brep_b, tolerance)
# Overload 2: collection vs collection (IEnumerable<Brep>, IEnumerable<Brep>)
diff = rg.Brep.CreateBooleanDifference([base], cutters, tolerance)
# Both also have a (brep, brep, tol, manifoldOnly) variant

# Intersection
inter = rg.Brep.CreateBooleanIntersection(brep_a, brep_b, tolerance)
inter = rg.Brep.CreateBooleanIntersection([set_a], [set_b], tolerance)

# IronPython note: if Python lists fail to resolve to IEnumerable<Brep>,
# wrap in .NET List:
from System.Collections.Generic import List as NetList
first = NetList[rg.Brep]()
first.Add(base_brep)
diff = rg.Brep.CreateBooleanDifference(first, cutters_net_list, tolerance)
```

### Brep Analysis
```python
amp = rg.AreaMassProperties.Compute(brep)
amp.Area                         # surface area
amp.Centroid                     # center of area

vmp = rg.VolumeMassProperties.Compute(brep)
vmp.Volume                       # volume (solid breps only)
vmp.Centroid                     # center of volume

brep.GetBoundingBox(accurate)
brep.IsPointInside(pt, tolerance, strictly_in)  # point containment
```

---

## Meshes

### Mesh Construction
```python
mesh = rg.Mesh()

# Add vertices
mesh.Vertices.Add(x, y, z)       # returns index
mesh.Vertices.Add(point3d)

# Add faces (triangle or quad)
mesh.Faces.AddFace(v0, v1, v2)           # triangle
mesh.Faces.AddFace(v0, v1, v2, v3)       # quad

# Finalize -- these are SEPARATE normal collections
mesh.Normals.ComputeNormals()             # per-vertex normals (smooth shading)
mesh.FaceNormals.ComputeFaceNormals()     # per-face normals (flat, one per face)
# Or recompute both at once:
# mesh.RebuildNormals()
mesh.Compact()
mesh.UnifyNormals()
```

### Mesh from Other Geometry
```python
params = rg.MeshingParameters.Default    # or .Coarse, .Smooth, .Minimal
meshes = rg.Mesh.CreateFromBrep(brep, params)

# Custom parameters
params = rg.MeshingParameters()
params.MaximumEdgeLength = 2.0
params.MinimumEdgeLength = 0.1
params.RelativeTolerance = 0.5

# From planar boundary
mesh = rg.Mesh.CreateFromPlanarBoundary(closed_curve, params, tolerance)
```

### Mesh Properties and Operations
```python
mesh.Vertices.Count
mesh.Faces.Count
mesh.Vertices[i]                  # Point3f (not Point3d!)
mesh.Faces[i]                    # MeshFace (A, B, C, D indices)
mesh.Faces[i].IsTriangle         # True if triangle
mesh.Faces[i].IsQuad             # True if quad

# Topology
mesh.TopologyVertices             # shared vertex topology
mesh.TopologyEdges                # edge connectivity

# Modification
mesh.Weld(angle_tolerance)        # merge nearby vertices
mesh.Flip(true, true, true)       # flip normals, faces, edge order
mesh.RebuildNormals()
mesh.Explode()                    # separate disconnected parts
mesh.Split(cutter_mesh)

# Mesh booleans
rg.Mesh.CreateBooleanUnion(meshes)
rg.Mesh.CreateBooleanDifference(mesh_a_list, mesh_b_list)
rg.Mesh.CreateBooleanIntersection(mesh_a_list, mesh_b_list)

# Analysis
amp = rg.AreaMassProperties.Compute(mesh)
vmp = rg.VolumeMassProperties.Compute(mesh)
mesh.GetBoundingBox(accurate)
mesh.ClosestPoint(pt)             # returns (pt, face_index)
```

### Mesh Vertex Colors
```python
mesh.VertexColors.CreateMonotoneMesh(System.Drawing.Color.Red)
mesh.VertexColors.SetColor(vertex_index, color)

# Per-vertex coloring (e.g., for heatmaps)
import System.Drawing
for i in xrange(mesh.Vertices.Count):
    val = normalized_values[i]  # 0.0 to 1.0
    r = int(val * 255)
    b = int((1.0 - val) * 255)
    mesh.VertexColors.SetColor(i, System.Drawing.Color.FromArgb(r, 0, b))
```

---

## Transforms

```python
# Translation
xf = rg.Transform.Translation(vector)
xf = rg.Transform.Translation(dx, dy, dz)

# Rotation
xf = rg.Transform.Rotation(angle_radians, axis_vector, center_point)
xf = rg.Transform.Rotation(angle_radians, rotation_center)  # 2D rotation

# Scale
xf = rg.Transform.Scale(center_point, factor)
xf = rg.Transform.Scale(plane, x_factor, y_factor, z_factor)  # non-uniform

# Mirror
xf = rg.Transform.Mirror(plane)
xf = rg.Transform.Mirror(pt_on_mirror, mirror_normal)

# Projection
xf = rg.Transform.PlanarProjection(plane)  # project onto plane

# Identity
xf = rg.Transform.Identity

# Combine transforms (matrix multiplication)
combined = xf_b * xf_a  # apply xf_a first, then xf_b

# Apply to geometry
success = geometry.Transform(xf)

# Apply to point (creates new point)
new_pt = xf * point3d
```

---

## Intersections

All in `Rhino.Geometry.Intersect.Intersection`:

```python
from Rhino.Geometry.Intersect import Intersection

# Curve-Curve
events = Intersection.CurveCurve(crv1, crv2, tol, overlap_tol)
# events is CurveIntersections collection
for e in events:
    e.PointA                     # intersection point on curve 1
    e.PointB                     # intersection point on curve 2
    e.ParameterA                 # parameter on curve 1
    e.ParameterB                 # parameter on curve 2
    e.IsOverlap                  # True if overlap (not crossing)

# Curve-Plane
events = Intersection.CurvePlane(crv, plane, tol)

# Curve-Brep
success = Intersection.CurveBrep(crv, brep, tol, overlap_curves, intersection_pts)
# overlap_curves and intersection_pts are output arrays

# Brep-Brep
success = Intersection.BrepBrep(brep1, brep2, tol, curves, pts)

# Brep-Plane
success = Intersection.BrepPlane(brep, plane, tol, curves, pts)

# Line-Mesh
face_ids = Intersection.MeshLine(mesh, line)

# Mesh-Mesh
polylines = Intersection.MeshMeshAccurate(mesh1, mesh2, tol)

# Mesh-Plane
polylines = Intersection.MeshPlane(mesh, plane)

# Ray shooting
ray = rg.Ray3d(origin, direction)
t = Intersection.MeshRay(mesh, ray)  # returns parameter (-1 if miss)
```

---

## Bounding Boxes and Planes

### BoundingBox
```python
bb = geometry.GetBoundingBox(accurate)   # True for tight, False for fast
bb = rg.BoundingBox(min_pt, max_pt)

bb.Min, bb.Max                   # corner points
bb.Center                        # center point
bb.Diagonal                      # diagonal vector
bb.IsValid                       # check validity
bb.Contains(pt)                  # point containment
bb.Union(other_bb)               # expand to include other
bb.ToBrep()                      # convert to box Brep
```

### Interval
```python
interval = rg.Interval(t0, t1)
interval.Length                   # t1 - t0
interval.Mid                     # midpoint parameter
interval.ParameterAt(t)          # normalized t in [0,1] to actual parameter
interval.NormalizedParameterAt(t) # actual parameter to normalized [0,1]
interval.Contains(value)          # check if value is in interval
```

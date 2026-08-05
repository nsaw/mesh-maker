# Vectric Aspire V12 - Design and Modeling Workflow

## Table of Contents
1. [Job Setup](#job-setup)
2. [2D Vector Design](#2d-vector-design)
3. [3D Component Modeling](#3d-component-modeling)
4. [Component Combine Modes](#component-combine-modes)
5. [Import Formats](#import-formats)
6. [Layer and Level Management](#layer-and-level-management)

---

## Job Setup

Every project starts with job setup. Getting this right is critical because it defines the physical relationship between your design and the material on the machine.

### Creating a New Job
- **Width / Height**: Physical dimensions of your material in X and Y
- **Thickness**: Actual measured thickness of the material
- **Z Zero Position**: Where Z=0 is located
  - **Machine Bed** (owner's standard): Z=0 at the spoilboard surface. Material sits above Z=0. Material thickness must be measured accurately.
  - **Material Surface**: Z=0 at the top of the stock. Cuts go into negative Z.
  - Owner always uses Machine Bed. This is more repeatable -- no re-zeroing needed when swapping stock of different thicknesses on the same spoilboard.
- **XY Datum Position**: Where (0,0) is on the material
  - Options: Center, or any of the four corners
  - **Bottom-left** is standard for ShopBot workflow (matches machine coordinate convention)
  - Must match where you zero XY on the ShopBot
- **Units**: Inches or millimeters
- **Appearance**: Material color in 3D preview (cosmetic only)

### Job Types
- **Single Sided**: Standard. One-sided machining from the top.
- **Double Sided**: For projects machined on both sides. Aspire manages the flip and registration.
- **Rotary**: For lathe-style work with a rotary axis. Wraps the design around a cylinder.

### Modifying Job Setup
- Can be changed later via Edit > Job Setup
- Changing dimensions after design is started may reposition existing geometry
- Changing Z-zero position or thickness affects all toolpath depths

---

## 2D Vector Design

Vectors are the foundation of almost everything in Aspire. Toolpaths follow vectors. 3D shapes are often built from vector profiles. Even 3D imports typically need vector boundaries.

### Drawing Tools
- **Line/Polyline**: Click to place points, press Escape or close to finish
- **Arc**: 3-point arc, center-point arc, or tangent arc
- **Circle**: Center + radius, or 3-point
- **Rectangle**: Click-drag or specify dimensions
- **Polygon**: Regular polygons (3-sided through N-sided)
- **Star**: Inner and outer radius with point count
- **Ellipse**: Center + two radii

### Vector Editing
- **Node Editing** (N key): Select a vector, press N to enter node mode. Move, add, delete nodes. Convert between sharp/smooth/symmetric node types. This is where precise shape control happens.
- **Offset**: Create a parallel copy at a specified distance (inside or outside)
- **Fillet**: Round corners at a specified radius
- **Chamfer**: Bevel corners at a specified distance
- **Trim**: Cut vectors at intersection points
- **Extend**: Extend a vector to meet another
- **Join Vectors**: Combine open vectors into closed shapes (important for toolpaths -- many toolpath types require closed vectors)
- **Boolean Operations**: Weld (union), Subtract, Intersect, Trim -- applied to closed vectors
- **Align**: Align selected vectors to each other or to the material

### Text Tools
- **Standard Text**: TrueType and OpenType fonts
- **Text on a Curve**: Flow text along any vector path
- **Engraving Fonts**: Single-line fonts designed for V-carving (much faster than outline fonts for engraving)

### Vector Import
- Aspire imports DXF, SVG, AI, EPS, PDF vector formats
- Imported vectors may need cleanup: join open vectors, remove duplicates, fix intersections
- Scale and position imported vectors to match your material

### Bitmap Tracing
- Import a bitmap image (JPG, PNG, BMP, TIFF)
- Use Trace Bitmap to convert to vectors
- Black & white threshold tracing for simple shapes
- Color tracing for multi-layer designs
- Results need manual cleanup for best toolpath results

---

## 3D Component Modeling

Aspire's 3D modeling system is component-based. Each 3D element is a "component" that combines with others through a hierarchy of levels. The key concept: you build up complex 3D shapes by combining simpler ones.

### Component Tree
- The Component Tree panel shows all 3D components organized in levels
- Each component has properties: name, combine mode, height, base height, tilt, fade
- Components within a level combine with each other according to their individual combine mode
- Levels combine with each other according to the level's combine mode
- Think of it like Photoshop layers but for 3D relief

### Shape Creation Tools
These create 3D components from 2D vector outlines:

**Create Shape from Vector**:
- Select a closed vector, choose a profile shape
- Profile options: Flat, Round (dome), Angle, Round with flat, Custom (user-drawn cross-section)
- Set the height (how tall the shape rises above the base)
- Set the base height (how high above Z=0 the bottom of the shape sits)
- Start/end angle for round profiles
- Tilt: angle the shape in X or Y

**Two-Rail Sweep**:
- Two vectors define the rails (edges), a cross-section profile defines the shape
- Powerful for moldings, frames, organic shapes
- Cross-section can vary along the length

**Spin (Rotary)**:
- Spins a profile vector around an axis to create a turned shape
- Perfect for bowls, vases, balusters, chess pieces

**Extrude and Weave**:
- Extrude: Push a cross-section along a vector path
- Weave: Create interlocking patterns (basket weave, Celtic knots)

**Turn and Spin**:
- Create rotational shapes from cross-section profiles
- Useful for decorative elements, hardware, round objects

### Sculpting Tools
For freeform 3D editing after creating base shapes:

- **Smooth**: Blend/soften areas
- **Smudge**: Push material around
- **Deposit**: Add material
- **Remove**: Remove material
- **Flatten**: Push areas to a specific height
- Brush size, strength, and smoothing are adjustable
- Sculpting operates on the composite model (all visible components)

### 3D Clipart
- Aspire includes a clipart library of 3D components
- Additional clipart available from Vectric and third parties
- Import any STL, 3DM (Rhino), or OBJ file as a component
- Imported 3D models can be scaled, positioned, and combined with other components

---

## Component Combine Modes

How components interact with each other is controlled by combine modes. This is fundamental to building complex 3D designs.

### Modes

**Add**: The component's height is added to everything below it. Use for elements that sit on top of a surface (text on a plaque, decoration on a panel).

**Subtract**: The component's shape is removed from everything below it. Use for recesses, channels, mortises.

**Merge (High)**: Takes the highest point at each XY position. Components merge smoothly where they overlap, keeping the taller surface. Use for overlapping decorative elements, terrain features.

**Low**: Takes the lowest point at each XY position. Opposite of Merge.

**Multiply**: Multiplies the heights at each XY position (normalized to 0-1 range). Use for applying texture -- a flat texture pattern multiplied onto a domed shape gives a textured dome.

### Level Combine Modes
Levels also have combine modes. The level mode controls how the entire level's composite output combines with levels below it. Same options: Add, Subtract, Merge, Low, Multiply.

### Practical Patterns

**Relief carving (sign with raised text on border)**:
- Level 0: Background shape (flat or textured base) -- Merge mode
- Level 1: Border/frame (Two-Rail Sweep around perimeter) -- Add mode
- Level 2: Text (Create Shape, round profile) -- Add mode

**Inset panel with decoration**:
- Level 0: Flat panel -- base shape
- Level 1: Recessed area (subtract mode) -- creates the inset
- Level 2: Decorative element inside the recess (add mode)

**Textured surface**:
- Level 0: Smooth dome or shape -- base form
- Component: Texture pattern -- Multiply mode on same level
- Result: Texture conforms to the underlying shape

---

## Import Formats

### 2D Vector Formats
| Format | Notes |
|--------|-------|
| DXF | Best for CAD imports. Supports layers. Clean up may be needed. |
| SVG | Good for web/design tool output. Preserves curves well. |
| AI (Adobe Illustrator) | Supported but older format versions only |
| EPS | PostScript vectors. Good compatibility. |
| PDF | Extracts vector content from PDF pages |

### 3D Model Formats
| Format | Notes |
|--------|-------|
| STL | Universal mesh format. No color/texture. Most common for CNC. |
| OBJ | Mesh format with material support. |
| 3DM (Rhino) | NURBS-based. High quality import if using Rhino for design. |
| SKP (SketchUp) | Supported with limitations. Convert to STL if issues. |

### Image Formats (for tracing or texture)
| Format | Notes |
|--------|-------|
| JPG/PNG/BMP/TIFF | For bitmap tracing or 3D texture from grayscale |

### Importing 3D Models
- When importing STL/OBJ, Aspire offers orientation and scaling options
- Choose how the model maps to the XYZ plane
- Models taller than the material thickness will be scaled/clipped
- Complex models may need simplification for clean toolpathing

---

## Layer and Level Management

### 2D Layers
- Organize 2D vectors by layer (like AutoCAD/Illustrator layers)
- Each layer has a name, color, and visibility toggle
- Layers are useful for organizing different toolpath groups:
  - "Profile Cuts" layer for outlines
  - "Pockets" layer for recessed areas
  - "V-Carve Text" layer for engraved text
  - "Drill Holes" layer for registration/mounting holes

### 3D Levels
- Organize 3D components by level
- Each level has its own combine mode with levels below
- Components within a level combine with each other first
- Then the level's combined result interacts with levels below
- Standard practice: separate background, detail, and text into different levels
- Toggle level visibility to work on specific elements

### Organization Tips
- Name layers and levels descriptively
- Use layers to quickly select all vectors for a specific toolpath
- Keep different toolpath strategies on different layers
- Lock layers/levels you don't want to accidentally edit

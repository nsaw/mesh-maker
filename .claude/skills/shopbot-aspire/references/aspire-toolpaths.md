# Vectric Aspire V12 - Toolpath Reference

## Table of Contents
1. [Toolpath Overview](#toolpath-overview)
2. [2D Profile Toolpath](#2d-profile-toolpath)
3. [Pocket Toolpath](#pocket-toolpath)
4. [Drilling Toolpath](#drilling-toolpath)
5. [V-Carve / Advanced V-Carve](#v-carve-toolpath)
6. [3D Roughing Toolpath](#3d-roughing-toolpath)
7. [3D Finishing Toolpath](#3d-finishing-toolpath)
8. [Fluting Toolpath](#fluting-toolpath)
9. [Moulding Toolpath](#moulding-toolpath)
10. [Texture Toolpath](#texture-toolpath)
11. [Prism Carving](#prism-carving)
12. [Inlay Toolpath](#inlay-toolpath)
13. [Tabs and Bridges](#tabs-and-bridges)
14. [Toolpath Preview and Simulation](#toolpath-preview-and-simulation)
15. [Toolpath Order and Strategy](#toolpath-order-and-strategy)

---

## Toolpath Overview

Toolpaths convert your design into machine instructions. Each toolpath type is optimized for a specific kind of operation. Choosing the right strategy for each part of your design is one of the most important decisions in CNC work.

### Common Parameters Across All Toolpaths
- **Name**: Descriptive name for the toolpath (e.g., "Profile Cut - Outline")
- **Tool**: Selected from the tool database
- **Start Depth**: Where the tool starts cutting (usually 0.0 for top of material)
- **Cut Depth / Final Depth**: How deep the tool cuts
- **Pass Depth**: Maximum depth per pass (tool database default, can override)
- **Calculation**: Generate the toolpath. Must recalculate after any parameter change.

---

## 2D Profile Toolpath

Cuts along the outline of selected vectors. The most common toolpath for cutting parts out of sheet material.

### Machine Vectors On
- **Outside**: Tool path runs outside the vector (for cutting out a part)
- **Inside**: Tool path runs inside the vector (for cutting a hole/pocket edge)
- **On**: Tool center follows the vector exactly (for engraving/scoring lines)

### Cut Direction
- **Climb** (Down-cut direction): Bit rotation matches feed direction. Gives better surface finish but can grab thin or unsecured material.
- **Conventional** (Up-cut direction): Bit rotation opposes feed direction. Safer grip on material, slightly rougher finish.
- Choose based on material security and finish requirements.

### Key Parameters
- **Allowance Offset**: Leave extra material (positive = leave material, negative = overcut). Useful for sanding allowance or test fits.
- **Separate Last Pass**: Run the final pass at a different speed/depth for better finish. Common: slower feed on last pass.
- **Profile Pass Direction**: Last pass can be climb or conventional independent of roughing passes.

### Ramp Plunge
Instead of plunging straight down (hard on bits), ramp entry angles the tool into the material:
- **Smooth**: Arcs into the cut along the toolpath
- **Zig Zag**: Ramps back and forth along a line
- Set ramp angle (typically 5-15 degrees) and distance
- Highly recommended for hard materials and large bits

### Start Point
- By default, Aspire chooses the start point
- You can set a specific start point on the vector (useful for controlling where the entry mark appears)
- Start points can be set per-vector using the Node Editing tool

---

## Pocket Toolpath

Clears the interior area bounded by selected vectors. Removes all material within the boundary to the specified depth.

### Clearing Strategy
- **Offset**: Concentric passes from outside in (or inside out). Clean, predictable, good for most cases.
- **Raster**: Parallel lines across the pocket. Useful for very large areas. Can specify raster angle (0, 45, 90, etc.)
- **Offset then Raster**: Offset pass on the boundary for a clean edge, then raster to clear the interior.

### Key Parameters
- **Stepover**: Distance between adjacent passes. Typically 40-60% of tool diameter. Smaller = slower but smoother floor.
- **Cut Direction**: Climb or conventional for each pass type
- **Allowance**: Material left on walls and floor for a finish pass
- **Use Larger Area Clearance Tool**: Add a bigger tool to clear the bulk, then finish with the selected tool. Saves significant time on large pockets.
- **Pocket Depth**: Can be shallower than material thickness (partial depth pocket) or full through-cut

### Ramp Plunge
Same options as profile toolpath. Especially important for pockets since the tool must plunge into solid material.

---

## Drilling Toolpath

Drills holes at the center of selected circles or at selected points.

### Drill Cycle Options
- **Standard Drill**: Plunge to full depth in one shot
- **Peck Drill**: Plunge in increments (peck depth), retract to clear chips between pecks. Required for deep holes.
- **Dwell**: Pause at the bottom for a cleaner hole bottom

### Key Parameters
- **Peck Depth**: Depth of each peck (for peck drilling)
- **Retract Height**: How far the drill retracts between pecks
- Use circles in the design to define hole positions and sizes
- The tool diameter should match or be slightly smaller than the desired hole

---

## V-Carve Toolpath

V-carving uses a V-bit to carve text and designs with a hand-carved look. The bit plunges deeper in wide areas and shallower in narrow areas, creating a natural tapered effect.

### How V-Carving Works
- The V-bit carves to a depth determined by the width of the vector
- Narrow features = shallow cuts, wide features = deep cuts
- The angle of the V-bit determines the depth-to-width ratio
- A 90-degree V-bit creates a 45-degree wall angle

### Tool Selection
- **V-Bit** (primary): The main carving tool. Common angles: 60, 90, 120 degrees.
  - Steep angle (60) = deeper cuts for given width, more detail but deeper
  - Shallow angle (120) = shallower, wider cuts
- **Clearance Tool** (optional): A flat endmill that clears large flat areas before the V-bit. Dramatically reduces machining time on wide designs.

### Advanced V-Carve
- Uses a flat-bottom clearance tool to cut the flat floor areas
- The V-bit only cuts the detailed edges and narrow features
- Set the **Flat Depth**: the depth of the flat floor areas
- The V-bit handles only the tapered walls between the flat floor and the vectors
- Results in much faster machining for designs with large filled areas

### Key Parameters
- **Start Depth**: Usually 0.0 (top of material) but can be set deeper for recessed V-carving
- **Flat Depth**: For advanced V-carve, the depth of flat areas (e.g., 0.125")
- **Use Vector Start Points**: Controls where the V-bit enters each vector
- **Corner Sharpening**: Slows down or modifies the path at sharp corners for cleaner results

### Inlay V-Carving
For creating male/female inlay pairs using V-carving:
- Create the **female** (pocket) piece using V-carve toolpath
- Create the **male** (plug) piece using the Inlay Toolpath (see below)
- The two pieces fit together with matching V-carved edges

---

## 3D Roughing Toolpath

Removes bulk material to rough out 3D shapes. Leaves a specified allowance for the finishing pass. Always run roughing before finishing on 3D projects.

### Strategy
- **Offset (recommended)**: Concentric passes that follow the 3D contour. Efficient and leaves an even allowance.
- **Raster**: Parallel passes in X or Y direction. Simple but may leave more material in some areas.

### Key Parameters
- **Machining Allowance**: How much material to leave for finishing (typically 0.01" - 0.03")
- **Stepdown**: Maximum Z depth per pass
- **Stepover**: Distance between adjacent passes (typically 40-60% of tool diameter)
- **Tool**: Use the largest appropriate flat endmill. Roughing is about removing material quickly, not finish quality.
- **Machining Boundary**: The area to machine. Can be the model boundary, selected vectors, or a custom boundary with offset.
- **Raster Angle**: For raster strategy, the angle of the parallel passes

### Boundary Options
- **Model Boundary**: Machines the entire 3D model area
- **Selected Vector(s)**: Only machine within the selected boundary vectors
- **Boundary Offset**: Add extra distance outside the boundary for clean edges

---

## 3D Finishing Toolpath

Creates the final smooth surface on 3D models. Run after roughing.

### Strategy Options
- **Raster**: Parallel passes at a specified angle. Most common for general 3D work.
  - Raster angle 0 = passes along X axis
  - Raster angle 90 = passes along Y axis
  - Raster angle 45 = diagonal passes
  - Sometimes running two finish passes at different angles (0 and 90) gives the best result
- **Offset**: Concentric passes following the 3D contour. Good for round/organic shapes.
- **3D Offset**: Follows the 3D surface contours more precisely than standard offset.

### Key Parameters
- **Stepover**: The critical parameter for finish quality. Controls the distance between adjacent passes.
  - Ball-nose: 8-12% of diameter for smooth finish, 15-20% for acceptable, 25%+ shows visible scallops
  - For a 1/4" ball-nose: 0.02" - 0.03" stepover = smooth, 0.05" = acceptable, 0.0625"+ = visible lines
- **Tool**: Ball-nose endmill for curved surfaces (most common). Tapered ball-nose for fine detail. Flat endmill only for truly flat areas.
- **Machining Boundary**: Same options as roughing
- **Raster Angle**: For raster strategy, experiment with different angles to see which direction produces the best finish for your specific geometry

### Stepover and Scallop Height
The relationship between stepover, tool diameter, and scallop height is:
```
Scallop Height = R - sqrt(R^2 - (stepover/2)^2)
```
Where R is the ball-nose radius. Smaller stepover = smaller scallops = smoother surface = longer machining time. This is always a tradeoff.

---

## Fluting Toolpath

Creates tapered grooves (flutes) along selected vectors. The tool ramps into the material at the start and ramps out at the end.

### Uses
- Decorative fluting on furniture legs and columns
- Organic groove patterns
- Leaf veins and natural details

### Key Parameters
- **Flute Type**: Ramp at start/end, or various combinations
- **Depth**: Maximum depth of the flute
- **Ramp Length**: How long the entry/exit ramp is

---

## Moulding Toolpath

Machines a 3D cross-section along a vector path, creating moulding profiles.

### Uses
- Frame moulding profiles
- Edge treatments
- Decorative borders

### Key Parameters
- **Cross-Section**: The 3D profile shape (from a cross-section vector or preset)
- **Scaling**: How the cross-section scales across the vector width
- **Tool**: Typically a ball-nose for 3D profiles

---

## Texture Toolpath

Applies random or patterned textures to a bounded area.

### Texture Types
- **Random wave**: Organic, hand-carved appearance
- The texture parameters control wave length, amplitude, and randomness
- Applied within selected vector boundaries

---

## Prism Carving

Cuts a prismatic (beveled) shape along vectors, similar to V-carving but with a flat bottom. Creates beveled edges with a flat center region.

### Uses
- Raised prismatic lettering
- Beveled borders
- Geometric relief patterns

---

## Inlay Toolpath

Creates male (plug) and female (pocket) pieces that fit together, typically using V-carved edges for a precise fit.

### Workflow
1. Design the inlay pattern as vectors
2. Create the **female** (pocket) toolpath on piece A
3. Create the **male** (plug) toolpath on piece B
4. Aspire calculates the geometry so the two pieces mate
5. Glue the male plug into the female pocket, sand flush

### Key Parameters
- **Allowance**: Gap between male and female for glue space
- **Minimum Depth**: Ensures the plug is deep enough to hold
- Works with V-bits for tapered edges (self-centering fit)

---

## Tabs and Bridges

Tabs prevent cut-out pieces from moving during through-cut profile operations.

### Tab Configuration
- **Add Tabs**: Check to enable tabs on a profile toolpath
- **Tab Length**: Width of the tab along the cut line (typically 0.25" - 0.5")
- **Tab Height**: How tall the tab is (typically 0.02" - 0.05", just enough to hold)
- **Number of Tabs**: Per vector, or based on distance between tabs
- **3D Tabs**: Ramp up/down smoothly (preferred -- easier to remove and less shock on the bit)
- **Rectangular Tabs**: Simple vertical tabs (faster to calculate but harsher on the bit and harder to remove)

### Tab Placement
- Aspire auto-places tabs evenly around the vector
- You can manually add, remove, or move tabs in the toolpath preview
- Place tabs in waste areas or inconspicuous locations
- Avoid placing tabs at sharp corners

### Removing Tabs After Cutting
- Oscillating multi-tool with flush-cut blade
- Chisel and mallet for wood
- Sand flush with the surface
- For 3D tabs, a light sanding pass is usually sufficient

---

## Toolpath Preview and Simulation

### Preview Features
- **3D Preview**: Shows the material with all calculated toolpaths applied
- Rotate, zoom, pan to inspect from all angles
- **Simulate Machining**: Watch the cut in real-time (accelerated)
- **Toolpath Drawing**: Show/hide individual toolpaths in the 2D and 3D views
- Color-coded by toolpath or by tool

### What to Check in Preview
1. **No unexpected cuts**: Look for toolpath going where it shouldn't
2. **Correct depth**: Measure in the preview to verify depths
3. **Tab placement**: Verify tabs are present and positioned well
4. **Surface quality**: On 3D finishes, look for visible scallop lines (reduce stepover if too prominent)
5. **No collisions**: Tool holder/collet clearance for deep pockets
6. **Material left behind**: Ensure all intended material is removed

### Reset Preview
- Reset to see the raw material before toolpaths
- Apply toolpaths one at a time to verify each operation independently

---

## Toolpath Order and Strategy

The order in which you run toolpaths matters for quality and safety.

### Recommended Order
1. **Drilling** (registration holes, if needed)
2. **3D Roughing** (if doing 3D work)
3. **3D Finishing** (if doing 3D work)
4. **Pocketing** (interior pockets before profiles)
5. **V-Carving** (detail work)
6. **Interior Profile Cuts** (holes, inside shapes)
7. **Exterior Profile Cuts** (final cutout, always last)

### Why This Order
- Drilling registration holes first helps with alignment
- 3D work needs the full material block as reference
- Pockets before profiles because the surrounding material provides stability
- Interior cuts before exterior because once the part is cut free, it can shift
- Exterior profile cuts always last because they free the part from the stock

### Saving Toolpaths
- Each toolpath is saved separately as an .sbp file (or grouped if using the same tool)
- Use the ShopBot post-processor (e.g., "ShopBot Arc (inch) w/speed")
- The ATC post-processor handles multi-tool jobs in a single file
- Name files descriptively: "01_3D_Rough.sbp", "02_3D_Finish.sbp", "03_Profile_Cut.sbp"

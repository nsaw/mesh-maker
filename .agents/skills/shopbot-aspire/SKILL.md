---
name: shopbot-aspire
description: "Comprehensive CNC routing skill covering ShopBot CNC routers (Desktop MAX ATC V2, PRS, Buddy) and Vectric Aspire V12 CAD/CAM software. Use this skill whenever the user mentions ShopBot, Vectric, Aspire, VCarve, CNC routing, toolpaths, V-carving, 3D carving, CNC setup, post-processors for CNC, OpenSBP commands, SBP programming, feeds and speeds for CNC routers, bit selection for wood/plastic/aluminum routing, ATC (automatic tool changer) operations, Z-zeroing, XY homing, spoilboard surfacing, dust collection setup, material hold-down, climb vs conventional cutting, or any CNC woodworking/fabrication workflow. Also trigger when the user references .sbp files, .crv files, .crv3d files, ISO20 toolholders, ER-20 collets, or ShopBot control software (SB3). This skill spans the full pipeline from 2D/3D design in Aspire through toolpath generation to machine operation and troubleshooting."
---

# ShopBot CNC + Vectric Aspire Skill

This skill covers the complete CNC routing workflow: designing in Vectric Aspire, generating toolpaths, configuring post-processors for ShopBot machines, and operating the machine safely and effectively. It is organized as a reference system -- read the relevant section for the task at hand.

**Owner's machine**: ShopBot Desktop MAX ATC V2, 36" x 24" cutting area, 1HP spindle, ISO20/ER-20 ATC system. All feeds/speeds recommendations and operational guidance are optimized for this specific machine unless otherwise noted.

**Owner's preferences**:
- Z-zero is ALWAYS machine bed (spoilboard surface), never top of material. Aspire job setup must use "Machine Bed" for Z-zero position.
- Primary materials: hardwoods (oak, maple, walnut) and hard sheet goods (baltic birch plywood). MDF only for templates.
- The standard/published feeds and speeds for the Desktop MAX ATC are typically too aggressive on feed rates. This machine's 1HP spindle and stepper drives can't sustain the same feeds as a PRS or industrial router. When in doubt, reduce feeds by 15-25% from published starting points.
- Tool database location: `~/Library/CloudStorage/Dropbox/ShopBot [DROPBOX]/[DB] TOOL DATABASE/tooldb.vtdb`

## Quick Reference: Where to Look

| Task | Reference File |
|------|---------------|
| Machine specs, ATC setup, hardware | `references/shopbot-hardware.md` |
| OpenSBP commands (MZ, MS, SO, etc.) | `references/opensbp-commands.md` |
| Zeroing, coordinates, speeds, safety | `references/shopbot-operations.md` |
| Aspire job setup, design, 3D modeling | `references/aspire-workflow.md` |
| Toolpath types and parameters | `references/aspire-toolpaths.md` |
| Tool database, post-processors | `references/aspire-tools-postprocessors.md` |

## The CNC Routing Pipeline

Understanding the end-to-end workflow is critical for giving good advice. Each step depends on decisions made in the previous one, and mistakes compound. Here is the pipeline:

### 1. Design (Aspire)
- Create or import 2D vector artwork (DXF, SVG, AI, EPS, PDF)
- Create or import 3D models (STL, 3DM, OBJ) or model from scratch
- Organize with layers (2D) and levels/components (3D)
- 3D components combine via modes: Add, Subtract, Merge, Low, Multiply

### 2. Job Setup (Aspire)
- Define material dimensions (width, height, thickness)
- Set Z-zero position: **Machine Bed** (owner always zeros to spoilboard surface)
- Set XY datum: typically bottom-left corner of material
- Choose job type: single-sided, double-sided, or rotary

### 3. Toolpath Generation (Aspire)
- Select vectors/components that define machining regions
- Choose toolpath strategy (profile, pocket, V-carve, 3D rough/finish, etc.)
- Configure tool from database (geometry, speeds, feeds, depths)
- Set tabs/bridges to hold parts during cutout
- Preview/simulate to verify before cutting

### 4. Post-Processing (Aspire -> ShopBot)
- Select the ShopBot post-processor (e.g., "ShopBot Arc (inch) w/speed")
- Save toolpath as .sbp file
- Post-processor translates XYZ coordinates into OpenSBP commands

### 5. Machine Setup (ShopBot Control Software)
- Home XY axes using proximity switches [C3]
- Zero Z axis to **machine bed** (spoilboard surface) using Z-zero plate [C2] -- place plate on spoilboard, not material
- Verify material is secured (clamps, screws, vacuum, or tabs)
- Verify dust collection is connected and running
- Air-cut first (run file with spindle off, Z raised) to check paths

### 6. Cutting (ShopBot Control Software)
- Load .sbp file with [FP] command
- Start spindle, verify RPM
- Run file -- SPACEBAR is emergency stop
- Monitor cut quality: listen for chatter, watch for burning, check chip size

### 7. Post-Cut
- Remove tabs with oscillating tool or chisel
- Sand/finish as needed
- Surface spoilboard periodically with TU (Tools > Tabletop Surfacer)

## Critical Safety Rules

These are non-negotiable. Include them in any operational advice:

1. **SPACEBAR stops all motion** during cutting. This is the panic button.
2. Never leave the machine unattended while cutting
3. Always wear eye and ear protection
4. Turn off spindle before changing bits or adjusting workpiece
5. Secure workpiece firmly -- flying material is the primary danger
6. Position dust skirt before cutting
7. Verify Z-zero before every cut session
8. Air-cut new files first to verify paths
9. Never manually move carriages when motors are off (generates harmful pulses)
10. Keep hands away from moving gantry and spinning bit at all times

## Common Pitfalls and How to Avoid Them

**Z-zero drift**: If cuts are consistently too deep or too shallow, re-zero Z. The Z-zero plate must be clean and making good contact. On ATC machines, run ATC_FixZ_Plate.sbp if tool length offsets seem wrong.

**Wrong post-processor**: Using a generic G-code post instead of ShopBot-specific will produce files the controller can't read. Always use a ShopBot post-processor (look in the "02-ShopBot" folder in Aspire's PostP directory).

**Climb vs conventional**: Climb cutting (bit rotation matches feed direction) gives better finish but can grab the workpiece. Conventional is safer for unsecured or thin stock. Aspire lets you choose per toolpath.

**Feeds too fast / too slow**: Too fast = chatter, broken bits, rough finish. Too slow = burning, excessive heat, premature bit wear. The chip load calculation (feed rate / (RPM x flutes)) should match the manufacturer's recommendation for your material.

**Forgetting tabs**: Profile cuts that go all the way through need tabs/bridges to prevent the cutout piece from moving. Without tabs, the freed piece can shift into the bit path and cause a crash.

**Stepover too wide on 3D finishing**: For ball-nose finishing passes, stepover determines scallop height. 8-12% of bit diameter gives a smooth finish. 50%+ will show visible ridges.

**Not surfacing the spoilboard**: An unsurfaced spoilboard is not flat relative to the gantry plane. This means Z-zero varies across the table. Surface with TU command before precision work.

## Material-Specific Guidance

The owner primarily cuts hardwoods and baltic birch plywood, with MDF only for templates. When advising on feeds/speeds, default to these materials. The Desktop MAX ATC's 1HP spindle and stepper drives can't sustain the same feeds as PRS or industrial machines -- published "starting points" from ShopBot and bit manufacturers often need to be dialed back 15-25% on feed rates.

**Hardwood (oak, maple, walnut) -- PRIMARY MATERIAL**:
- 1/4" upcut spiral: 1.2-1.8 IPS feed, 16000 RPM, 0.0625-0.1" depth per pass
- 3/8" chipbreaker: 2.0-2.5 IPS feed, 12000 RPM, 0.15-0.25" depth per pass
- V-bit: 0.8-1.2 IPS feed, 10000-14000 RPM
- Slow down and take shallower passes; listen for chatter
- Climb cutting gives best finish on hardwoods if material is well-secured

**Baltic Birch Plywood -- PRIMARY MATERIAL**:
- 1/4" compression spiral (Whiteside UD2102): 1.5-2.0 IPS feed, 12000-16000 RPM, 0.125" depth per pass
- Compression bits are critical -- upcut tears top veneer, downcut tears bottom
- First pass must be deeper than the downcut section of the compression bit
- Through-cuts always need tabs; baltic birch is heavy enough to stay put during pocketing

**MDF (templates only)**:
- 1/4" upcut spiral: 2.0-2.5 IPS feed, 16000-18000 RPM, 0.125-0.25" depth per pass
- 1.25" surfacing bit: 4.0 IPS feed, 12000 RPM, 0.08" depth per pass
- MDF produces very fine dust -- good dust collection is critical
- Good material for testing toolpaths before committing to expensive hardwood

**Softwood (pine, cedar)**:
- 1/4" upcut spiral: 2-2.5 IPS feed, 16000-18000 RPM, 0.125" depth per pass
- V-bit: 1.5-2 IPS feed, 14000-16000 RPM

**Acrylic/Plastics (occasional)**:
- Single-flute O-flute bit (TOOL 6 position)
- 1-1.5 IPS feed, 14000-16000 RPM, 0.05-0.1" depth per pass
- Chips should look like small curls, not dust (dust = too slow / too many flutes)

**Aluminum (with care)**:
- Single-flute, ZrN-coated from Boneyard
- 0.5-0.8 IPS feed, 10000-14000 RPM, 0.02-0.04" depth per pass
- Use cutting fluid/lubricant (WD-40 or Tap Magic)
- Clear chips aggressively -- re-cutting aluminum chips destroys bits

These are conservative starting points tuned for the Desktop MAX ATC. Adjust based on cut quality, and always test on scrap before committing to good stock.

## When to Read Each Reference File

**Read `shopbot-hardware.md` when:**
- User asks about machine specs, cutting area, spindle power
- Setting up ATC (automatic tool changer) operations
- Configuring toolbar, tool holders, air supply
- Troubleshooting hardware issues (proximity switches, limit switches)

**Read `opensbp-commands.md` when:**
- User asks about specific SBP commands
- Writing or editing .sbp part files
- Troubleshooting command syntax
- Understanding move types (M vs J vs C commands)
- Configuring speed, output switches, zeroing commands

**Read `shopbot-operations.md` when:**
- Setting up coordinate system (XY datum, Z-zero, Table Base Coordinates)
- Configuring speeds and feed rates in ShopBot control software
- Understanding absolute vs relative distance modes
- Clamping and hold-down strategies
- Maintenance and troubleshooting procedures
- Safety procedures

**Read `aspire-workflow.md` when:**
- Creating a new project / job setup
- 2D vector design or import
- 3D component modeling (shapes, sweeps, sculpting)
- Understanding component combine modes
- Layer and level management
- Bitmap tracing

**Read `aspire-toolpaths.md` when:**
- Selecting the right toolpath strategy for the job
- Configuring toolpath parameters (depths, stepover, ramps)
- Understanding V-carving, inlay, or specialty toolpaths
- Setting up tabs/bridges
- Toolpath preview and simulation

**Read `aspire-tools-postprocessors.md` when:**
- Setting up or modifying the tool database
- Configuring speeds and feeds per material
- Selecting or customizing the ShopBot post-processor
- Understanding post-processor file format and variables
- Troubleshooting output file issues

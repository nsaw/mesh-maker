# ShopBot Operations Reference

## Table of Contents
1. [Coordinate System and Zeroing](#coordinate-system-and-zeroing)
2. [Speed and Feed Configuration](#speed-and-feed-configuration)
3. [Material Hold-Down Methods](#material-hold-down-methods)
4. [Pre-Cut Checklist](#pre-cut-checklist)
5. [Running a Cut File](#running-a-cut-file)
6. [Troubleshooting](#troubleshooting)
7. [Maintenance](#maintenance)

---

## Coordinate System and Zeroing

### The XYZ Convention
- **X axis**: Long axis of the table (left to right, facing the front)
- **Y axis**: Short axis (front to back, gantry travel direction)
- **Z axis**: Vertical (up = positive, down = negative into material)
- Origin (0,0,0) is typically bottom-left corner at the material surface

### Two Coordinate Systems
ShopBot maintains two separate coordinate systems:

1. **Working Coordinates**: Your project origin. Set with Z2, Z3, ZX, ZY, ZZ commands. This is what you move relative to during normal operation. Reset freely as needed per project.

2. **Table Base Coordinates (TBC)**: The machine's permanent reference. Set with [ZT]. Represents the physical layout of the table. Required for limit checking [SF] and for maintaining position across sessions.

### Standard Zeroing Workflow

**Step 1: Home XY**
```
C3    (or use menu: Tools > C3 - Home XY)
```
This drives X and Y to their proximity switches, establishing a repeatable XY reference. After C3, the machine knows where it is on the table.

**Step 2: Position to material origin**
Move the tool to the corner of your material that matches Aspire's XY datum (typically bottom-left). Use keyboard arrows (K shortcut) for fine positioning.

**Step 3: Zero XY**
```
Z2    (zeros X and Y at current position)
```

**Step 4: Zero Z to machine bed**
```
C2    (or use menu: Tools > C2 - Zero Z)
```
This uses the Z-zero plate. Place the plate on the **spoilboard surface** (not the material), connect the clip lead, then run C2. The Z axis descends until the bit contacts the plate, then retracts and sets Z=0 at the spoilboard surface. Ensure the Z-zero plate area is clean and flat.

**Important**: Z-zero plate thickness is pre-calibrated. If you replace the plate, you must update the calibration value in the Z-zero settings.

### Z-Zero Position Choices
- **Machine Bed / spoilboard surface** (owner's standard): Z=0 is the spoilboard. Material sits above Z=0. Place the Z-zero plate on the spoilboard (not the material) when running C2. Material thickness in Aspire must be measured accurately since cut depths are calculated from the bed up.
- **Top of material**: Z=0 is the material surface. Cutting goes negative. Place Z-zero plate on the material surface.
- Must match between Aspire job setup and ShopBot zeroing. Mismatch = wrong cut depth.
- **Owner always uses Machine Bed**. This is more repeatable across material changes and avoids re-zeroing when swapping stock of different thicknesses on the same spoilboard.

### Absolute vs Relative Mode
- **Absolute** [SA]: Coordinates are positions on the table. M2, 5, 3 goes to X=5, Y=3.
- **Relative** [SR]: Coordinates are distances from current position. M2, 5, 3 moves 5 right and 3 back from wherever you are.
- Part files from Aspire use absolute coordinates by default. Avoid mixing modes.

---

## Speed and Feed Configuration

### Speed Types
- **Move Speed** [MS]: The speed during cutting. This is your feed rate.
- **Jog Speed** [JS]: The speed during rapid positioning (non-cutting moves).
- Both are set in IPS (inches per second) or mm/s depending on unit configuration.

### Setting Speeds
```
MS, 2.0, 1.0     'Move: 2.0 IPS XY, 1.0 IPS Z
JS, 4.0, 2.0     'Jog: 4.0 IPS XY, 2.0 IPS Z
VS, 2.0, 1.0, 4.0, 2.0   'Set all speeds at once
```

**When using Aspire post-processed files**: Speeds are embedded in the .sbp file based on your tool database settings. The file overrides manual speed settings.

### Acceleration and Deceleration (Ramping)
- Controlled with [VR] command
- Ramp values determine how quickly the machine accelerates/decelerates
- **Lower ramp values** = faster acceleration (more aggressive, may cause lost steps on heavy gantries)
- **Higher ramp values** = slower, smoother acceleration (safer but slower overall)
- Separate ramp values for Move and Jog speeds
- Default values work well for most situations; adjust only if you see issues

### Feed Rate Calculation
The fundamental relationship:

```
Chip Load = Feed Rate / (RPM x Number of Flutes)
```

- **Chip load** is the thickness of material each flute removes per revolution
- Ideal chip load varies by material and bit diameter (check manufacturer spec sheets)
- Typical chip load for 1/4" bit in wood: 0.003" - 0.007" per flute
- Feed rate in ShopBot is in IPS; convert as needed (1 IPS = 60 IPM)

### Speed Override During Cutting
- During a cut, you can adjust speed in real-time using the speed controls in the Position Window
- Useful for fine-tuning: if you hear chatter, slow down; if the cut looks clean, you can speed up
- This does not change the file -- only the current run

---

## Material Hold-Down Methods

Securing the workpiece is critical. Unsecured material can shift or fly off during cutting.

### Clamps (mechanical)
- Use toggle clamps or C-clamps around the perimeter
- Keep clamps outside the cutting path (verify in preview mode)
- For through-cuts, clamps plus tabs/bridges are standard
- Quick and reliable but limits where the machine can reach

### Screws
- Screw directly through the material into the spoilboard
- Best for material that will be trimmed (screw holes end up in waste area)
- Very secure; allows cutting close to edges
- Use in combination with tabs for through-cuts

### Vacuum Table
- Uses a vacuum pump to hold material down via suction
- Best for flat sheet goods (plywood, MDF, acrylic)
- Requires a dedicated vacuum system and gasket/plenum setup
- Not effective for small or narrow pieces
- Can lose hold during through-cuts (air leaks through the kerf)

### Double-Sided Tape
- 3M VHB or carpet tape between material and spoilboard
- Good for small pieces or finish cuts where clamp marks are unacceptable
- Less secure than mechanical clamping -- not for aggressive cuts
- Difficult to remove cleanly from some materials

### Tabs/Bridges (in the toolpath)
- Small uncut "bridges" between the part and the surrounding material
- Configured per toolpath in Aspire (Tab Length, Tab Height, number of tabs)
- Essential for through-cut profiles on unclamped areas
- Remove after cutting with oscillating saw, flush-cut saw, or chisel + sanding
- 3D tabs (ramp up/down) leave a cleaner result than rectangular tabs

---

## Pre-Cut Checklist

Run through this before every cutting session:

1. [ ] Material is secured (clamps, screws, vacuum, or plan for tabs)
2. [ ] Correct bit installed, tight in collet, correct diameter
3. [ ] XY homed [C3] and zeroed [Z2] at material origin
4. [ ] Z zeroed [C2] at machine bed / spoilboard surface (clean Z-zero plate, clean bit)
5. [ ] Z-zero position set to Machine Bed in Aspire job setup
6. [ ] Material dimensions match Aspire job setup
7. [ ] Dust collection connected and running
8. [ ] Dust shoe positioned correctly
9. [ ] File previewed in Aspire and ShopBot Preview mode [SP]
10. [ ] Air cut performed (spindle off, Z raised) for new/untested files
11. [ ] Spindle speed verified (listen for correct RPM)
12. [ ] Stop button accessible and working
13. [ ] Safety glasses and hearing protection on
14. [ ] Workspace clear of tools, loose material, and bystanders

---

## Running a Cut File

### Step-by-step:
1. Start SB3 Control Software
2. Connect to tool (or continue in Preview mode for testing)
3. Home with [C3], zero Z with [C2], zero XY with [Z2]
4. Switch to Move/Cut mode with [SM]
5. Load file: [FP], select the .sbp file
6. Set parameters in the Fill-In Sheet (proportion, offset, repetitions)
7. Press ENTER to begin execution

### During the cut:
- **SPACEBAR**: Soft stop (controlled deceleration). You can resume or abort.
- **External STOP button**: Hard stop (immediate power cut to motors/spindle)
- Monitor chip size and sound -- adjust expectations by material
- If something looks wrong, hit SPACEBAR immediately. Better to waste time restarting than to break a bit or damage the workpiece.

### Resuming after a stop:
- After a soft stop, SB3 offers options to resume from the current position
- [FG] (File Goto) lets you restart a file from a specific line number
- Useful if a bit breaks mid-cut: change the bit, re-zero Z, then resume

### Multi-file jobs (ATC):
- ATC files include automatic tool changes
- The post-processor generates the tool-change sequence
- Each tool change: retract Z -> stop spindle -> park tool -> pick new tool -> re-zero Z -> start spindle -> continue
- Verify all tools are in the correct rack positions before starting

---

## Troubleshooting

### Cut is too deep / too shallow
- Re-zero Z [C2]. Check Z-zero plate contact.
- Verify Z-zero position matches Aspire (top vs bottom of material)
- Check that material thickness in Aspire matches actual material
- On ATC machines: run ATC_FixZ_Plate.sbp

### Machine loses position (steps)
- Reduce speeds and accelerations
- Check for mechanical binding (debris on rails, loose belts)
- Verify motor cables are secure
- Check for electrical noise (spindle VFD can cause interference)
- Run calibration check: command a 10" move, measure actual distance

### Bit breaks during cut
- Stop immediately [SPACEBAR]
- Common causes: too fast feed, too deep pass, dull bit, chip re-cutting (especially aluminum)
- Replace bit, re-zero Z, resume from the last good line with [FG]

### Burning on cuts
- Feed too slow (material overheats from friction)
- Dull bit
- Wrong bit type for material (e.g., too many flutes for soft material)
- Increase feed rate or reduce RPM

### Chatter / rough finish
- Feed too fast relative to RPM
- Bit is dull or has runout
- Material not secured (vibrating)
- Reduce feed rate or increase RPM
- Check collet tightness

### Machine won't connect
- Check USB cable
- Restart SB3 software
- Check Device Manager for USB driver
- Power-cycle the control box
- Try a different USB port

### Proximity switch issues
- LED should light when metal is within ~2mm
- Check wiring connections at the switch and control box
- Adjust switch position if it triggers too early or too late
- Metal chips can trigger false readings -- keep switch area clean

---

## Maintenance

### Daily
- Clean chips and dust from table, rails, and gantry
- Check dust collection for full bags/filters
- Inspect bit condition before first cut

### Weekly
- Lubricate linear rails/bearings (follow manufacturer's recommendation)
- Check belt tension (if belt-driven)
- Inspect collet for wear, clean with solvent
- Verify machine calibration with a test cut

### Monthly
- Surface spoilboard if needed [TU]
- Check all fasteners for looseness (vibration loosens things over time)
- Inspect wiring for chafing or damage
- Clean proximity switches
- Lubricate Z-axis lead screw

### As Needed
- Replace worn collets (when bit slips or cuts are inconsistent)
- Replace spoilboard when surfacing can no longer flatten it
- Update SB3 software when new versions are released
- Recalibrate axes if dimensional accuracy degrades

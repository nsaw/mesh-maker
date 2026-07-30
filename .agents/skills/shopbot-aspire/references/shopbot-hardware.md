# ShopBot Hardware Reference

## Table of Contents
1. [Desktop MAX ATC V2 Specifications](#desktop-max-atc-v2-specifications)
2. [ATC (Automatic Tool Changer) System](#atc-system)
3. [Spindle and Collet System](#spindle-and-collet-system)
4. [Proximity Switches and Homing](#proximity-switches-and-homing)
5. [Control Box and Electronics](#control-box-and-electronics)
6. [Dust Collection](#dust-collection)
7. [Machine Models Overview](#machine-models-overview)

---

## Desktop MAX ATC V2 Specifications (36x24 Configuration)

The Desktop MAX ATC V2 is a compact CNC router with automatic tool changing capability. This reference is optimized for the 36" x 24" configuration.

**Cutting Area**: 36" x 24" x ~6" (X x Y x Z)
- X = 36" (long axis, left to right)
- Y = 24" (short axis, front to back / gantry travel)
- Z-axis travel accommodates material thickness + clearance (~6")

**Frame**: Welded steel base with aluminum gantry
**Drive**: Stepper motors on all axes, pinion drive on X/Y, lead screw on Z
**Speed**: Max rapid (jog) ~3-4 IPS, max cut speed varies by material
**Resolution**: 0.0005" (half a thousandth)
**Repeatability**: +/- 0.002"

**Spindle**:
- 1HP (750W) HSD/Colombo air-cooled spindle
- ER-20 collet system (standard with ATC variant: ISO20 taper)
- Speed range: ~8,000 - 24,000 RPM (VFD controlled)
- Controlled via ShopBot software (SO commands for spindle on/off)

**Controller**: ShopBot Control Box with USB connection
- SB3 Control Software (Windows)
- Supports OpenSBP and standard G-code

**Power**: 110V/220V depending on configuration
**Weight**: ~250-350 lbs depending on configuration

---

## ATC System

The ATC (Automatic Tool Changer) uses ISO20 taper tool holders with a pneumatic drawbar.

### Tool Holders
- **Type**: ISO20 taper (also called BT20 or similar)
- **Collet**: ER-20 collets pressed into ISO20 holders
- **Available collet sizes**: 1/8", 1/4", 3/8", 1/2" and metric equivalents
- Tool holders sit in a tool rack (typically 4-6 positions)

### Air Requirements
- **Minimum pressure**: 90 PSI at the machine
- **Compressor**: Minimum 2 CFM at 90 PSI
- **Air must be dry and clean** -- use a filter/regulator/lubricator (FRL) unit
- Moisture in the air line will damage the drawbar mechanism

### ATC Operation Sequence
1. Spindle moves to safe Z height
2. Spindle stops (RPM goes to zero, confirmed by sensor)
3. Machine moves to current tool's rack position
4. Drawbar releases (pneumatic) -- tool drops into rack
5. Machine moves to new tool's rack position
6. Drawbar engages (pulls ISO20 taper into spindle)
7. Z-height is automatically recalibrated using the Z-zero plate

### ATC Configuration Files
- **ATC_Configure.sbp**: Run to set up tool rack positions
- **ATC_FixZ_Plate.sbp**: Run if Z-zero plate offset seems wrong
- Tool positions are stored in custom variables that the post-processor uses
- The ShopBot ATC post-processor in Aspire handles tool changes automatically

### ATC Troubleshooting
- **Tool won't release**: Check air pressure (needs 90+ PSI), check for moisture in air line
- **Tool not seating properly**: Clean ISO20 taper surface, check for debris
- **Z-offset wrong after tool change**: Re-run ATC_FixZ_Plate.sbp
- **Machine crashes during tool change**: Re-run ATC_Configure.sbp to verify rack positions
- Always ensure the tool rack area is clear of clamps and material

---

## Spindle and Collet System

### ER-20 Collets (non-ATC machines)
- Collets grip the bit shank and are held by a collet nut
- Available in standard fractional and metric sizes
- Must match the bit shank diameter exactly
- Tighten with the supplied wrenches: one on the spindle shaft, one on the collet nut
- Do not overtighten -- hand-tight plus a firm quarter turn
- Clean collets regularly; dust buildup causes runout

### ISO20 Tool Holders (ATC machines)
- ER-20 collets are pressed into ISO20 holders
- Each tool gets its own holder -- you do not swap collets
- The ISO20 taper provides the machine interface; the ER-20 collet grips the bit
- Set the bit in the holder with the correct stick-out, then tighten the collet nut
- Once set, the tool+holder assembly goes into the tool rack as a unit

### Spindle Speed Control
- Controlled by VFD (Variable Frequency Drive) in the control box
- ShopBot software sends speed commands via RS-485 or analog signal
- In SBP files, spindle is controlled via the `TR` (Tool RPM) and `SO` (Switch Output) commands
- The Aspire post-processor handles spindle commands automatically
- Allow 2-3 seconds for the spindle to reach target RPM after start command

---

## Proximity Switches and Homing

### Proximity Switch Function
- X, Y, and Z axes each have proximity switches at their home positions
- These are inductive sensors that detect metal at close range (~2mm)
- Used for homing (finding the machine's reference position)
- LED indicator on the switch lights when triggered

### Homing Procedure
- **C3**: Home X and Y axes using proximity switches
- **C2**: Zero Z axis using the Z-zero plate (touch-off plate)
- After homing, the machine knows its absolute position on the table

### Z-Zero Plate
- A metal plate placed on top of the material (or spoilboard for Z-zero-to-table)
- Connected to the control box via a clip lead
- The Z axis moves down slowly until the bit contacts the plate
- The plate thickness is pre-calibrated -- the software accounts for it
- **Critical**: The plate and bit must be clean for accurate zeroing
- If using ATC, the Z-zero plate is also used after each tool change to calibrate tool length

### Limit Checking
- Software limit checking [SF] prevents the machine from moving beyond table boundaries
- Requires the Base Coordinate System [ZT] to be set correctly
- Default limits are for full-size (96" x 48") tables -- adjust with [VL] for smaller machines

---

## Control Box and Electronics

### Control Box
- Houses stepper motor drivers, power supply, USB interface, relay board
- USB connection to Windows PC running SB3 software
- Status LEDs indicate power, connection, and motor enable states
- DO NOT disconnect USB during cutting operations

### Input/Output Switches
- **Input switches** (proximity sensors, Z-zero plate, stop button): Read with [VN]
- **Output switches** (spindle, dust collector, coolant): Controlled with [SO]
  - SO,1,1 = Turn on output 1 (typically spindle)
  - SO,1,0 = Turn off output 1
  - Output assignments depend on wiring configuration

### Stop Button
- External stop button connects to the control box
- Pressing it cuts power to motors and spindle (hard stop)
- Different from SPACEBAR soft stop (controlled deceleration)
- PRS models have Emergency Stop switches that cut all power

---

## Dust Collection

- CNC routing produces enormous amounts of dust and chips
- **Required for**: MDF, plywood, any prolonged cutting
- Minimum 2" hose diameter, 4" preferred for heavy chip loads
- Dust shoe/skirt attaches to the Z-axis carriage and surrounds the bit
- Adjust dust shoe height so it lightly brushes the material surface
- Connect to shop vacuum (minimum) or dedicated dust collector (preferred)
- Automating dust collector via output switch (SO command) is recommended

---

## Machine Models Overview

| Model | Cut Area | Key Feature |
|-------|----------|-------------|
| Desktop | 24" x 18" | Entry-level, manual tool change |
| Desktop MAX | 24" x 18" / 36" x 24" | Higher performance, optional ATC |
| Desktop MAX ATC | 24" x 18" / 36" x 24" | Automatic tool changer |
| Buddy | 32" x 18" | Entry-level, compact |
| PRSstandard | 48" x 96" (and others) | Full-size production |
| PRSalpha | 48" x 96" (and others) | Highest speed/performance |

All models use the same SB3 control software and OpenSBP language. The fundamental workflow (Aspire -> post-process -> SB3 -> cut) is identical across all models. The main differences are cutting area, spindle options, and mechanical rigidity.

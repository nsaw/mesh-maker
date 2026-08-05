# OpenSBP Command Reference

All ShopBot operations use two-letter commands from the OpenSBP language. The first letter identifies the category, the second specifies the action. Parameters follow the command, separated by commas.

## Table of Contents
1. [Command Structure](#command-structure)
2. [Move Commands (M)](#move-commands)
3. [Jog Commands (J)](#jog-commands)
4. [Cut Commands (C)](#cut-commands)
5. [Zero Commands (Z)](#zero-commands)
6. [Speed Commands (MS/JS/VS)](#speed-commands)
7. [Set Commands (S)](#set-commands)
8. [Values Commands (V)](#values-commands)
9. [File Commands (F)](#file-commands)
10. [Record Commands (R)](#record-commands)
11. [Tools Commands (T)](#tools-commands)
12. [Utility Commands (U)](#utility-commands)
13. [Output Switch Commands (SO)](#output-switch-commands)
14. [Help Commands (H)](#help-commands)

---

## Command Structure

```
[XX] param1, param2, param3
```
- Commands are 2 letters, entered sequentially (e.g., type "M" then "Z")
- Parameters separated by commas
- Blank parameters use current/default values: `M2, ,5` moves only Y to 5
- Parameters accept formulas: `MZ, 1.5 * SQR(4.2)/(23-12.23)`
- ShopBot also reads standard G-code (loaded via [FP] or [FC])

---

## Move Commands

Move commands execute at the current **Move/Cut speed** (set with [MS] or [VS]).

| Command | Description | Parameters |
|---------|-------------|------------|
| **M2** | Move 2D (X,Y) | x, y |
| **M3** | Move 3D (X,Y,Z) | x, y, z |
| **M4** | Move 4D (X,Y,Z,A) | x, y, z, a |
| **M5** | Move 5D (X,Y,Z,A,B) | x, y, z, a, b |
| **MX** | Move X axis only | x |
| **MY** | Move Y axis only | y |
| **MZ** | Move Z axis only | z |
| **MA** | Move A axis only | a |
| **MB** | Move B axis only | b |
| **MH** | Move Home (0,0) | _(none)_ |
| **MD** | Move by Distance+Angle | length, angle, z-change |
| **MN** | Move Nudge | _(interactive panel)_ |
| **MI** | Move Indexer/Oscillate | axis, direction, speed, freq, distance |

**Key behavior**:
- All moves are interpolated (diagonal moves are smooth arcs, not stairstepped)
- Absolute vs Relative mode set by [SA] / [SR]
- Z values: positive = up (away from material), negative = down (into material)
- [MH] always moves to absolute 0,0 regardless of relative mode
- If Z is below Safe-Z height, Z retracts first before XY move

---

## Jog Commands

Jog commands execute at the current **Jog speed** (set with [JS] or [VS]). Jog speed is typically faster than Move speed -- used for rapid positioning, not cutting.

| Command | Description | Parameters |
|---------|-------------|------------|
| **J2** | Jog 2D (X,Y) | x, y |
| **J3** | Jog 3D (X,Y,Z) | x, y, z |
| **J4** | Jog 4D | x, y, z, a |
| **J5** | Jog 5D | x, y, z, a, b |
| **JX** | Jog X axis | x |
| **JY** | Jog Y axis | y |
| **JZ** | Jog Z axis | z |
| **JA** | Jog A axis | a |
| **JB** | Jog B axis | b |
| **JH** | Jog Home (0,0) | _(none)_ |
| **JS** | Jog Speed set | xy-speed, z-speed, a-speed, b-speed |

---

## Cut Commands

Cut commands create geometric shapes directly from the control software or in part files.

| Command | Description | Key Parameters |
|---------|-------------|---------------|
| **CA** | Cut Arch | arch-length, arch-height, O/I/T, direction, angle, plunge, repetitions |
| **CC** | Cut Circle | diameter, O/I/T, direction, begin-angle, end-angle, plunge, repetitions, proportions, TAB/POCKET/SPIRAL |
| **CG** | Cut G-code Circle | diameter, x-end, y-end, center-offsets, O/I/T, direction, plunge |
| **CP** | Cut Circle from Center | diameter, x-center, y-center, O/I/T, direction, angles, plunge |
| **CR** | Cut Rectangle | length-x, length-y, O/I/T, direction, start-corner, plunge, repetitions, TAB/POCKET |

**Common parameters across cut commands**:
- **O/I/T (Out/In/True)**: O = path outside specified dimension, I = inside, T = on the line (default)
- **Direction**: 1 = clockwise, -1 = counter-clockwise
- **Plunge**: Depth per pass (negative = into material)
- **Repetitions**: Number of passes (increasing depth each pass)
- **TAB feature**: Creates holding tabs on the last pass (TAB size set with [VB])
- **POCKET**: Clears interior with concentric passes
- **SPIRAL**: Plunges gradually while circling (no abrupt plunge)

---

## Zero Commands

| Command | Description |
|---------|-------------|
| **Z2** | Zero X and Y axes (sets current position as 0,0) |
| **Z3** | Zero X, Y, and Z |
| **Z4** | Zero X, Y, Z, and A |
| **Z5** | Zero all 5 axes |
| **ZX** | Zero X axis only |
| **ZY** | Zero Y axis only |
| **ZZ** | Zero Z axis only |
| **ZA** | Zero A axis |
| **ZB** | Zero B axis |
| **ZT** | Zero Table Base Coordinates (sets permanent reference) |

**Zeroing philosophy**:
- Working coordinates (Z2, Z3, etc.) are temporary -- they define your project origin
- Table Base Coordinates (ZT) are permanent -- they define the machine's physical reference
- Use [C3] (proximity switch homing) + [C2] (Z-zero plate) for repeatable setup
- [VA] redefines current position to specific values without moving

---

## Speed Commands

| Command | Description | Parameters |
|---------|-------------|------------|
| **MS** | Move/Cut Speed | xy-speed, z-speed, a-speed, b-speed |
| **JS** | Jog Speed | xy-speed, z-speed, a-speed, b-speed |
| **VS** | Values for all Speeds | move-xy, move-z, jog-xy, jog-z, a-speed, b-speed |

**Speed units**: Inches per second (IPS) or mm per second, depending on [VU] setting.

**Important**: MS and JS commands create ramp-down/ramp-up sequences when placed between moves. Use [VS] instead if you want to change speed without interrupting motion (within a "move stack").

**Ramp settings**: Configured with [VR]. Controls acceleration and deceleration rates. Higher ramp values = slower accel/decel but smoother motion. Lower values = faster but more aggressive.

---

## Set Commands

| Command | Description |
|---------|-------------|
| **SA** | Set to Absolute distance mode |
| **SR** | Set to Relative distance mode |
| **SF** | Set File and Move Limit Checking on/off |
| **SI** | Send Command Line(s) directly to controller |
| **SK** | Set KeyPad Arrows to Move Tool |
| **SL** | Set to Clear all Variables in Memory |
| **SM** | Set to Move/Cut mode (from Preview) |
| **SO** | Set Output Switch (see below) |
| **SP** | Set to Preview mode |
| **ST** | Set location to Table Base Coordinates |
| **SV** | Set Values to Permanent (in part files only) |
| **SW** | Set Warning Duration |

---

## Values Commands

Values commands configure machine parameters persistently.

| Command | Description |
|---------|-------------|
| **VA** | Values for Axis Locations (redefine current position) |
| **VB** | Values for Tabbing Feature (tab height, width, spacing) |
| **VC** | Values for Cutter-related Parameters (safe-Z, bit diameter) |
| **VD** | Values for Display Settings |
| **VH** | Values for Z-axis Height Controller |
| **VI** | Values for Communications Port |
| **VL** | Values for Table Limits |
| **VN** | Value Input Switch Assignment |
| **VO** | Value Temporary Tool Offset |
| **VP** | Values for Preview Screen |
| **VR** | Values for Ramps (acceleration/deceleration) |
| **VS** | Values for all Speeds |
| **VU** | Values for Calibration Units |

**Key values**:
- **VB** (Tabbing): Sets tab height, width, and minimum distance between tabs
- **VC** (Cutter): Sets Safe-Z height, bit diameter for cut commands
- **VL** (Limits): Sets X, Y, Z travel limits for limit checking [SF]
- **VR** (Ramps): Controls accel/decel rates per axis. Lower = faster but more jerky
- **VU** (Units): Sets steps-per-unit for each axis, circle resolution. Calibration-critical.

---

## File Commands

| Command | Description |
|---------|-------------|
| **FP** | File Load and Run Part File (.sbp, .tap, .nc, .gcode) |
| **FG** | File Load in Goto/Single-Step Mode |
| **FE** | File Edit (open in text editor) |
| **FC** | File Convert (.dxf, .plt, .hpg, .bmp, .jpg, .nc to .sbp) |
| **FS** | File Set Parts Directory |

**FP is the primary command for running cut files.** Parameters:
- Filename, proportion-X, proportion-Y, proportion-Z, repetitions
- Offset: 0=none, 1=3D offset, 2=2D offset (from current position)
- TAB feature, plunge from Z-axis 0

**2D Offset mode** is extremely useful: run the same part file at different positions on the material by positioning the tool, then using `FP, MYPART.SBP, , , , , 2` to cut with 2D offset.

---

## Record Commands

| Command | Description |
|---------|-------------|
| **RA** | Record Activate (start recording commands) |
| **RI** | Record Inactivate (stop recording) |
| **RP** | Record Play all stored commands |
| **RR** | Record Replay last commands |
| **RS** | Record Save to file |
| **RZ** | Record Zero (clear stored commands) |

Useful for creating simple part files by recording manual operations.

---

## Tools Commands

| Command | Description |
|---------|-------------|
| **TC** | Tools Copy Machine (copy from another ShopBot's settings) |
| **TD** | Tools Drill Press (interactive drill tool) |
| **TF** | Tools Forney Fluter |
| **TH** | Tools Header Writer (create part file headers) |
| **TI** | Tools Indexer |
| **TS** | Tools ShopBot Setup (interactive setup wizard) |
| **TT** | Tools Typesetter (text cutting tool) |
| **TU** | Tools Tabletop Surfacer |

**TU (Tabletop Surfacer)** is particularly important: it cuts a thin skim pass across the entire spoilboard to make it perfectly parallel to the gantry's XY plane. Run this periodically and after any mechanical adjustment.

---

## Output Switch Commands

**SO** (Set Output Switch) controls external devices wired to the control box.

```
SO, switch-number, state
```
- `SO, 1, 1` -- Turn on switch 1 (typically spindle relay)
- `SO, 1, 0` -- Turn off switch 1
- Switch assignments vary by machine configuration
- Common: Switch 1 = spindle, Switch 2 = dust collector

The Aspire post-processor includes SO commands automatically for spindle control.

---

## Help Commands

| Command | Description |
|---------|-------------|
| **HA** | Help About (software version) |
| **HB** | Help ShopBot Website Tech Bulletins |
| **HC** | Help Command Reference |
| **HE** | Help Quick Reference (editable) |
| **HN** | Help Send Tech Support Request |
| **HQ** | Help Quick Reference Page |
| **HR** | Help Quick Reference (printable) |
| **HT** | Help Troubleshooting & Maintenance |
| **HU** | Help User Guide |
| **HW** | Help ShopBot Website |

---

## Part File Programming Notes

Part files (.sbp) are plain text files containing OpenSBP commands, one per line. They can also include:

- **Comments**: Lines starting with `'` (apostrophe)
- **Variables**: User-defined with `&variable = value`
- **Conditional logic**: `IF`, `THEN`, `ELSE`, `ENDIF`
- **Loops**: `GOTO` with labels
- **Math expressions**: SQR(), SIN(), COS(), TAN(), ABS(), INT(), etc.
- **Input/output**: `INPUT` for user prompts, `PRINT` for messages

Example part file:
```sbp
'Simple rectangle cut
SA          'Set absolute mode
MS, 1.5     'Set move speed to 1.5 IPS
JS, 3.0     'Set jog speed to 3.0 IPS
SO, 1, 1    'Spindle on
PAUSE 3     'Wait 3 seconds for spindle to spin up
MZ, -0.25   'Plunge to 0.25" depth
M2, 6, 0    'Cut to X=6
M2, 6, 4    'Cut to Y=4
M2, 0, 4    'Cut to X=0
M2, 0, 0    'Return to start
MZ, 1.0     'Retract Z
SO, 1, 0    'Spindle off
MH          'Move home
```

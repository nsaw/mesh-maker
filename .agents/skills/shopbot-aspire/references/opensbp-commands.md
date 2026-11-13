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
- All moves are interpolated and fully speed-vectored: a diagonal is a straight line, not a stairstep, and the cutter tip holds constant velocity whether moving in X, Y, on a diagonal, or through a curve. Motors audibly change speed on diagonals and circles to keep that vector constant — that is correct behavior, not a fault.
- Absolute vs Relative mode set by [SA] / [SR]
- Z values: positive = up (away from material), negative = down (into material)
- [MH] always moves to absolute 0,0 regardless of relative mode
- Ordinary moves and jogs do not retract to Safe-Z first. Safe-Z (`%(28)`) applies only to `[MH]`, `[JH]`, movement-block reloads and tabbing, so lift Z explicitly before an XY move

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

**You cannot debug a settings problem from command names alone.** Each V command writes one
comma-separated line into `shopbot.ini`, and an out-of-range value raises a modal that names
only the command, never the parameter. The full ordered parameter lists below are transcribed
from ComRef.pdf; positional defaults are in parentheses.

### VA — Axis Locations
`{x, y, z, a, b, tableBase-x, tableBase-y, tableBase-z, tableBase-a, tableBase-b}`
Redefines the current position without moving. Changing working coordinates does **not**
change Table Base Coordinates. The last five parameters set TBC directly and exist mainly so
TBC can be persisted in `shopbot.ini`.

### VB — Tabbing
`{distance-to-pull-UP (.1), distance-to-next-TAB (4), size-of-TAB (1), distance-of-leads (.5), 1-ON/0-OFF, number, start-distance}`
Total tab footprint is the TAB size **plus** both leads. Distances are measured from the
cutter centerline, so cutter diameter has to be accounted for.

### VC — Cutter Parameters
`{diameter (.25), -obsolete-, -obsolete-, safe-Z-pull-up (1), plunge-direction (-), %-pocket-overlap (10), safe-A-pull-up (1), triggered-output-switch, trigger-ON-threshold, trigger-OFF-threshold, vertical-axis-monitored, triggered-output-switch-#}`
Safe-Z here is what `[MH]`/`[JH]` and movement-block reloads retract to. Cutter diameter is
readable in a part file as system variable `%(23)`.

### VD — Display Settings
`{-obsolete-, number-of-axes (3), linear-units (0=in, 1=mm), units-type-A, units-type-B, -obsolete-, display-file-comments (0), keypad-fixed-distance (.1), keypad-remote (0), write-part-file-log (1), write-system-log (1), msg-screen-loc-X, msg-screen-loc-Y, msg-screen-size-X, msg-screen-size-Y, show-file-progress (0), keypad-switches-auto-off (0), show-file-progress, main-display-type (1)}`
**Parameter 3 is the inch/mm switch, and changing it recalculates and saves every other system
value** — locations, calibrations, tool sizes, speeds, ramps. Check this parameter first
whenever stored numbers look scaled by 25.4. Parameters 10 and 11 control whether the
per-job `.LOG` and `sbsys.log` get written; both default on, and both are needed for
`[FG]` restart and for run history.

### VH — Z Height Controller / Laser / Heater
`{height-control-mode (0), plasma-height-rate (.25), laserPWM%-low (0), laserPWM%-high (0), laser-pulse-freq-KHz (5.4), low-cycle-time (3), set-temperature (0)}`
Must be enabled first in `[VN]` parameter 3.

### VI — Comm Port and Driver Channels
`{comm-port, -obsolete-, -obsolete-, -obsolete-, driver-ch-1, driver-ch-2, driver-ch-3, driver-ch-4, speed (5), driver-ch-5, driver-ch-6, enable (1)}`
Standard mapping: channel 1=X, 2=Y, 3=Z, 4=A, 5=B, 6=C. Reverts at end of part file unless `[SV]`.

### VL — Table Limits
`{low-X, high-X, low-Y, high-Y, low-Z, high-Z, low-A, high-A, limit-checking (1=ON/0=OFF), low-B, high-B}`
Evaluated against **Table Base Coordinates**, not working coordinates. Parameter 9 is the same
switch as `[SF]`.

### VN — Input/Output Switch Assignment
`{limit-switches-active (1), stop-switch-#4-mode (0=normally-closed), torch/laser/analog (0), input-switch-mode for inputs 1-3 and 5-12 (0=standard), ..., output-switch-mode for outputs 1-12 (0), ...}`
Input 4 is hard-wired as Emergency Stop on alpha tools and Remote Stop on standard tools.
Output switch modes: 0 = on from console/`SO`, auto-off at end of file; 1 = no auto-off;
2 = off on Stop, back on if restarted; 3 = auto-on at file start, auto-off at end;
4 and 5 = auto-on, then never off (4) or off on Stop (5).

### VO — Temporary Tool Offset
`{activate (1=ON, 2=OFF), offset-X, offset-Y, offset-Z, offset-A, offset-B, offset-C}`
Offsets are added to the displayed position, and stack with any file offset or proportion.

### VP — Preview Screen
`{grid (6), table-size-X (96), table-size-Y (48), table-size-Z (6), simulate-cutting (0=off), draw-tool (1=on), start-at-real-position (1=on), draw-jogs (1=on), left-panel-behavior, right-panel-behavior}`
Display only. It cannot affect motion, feeds, or geometry.

ComRef documents only the first eight parameters. **The fill-in sheet exposes two more**,
Left Panel Behavior and Right Panel Behavior, each taking `-1 Leave as is`, `1 Force open`, or
`0 Force closed`. `-1` is the factory value on the Desktop MAX profile and is legitimate.

Grid Size has a floor of 1. A stored VP line whose grid has drifted below 1 will raise
`Parameter Value Below Range for VP -- Setting to Lower Limit ( 1 )`. That modal, raised
mid-file, can abort a running cut — see `sb3-config-logs-and-recovery.md`. Keep grid at the
documented default of 6 rather than parked on its floor.

### VR — Ramps
`{XY-move-ramp-speed (.4), Z-move (.4), A-move (.4), B-move (.4), XY-jog (.4), Z-jog (.4), A-jog (.4), B-jog (.4), move-ramp-rate (.2), jog-ramp-rate (.2), 3D-threshold (100%), minimum-distance-to-check (.15), slow-corner-speed (65%), -obsolete-, -obsolete-, keypad-ramp-rate (.2), small-circle (.25)}`
Ramp Speed is the start/end speed of a move **and the floor speed for intricate work** — a run
of short segments executes at Ramp Speed rather than oscillating. Below about .2 in/sec is
counterproductive; above about 1.2 in/sec causes jarring starts. Ramp Rate is a *distance*:
how far the tool takes to change speed by 2 units. Higher = longer, smoother ramps.
Corners sharper than 43 degrees always force a full ramp down.

Doc discrepancy, unresolved: ComRef lists Small Circle under `[VR]` with default .25, while
the UsersGuide describes the same behavior as the 8th parameter of `[VU]` with default .20.
Verify against the live fill-in sheet before relying on either.

### VS — All Speeds
`{XY-move, Z-move, A-move, B-move, XY-jog, Z-jog, A-jog, B-jog}` in units/sec.
Reverts at end of part file unless `[SV]`. Unlike `[MS]`/`[JS]`, `VS` does **not** break the
move stack, so use it for mid-toolpath speed changes you do not want to punctuate with a
ramp-down/ramp-up.

### VU — Calibration Units
`{x-unit, y-unit, z-unit, a-unit, circle-segment-resolution (.05), -obs-, -obs-, -obs-, b-unit, resM-x, resM-y, resM-z, resM-A, resM-B, step-interval-divider (1), disable-res-shifting (0)}`
Units are exact steps per inch/mm/degree per axis and are calibration-critical — do not guess
them; load the machine's settings file via `[UR]`. Circle resolution can go as low as .005 but
low values consume movement-block memory and can force mid-circle reloads. Resolution
multipliers are 1 on PRS/PRT standard tools. Reverts at end of part file unless `[SV]`.

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

> **DO NOT RUN THIS EXAMPLE ON NICK'S MACHINE AS WRITTEN (flagged 2026-11-10).** It assumes Z zero
> at the top of the material. Nick's Z zero is always the machine bed, so `MZ, -0.25` commands the
> bit 0.25 in below the spoilboard surface, and `MZ, 1.0` is not a retract above stock thicker
> than 1 in. With bed zero and stock of thickness T, a cut d deep is `MZ, T - d` and a retract is
> above T. The example is kept for syntax only and has not been rewritten, because a corrected
> file needs real stock and safe-Z values from the laptop.

Example part file (top-of-material Z zero, syntax illustration only):
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

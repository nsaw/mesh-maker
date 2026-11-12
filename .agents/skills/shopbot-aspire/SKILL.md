---
name: shopbot-aspire
description: "Comprehensive CNC routing skill covering ShopBot CNC routers (Desktop MAX ATC V2, PRS, Buddy) and Vectric Aspire V12 CAD/CAM software. Use this skill whenever the user mentions ShopBot, Vectric, Aspire, VCarve, CNC routing, toolpaths, V-carving, 3D carving, CNC setup, post-processors for CNC, OpenSBP commands, SBP programming, feeds and speeds for CNC routers, bit selection for wood/plastic/aluminum routing, ATC (automatic tool changer) operations, Z-zeroing, XY homing, spoilboard surfacing, dust collection setup, material hold-down, climb vs conventional cutting, or any CNC woodworking/fabrication workflow. Also trigger when the user references .sbp files, .crv files, .crv3d files, ISO20 toolholders, ER-20 collets, or ShopBot control software (SB3). This skill spans the full pipeline from 2D/3D design in Aspire through toolpath generation to machine operation and troubleshooting."
---

# ShopBot CNC + Vectric Aspire Skill

> ## STOP. READ THIS BEFORE YOU QUOTE A SINGLE NUMBER.
>
> **No machining value leaves this skill without a citation and a declared unit.**
> Feed rate, plunge rate, RPM, chip load, depth of cut, stepover. Every one, every time.
> On the shop laptop `~/.claude/rules/cnc-safety.md` is loaded in every session and outranks this
> file. On the Mac it is not auto-loaded: read `~/.claude/windows/rules/cnc-safety.md` before
> stating any machining value.
>
> **The numbers in this skill are Nick's conservative starting points for THIS machine.
> They are not manufacturer specification.** They are already dialled back 15-25% from
> published figures because a 1HP spindle on stepper drives cannot hold industrial feeds.
> Never present them as spec. Never write them into `tools.vtdb` as sourced data. Never
> apply them to a different machine, tool, or material.
>
> **Units.** SB3 is inches per SECOND. Bit catalogs publish inches per MINUTE. `IPM/60=IPS`.
> A catalog number dropped into an IPS field is 60x too fast. Show the arithmetic.
>
> **Drills only plunge.** A drill gets plunge rate, peck depth, retract. Never a feed rate.
>
> **Never bulk-edit the tool database.** One tool at a time, each value cited, shown to Nick
> before it is written. A PreToolUse hook blocks the write; that hook is the system working.
>
> **Never claim you verified something you did not.** If you say you read a row, the tool
> call is in the transcript. In August 2026 a claimed line-by-line verification that never
> happened put ~30x feed rates in front of a live spindle. That is what these rules exist
> to prevent.
>
> **Which machine you are on decides what you can do.** This body is shared with the shop
> laptop's copy (`~/.claude/windows/skills/shopbot-vectric-aspire/`, verified at the machine
> 2026-08-05 to 2026-08-09). Paths beginning `C:` or `Z:` are on the laptop.
>
> **On the Mac (where all modeling happens) you cannot touch the machine, Aspire or SB3.** Your
> job ends at a handoff packet: geometry that can be machined, with its units and limits stated.
> Read `references/relief-machinability.md` for that. Aspire toolpaths and cut files are authored
> at the laptop. The tool database lives in Vectric's cloud. Every file under
> `Dropbox/ShopBot [DROPBOX]/` and `Dropbox/shopbot-dump/` is stale and inactive (Nick, 2026-11-10);
> do not read tooling or machine values from them.
>
> **Tooling numbers are not a Mac concern.** Feeds, speeds and tool choice are set in Aspire at
> the laptop. The current shop-laptop skills, including `cnc-tooling`, are on the dotclaude branch
> `windows/shopbot-skill-and-export-fixes`; read them with
> `git -C ~/.claude show origin/windows/shopbot-skill-and-export-fixes:skills/cnc-tooling/SKILL.md`
> and never leave `~/.claude` checked out on that branch. The feed tables further down this file
> are older than that skill and disagree with it; do not quote them as recommendations.

This skill covers the complete CNC routing workflow: designing in Vectric Aspire, generating toolpaths, configuring post-processors for ShopBot machines, and operating the machine safely and effectively. It is organized as a reference system -- read the relevant section for the task at hand.

**Owner's machine**: ShopBot Desktop MAX ATC V2. Aspire and SB3 both run on the Windows shop
laptop (`shopbot`); the Mac never touches the machine.

Verified from the live config on 2026-08-05 (`shopbot.ini`, `ShopBot_PRSDesktopMAX3624.sbd`,
`ATC_variables.sbc`):

- SB3 v3.9.14, control box firmware 224, USB serial on COM3.
- Nominal work area 36 x 24 (the factory profile is literally named `...DesktopMAX3624`), but
  **travel is larger than the work area**. The ATC clips sit at X 39.718, outside the 36"
  work area.

  **`VL` X max is 38, not 40. Re-verified against live `shopbot.ini` 2026-08-09:**
  `VL, -1.003, 38, -1.003, 26, -3.3439, 8`. An earlier version of this file said 40 and
  Z -3.0154; both were stale.

  **38 is Nick's deliberate workaround, not a factory value. Do not "restore" it to 40.**
  Factory for this machine is 40/26 (X extended to cover the toolbar at 39.569-39.75;
  Y is the usual 24+2). The 38 pulls the default limit back inside the ATC zone so ordinary
  operation cannot wander in, while the ATC routines set 40/26 for themselves when they need
  it. **Any new ATC-adjacent routine must either set `VL,,40,,26` itself or use `SF,0`, or it
  will be blocked at 38.** Audited: `DT_ATC.sbp` and `DT_ATC_Zzero.sbp` set 40/26,
  `DT_ATC_Calibrate.sbp` uses `SF,0`, `ATC_Get_PlateOffset.sbp` never reaches the toolbar.

  **X boundary map:** 36 = table edge (`VP` param 2), ~37 = X prox sensor, 38 = soft limit,
  39.569 / 39.609 = Z plate / tool clips. **An X prox sits between the table and the ATC
  zone, and parking outside table bounds maroons the head** -- it will not home or jog back
  on. Single-tool Z-zero must park inside table bounds; the all-tools path must stay in the
  ATC zone. Those two paths are deliberately inconsistent. Do not "fix" that.
- ATC: `&ATC = 7`, 28 clip positions, `&MinTool = 1`, `&MaxTool = 7` (tools 1-7 have real
  measured Z offsets; 8+ are placeholder -5).
- Spindle commanded at 18000 RPM by the current post output (`TR,18000`).
- **Table Base Coordinate Z has DRIFTED and is not stable. Read it, never cache it.**
  -2.995 across jobs to May 2026, -3.3179 on 2026-08-07, **-3.3239 in live `shopbot.ini`
  on 2026-08-09** (`VA` param 8). That is 0.33" of movement, and safe-Z math is computed
  from it: `safeZ = -%(8) - &proxClearance - %(63)`. At the current value that yields
  **3.074**. A stale `%(8)` is exactly what turns an absolute `JZ` clearance move into a
  plunge, so any clearance move must be written as a guarded lift:
  `IF %(3) < &x THEN JZ, &x`.
- `%(28)` is Safe-Z (`VC` param 4, currently 2) and governs **only** `[MH]`, `[JH]`,
  movement-block reloads and tabbing -- **never** ordinary jogs or `J2`/`JX`/`JY`. Lifting
  Z before an XY move must be coded explicitly.
- Cutter diameter is `%(20)` per `ComRef.pdf`.
- X, Y and Z prox all share **input 3** on this machine (`ATC_Settings.sbc:259-261`).
  Generic ShopBot docs say 2/3/5. The live file wins.
- `VN,0` (limit switches off) **persists to disk**; only `VL`/`SF` limit *checking*
  auto-reverts at file end. Several ATC exit paths leave it disabled.

Confirmed against ShopBot's published Desktop MAX ATC V2 specs: 1HP ATC spindle with
pneumatically actuated drawbar, ISO20 tool holders, a toolbar of **seven** ER-20 toolholders
taking shanks to 1/2", 120V household power, and **an air supply of 4 CFM at 90 PSI is
required for the toolchanger**. The seven holders line up exactly with `&MaxTool = 7` in the
live config, which is a good cross-check that the machine is configured as shipped.

**Owner's preferences**:
- Z-zero is ALWAYS machine bed (spoilboard surface), never top of material. Aspire job setup
  must use "Machine Bed" for Z-zero position. Confirmed in live post output:
  `&PWZorigin = Table Surface` and header `Home Position Information = Bottom Left Corner, Table Surface`.
- Primary materials: hardwoods (oak, maple, walnut) and hard sheet goods (baltic birch plywood). MDF only for templates.
- The standard/published feeds and speeds for the Desktop MAX ATC are typically too aggressive on feed rates. This machine's spindle and stepper drives can't sustain the same feeds as a PRS or industrial router. When in doubt, reduce feeds by 15-25% from published starting points.
- **Tool database (live, on the machine where Aspire actually runs):**
  `C:\ProgramData\Vectric\Aspire\V12.0\ToolDatabase\tools.vtdb`
  Aspire keeps dated copies in `...\V12.0\Backups\ToolDatabase\tools_YYYY-MM-DD.vtdb`. Those
  backups cover the tool database only — **there is no autosave or recovery for `.crv3d`
  project files.**

## Before you assert anything about this machine

Today's failure mode, twice over, was answering from a stale file and from an unverified
reading of a dialog. Three rules:

1. **Live SB3 config is `C:\ProgramData\ShopBot\ShopBot 3\shopbot.ini`.** Every
   `CustomSettings*.sbd` on the box is a stale export. Diff against the factory profile
   `Settings\ShopBot_PRSDesktopMAX3624.sbd`, never against `default.sbd` (that one is for a
   96x48 tool).
2. **The shipped PDFs are older than this machine.** The ATC PDF's `&ATC` value list stops at
   2; this machine is 7. Prefer the live `.sbc` files.
3. **A blank entry in the Custom menu does not mean unassigned.** The label is just the first
   comment line of the `.sbc`.
4. **Know which version you are quoting.** Shipped PDFs are 2015, the shipped README stops at
   3.8.74 (Nov 2022), the running binary is **3.9.14**, and current is **3.9.20** (9/24/25).
   Live files beat manuals every time. An upgrade overwrites Custom #2,3,5,6,7,9 and #70+,
   which is the entire ATC chain — see `references/sb3-versions-and-maintenance.md` before
   suggesting one.

## Quick Reference: Where to Look

| Task | Reference File |
|------|---------------|
| **A cut aborted, a settings dialog fired, "where is the config"** | **`references/sb3-config-logs-and-recovery.md`** |
| **ATC calibration, tool measurement, plate offset, toolchange failures** | **`references/atc-desktop-max-v2.md`** |
| **Version differences, upgrade risk, chip load, maintenance, troubleshooting triage** | **`references/sb3-versions-and-maintenance.md`** |
| **Which post produced a file, tool database layout, Aspire logs, toolpath defaults** | **`references/aspire-installation-layout.md`** |
| OpenSBP commands, full V-command parameter lists | `references/opensbp-commands.md` |
| Part-file logic, variables, GOSUB/RETURN, move stacks, `Custom*.sbc` | `references/sbp-programming.md` |
| Machine specs, ATC setup, hardware | `references/shopbot-hardware.md` |
| Zeroing, coordinates, speeds, safety | `references/shopbot-operations.md` |
| Aspire job setup, design, 3D modeling | `references/aspire-workflow.md` |
| Toolpath types and parameters | `references/aspire-toolpaths.md` |
| Tool database, post-processors | `references/aspire-tools-postprocessors.md` |

**Resuming an aborted cut is `[FG]` — go to line, then Run from Here. Do not prime the
console first.** Full procedure and the reasons in `references/sb3-config-logs-and-recovery.md`.

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
- Select a **toolchange-capable** ShopBot post. Everything else produces a file with no `C9`
  and therefore no toolchange at all. On this machine the post actually used is
  **`ShopBot TC (inch)(*.sbp)`**, which lives in the machine-configuration database
  `PostP\postp.ppdb`, not in the `PostP\02-ShopBot` folder. Confirmed from the Aspire log,
  which names the post on every save and correlates to the `.sbp` mtime within 200 ms.
  The legacy folder equivalents are `ShopBot(inch)(Toolchange)w/speed(*.sbp)` and its MM
  twin — the only two of the 26 `.pp` files that emit `C9`.
  **Do not infer the post from the output's shape**; the database and legacy posts produce
  near-identical files. Read `Aspire\V12.0\Logs\debug_<date>_0.log`. See
  `references/aspire-installation-layout.md`.
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

> **These are NOT manufacturer specifications.** Every number below is Nick's own
> conservative starting point for the Desktop MAX ATC V2, arrived at by cutting. Feeds are
> in **IPS (inches per second)**, which is what SB3 uses. Bit catalogs publish IPM. Do not
> mix them: `IPM/60 = IPS`.
>
> Quote these only as "Nick's starting point, not a manufacturer spec." Do not write them
> into `tools.vtdb` as sourced data. Do not extend them to a tool, material, or machine not
> listed here. If you need a value for something not on this page, read the manufacturer
> catalog. Do not interpolate from these.

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

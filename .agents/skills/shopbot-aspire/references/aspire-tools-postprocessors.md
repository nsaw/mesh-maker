# Vectric Aspire V12 - Tool Database and Post-Processors

## Table of Contents
1. [Tool Database Overview](#tool-database-overview)
2. [Tool Types and Geometry](#tool-types-and-geometry)
3. [Cutting Parameters](#cutting-parameters)
4. [Material-Specific Tool Settings](#material-specific-tool-settings)
5. [ShopBot Post-Processor Configuration](#shopbot-post-processor-configuration)
6. [Post-Processor File Format](#post-processor-file-format)
7. [Saving and Exporting Toolpaths](#saving-and-exporting-toolpaths)

---

## Tool Database Overview

The tool database stores all your bit definitions with their geometry and cutting parameters. This is one of the most important parts of the Aspire setup because every toolpath references it.

### Database Structure
- **Tool Groups**: Organize tools into folders (e.g., "End Mills", "V-Bits", "Ball Nose", "Drills")
- **Tool Definition**: Each tool has geometry (physical dimensions) and cutting parameters
- **Material Overrides**: Cutting parameters can vary per material (wood vs plastic vs aluminum)
- **Machine Overrides**: Parameters can also vary per machine profile

### Adding a Tool
1. Right-click a group > Add Tool
2. Set the tool type (see Tool Types below)
3. Define geometry: diameter, angle, flute count, flute length, overall length
4. Set cutting parameters: spindle speed, feed rate, plunge rate, depth per pass, stepover
5. Name it descriptively (e.g., "1/4 Upcut Spiral 2-Flute")

### Tool Database Location
- Stored in the Vectric AppData folder
- Backs up with the database export function
- Can be shared between machines via export/import

---

## Tool Types and Geometry

### End Mill (Flat)
- Flat bottom, straight or spiral flutes
- **Upcut**: Pulls chips up and out. Good chip clearing. Can cause tearout on top surface of plywood.
- **Downcut**: Pushes chips down. Clean top edge but chips can pack in deep cuts.
- **Compression**: Upcut at the bottom, downcut at the top. Best of both worlds for through-cuts in veneered material. Requires first pass deeper than the downcut section.

**Geometry parameters**:
- Diameter (cutting diameter)
- Number of flutes (1, 2, 3, or 4 -- fewer flutes = better chip clearance)
- Flute length (cutting depth capacity)
- Shank diameter (may differ from cutting diameter)
- Overall length

### Ball Nose
- Hemispherical tip for 3D contouring
- Creates scalloped surface (scallop height depends on stepover)
- Available in straight and tapered variants

**Geometry parameters**:
- Diameter (at the ball)
- Tapered: includes taper angle and tip diameter
- Flute length, shank diameter, overall length

### V-Bit
- Angled point for V-carving and chamfering
- Common angles: 60, 90, 120 degrees (full included angle)
- Flat-tip V-bits have a tiny flat at the point for durability

**Geometry parameters**:
- Included angle (60, 90, 120, etc.)
- Diameter (at the widest point)
- Flat tip diameter (0 for sharp point)

### Tapered Ball Nose
- Ball nose tip with a tapered body
- Reaches into tight spaces while maintaining strength
- Excellent for detailed 3D finishing work

### Drill Bit
- For drilling operations only
- Point angle, diameter, flute length

### Engraving Bit
- Very fine point for thin-line engraving
- Small included angle (typically 30-60 degrees)
- Use at low depths for lettering and fine detail

### Form Tool
- Custom profile shape (ogee, roundover, cove, etc.)
- Define the profile in the tool editor
- Used for edge treatments and decorative profiles

---

## Cutting Parameters

These parameters control how aggressively the tool cuts. Getting them right is the difference between clean cuts and broken bits.

### Spindle Speed (RPM)
- Rotational speed of the spindle
- Desktop MAX ATC spindle range: ~8,000 - 24,000 RPM
- Higher RPM = more cuts per inch of travel = smoother finish (up to a point)
- Too high with slow feed = burning
- Material dependent: hard materials generally use lower RPM

### Feed Rate
- How fast the tool moves through the material (XY speed during cutting)
- Aspire uses inches/sec (IPS) or mm/sec, matching ShopBot convention
- This maps directly to the MS (Move Speed) command in the .sbp file
- The relationship between feed, RPM, and flutes determines chip load

### Plunge Rate
- How fast the tool moves downward into the material (Z speed)
- Typically 30-60% of the XY feed rate
- Slower plunge = less stress on the bit tip = longer tool life
- Critical for V-bits and ball-nose tools where the tip is fragile

### Depth Per Pass (Stepdown)
- Maximum material removed per pass in the Z direction
- General guideline: no more than 50% of tool diameter for end mills
- Conservative: 25% of tool diameter (hardwood, aluminum)
- Aggressive: 75-100% of tool diameter (soft foam, balsa)
- The tool database default can be overridden per toolpath

### Stepover
- Distance between adjacent passes in pocketing and 3D operations
- For pocketing with end mills: 40-60% of tool diameter (efficiency vs floor smoothness)
- For 3D finishing with ball-nose: 8-15% of tool diameter (scallop height control)
- Smaller stepover = longer cycle time but smoother result

---

## Owner's ATC Rack Configuration

The 7-position ATC rack is organized by function. Each position holds one ISO20 tool holder at a time; the "groups" below are alternative tools that can be loaded into that position depending on the job.

| Position | Function | Tools Available |
|----------|----------|----------------|
| TOOL 1 | Surfacing | 1.25" Surfacing Bit (2-flute) |
| TOOL 2 | V-Carving / Detail Roughing | 90-deg V-Bit (1-1/4"), 60-deg V-Bit (1") |
| TOOL 3 | Roughing / Through-Cuts | 3/8" Chipbreaker End Mill (2-flute) |
| TOOL 4 | Finish Group 1 | Whiteside UD2102 1/4" Compression Spiral, 1/4" Ball Nose, 3/8" Radiused End Mill (BN tip 3/16") |
| TOOL 5 | Finish Group 2 | 3/8" Straight Ball Nose, 1/4" Spiral Ball Nose (x2) |
| TOOL 6 | Fine Detail 1 | 1/8" Spiral Upcut End Mill, 1/4" O-Flute End Mill |
| TOOL 7 | Fine Detail 2 | Tapered Ball Nose set (R0.25-S1/16 through R1/16-S1/4) |

**Boneyard** (extras sorted by material suitability): Plastic-specific (O-flutes), Wood-specific (spirals), Aluminum-specific (ZrN-coated single-flute).

**Tool database location**: `~/Library/CloudStorage/Dropbox/ShopBot [DROPBOX]/[DB] TOOL DATABASE/tooldb.vtdb`

---

## Material-Specific Tool Settings

### For the 36x24 Desktop MAX ATC V2 (1HP spindle)

These are conservative starting points tuned for this specific machine. Published ShopBot feeds are often too aggressive for the Desktop MAX ATC -- its 1HP spindle and stepper drives can't sustain the same feeds as PRS or industrial machines. When in doubt, reduce feeds by 15-25% from published values.

#### Owner's Actual Tool Database Settings (from tooldb.vtdb)

These are the owner's real values. They represent tested, conservative settings for this specific machine.

**TOOL 1: 1.25" Surfacing Bit** (2-flute)
| Material | RPM | Feed (IPS) | Plunge (IPS) | Depth/Pass | Stepover |
|----------|-----|-----------|-------------|------------|----------|
| MDF/Templates | 12,000 | 4.0 | 1.0 | 0.08" | 0.625" |

**TOOL 2: 90-deg V-Bit** (1-1/4")
| Material | RPM | Feed (IPS) | Plunge (IPS) | Depth/Pass | Notes |
|----------|-----|-----------|-------------|------------|-------|
| MDF | 10,000 | 1.6 | 0.42 | 0.25" | Conservative for clean V-carving |
| Hardwood | 10,000 | 0.8-1.2 | 0.3 | 0.15" | Slow and steady for oak/maple/walnut |

**TOOL 2: 60-deg V-Bit** (1")
| Material | RPM | Feed (IPS) | Plunge (IPS) | Depth/Pass |
|----------|-----|-----------|-------------|------------|
| MDF | 16,000 | 2.5 | 0.83 | 0.1" |
| Hardwood | 14,000 | 1.5-2.0 | 0.6 | 0.08" |

**TOOL 3: 3/8" Chipbreaker End Mill** (2-flute)
| Material | RPM | Feed (IPS) | Plunge (IPS) | Depth/Pass | Stepover |
|----------|-----|-----------|-------------|------------|----------|
| MDF | 12,000 | 3.0 | 1.0 | 0.25" | 0.2" |
| Hardwood | 12,000 | 2.0-2.5 | 0.8 | 0.15-0.20" | 0.15" |
| Baltic Birch | 12,000 | 2.5 | 0.8 | 0.20" | 0.18" |

**TOOL 4: Whiteside UD2102 1/4" Compression Spiral**
| Material | RPM | Feed (IPS) | Plunge (IPS) | Depth/Pass | Stepover |
|----------|-----|-----------|-------------|------------|----------|
| Baltic Birch | 12,000 | ~3.9* | ~1.2* | 0.25" | 0.1" |

*Values stored as mm/sec in database (100/30 mm/s). The compression geometry is ideal for baltic birch -- clean edges on both top and bottom veneers. First pass must be deeper than the downcut section.

**TOOL 6: 1/8" Spiral Upcut End Mill**
| Material | RPM | Feed (IPS) | Plunge (IPS) | Depth/Pass |
|----------|-----|-----------|-------------|------------|
| MDF | 18,000 | 3.0 | 1.25 | 0.0625" |
| Hardwood | 16,000 | 2.0 | 0.8 | 0.04" |

#### General Reference (for tools not yet in database)

**1/4" Ball Nose (3D Finishing)**
| Material | RPM | Feed (IPS) | Stepover | Notes |
|----------|-----|-----------|----------|-------|
| Hardwood | 16,000 | 1.2-1.5 | 0.020" (8%) | Slow but smooth |
| MDF | 16,000 | 2.0 | 0.030" (12%) | Forgiving material |
| Softwood | 16,000 | 1.8 | 0.025" (10%) | Good finish |

**Tapered Ball Nose (Fine 3D Detail)**
| Material | RPM | Feed (IPS) | Stepover | Notes |
|----------|-----|-----------|----------|-------|
| Hardwood | 16,000 | 1.0-1.5 | 8-10% of tip dia | For fine detail only |
| MDF | 16,000 | 1.5-2.0 | 10-12% of tip dia | Test path on MDF first |

---

## ShopBot Post-Processor Configuration

### Selecting the Right Post-Processor
In Aspire, post-processors are in: Machine > Post-Processor
Or when saving toolpaths, select from the dropdown.

**For ShopBot Desktop MAX ATC V2, use**:
- **"ShopBot TC (inch)"**: For ATC (Tool Change) operations -- handles automatic tool changes
- **"ShopBot Arc (inch) w/speed"**: For single-tool jobs with arc support and speed commands
- **"ShopBot (inch)"**: Basic, no arc support (use Arc version instead for smaller files)

If these aren't listed, find them in:
```
C:\ProgramData\Vectric\Aspire\V12.0\PostP\02-ShopBot\
```

### Post-Processor Installation
- Post-processor files have `.pp` extension
- Place them in the PostP directory above (or a subdirectory)
- Restart Aspire to pick up new/modified post-processors
- The Online Machine Configuration wizard can download the correct post-processor automatically

### What the Post-Processor Does
It converts Aspire's internal toolpath data into OpenSBP commands:
- XYZ coordinates become M2, M3, MZ move commands
- Feed rates become MS speed commands
- Spindle on/off become SO switch commands
- Tool changes become the ATC macro sequence
- Arcs are converted to CG (G-code circle) or small line segments

---

## Post-Processor File Format

Post-processor files are text files with specific sections. Understanding the format lets you customize behavior.

### File Structure
```
POST_NAME = "ShopBot TC (inch)"
FILE_EXTENSION = "sbp"
UNITS = "INCHES"

+---------------------------------------------------
+ Header section - written at the start of the file
+---------------------------------------------------
begin HEADER
"'[TP_FILENAME]"
"'File created: [DATE] [TIME]"
"SA"                          'Set absolute mode
"'Zeroing not done in file"
...
end HEADER

+---------------------------------------------------
+ Tool change section
+---------------------------------------------------
begin TOOLCHANGE
"C9"                          'ATC tool change macro
...
end TOOLCHANGE

+---------------------------------------------------
+ New segment section (between toolpaths)
+---------------------------------------------------
begin NEW_SEGMENT
...
end NEW_SEGMENT

+---------------------------------------------------
+ Movement commands
+---------------------------------------------------
begin RAPID_MOVE
"J3,[X],[Y],[Z]"
end RAPID_MOVE

begin FEED_MOVE
"M3,[X],[Y],[Z]"
end FEED_MOVE

begin PLUNGE_MOVE
"MZ,[Z]"
end PLUNGE_MOVE

+---------------------------------------------------
+ Footer section - written at the end
+---------------------------------------------------
begin FOOTER
"MZ,[SAFE_Z]"
"SO,1,0"                     'Spindle off
"JH"                          'Jog home
end FOOTER
```

### Key Variables
| Variable | Description |
|----------|-------------|
| [X], [Y], [Z] | Current position |
| [FEED_RATE] | Feed rate in current units |
| [PLUNGE_RATE] | Plunge rate |
| [SPINDLE_SPEED] | RPM |
| [TOOL_NUMBER] | Tool database ID |
| [TOOL_NAME] | Tool name from database |
| [SAFE_Z] | Safe Z height |
| [TP_FILENAME] | Toolpath filename |
| [DATE], [TIME] | File creation timestamp |

### Customization Tips
- Add custom comments to the header for your workflow
- Modify the footer to park the tool at a specific location
- Add PAUSE commands before spindle start for safety verification
- The ATC post-processor uses C9 for tool changes (ShopBot's ATC macro)

---

## Saving and Exporting Toolpaths

### Save Workflow
1. Calculate all toolpaths
2. Open Save Toolpaths panel (or Toolpath > Save Toolpaths)
3. Select which toolpaths to include
4. Choose post-processor
5. Choose output location

### Multi-Tool ATC Jobs
- With the ATC post-processor, multiple toolpaths using different tools can be saved as a single file
- The post-processor inserts tool change sequences between toolpaths automatically
- Tool numbers must match the rack positions on your ATC

### Single-Tool Jobs
- Each tool gets its own .sbp file
- Run files in order on the machine
- You manually change the tool and re-zero Z between files

### File Naming Convention (recommended)
```
ProjectName_01_3D-Rough_025-EM.sbp     (step 01, 1/4" end mill)
ProjectName_02_3D-Finish_025-BN.sbp    (step 02, 1/4" ball nose)
ProjectName_03_VCarve_90V.sbp          (step 03, 90-degree V-bit)
ProjectName_04_Profile_025-EM.sbp      (step 04, 1/4" end mill)
```

### Verify Before Cutting
- Open the .sbp file in a text editor and sanity check:
  - Speeds look reasonable (MS commands)
  - Z depths look correct (not deeper than expected)
  - File starts with SA (absolute mode)
  - Spindle is turned on before cutting starts
  - Spindle is turned off and tool retracts at the end
- Run in Preview mode [SP] on the ShopBot software before cutting

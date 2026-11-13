# SB3 Configuration, Logs, and Job Recovery

Everything here was verified on the shop laptop (`shopbot`, Windows 11 Home, SB3 v3.9.14,
Desktop MAX ATC V2) on 2026-08-05, against the live filesystem, the shipped PDFs in
`C:\Program Files (x86)\ShopBot\ShopBot 3\Help\`, and string extraction from `Sb3.exe`.
Where a claim is inferred rather than verified, it says so.

---

## 1. Where the live configuration actually lives

**`C:\ProgramData\ShopBot\ShopBot 3\shopbot.ini` is the only file SB3 reads and writes.**

The UsersGuide states settings live in SHOPBOT.INI, are read at software start, and are
re-saved after every command entered. The path is also recorded in the registry at
`HKCU\SOFTWARE\VB and VBA Program Settings\ShopBot\UserData` under `uUsrPath`.

**Every `CustomSettings*.sbd` on the machine is a saved export, not the live config.**
This matters enormously and has already caused one wrong diagnosis. Observed 2026-08-05:

| File | Date | Role |
|---|---|---|
| `C:\ProgramData\ShopBot\ShopBot 3\shopbot.ini` | live, rewritten on exit | **the real config** |
| `C:\ProgramData\ShopBot\ShopBot 3\Settings\ShopBot_PRSDesktopMAX3624.sbd` | 2024-03-21 | factory profile for this machine — the correct baseline for "is this value anomalous?" |
| `C:\ProgramData\ShopBot\ShopBot 3\Settings\CustomSettings.sbd` | 2025-05-09 | stale export |
| `C:\CNC\machine\CustomSettings.sbd` | 2025-03-17 | stale export |
| `C:\Program Files (x86)\ShopBot\ShopBot 3\default.sbd` | 2007 | generic 96x48 factory default, NOT this machine |

`C:\SbParts` contains no settings file at all.

**Rule: read `shopbot.ini`, then diff against `ShopBot_PRSDesktopMAX3624.sbd` before calling
any value wrong.** Comparing against `default.sbd` will mislead you, because that file is for
a 96x48 tool.

Related commands: `[US]` saves current settings to a new custom settings file; `[UR]` resets
to defaults or loads a settings file, and also offers to clear the system log. `[UR]` will
wipe calibration — never suggest it casually.

---

## 2. The three log files, and what each is for

All in `C:\ProgramData\ShopBot\ShopBot 3\`, all rewritten when SB3 exits:

- **`sbsys.log`** — one line per file run, for the life of the machine. Format:
  `<path>,CUT,Elapsed:HH:MM:SS,,<time>,<date>,,<completed>,<breaks>,CBver,...`
  `completed` is 1/0 and `breaks` is the count of interruptions. A line ending `,1,0,` is a
  clean completed run; `,0,2,` is an aborted run with two breaks. This is the fastest way to
  answer "has this happened before?"
- **`problem.Log`** — written by the `[UD]` and `[UV]` commands. Contains a full copy of the
  current settings block, controller diagnostics, and a "Recorded Commands" tail. The
  recorded-commands tail is the command history at dump time; it is **not** a crash trace, so
  do not read causality into it.
- **`shopbot.ini`** — see above.

**Per-job log: `<JOBNAME>.LOG` sits next to the `.sbp`.** This is the one that matters for
recovery. Format:

```
Last Not Complete Stopped@Line 23382 |Cut Mode|  Elapsed: 00:50:45 ...
 File Completed:No  Ln:23382 Max: 36.22, 15.81, 2.75  Min: 0.00, 0.00, 1.40
 Offset:no  Brks=2  TBCs: .000, .000, -2.995  Props: 1.000, 1.000, 1.000
```

`Stopped@Line` is what `[FG]` pre-fills for a restart. `TBCs` records the Table Base
Coordinates in force, which is how you confirm zeros did not move between runs. Writing this
log is controlled by VD parameter 10 (Write Part File Log), default on.

---

## 3. Resuming an aborted cut — the verified procedure

**Use `[FG]`. Do not prime the machine with console commands first.**

`[FG]` is File Load in Goto/Single-Step Mode. ComRef: "[FG] offers an automatic function for
moving to the last line number executed in a file in order to take up cutting where it had
previously been left off or disrupted (e.g. by a broken bit)."

The restart dialog, verbatim from strings in `Sb3.exe`:

```
Single-Step or Re-start File (Replace cutter and zero axes before Re-starting a file)

Re-start cutting within a file that was inadvertently terminated.
(Last line processed is displayed if available in log file.
 You can enter or change the line number manually.)

  > Click 'GO' to move at Safe-Z height to line number that
       positions tool at desired re-start location.
  > Then click 'Run from Here' and tool will
       plunge to depth and continue cutting file.
```

Procedure:

1. `FG, <full path to the .sbp>`
2. Confirm the pre-filled line number, click **GO**. Safe-Z positioning move only, nothing cuts.
3. Click **Run from Here**.

**`Run from Here` starts the spindle and applies the full startup procedure — settings,
location, spindle speed — then resumes at that line.** Confirmed by the operator on a live
resumed roughing pass, 2026-08-05.

**Do NOT issue `CN, 90` / `MS` / `TR` / `C6` at the console before `FG`.** That sequence was
suggested once here without verification, and it crashed SB3 when `FG` ran. `[FG]` is
self-contained; it needs no console setup.

Related error strings in `Sb3.exe`, useful for recognizing what went wrong:
`Please Enter a Line Number.` / `Incorrect Location!` /
`Can not execute Run to Location in Backwards Direction.` / `Problem in Goto Request!`

Before restarting, honor the dialog's own instruction: the correct cutter must be in the
spindle and the axes must be zeroed as they were.

---

## 4. Reading a "Parameter Value Below Range" dialog

The message is assembled from these literals in `Sb3.exe`:

```
'Parameter Value Below Range for '  +  NAME  +  ' -- Setting to Lower Limit ('  +  VALUE  + ')'
'Parameter Value Above Range for '  +  NAME  +  ' -- Setting to Upper Limit ('  +  VALUE  + ')'
```

Two consequences that are easy to get wrong:

- **NAME is the two-letter command, not the parameter.** SB3 never tells you which of the
  command's parameters was out of range. You must work it out by elimination against the
  parameter list and each parameter's legal range.
- **The parenthetical is the clamped value**, not a parameter index.

Worked example, 2026-08-05: `Parameter Value Below Range for VP -- Setting to Lower Limit ( 1 )`.
VP has ten parameters. Cutting Simulations, Draw Tool and Draw Jogs legally take 0; Left and
Right Panel Behavior legally take `-1 Leave as is`, `1 Force open`, `0 Force closed`, and the
`-1` is factory (present in `ShopBot_PRSDesktopMAX3624.sbd` since 2024-03-21). By elimination
the only parameter with a floor of 1 was **Grid Size**, VP parameter 1, which read 6 in every
historical snapshot and 1 afterward. SB3 clamped it and persisted the clamped value.

**A modal raised mid-file can kill the run.** In that incident, dismissing the dialog twice
logged `Brks=2`, and two lines later SB3 threw `Unexpected Return Fault` with no resume path,
only Quit or Close & Exit. The part file contained zero GOSUB and zero RETURN across 88,954
lines, so the stack fault was SB3's interpreter failing to resume after the interruption, not
the `.sbp`. Treat any out-of-range stored setting as a live hazard before a long unattended
cut, and keep values off their floor rather than exactly on it.

What triggered SB3 to re-validate VP mid-run was never determined. Ruled out: the Aspire post
output, every `Custom*.sbc`, a Parsec session or resolution change, and Windows display events.

---

## 4b. Is it the file, or is it the machine?

A CAM depth error and a Z-reference error look identical at the workpiece: the cut comes
out shallow and material is left standing. They have nothing in common as causes, and
probing routines fix only one of them. **Always read the posted file first.** It costs one
command and it is decisive.

```bash
grep -oE "^[MJ]3,[-0-9.]+,[-0-9.]+,[-0-9.]+" FILE.sbp | awk -F, '{print $4}' | sort -n | head -1
```

That is the deepest Z the file actually commands. With Z zero at the table and the
material top at `+thickness`, the arithmetic is:

```
commanded Zmin  =  material thickness  -  intended cut depth
```

So on 1.600 stock, a profile intended to go 0.010 into the spoilboard must read
**-0.010**. Anything higher is a CAM error.

- **File disagrees with intent** -> the error was baked in before the machine moved. No
  probing routine will change it. Re-post the toolpath. Check the file's mtime too: if it
  predates whatever fault you were blaming, that settles causation.
- **File agrees with intent but the cut is still wrong** -> now it is the machine. Go to
  `CN,73` and the Z reference chain.

Worked example, 2026-08-06. A profile left 0.05" standing and the assumption was a Z
calibration fault. Reading every file in the job took seconds:

| File | Material | Z min commanded | Implied cut depth |
|---|---|---|---|
| `FACE-leg` | 1.600 | **+0.050** | 1.550 |
| `SIDE-leg` | 1.600 | **-0.010** | 1.610 |

Same job, same stock, same tool, same table-surface origin. `Profile 3` had been updated
to 1.610 and `Profile 2` had not. The machine cut exactly what it was told, the file's
mtime predated the fault being blamed by 86 minutes, and no amount of reprobing would have
touched it.

Sanity-check the whole job in one pass:

```bash
for f in *.sbp; do
  printf "%-50s %s\n" "$f" \
    "$(grep -oE '^[MJ]3,[-0-9.]+,[-0-9.]+,[-0-9.]+' "$f" | awk -F, '{print $4}' | sort -n | head -1)"
done
```

Toolpath names sit in the file as `'Toolpath Name = ...` comments, so `grep -n "Toolpath
Name"` tells you which pass owns a suspect depth.

---

## 5. Controller diagnostics: the numbers that matter

From `[UD]` (Help/UD Diagnostic Notes.pdf), with the 2026-08-05 readings on this machine:

| Value | Healthy range | This machine |
|---|---|---|
| Supply VDC | 4.7 to 5.5 | 5.01 |
| Controller core temp | below 60 C | 47.7 C |
| Buffer Underflow Total | 0 — any value means USB streaming hiccuped | 0 |
| Static_ET | 5 ms or less | 3.1 ms |
| Packet_ET | 20 ms or less ideal; under 40 ms "should not have any problems" | 27.8 ms |

Packet_ET of 27.8 ms sits above the ideal band but inside the acceptable one. Worth watching,
not worth acting on alone. To get valid readings, make a 4 inch `[MX]` or `[MY]` move first,
then run `[UD]`. If underflows appear, the documented first remedy is reducing Move/Jog speeds.

---

## 6. Table Base Coordinates, and why they are the recovery anchor

SB3 keeps two coordinate systems: the **working** coordinates you re-zero constantly, and the
**Table Base Coordinates (TBC)** which track the real physical corner of the machine.

- `[ZT]` zeros TBC. `[ST]` restores working coordinates from TBC. `[UZ]` zeros everything
  including TBC.
- Software limit checking (`[SF]`, `[VL]`) is evaluated against **TBC, not working
  coordinates**. This is the whole point of the system: re-zeroing your work does not blind
  the machine to where the stop bolts are.
- TBC lives in the computer. It is lost if the carriages are moved by hand, on power failure,
  or on a crash.
- Each job's `.LOG` records the TBC in force. Matching TBC across runs is the cheapest
  evidence that zeros did not move. TBC Z on this machine has drifted (-2.995 to May 2026,
  -3.3239 on 2026-08-09; see `SKILL.md`), so read it from the current log, never a past one.

---

## 7. Values that revert at end of file

`[VS]`, `[VI]`, `[VU]` and limit-checking changes made **inside a part file** automatically
revert to their pre-file values when the file ends or is terminated. `[SV]` makes them
permanent from the point it is issued.

`[MS]` and `[JS]` differ from `[VS]` in a way that affects cut quality: MS and JS punctuate the
move stack and force a ramp-down/ramp-up around the speed change. `[VS]` does not break the
stack. Use `[VS]` mid-toolpath when you do not want to disturb ongoing motion.

Output switches are all turned off when you leave SB3, and their state is not restored on
restart.

# SB3 Versions, Upgrade Risk, and Machine Maintenance

Verified 2026-08-05 against the running install, the shipped `Readme.txt` and
`UpdateHistory.txt`, and ShopBot's live download page.

---

## Three-way version drift — know which layer you are quoting

| Layer | Version | Date |
|---|---|---|
| Shipped ComRef / UsersGuide / ProgHand PDFs | v3 era docs | **2015** |
| Shipped `Readme.txt` release notes stop at | **3.8.74** | Nov 2022 |
| **Running binary on this machine** | **3.9.14** | mid-2025 |
| **Current release from ShopBot** | **3.9.20** | 9/24/25 |

Every local document is older than the software, and the software is older than current. This
is why the ATC PDF lists `&ATC` values 0-2 while the live `Custom89.sbc` branches on 1,2,3,4,6,7
and this machine is 7. **When a manual and the live files disagree, the live files win.**

`UpdateHistory.txt` carries major revisions; `Readme.txt` carries point revisions for the
version it shipped with. Neither has been updated for 3.9.x, so there is no local record of
what 3.9.0 through 3.9.14 changed.

Recent releases from the download page, most relevant first:

| Version | Date | Noted change |
|---|---|---|
| 3.9.20 | 9/24/25 | current |
| 3.9.12 | 5/5/25 | updated Desktop spindle speed control |
| 3.9.06 | 12/26/24 | indexer calibration routines |
| 3.8.97 | 2/13/24 | ATC status check improvements |
| 3.8.92 | 11/10/23 | optional debug mode |
| 3.8.90 | 11/7/23 | ATC unitless setup, spindle fixes |
| 3.8.88 | 9/15/23 | ATC tool change retry |

Useful provenance: the `[FG]` resume system and the graphical file progress indicator both
arrived in **3.6.1**, and `[SV]` in **3.6.2**.

---

## Upgrading will overwrite the ATC chain — read this first

From the shipped `Readme.txt`, verbatim in substance:

> Custom Cuts are not overwritten during installation of the software EXCEPT for
> **#2, 3, 5, 6, 7, & 9 and #70 and above**. If you have modified your own version of these,
> save a copy before updating software. (If you forget, the installer saves a backup copy as
> `C:\SbParts\Custom_BACKUP_PREVIOUS`.)

That range is precisely this machine's ATC chain: `Custom9.sbc` is the in-file toolchange
hook, `Custom72/73/74/77/78/79` are the ATC calibration, tool-measurement, plate-offset and
toolbar routines, and `Custom6`/`Custom7` are spindle on/off. **An upgrade replaces all of
them.**

Also overwritten on update: sample files (`sample_*`), and the ZZero/XYZero routines. **Not**
overwritten: `my_variables.sbc` offsets recorded by the SETUP tool, and
`ATC_Local_Data\ATC_tool_variables.sbc` / `ATC_variables.sbc` (the ATC PDF explicitly warns
installers not to clobber these, because they carry the calibration).

Before any upgrade: copy `C:\SbParts\Custom\` somewhere safe, note that
`Custom_CopyOEM` is the pristine OEM set and `Custom_BACKUP_PREVIOUS` is the prior state, and
diff after upgrading to see what actually changed. Uninstalling is not required to update.
Firmware, if it needs updating, goes in via `[UI]` from **Preview mode**.

---

## Chip load, the sourced version

The UsersGuide reproduces Onsrud's ranges. Chipload = feedrate / (RPM x flutes), with feedrate
in inches per minute (SB3 IPS x 60).

| Material | 1/4" dia | 1/2" dia |
|---|---|---|
| Softwood | .002-.020 | .003-.030 |
| Hardwood | .005-.020 | .005-.030 |
| MDF | .005-.020 | .005-.030 |
| Plywood | .005-.020 | .005-.030 |
| Laminated chipboard | .008-.020 | .010-.030 |
| Soft plastic | .004-.012 | .006-.014 |
| Hard plastic | .006-.012 | .008-.016 |
| Aluminium | .003-.010 | .004-.012 |

Depth of cut at 2x diameter, reduce chip load 25%. At 3x diameter, reduce 50%.

Onsrud's tuning method: start from the chip-load RPM, raise feed until finish degrades or the
part moves, back off 10%, then lower RPM until finish degrades and bring it back up.

ShopBot's own starting points: **1.7 in/sec XY move speed** for most woods, **0.5 in/sec** Z
plunge, ramp speed 0.4 on both. For 1/4" hardwood they suggest 0.75-1.25 in/sec, for 1/4"
plywood 1.0-1.75 in/sec. Spindle-equipped alpha tools cut at 6-10 in/sec and jog around 30;
stepper motors lose torque as they speed up, so faster is not automatically better.

---

## Maintenance

**Lubrication.** Rack and pinion works best greased; any bearing grease, renewed periodically.
A light oil film protects rails in humid conditions. Keep tracks and racks clear of dust —
compressed air occasionally.

**Two things that destroy electronics:**

1. Never unplug a motor or motor cable with power on. The surge kills the driver circuitry. A
   loose motor wire does the same.
2. Never push the machine by hand with motors connected, powered or not. The motors generate
   current that zaps the drivers. Unplug the motor wires first. Short, very slow nudges are
   tolerated.

Warm motors and drivers are normal, as is a hum at standstill (PWM chopper drive) and a
`thunk` at power-on. Extremely hot to the touch is a fault or a bad connection.

**Tolerance build-up checklist**, in the order the UsersGuide gives it: step resolution is
~.0005 and that is the floor; collets are consumable and good ones are rated under 700 hours;
dull or unbalanced bits are the most frequent cause of bad cuts; router bearing run-out is
typically .004-.006 and worsens with wear; hold-down slop dominates everything else; check Z
axis play, rack/pinion backlash, and X/Y carriage set screws.

---

## Troubleshooting triage

The UsersGuide's first move is to classify the problem before chasing it:

1. **File creation** — design software or conversion to `.sbp`.
2. **Software function** — a command not behaving as documented. Check ComRef and the
   `S_*.SBP` sample files.
3. **Tool operation** — the machine misbehaves on a plain keyboard command. Test with `[CC]`
   or `[CR]` in air. If it only misbehaves inside a file, it is category 1 or 2, not this one.

Within category 3, distinguish primary failure (connection, wrong direction, wrong location,
stalling, no movement) from qualitative failure (rough, uneven, inaccurate). Also establish
whether it is a first-use problem or a regression, and what changed.

**Intermittent connection / "Too many characters received"** is a comms dropout. Documented
causes, in order: screen saver or power management engaging during a long file; a laptop on
battery, which throttles the USB port; electrical noise from shop equipment such as
compressors. Disable sleep and screensavers, and keep the laptop on mains.

`problem.Log` is what ShopBot support asks for — it is produced by `[UD]` and `[UV]`. For
valid comms numbers, make a 4 inch `[MX]` or `[MY]` move first, then run `[UD]`. Thresholds
and this machine's readings are in `sb3-config-logs-and-recovery.md`.

# Aspire V12 Installation Layout — `C:\ProgramData\Vectric`

Ingested directly from the shop laptop 2026-08-06. 309 files, 58 MB. Everything here was
read from disk, not from Vectric documentation.

---

## 1. The post-processor trap: two systems coexist

**Aspire V12 has two independent post-processor stores, and the one you pick from is not
the folder of `.pp` files.**

| | Legacy `.pp` files | Machine-configuration database |
|---|---|---|
| Location | `Aspire\V12.0\PostP\02-ShopBot\` | `Aspire\V12.0\PostP\postp.ppdb` (4.98 MB) |
| Count | 26 ShopBot posts | referenced by GUID |
| Association | picked by name at save | mapped per machine in `ToolDatabase\mppa` |
| Updated by | software install | **Vectric cloud service**, on demand |

`mppa` is JSON, `dataFormat: 3`, and maps three machine configurations to their posts. The
ShopBot machine (`48baf505-56c0-463b-bb29-e2bf1cc5589e`) is associated with
**`ShopBot TC (inch)(*.sbp)`** and `ShopBot TC (mm)(*.sbp)`.

**No `.pp` file in `02-ShopBot` carries that name.** The full name map of the 26 legacy
posts is below, and `ShopBot TC` appears nowhere in it. It lives only in `postp.ppdb`.

### How to know which post was actually used

**Aspire logs it.** Do not infer it from the output's shape. `Aspire\V12.0\Logs\debug_<date>_0.log`:

```
[TpSave]   Saving toolpaths
[TpSave]   PostP used for saving:
[ppOutput] Outputting PPContent <guid> to <temp>
[ppOutput] Outputting PPFile to <temp>\ShopBot TC (inch)(!.sbp).pp
[ppOutput] Outputting PPFile to <temp>\ShopBot_run.ini
```

Aspire extracts the chosen post from `postp.ppdb` into a temp folder as a `.pp`, then runs
it. The `ppOutput` line names it. Correlate the timestamp against the `.sbp` mtime to tie a
save to a file — on 2026-08-05 the match was exact to within 200 ms:

| Log time | Post | Resulting file | File mtime |
|---|---|---|---|
| 14:59:57.264 | `ShopBot TC (inch)` | `SIDE-leg_26-APPLE-TABLE.sbp` | 14:59:57.351 |
| 15:04:57.587 | `ShopBot TC (inch)` | `FACE-leg_26-APPLE-TABLE.sbp` | 15:04:57.753 |

**Correction of an earlier claim in this skill.** It previously stated the active post was
`ShopBot_Arc_Inch_Toolchange_Control.pp`. That was inferred from output characteristics —
it is one of only two legacy posts that emit `C9`, and its toolchange block matches the
file. The inference was wrong. The log names `ShopBot TC (inch)(*.sbp)` from the database
for every save. The two posts evidently produce near-identical output, which is exactly why
inferring from output failed.

Also logged: on 2026-08-05 at 17:00 the post list was refreshed from
`https://postp-service.vectric.com/api/public/postp/package/v1`, with the prompt "You are
about to update the list of post-processors and machine configurations available to you."
That is what stamped `Backups\PostPDbPkg\2026_08_05_1700\`. **Post definitions on this
machine can change without a software update.** If output shape changes unexpectedly, check
that backup folder for a recent refresh.

### The 26 legacy ShopBot posts, file to display name

Only the two `Toolchange_Control` files emit `C9`.

| File | POST_NAME |
|---|---|
| `ShopBot_Arc_Inch_Toolchange_Control.pp` | ShopBot (inch)(Toolchange)w/speed(*.sbp) |
| `ShopBot_Arc_MM_Toolchange_Control.pp` | ShopBot (mm)(Toolchange)w/speed(*.sbp) |
| `ShopBot_Arc_Inch.pp` | ShopBot (arcs)(inch) (*.sbp) |
| `ShopBot_Arc_inch_Spindle_control.pp` | ShopBot Arc (inch)w/speed(*.sbp) |
| `ShopBot_Arc_MM.pp` | ShopBot (arcs)(mm) (*.sbp) |
| `ShopBot_Arc_MM_Spindle_Control.pp` | ShopBot Arc (mm)w/speed(*.sbp) |
| `ShopBot_inch.pp` / `ShopBot_mm.pp` | ShopBot (inch)/(mm)(*.sbp) |
| `ShopBot_Alpha_Arc_Inch_Spindle_RPM _.pp` | ShopBot Alpha(arcs)(inch)(Spindle RPM)(*.sbp) |
| `ShopBot_Alpha_Arc_Inch_Spindle_RPM .pp` | **"Scott W - New"** — someone's working copy, note the trailing space in the filename |
| `ShopBot_alpha_*` (4 files) | alpha_control and w/speed variants |
| `ShopBot_head2_*`, `ShopBot_Head2_*` (4) | second-head variants |
| `ShopBot_Drill*`, `ShopBot_PRSDrill*`, `ShopBot_GC1/GC2_Drill*` (8) | air-drill posts |

`My_PostP\` is the user post folder and holds only `readme.txt`: "Custom Post-Processors
placed here will be outside Vectric's Post-Processor update cycle." **It is empty, so this
machine runs entirely stock posts** — nothing here is protected from a cloud refresh.

---

## 2. Tool database

`Aspire\V12.0\ToolDatabase\`

| File | Size | Role |
|---|---|---|
| `tools.vtdb` | 2.1 MB | **the live tool library** |
| `tools.vtdb.upload` | 2.1 MB | cloud-sync staging copy |
| `tools.vtdb.vectric` | 802 KB | vendor baseline |
| `laser_tools.vtdb` | 131 KB | separate laser library, unused here |
| `mppa`, `mppa.vectric` | 2 KB | machine-to-post associations, see above |

Dated snapshots in `Backups\ToolDatabase\tools_YYYY-MM-DD.vtdb`, and
`Backups\CloudDownload\<timestamp>\ToolDatabase\` holds what was pulled from the Vectric
cloud (two sets, both March 2025). Never edit `.upload` or `.vectric` directly.

**Separate previewer database.** `ShopBot Preview\V2.0\ToolDatabase\tools.tool_db` (52 KB)
is the bundled Vectric previewer's own library, unrelated to Aspire's. Its
`ToolDatabase_Locations.txt` searches, in order, `Aspire\V3.0`, `VCarve Pro\V6.0`,
`PartWorks\V3.0` under `C:\ProgramData\Vectric` — all version numbers that do not exist on
this machine, so the previewer always falls through to its own default library.

---

## 3. Toolpath defaults

`Aspire\V12.0\ToolpathDefaults\` — 17 `.default` files, one per strategy, 1-2 KB each. These
are the parameters a new toolpath starts with:

`3Carve`, `BevelCarving`, `Chamfer`, `Drilling`, `FinishMachine`, `Fluting`, `LaserEngrave`,
`PhotoVCarve`, `PocketMachine`, `ProfileMachine`, `QuickEngrave`, `RoughMachine`,
`SweptProfile`, `Texture`, `ThreadMilling`, `VCarve`, `VInlay`

`ProfileMachine.default` and `RoughMachine.default` are the two that matter most for this
shop's work. Editing them changes the starting point for every future toolpath, which is the
right lever if a depth or stepover keeps needing the same manual correction.

---

## 4. Everything else

- `Gadgets\` — Celtic Weave Creator, Dragknife Toolpath, DXF Batch Processor, Explode
  Vectors, Keyhole Toolpath, Setup Sheet Editor, Wrapping (Create Rounding Toolpath, Fluting
  Layout, Spiral Layout). `My_Gadgets\` is the user slot. All Lua.
- `BitmapTextures\` — 51 images in `1_Wood`, `2_Metals`, `3_Stone`, `4_Misc`.
  `VectorTextures\` — 2 files.
- `Logs\` — `debug_YYYY-MM-DD_0.log`, one per day Aspire ran, largest 3.4 MB. Records program
  options at startup, dialog lifecycle, downloads, and the post/save events above. **This is
  the only place that records which post produced a file.**
- `Crash\` — **empty**. Consistent with there being no `.crv3d` autosave or recovery
  anywhere. Aspire's backup tree covers the tool and post databases only.
- `FileDialog\V12.0\Logs\` — file-dialog logs, 8 files, no operational value.
- Top level: `Post Processor Guide.lnk` and `Reference Manual.lnk`, shortcuts to Vectric docs.

---

## 5. Practical consequences

1. **To know which post made a file, read the Aspire log for that day.** Do not deduce it
   from the `.sbp` header or its command shape.
2. **A cloud post refresh can change output without any software update.** Check
   `Backups\PostPDbPkg\` for a recent dated folder when output shape shifts.
3. **`My_PostP` is empty**, so nothing on this machine is insulated from that refresh. If a
   post ever needs pinning, a copy there is how.
4. **The previewer's tool-database search paths are all stale**, so its tool display never
   reflects the real Aspire library. Harmless, but do not trust previewer tool geometry.

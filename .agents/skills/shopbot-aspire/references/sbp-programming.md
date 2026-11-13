# SBP Part File Programming

Source: `SBP Programming Handbook` (`SBG00314150707ProgHandWin`), local copy at
`C:\Program Files (x86)\ShopBot\Developer Tools\ProgHand.pdf`, plus ComRef.pdf. Read this
when writing or debugging a `.sbc`/`.sbp` that contains logic rather than only motion —
including ShopBot's own `Custom*.sbc` hooks.

---

## Variables

- All user variables start with `&`. Assign with `&name = value`.
- **Variables are persistent AND global.** They survive past the end of the file that defined
  them and are visible to every subsequently run file. This is why a part file can set
  `&ATC` via `CN, 90` and have the ATC chain see it several thousand lines later, and equally
  why a stale variable from an earlier file can silently change behavior.
- `[SL]` clears all variables. `[UL]` lists them in the editor (editable). `[VV]` defines them
  from the console. The software retains up to 100.
- String concatenation uses `&`: `&newstring = "My name is " & &firstname`. Strings in `IF`
  tests need explicit quotes.
- System variables are read as `%(n)`. The ones that actually come up:

| Var | Meaning |
|---|---|
| `%(1)` `%(2)` `%(3)` | current X, Y, Z location |
| `%(6)` `%(7)` `%(8)` | Table Base Coordinate X, Y, Z |
| `%(21)` | distance mode, absolute vs relative |
| `%(22)` | mode, cut vs preview |
| `%(23)` | cutter diameter |
| `%(25)` | units, 0 = inches, 1 = mm |
| `%(28)` | Safe Z |
| `%(51)`-`%(58)` | input switches 1-8 |
| `%(71)`-`%(80)` | move speeds X,Y,Z,a,b then jog speeds X,Y,Z,a,b |
| `%(101)`-`%(108)` | output switch status 1-8 |

Full table in `Help\ShopBotSystemVar.pdf`. Note `%(25)` is what the Vectric post tests on
line 16 of every file to abort if the software is in metric.

---

## Control flow, and the Unexpected Return Fault

```
GOSUB label      -> jumps to "label:" ; RETURN comes back to the line below the GOSUB
GOTO  label      -> jumps to "label:" ; no return
RETURN           -> returns to the line below the initiating GOSUB
END              -> ends the file
IF <test> THEN <command | assignment | GOTO label>
ON INPUT(switch#, 0|1|2|3) <command>
PAUSE {seconds | UNTIL input#, state}
```

`IF` permits **only one logical test per statement**. There is no compound condition; chain
separate `IF` lines instead.

**`RETURN` with nothing on the GOSUB stack produces `-- Unexpected Return Fault ! --`.** The
Programming Handbook names the classic file-level cause directly: if subroutines sit at the
bottom of a part file, you must put an `END` before them "to make sure that execution of the
Part File does not inadvertently flow into the sub-routine."

Diagnosing one, in order:

1. Count `GOSUB` and `RETURN` in the running file. Vectric-posted files contain **zero** of
   both — if the file has none, the fault did not originate in your toolpath.
2. Check any `.sbc` the file invoked (`CN,n` / `C#,n`) for a subroutine block reachable by
   fall-through without an `END` guarding it.
3. If neither, it is SB3's own interpreter state. The known trigger on this machine is a modal
   dialog raised mid-file: dismissing it lets a couple more lines execute and then the stack
   fault fires, with no resume offered. See `sb3-config-logs-and-recovery.md`.

The fault dialog is titled `PAUSED in Movement or File Action` and offers only Quit or
Close & Exit. That absence of a resume button is the signal that SB3 could not recover — an
ordinary spacebar stop offers a resume path.

---

## Move stacks

Consecutive moves are buffered into a movement block and executed as one smooth stream.
What breaks the stack matters for surface finish:

- `[MS]` and `[JS]` **punctuate** the stack. A speed change written with them forces a
  ramp-down then ramp-up around the change.
- `[VS]` does **not** break the stack. Use it for mid-toolpath speed changes.

Look-ahead ramping analyses upcoming segments: direction changes sharper than 43 degrees
always force a full ramp to Ramp Speed; gentler corners get a graded reduction governed by
`[VR]` Slow Corner Speed (default 65%). A run of segments too short to accelerate through is
executed at Ramp Speed throughout rather than oscillating.

---

## Values that revert at end of file

`[VS]`, `[VI]`, `[VU]` and limit-checking changes made inside a part file revert when the file
ends or is terminated. `[SV]` freezes current values as permanent from that point. This is a
frequent source of "I set it and it didn't stick".

Output switches are all off when SB3 exits and their state is not restored on restart.

---

## Custom command files

`Custom<N>.sbc` in `C:\SbParts\Custom\` is invoked as `CN, <N>` from a part file or console,
and as `C#,<N>` from inside another `.sbc`.

- The `Custom [N]umber` menu label is **the first comment line of the file**. A file whose
  first line is a bare `'` shows blank in the menu and still contains working code. Never
  infer "unassigned" from a blank menu entry.
- Reserved on this machine by ShopBot's own ATC chain: 1, 6, 7, 9, 72, 73, 74, 77, 78, 79,
  88, 89, 90, 91. See `atc-desktop-max-v2.md` for the call graph.

`SHELL, "path and args", {display}, {ASYNC|SYNC}` starts an external program from a part file.
ShopBot uses this itself: `MyVars.exe` rewrites values in `my_variables.sbc` from a
`TempVar.txt` list. Display option 0 is hidden with hidden focus and is a good way to lose
control of the machine — do not use it.

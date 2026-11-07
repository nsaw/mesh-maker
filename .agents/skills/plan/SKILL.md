---
name: plan
description: Turns confirmed investigation findings into a concrete implementation plan — one section per fix with target files, the exact change, rationale, and verification steps. Drives every SUSPECTED/UNKNOWN to closure before presenting. Use when findings or requirements are ready to become actionable work, typically invoked explicitly via /3-plan or "write a plan"; not a general-purpose planning aid for trivial one-step changes.
---

# plan

Turn confirmed findings into an implementation plan. This is the planning stage:
no code is written here.

**FIRST ACTION — before reading findings, before any file reads or greps:**
Call the `EnterPlanMode` tool. Do not skip this step. Do not proceed until plan
mode is active.

The findings, requirements, or issue description you were invoked with are your
input. Plan from those.

<rules>
- **NO SUBAGENTS.** Do NOT use the Task tool to spawn Explore, Plan, or any other subagent. Do ALL file reads, greps, and globs yourself directly. Subagents are unreliable for planning — they miss files, return incomplete results, and waste time. Use Read, Grep, Glob tools directly.
- Max 750 lines. If exceeded, you're including investigation or justification that belongs in findings, not the plan.
- One section per fix. Each fix must have:
  - Target file(s)
  - What to change (specific enough to implement, not pseudocode)
  - Why this fixes the confirmed root cause
  - What to verify after the change
- Do not re-run the investigation. The findings are your input for WHAT is broken.
- BUT: drive every SUSPECTED/UNKNOWN to closure before presenting (see Risk Closure below).
  A plan whose Unknowns section still lists open questions is not finished.
- Do not include self-review, confidence scores, or adversarial gates.
- Do not include revision history. If the plan needs changes, rewrite the entire plan (don't patch sections).
- Order fixes by dependency (what must be done first).
- If fixes have no dependencies, say so — they can be parallelized.
</rules>

<pre-existing-issue-sweep>
PRE-EXISTING ISSUES: EVERY ONE GETS A DISPOSITION, BY SEVERITY

Every [PRE-EXISTING] item from the investigation or critique gets exactly one
disposition in the plan, decided by this severity floor (a repo's CLAUDE.md may tighten it):

- **Inside the contract** (the issue this plan is for, or its acceptance criteria): a Fix
  section in THIS plan, at every severity. Only items outside it go by severity below.
- **Outside it, Critical or Major** (data loss or corruption, a leak, a crash, or wrong
  behavior on a reachable path stated as a concrete sequence): a Fix section
  in THIS plan.
- **Outside it, Minor or Trivial**: a GitHub issue, created when the plan is written, with
  file:line evidence. List each one under a "Filed, not in this change"
  heading with its issue link.

An item with no disposition is the failure. So is a "deferred" line with no
issue behind it.

FORBIDDEN language in plans:
- "Pre-existing, not addressing in this plan" (with no issue link)
- "Tracked separately" (with no issue link)
- "TBD" or "later" for any item

Why the floor: when every nearby Minor joins the plan, the plan grows to dozens
of fixes, the PR grows with it, and the review loop runs for days because each
fix exposes more edge cases. Measured on thoughtmarks #364 (39 review rounds)
and #394 (9 rounds and open), 2026-11-06.

Pre-existing fixes that made the floor should be:
1. Listed as their own Fix sections (not buried in footnotes)
2. Tagged with [PRE-EXISTING] and the severity in the short description
3. Ordered by dependency alongside the primary fixes
4. Given the same verification rigor as primary fixes

If a grade is borderline, state the concrete path. If you cannot state one,
it is Minor.
</pre-existing-issue-sweep>

<pr-shape>
PR SHAPE: ONE MECHANISM PER PR, DECIDED HERE

Count the mechanisms in this plan. A mechanism is one root cause or one
behavior change that can be reviewed and reverted on its own. Issues share a
PR only when one fix closes all of them. A dependency or SDK migration, an
infra or data operation (cutover, backfill, bulk deletion) and a new feature
are each their own PR and never ride along with bug fixes.

- One mechanism: one PR. Write its done contract in the output below.
- More than one: split into PR slices, each with its own branch, its own done
  contract and its own Fix sections, in dependency order. Slices with no
  dependency between them may run in parallel only if they share no files.
  Each slice is built, gated and opened on its own: 6a-implement and the
  pre-PR gate take one slice (its Fix sections and done contract), and "built"
  means that slice's Fix sections, not the whole plan's.
- Size tripwire: a slice over 40 files or 2,000 changed lines of hand-written
  code (lockfiles, vendored pods, generated files and snapshots excluded) needs
  a "Why this is one PR" line that names what stops the split.

Write the done contract now, while scope is still a decision rather than a
running total: what the PR must do, what it must not break, and what is
explicitly out of scope, with the issue links from "Filed, not in this change".
triage-pr-comments freezes this paragraph verbatim at round 1.

Why: on thoughtmarks, single-mechanism PRs took 2 to 3 review rounds. #394,
which bundled eight issues, an infra cutover and a feature, was 9 rounds in and
still open, and #364 took 39 (RCA 2026-11-06).
</pr-shape>

<output-format>
## Plan: write to the session plan, or to the directory this project designates
## for agent output. Never write plan output into `.claude/`.

### Decisions
[The decision round from Risk Closure below, written down. Numbered. Each item carries the
 question, the answer you recommend, what changes if it goes the other way, and the default
 the plan executes if the user says nothing. Every section of the plan below must ALREADY be
 written to those defaults — that is what makes the plan runnable unanswered, and a fix or
 task that contradicts its own default is a defect, not a choice. When the round was asked
 interactively, keep the section and replace each default with the answer given, so a later
 session reading this file can tell a decided scope from an assumed one.]

### Prerequisites
[anything that must be true before starting — e.g., branch, env, deploy state]

### Fix 1: [short description]
- **File**: [path]
- **Change**: [what to add/modify/remove]
- **Why**: [which confirmed finding this addresses]
- **Verify**: [how to confirm the fix works]

### Fix 2: [short description]
...

### Fix N: [PRE-EXISTING] [short description]
- **File**: [path]
- **Change**: [what to add/modify/remove]
- **Why**: [pre-existing issue found during investigation — cite MISSING finding with file:line]
- **Verify**: [how to confirm the fix works]

### Dependency Order
[which fixes depend on others, or "no dependencies — can be parallelized"]

### Filed, not in this change
[Outside-contract Minor/Trivial items under the severity floor, each with its GitHub issue link.
 "None" is a valid answer.]

### PR Slices
| Slice | Branch | Issues closed | Fix sections | Depends on | Est. files |
[One row when the plan is one mechanism. Any slice over the size tripwire carries its
 "Why this is one PR" line here.]

### Done Contract
[Per slice, one short paragraph: Must do / Must not break / Out of scope (with issue links).
 triage-pr-comments freezes it verbatim at round 1; changing it later is said out loud to the
 user, never edited in place.]

### Unknowns / Flags
[ONLY the items the Risk Closure gate below admits — everything else must have been
 closed before this plan was presented, and a decision only the user can make belongs in
 Decisions, not here]
[each surviving item needs: what would resolve it, and which phase gates on it]
</output-format>

<risk-closure>
## Risk Closure (MANDATORY before ExitPlanMode)

Take every item in Risks / Unknowns / Assumptions and resolve it NOW from live
code, config, schema, or vendor docs. Do not present a plan that defers a
question you could have answered in five minutes of reading.

**Why:** on one past planning round, several "verify later on device" items were
provable from live code in minutes (CSRF cookie requirement, token TTL, refresh
rotation), and one invalidated a core design leg that would otherwise have
surfaced mid-build.

**Rules:**
- An item survives into Unknowns ONLY if it genuinely requires a device, a
  runtime, or a third party. "I didn't check" is not a reason. A decision only the
  user can make does NOT belong here: it goes in the Decisions round below, where
  it carries a default and is therefore not unknown.
- Every surviving item gets a concrete resolution step and the phase that gates on it.
- Any defect discovered while closing a risk gets a disposition by the severity
  floor above: inside the contract, or Critical/Major
  outside it, it becomes a work item in THIS plan; an outside-contract Minor or
  Trivial becomes a linked GitHub issue. Never a bare "known issue".
- "Sized via telemetry," "verify later on device," and "TBD" are rejected
  phrasings. Resolve or justify.

**Decisions, in one round.** Facts are yours to close from code. Decisions are not:
scope, product naming, whether a marketing version bumps, whether an old endpoint
stays for one release. Closing one of those by assumption is how "more like Y"
quietly becomes "identical to Y."

When the plan is otherwise closed, collect every decision whose prerequisites are
already settled and ask that whole set in ONE AskUserQuestion call, in the shape the
`### Decisions` section defines. Four is the cap: with more than four settled, ask the
four with the widest blast radius and carry the rest into the next round. Then
recompute, because an answer can settle the prerequisites of a decision that was not
askable before. The round ends when no settled decision is left unasked; the PLAN is
finished when the user approves it at ExitPlanMode, not when the questions run out.

Where AskUserQuestion is unavailable (a `claude -p` run has no such tool, and some
subagents do not either — test for the tool, do not match the example), the same round
goes in the plan's `### Decisions` section, ahead of Prerequisites, in the shape that
section defines. Apply each default and then recompute exactly as above: a default can
settle the prerequisites of a decision that was not askable before, and that decision
belongs in the block too rather than being silently skipped.
</risk-closure>

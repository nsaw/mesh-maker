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
PRE-EXISTING ISSUES — MANDATORY INCLUSION IN PLAN

If the investigation or critique surfaced pre-existing issues in files being
touched (tagged [PRE-EXISTING] in MISSING findings), these MUST be included
in the plan as additional fixes. They are NOT out of scope.

FORBIDDEN language in plans:
- "Out of scope for this change"
- "Deferred to a separate PR/ticket"
- "Pre-existing, not addressing in this plan"
- "Beyond the scope of this fix"
- "Tracked separately"

If an issue was found in a file we are already modifying, it is cheaper to fix
it now than to discover it later. Scope blindness from narrow focus is a bigger
risk than scope creep from thoroughness.

Pre-existing fixes should be:
1. Listed as their own Fix sections (not buried in footnotes)
2. Tagged with [PRE-EXISTING] in the short description
3. Ordered by dependency alongside the primary fixes
4. Given the same verification rigor as primary fixes

The only acceptable reason to exclude a pre-existing issue from the plan is
if fixing it requires changes to files COMPLETELY UNRELATED to the current
work (zero file overlap). If there is ANY file overlap, it goes in the plan.
</pre-existing-issue-sweep>

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
- Any defect discovered while closing a risk becomes an in-scope work item in
  THIS plan — not a known issue, not a follow-up ticket. Game day: if you found
  it, you fix it.
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

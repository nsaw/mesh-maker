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
[ONLY items that genuinely cannot be resolved without a device or runtime —
 everything else must have been closed before this plan was presented]
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
  runtime, or a third party. "I didn't check" is not a reason.
- Every surviving item gets a concrete resolution step and the phase that gates on it.
- Any defect discovered while closing a risk becomes an in-scope work item in
  THIS plan — not a known issue, not a follow-up ticket. Game day: if you found
  it, you fix it.
- "Sized via telemetry," "verify later on device," and "TBD" are rejected
  phrasings. Resolve or justify.
</risk-closure>

# Thoughtmarks layer: plan

> Repo-specific layer for `~/Code/thoughtmarks`. Loaded by `Read`, not by `Skill`.
> It lived at `thoughtmarks/.claude/skills/plan/SKILL.md` until 2026-08-27, where a
> same-named personal skill shadowed it and made it unreachable by any route.

# plan (Thoughtmarks)

Turn confirmed findings into an implementation plan. This is the planning stage:
no code is written here.

Call `EnterPlanMode` before reading findings or files. Where the tool is absent (a
`claude -p` run, some subagents), continue without it and write the plan to the output
path below.

The findings, requirements, or issue description you were invoked with are your
input. Plan from those.

<ios-skill-invocation>
MANDATORY WHEN THE PLAN TOUCHES APPLE SURFACE: `Read`
`/Users/sawyer/Code/thoughtmarks/.claude/skills/ios-pro/SKILL.md` by that absolute path and
follow it BEFORE writing the plan (a namespaced `anthropic-skills:ios-pro` does not satisfy this). Apple surface means `ios/**`, `*.swift`, `*.xcodeproj`/`*.xcworkspace`,
`Podfile*`, `*.entitlements`, `*.plist`, `PrivacyInfo.xcprivacy`, StoreKit, App Intents,
notifications, WCSession, or the archive scripts. A TypeScript or JS file that wraps Apple
behavior counts, and so does backend work that serves it: subscription and IAP endpoints,
their routing, middleware and auth. When it applies it is not optional: StoreKit, App Store
Server API, entitlements, notifications and App Review constraints shape the correct plan
even when the immediate files are RN/JS/backend.

Resolve the trigger from the files the plan will touch. A plan with no Apple surface skips
the gate and says so in one line, so the skip is visible rather than silent. Agent
configuration, backend-only schema work and ordinary landing-site copy have no Apple surface.
Subscription, pricing and IAP copy DO, wherever it lives, because that is the copy that
invents plausible-sounding Apple behavior when nobody checks it.

If `ios-pro` cannot be invoked at all (bare checkout, CI, a context without the skill), do
NOT proceed as though the gate passed. Verify every Apple API claim against a live
`developer.apple.com` URL, cite that URL in the plan, and mark each affected fix
`UNVERIFIED: ios-pro unavailable` so a later session with the skill can re-grade it.
</ios-skill-invocation>

<rules>
- Do not use subagents (Explore, Plan or any other) for planning. Do every read, grep and glob yourself: a plan built on a subagent's summary inherits whatever files it missed.
- Keep the plan to 750 lines or fewer. A longer plan is usually carrying investigation or justification that belongs in the findings it cites.
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
PRE-EXISTING ISSUES: EVERY ONE GETS A DISPOSITION, BY SCOPE THEN SEVERITY

Every [PRE-EXISTING] item from the investigation or critique gets exactly one
disposition in the plan, decided by the scope rule in CLAUDE.md Project
Guardrails 3:

- **Inside the contract** (the issue this plan is for, or its acceptance criteria): a Fix
  section in THIS plan, at every severity.
- **Related to the contract** (same file or function, same feature or user flow, same
  defect class, or newly reachable through this change): a Fix section in THIS plan, at
  every severity, unless its fix is a separate mechanism (a dependency or SDK migration, an infra or data operation, a new feature; a different root cause in a touched file is not one by itself) or would cross the size limit.
- **Unrelated, Critical or Major** (data loss or corruption, a leak, a crash, or wrong
  behavior on a reachable path stated as a concrete sequence): a Fix section, shipped as
  its own PR slice.
- **Unrelated, Minor or Trivial**: a defect someone would act on gets a GitHub issue opened before merge (one per
  mechanism, never one per finding) and linked under "Found, not fixed here"; a PR-body list
  alone is not tracking. Style preferences are listed, not filed.

An item with no disposition is the failure. So is a related item pushed to an issue.

FORBIDDEN language in plans:
- "Pre-existing, not addressing in this plan" (with no disposition under the scope rule)
- "Tracked separately" (with no disposition under the scope rule)
- "TBD" or "later" for any item

Why the scope rule: a related find joins the plan because filing each one as its own issue meant
closing one issue opened several. The plan stays bounded because an unrelated find is listed,
not fixed: fixing everything anywhere is what drives a PR into dozens of review rounds.

Pre-existing fixes that get a Fix section should be:
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
explicitly out of scope: the items under "Found, not fixed here" (by file:line) and any
separate-PR slices.
triage-pr-comments freezes this paragraph verbatim at round 1.

Why: on thoughtmarks, single-mechanism PRs took 2 to 3 review rounds. #394,
which bundled eight issues, an infra cutover and a feature, was 9 rounds in and
still open, and #364 took 39 (RCA 2026-11-06).
</pr-shape>

<output-format>
## Plan: in plan mode, write to session plan or .claude-cache/plans/BUILD-[NUMBER]-[DESCRIPTOR]-plan.md

### Decisions
[The decision round from Risk Closure below, written down. Numbered. Each item carries the
 question, the answer you recommend, what changes if it goes the other way, and the default
 the plan executes if the user says nothing. Every section of the plan below must ALREADY be
 written to those defaults — that is what makes the plan runnable unanswered, and a fix or
 task that contradicts its own default is a defect, not a choice. When the round was asked
 interactively, keep the section and replace each default with the answer given, so a later
 session reading this file can tell a decided scope from an assumed one.]

### Prerequisites
[anything that must be true before starting — e.g., branch, env, backend deploy]

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

### Found, not fixed here
[Unrelated Minor/Trivial defects under the scope rule, each with file:line and the
 `Refs #N` link to its issue (one issue per mechanism, opened before merge). "None" is a valid answer.]

### PR Slices
| Slice | Branch | Issues closed | Fix sections | Depends on | Est. files |
[One row when the plan is one mechanism. Any slice over the size tripwire carries its
 "Why this is one PR" line here.]

### Done Contract
[Per slice, one short paragraph: Must do / Must not break / Out of scope (the "Found, not fixed here" items and any separate-PR slices).
 triage-pr-comments freezes it verbatim at round 1; changing it later is said out loud to the
 user, never edited in place.]

### Pre-Merge Device Checks
[Only for a slice that ships in the app binary. Each check as a step sequence with its expected
 result, run by the agent through Device Hub on the slice's `archive:distribute` build after
 reviews are clean and before merge. Say which checks `archive:automate` alone covers (install
 and deep-link navigation, nothing interactive), and list owner-only checks separately.
 "None: no interactive behavior" is a valid answer and says why.]

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

**Why:** on BUILD-1474 planning, several "verify later on device" items were
provable from live code in minutes (CSRF cookie requirement, token TTL, refresh
rotation), and one invalidated a core design leg that would otherwise have
surfaced mid-build.

**Rules:**
- An item survives into Unknowns ONLY if it genuinely requires a device, a
  runtime, or a third party. "I didn't check" is not a reason. A decision only the
  user can make does NOT belong here: it goes in the Decisions round below, where
  it carries a default and is therefore not unknown.
- Every surviving item gets a concrete resolution step and the phase that gates on it.
  An item that needs the phone resolves as a named Device Hub check in the pre-merge gate
  (`.claude/CLAUDE.md`, "Pre-merge ship and device gate"), never as "after merge". The checks
  only the owner can run (spoken lock-screen Siri, watch on wrist, Face ID, a real purchase)
  are listed separately so the PR names them before merge.
- Any defect discovered while closing a risk gets a disposition by the scope
  rule (CLAUDE.md Project Guardrails 3): inside or related to the contract, or an
  unrelated Critical/Major, it becomes a work item in THIS plan; an unrelated Minor
  or Trivial defect gets a GitHub issue, referenced under "Found, not fixed here". Never a bare "known issue".
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

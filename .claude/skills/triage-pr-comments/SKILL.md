---
name: triage-pr-comments
description: Triages AI code review comments (CodeRabbit, Greptile, Sentry, and the in-house /pr-review) on the current branch's PR — verifies each finding against live code, fixes valid issues, resolves conversations, commits and pushes. Handles inline comments, outside-diff comments, nitpicks, and additional comments. Use 'autofix' flag to loop until clean. Use this skill whenever the user mentions PR comments, code review findings, triage, addressing review feedback, or wants to fix issues flagged by AI reviewers on a pull request.
argument-hint: "[optional: 'autofix', PR number, e.g. 'autofix', '29', 'autofix 29']"
---

# mesh-maker PR Comment Triage

<task>
Triage AI code review comments on the current branch's PR. $ARGUMENTS
</task>

<autofix-mode>
## Autofix Loop Mode

Parse $ARGUMENTS for the `autofix` flag (case-insensitive). Any remaining
arguments (e.g. PR number) are passed through normally.

Examples: `/triage-pr-comments autofix`, `/triage-pr-comments autofix 29`

When `autofix` is present, after completing Phase 6 (deploy to production):

1. **Report round completion**: "Round [N] complete. Waiting 12 minutes for
   reviewers to re-analyze the push..."
2. **Wait 12 minutes**: `sleep 720` — this gives CodeRabbit, Greptile, and
   Sentry time to re-run their reviews on the new commit.
3. **Re-run FULL Phase 0**: Pull ALL comment sources again from all 4 API
   surfaces. This is a COMPLETE re-pull, not a delta check. You MUST:
   - Re-fetch inline review comments (SOURCE 1)
   - Re-fetch top-level issue comments (SOURCE 2) — re-parse EVERY `<details>`
     bucket, discovered generically, not just `⚠️ Outside diff range` and
     `🧹 Nitpick`
   - Re-fetch review bodies (SOURCE 3) — re-parse Greptile additional comments
   - Re-run the `/pr-review` marker queries (SOURCE 4)
   - **Re-fetch and re-parse the Greptile summary comment** — extract the
     CURRENT confidence score AND re-read ALL concerns/findings in the summary
     body. The summary is updated in-place after each commit, so its content
     CHANGES between rounds. Treat it as a fresh document every round.
   - Re-fetch resolution status via GraphQL (paginated)
   - **Re-read the `triage:v1:addressed` ledger** (Phase 4) — this is what makes
     a complete re-pull terminate. Re-parsing finds every prior round's embedded
     findings again; the ledger is the only thing that distinguishes "already
     handled, no thread to prove it" from "new".
4. **Examine ALL unresolved findings** — not just "new" ones. Specifically:
   - Any **outside-diff comments** from CodeRabbit or Greptile that were not
     addressed in prior rounds (these are persistently skipped — FORBIDDEN)
   - Any **nitpick comments** from CodeRabbit that were not addressed
   - Any **severity-bucket comments** (Critical/Major/Minor) not addressed
   - Any **Greptile summary concerns** that are new or changed since last round
   - Any **`/pr-review` findings** not addressed
   - Any **replies** to prior fix comments that request further changes
   - Any NEW inline comments that appeared after the previous commit
   - Previously resolved threads can be skipped (already handled)
   - Findings whose ledger key is already recorded can be skipped (already
     addressed). If a *reviewer re-raises* a keyed finding as a new comment with
     a thread ID, that thread is a new finding — the ledger suppresses re-parsing
     the same body, never a reviewer saying it again.
   - Comments that arrived **while the previous round was running**. Both bots
     post mid-triage; a fetch at the top of a round is already a snapshot by the
     time the round ends. Re-fetch, do not diff against your cached list.
5. **Check the Greptile confidence score** (see Greptile Confidence Gate below).
6. **If ANY unaddressed findings exist** (new OR carried over): Run Phases 1–6
   again as a new round. Increment the round counter. Commit message for
   subsequent rounds:
   ```text
   fix: address PR #<number> round-<N> review findings
   ```
7. **If NO new unresolved comments BUT Greptile score is stale or < 4/5**: first
   establish whether Greptile re-reviews on this PR at all (see the Greptile
   Confidence Gate — a single review with a stale `reviewed_commit` means it does
   not, and every recheck is dead time). If it does, wait another 12 minutes and
   re-check, up to 3 times (36 min total). If it does not, stop rechecking, record
   the score as UNAVAILABLE with the commit it describes, and judge the PR on the
   remaining gates.
8. **Check the PR is actually green** — comments are only one of three things that
   keep it red, and the other two are invisible to every query above:
   ```bash
   gh pr view <number> --json mergeable,mergeStateStatus,statusCheckRollup \
     --jq '{mergeable, mergeStateStatus, checks: [.statusCheckRollup[]? | select(.conclusion != "SUCCESS") | {name, status, conclusion}]}'
   ```
   - `mergeable: CONFLICTING` → merge `origin/main` and resolve (Phase 5 step 5).
     This is the one that bites, because it appears without anyone touching the PR:
     a merge to `main` makes a green branch red while you are mid-round.
   - any check not `SUCCESS` → read the failing run and fix it. A failing gate is a
     finding whether or not a reviewer commented on it.
   - Both are round-triggering conditions exactly like a new comment is. Do not
     report "all clear" off the comment count alone.
9. **If NO new unresolved comments AND the head's CodeRabbit status description reads
   `Review completed` AND Greptile confidence >= 4/5 and fresh (or confirmed
   UNAVAILABLE per the gate) AND `mergeable` is not CONFLICTING AND every check is
   SUCCESS**: Report "All clear after round [N]", naming the commit each reviewer
   actually read, and stop. If the head is `Review rate limited`, you have not
   finished — wait for the window, request a review, and re-check.
10. **Safety cap**: Maximum 10 rounds. If round 10 still produces new comments,
    stop and report: "Reached autofix cap (10 rounds). [N] comments remain
    unresolved. Greptile confidence: [score]. Manual review recommended."

### Greptile Confidence Gate

Greptile posts a summary comment on the PR (via SOURCE 2: `issues/{n}/comments`)
that is **updated in-place** after each new commit. This comment contains a
confidence score in the format `N/5` (e.g., "Confidence: 3/5" or "3/5"). It may
appear as an older comment since it is edited rather than re-posted.

**How to find it**:
```bash
# Fetch all issue comments and find the Greptile summary
gh api repos/{owner}/{repo}/issues/{number}/comments --paginate \
  --jq '.[] | select(.user.login == "greptile[bot]" or .user.login == "greptile-bot") | {id, body, updated_at}'
```
Parse the comment body for the confidence score pattern (e.g., `\d/5`).

**Staleness guard (MANDATORY)**: Because the summary comment is edited in-place,
a previous round's score is still visible immediately after a push — before
Greptile has re-analyzed the latest commit. Before trusting the score for any
stop/recheck decision:
1. Record the push timestamp when Phase 5 completes (from the push or commit
   output, or `gh pr view --json commits --jq '.commits[-1].committedDate'`).
2. Compare the Greptile comment's `updated_at` against that push timestamp.
3. **If `updated_at` < push timestamp**, the score is STALE — Greptile has not
   yet re-analyzed. Treat this the same as "confidence unknown" and wait + recheck
   (do NOT use the stale score to declare "all clear").
4. Only use the score for stop/recheck decisions when `updated_at` > push timestamp,
   confirming Greptile has updated its analysis after the latest commit.

**Greptile does not necessarily re-review on push, and waiting will not make it.**
This is the trap in the recheck rule above. Its summary footer reads
`Reviews (N): Last reviewed commit: [...](…/commit/<sha>) | [Re-trigger Greptile](…)`
— the re-trigger link exists precisely because a new commit does not always start a
new review. On PR #18 Greptile reviewed **once**, at PR open, and its summary was
still pinned to that first commit six hours and four pushes later.

So before spending three 12-minute rechecks on a stale score, decide which case
you are in, using the footer rather than `updated_at` alone:

```bash
gh api repos/{owner}/{repo}/issues/{number}/comments --paginate \
  | jq -r '.[] | select(.user.login|test("greptile"))
           | "reviewed_commit=\(.body|capture("commit/(?<s>[0-9a-f]{7})").s) updated=\(.updated_at)"'
gh pr view {number} --json commits --jq '.commits | length'   # how many pushes it has had
```

- `reviewed_commit` == current head → the score is real. Apply the stop condition.
- `reviewed_commit` != head but Greptile has reviewed **more than once** on this PR
  → it does re-review; it is just behind. Wait and recheck as described.
- `reviewed_commit` != head and Greptile has reviewed **exactly once** → it is not
  going to re-review on its own. Waiting is dead time. Either re-trigger it via the
  footer link and then wait, or record the score as **UNAVAILABLE (not re-reviewed
  since `<sha>`)** and stop on the other gates. Do NOT report a score pinned to an
  old commit as though it described the current head.

A stale score is also frequently a stale *concern*: on PR #18 the 3/5 cited the
`serializeConfig` typo as the sole blocker, and that had been fixed five commits
before the score was read. Re-verify a stale score's stated blockers against live
code before treating the number as a reason the PR is not green.

**Stop condition**: The autofix loop MUST NOT declare "all clear" unless:
- The Greptile confidence score is **4/5 or 5/5** and **fresh** (`reviewed_commit`
  == head), OR
- Greptile is confirmed not re-reviewing (single review, stale `reviewed_commit`),
  its stale concerns have each been re-verified against live code, and the score is
  reported as UNAVAILABLE rather than as a pass.

A fresh score of 3/5 or below means Greptile still has concerns — either new
comments will appear, or the summary needs manual review.

**Report the score** in every round completion message and in the final summary,
with which commit it describes and whether that is the current head — not merely
"fresh/stale", which hides the never-re-reviewed case entirely.

The autofix loop summary should include all rounds:

```text
## Autofix Summary — PR #[number]
Rounds completed: [N]
Total comments addressed: [N]
Total commits: [list]
Deploys: [N] (meshcraft.sawyerdesign.io)
Greptile confidence: [score]
Mergeable: [MERGEABLE | CONFLICTING]  Checks: [N/N SUCCESS]
Status: [CLEAN | CAPPED at round N with M remaining | CONFIDENCE_LOW | NOT_MERGEABLE | CHECKS_FAILING]
```

If `autofix` is NOT in $ARGUMENTS, run a single pass (Phases 0–6) as normal.
</autofix-mode>

<mandatory-coverage>
## Non-Skippable Comment Categories (ENFORCED — ALL MODES)

The following comment categories are MANDATORY to address. They are consistently
skipped in practice, which defeats the purpose of code review triage. Skipping
any of these is a skill violation.

### 1. Outside-Diff Comments (CodeRabbit `⚠️ Outside diff range` + Greptile)

These are comments on code OUTSIDE the PR diff that reviewers flagged as related.
They are embedded in `<details>` dropdowns and render collapsed — making them
easy to miss. They are NOT optional.

**MANDATORY**: Every outside-diff comment must be:
- Read and investigated against live code (same as inline comments)
- Classified (VALID BUG / VALID IMPROVEMENT / FALSE POSITIVE / etc.)
- Fixed if valid, explained if false positive
- Replied to in the consolidated issues comment (Phase 4)

**FORBIDDEN**: Skipping outside-diff comments because they are "not in the diff",
"pre-existing", or "out of scope". If a reviewer flagged it, you address it.

### 2. Nitpick Comments (CodeRabbit `🧹 Nitpick`)

These are lower-severity suggestions but they are still actionable findings.
They are embedded in `<details>` dropdowns and render collapsed.

**MANDATORY**: Every nitpick must be investigated, classified, and either fixed
or explained. "It's just a nitpick" is not a reason to skip.

### 3. Greptile Summary (Re-examined EVERY Round)

The Greptile summary comment is updated in-place after each commit. Its content
(concerns, findings, confidence score) CHANGES between rounds. It is NOT a
static artifact from PR open time.

**MANDATORY in every round (autofix mode)**:
- Re-fetch the Greptile summary comment (by author, not recency)
- Re-read the FULL body — not just the confidence score
- Extract any concerns or findings that are new or changed since last round
- Address new/changed concerns as actionable findings
- Report the current confidence score AND whether the summary content changed

**MANDATORY in single-pass mode**: Fetch and fully parse the Greptile summary
once. Extract all concerns. Address each one.

### 4. Replies and Follow-Up Comments

After fixing and pushing, reviewers (human or bot) may reply to your fix comments
requesting further changes. These replies are new findings.

**MANDATORY**: Check for replies to your previous fix comments in every autofix
round. A reply saying "this doesn't fully address the concern" or suggesting a
different approach is an unresolved finding that must be addressed.

### 5. Severity-Bucket Comments (CodeRabbit Critical / Major / Minor)

The highest-severity findings CodeRabbit produces. They arrive one of two ways —
as a `<details>` bucket in the review body, or as ordinary inline comments
labelled `_🟠 Major_` in the body text — and a triage that only knows the
outside-diff and nitpick bucket names sees neither.

**MANDATORY**: Discover buckets generically (any `… comments (N)` summary) and
read the severity label on every inline comment. A round that reports 0 Critical
/ Major / Minor findings on a PR with a nonzero `Actionable comments posted: N`
has mis-parsed something.

### 6. `/pr-review` Findings (SOURCE 4)

The in-house reviewer posts under a human account, so every author filter in this
file skips it silently, and a marker query for `finding` alone drops its
outside-diff and nitpick findings. Both failures look identical to a clean round.

**MANDATORY**: Run the SOURCE 4 marker queries every round, matching all marker
types. If they return nothing, confirm `/pr-review` actually ran on this PR
before recording a clean pass.

### Completeness Gate (End of Every Round)

Before declaring a round complete, verify:
- [ ] ALL outside-diff comments addressed (not just counted)
- [ ] ALL nitpick comments addressed (not just counted)
- [ ] ALL Critical / Major / Minor comments addressed (not just counted)
- [ ] ALL `/pr-review` findings addressed, all marker types queried
- [ ] Greptile summary re-read and concerns extracted
- [ ] ALL replies to prior fix comments checked
- [ ] Findings table includes items from ALL categories (inline, severity buckets,
      outside-diff, nitpick, additional-comment, greptile-summary, pr-review, reply)
- [ ] No `<details>` dropdowns left unparsed, including buckets whose label this
      file does not name
- [ ] Every embedded finding recorded in the `triage:v1:addressed` ledger
- [ ] Sources re-fetched at the END of the round, not only at the start — a
      reviewer that posts mid-round is otherwise invisible until the next one
</mandatory-coverage>

<workflow>

## Phase 0: Discover PR and Comments

1. **Identify the PR**:
   - If $ARGUMENTS provides a PR number, use that
   - Otherwise, find the PR for the current branch: `gh pr view --json number,title,url,headRefName`

2. **Pull ALL comment sources** — there are 3 distinct API surfaces:

   ```bash
   # SOURCE 1: Inline review comments (threaded on specific lines)
   # Contains: CodeRabbit inline, Sentry inline, Greptile inline
   gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate

   # SOURCE 2: Top-level PR comments (issue-style comments, not on lines)
   # Contains: CodeRabbit summary with embedded <details> dropdowns,
   #           Greptile review body with embedded "Additional Comments"
   gh api repos/{owner}/{repo}/issues/{number}/comments --paginate

   # SOURCE 3: Full review bodies (submitted reviews with body text)
   # Contains: Greptile "Additional Comments" that live in the review body
   gh api repos/{owner}/{repo}/pulls/{number}/reviews --paginate

   # RESOLUTION STATUS: Review threads with isResolved flag (paginated)
   # Use cursor-based pagination to fetch ALL threads — some PRs exceed 100.
   # Loop until pageInfo.hasNextPage is false:
   gh api graphql -f query='
     query($owner: String!, $repo: String!, $number: Int!, $after: String) {
       repository(owner: $owner, name: $repo) {
         pullRequest(number: $number) {
           reviewThreads(first: 100, after: $after) {
             pageInfo { hasNextPage endCursor }
             nodes {
               isResolved
               id
               comments(first: 50) {
                 nodes { body author { login } path line }
               }
             }
           }
         }
       }
     }' -f owner="{owner}" -f repo="{repo}" -F number={number}
   # If pageInfo.hasNextPage is true, re-query with -f after="{endCursor}"
   # and accumulate all nodes until hasNextPage is false.
   ```

3. **Parse embedded comments from `<details>` dropdowns in comment bodies**:

   AI reviewers embed findings inside HTML `<details>` blocks in their top-level
   or review body comments. These are NOT separate API comments — they are
   sections within a single comment's markdown body. You MUST read and parse
   the full body text to extract them.

   **CodeRabbit** (`coderabbitai[bot]`) top-level comment structure:
   ```text
   Actionable comments posted: N

   <details> ⚠️ Outside diff range comments (N)
     → Each item lists a file:line and a finding. These are comments on code
       that was NOT in the PR diff but is related. Extract each as a separate item.
   </details>

   <details> 🧹 Nitpick comments (N)
     → Lower-severity suggestions. Each lists file:line and a recommendation.
       Extract each as a separate item.
   </details>

   <details> 📜 Review details
     → Configuration, commit summary, etc. — informational, not actionable.
   </details>
   ```

   **The section vocabulary CHANGES — never hardcode it.** CodeRabbit moved to
   severity buckets in 2026-07: a review body now carries one `<details>` per
   bucket — `🔴 Critical`, `🟠 Major`, `🟡 Minor`, `🧹 Nitpick`, `⚠️ Outside diff
   range`, `♻️ Duplicate`, and any future label — each summarized `… comments (N)`
   with one child `<details>` per file. **Discover** EVERY such section generically
   (match any summary ending in `comments (N)`); do NOT parse only outside-diff +
   nitpick. On a real PR a check that knew only those two names reported a clean
   `7/7` while the body carried **43** findings — 36 (Critical/Major/Minor) were
   invisible.

   Discovery is generic; **counting is not.** Classify every discovered bucket
   into exactly one of these, by name, and let the default carry the unknowns:

   | Bucket | Actionable? | Why |
   |---|---|---|
   | `🔴 Critical`, `🟠 Major`, `🟡 Minor`, `🧹 Nitpick` | **yes** | severity buckets — every entry is a finding |
   | `⚠️ Outside diff range` | **yes** | a defect the diff did not touch is still a defect |
   | `♻️ Duplicate` | no | restates an entry already counted in a severity bucket; counting it double-counts one finding and manufactures a second "fix" for it |
   | `📜 Review details`, `📥 Commits`, `📒 Files selected`, `⛔ Files ignored`, `🧰 Tools`, `🪄 Autofix` | no | configuration and provenance, no finding in them |
   | **any bucket not named above** | **yes — treat as actionable** | an unrecognized label is far more likely to be a new severity tier than a new informational block. Investigate its entries and say in the summary that you classified an unknown bucket as actionable. |

   **The actionable total** = the sum of per-file entries across actionable
   buckets only. That total is what your findings list and every coverage count
   must match. Reconcile it against `Actionable comments posted: N` at the top of
   the review body; if they disagree, you have mis-bucketed something — find the
   discrepancy before moving on, do not average the two.

   A caveat that costs a whole round if missed: **CodeRabbit does not always use
   the `<details>` buckets.** It often posts each finding as a normal inline
   comment (SOURCE 1) carrying its severity inline as `_🟠 Major_` plus an
   `<!-- cr-indicator-types:nitpick -->` marker, and leaves the review body with
   nothing but the count and an AI-agents prompt block. Both shapes occur, and a
   single PR can mix them. Never conclude "0 nitpicks" from an absent nitpick
   bucket — check the inline comments' severity labels and indicator markers too.

   **Greptile** (`greptile-bot` or `greptile[bot]`) review body structure:
   ```text
   [N inline comments, N additional comments]

   (inline comments appear as threaded review comments — already in SOURCE 1)

   **Additional Comments**
   → These appear in the review body text (SOURCE 3), often after the inline
     comment summary. Each lists a file reference and a finding. They are NOT
     posted as inline comments due to platform limitations.
     Extract each as a separate actionable item.
   ```

4. **Build the complete findings list** from all sources:
   - Inline review comments (SOURCE 1) — already file:line specific
   - **Every entry of every actionable CodeRabbit bucket** per the table above —
     Critical / Major / Minor / Nitpick / Outside-diff / any unrecognized label,
     parsed from the `<details>` blocks in SOURCE 2 and SOURCE 3. Not just
     outside-diff and nitpick.
   - CodeRabbit actionable items listed at top of summary — parse from SOURCE 2
   - Greptile "Additional Comments" — parse from review body in SOURCE 3
   - Greptile summary concerns — see step 6
   - `/pr-review` findings (SOURCE 4) — see the SOURCE 4 section at the end of
     this file; matched by marker, not by author
   - Sentry inline comments (SOURCE 1)

   Every item in this list gets a row in the findings table and a cell in the
   coverage table. Nothing enters the list without leaving a trace in both.

5. **Deduplicate**: Group by compound key `file + line + reviewer + category`.
   Same file+line from the SAME reviewer on the SAME concern = one investigation.
   Different reviewers or different concern categories (e.g., security vs performance)
   at the same location are SEPARATE findings — do not collapse them.

6. **Fetch and parse the Greptile summary comment** (MANDATORY — all modes):

   Greptile posts a top-level summary comment (SOURCE 2) that is **updated
   in-place** after each new commit. It contains a confidence score (`N/5`)
   and a summary of overall concerns. This comment may appear older since it
   is edited rather than re-posted — identify it by author, not by recency.

   ```bash
   # Fetch the Greptile summary comment
   gh api repos/{owner}/{repo}/issues/{number}/comments --paginate \
     --jq '.[] | select(.user.login == "greptile[bot]" or .user.login == "greptile-bot") | {id, body, updated_at}'
   ```

   From the comment body:
   - **Extract the confidence score** — look for the pattern `N/5` (e.g.,
     "Confidence: 3/5", "3/5", or similar). Report this score.
   - **Extract any concerns or findings** listed in the summary that are NOT
     already covered by inline comments or additional comments. These are
     high-level observations that may reference files or patterns. Treat each
     as an actionable finding and include in the findings table.

   Report the Greptile confidence score in the Phase 0 summary output:
   ```text
   Greptile confidence: [N]/5 (updated: [timestamp])
   ```

Present a summary table before investigating:

| # | File | Line | Reviewer | Source | Category | Summary |
|---|------|------|----------|--------|----------|---------|

Source values: inline, review-body, details-dropdown, greptile-summary, pr-review.
Category values: bug, outside-diff, nitpick, additional-comment, reply, security,
performance, critical, major, minor, unknown-bucket.

`reply` is a category, not a bookkeeping detail: the completeness gate and the
coverage table both require replies to prior fixes to appear as findings, so
without a category value for them they can only be misfiled or dropped.

Reviewer values include `pr-review` alongside `coderabbitai`, `greptile`, and
`sentry`. `/pr-review` runs under a human account, so the reviewer column is the
only place its provenance is recorded — never file its findings under the human's
name, or they become indistinguishable from a maintainer's own review comments.

## Phase 1: Investigate Each Comment

For EACH unresolved comment, in file order (to batch related fixes):

### 1a. Read the Actual Code

- Read the file at the referenced location (Read tool) — full function body, not just the flagged line
- Understand the surrounding context (±30 lines minimum)
- Trace callers and callees if the comment is about logic flow

### 1b. Classify the Comment

- **VALID BUG** — Real issue confirmed by reading live code. Will fix.
- **VALID IMPROVEMENT** — Not a bug but a legitimate code quality improvement. Will fix.
- **FALSE POSITIVE** — The reviewer misunderstood the code, missed context, or the pattern is intentional. Will explain why.
- **ALREADY FIXED** — The issue was fixed in a subsequent commit. Will note and resolve.
- **NOT APPLICABLE** — Comment references code that doesn't exist or was removed. Will resolve.

### 1c. Anticipate Ripple Effects

For each VALID BUG or VALID IMPROVEMENT:
- **Search for the same pattern** across the codebase — if the bug exists here, it likely exists elsewhere
- **Trace call sites** — if you change a function signature or return type, find ALL callers
- **Check related files** — this is a 13-file codebase, so cross-referencing is fast:
  - `state.ts` ↔ every file (STATE singleton)
  - `mesh.ts` ↔ `render.ts` ↔ `ui.ts` (generate → render pipeline)
  - `export.ts` reads from STATE.vertices
  - `interaction.ts` modifies STATE.orbit/tilt/zoom → triggers renderViewport
  - `toolbar.ts` binds buttons that call into mesh/render/export

## Phase 2: Fix Valid Issues

For each VALID BUG and VALID IMPROVEMENT:

1. **Apply the minimal surgical fix** that addresses the reviewer's concern
2. Follow existing code patterns and project rules:
   - **No `console.log`** — this is a production tool
   - **Escape user input in innerHTML** — `STATE.depthMapName` is user-controlled
   - **Revoke object URLs** — every `createObjectURL()` must have a matching `revokeObjectURL()`
   - **No degenerate triangles** — enforce minimum material thickness (0.01") for watertight exports
   - **No TODO/FIXME in production paths**
   - **Type safety** — `strict: true` in tsconfig, no `any` escape hatches
3. **Fix pattern proliferation** — if the same bug exists elsewhere, fix all instances
4. **Fix ripple effects** — update callers, types affected by the change

## Phase 3: Validate

```bash
npm run lint            # eslint src/ cli/
npm run typecheck       # tsc --noEmit — browser sources
npm run typecheck:cli   # tsc -p tsconfig.cli.json --noEmit — NOT run by the pre-commit hook
npm run build           # full Vite production build (tsc + vite build)
```

All four must pass cleanly before proceeding.

Use the `npm run` scripts, never a bare `npx tsc`: the scripts run the repo's
pinned TypeScript and carry the right `-p` flag, while `npx` silently downloads
whatever version is current when a local binary is missing — so it can pass on a
compiler the repo never uses. `typecheck:cli` is listed because the pre-commit
hook does not run it (`npm run lint` + `npm run typecheck` only), so a CLI-only
type error in `cli/` or `src/sbp/` gets through the hook and fails in CI.

If the fixes touched either side of the TS↔Python mirror, the parity specs are
the tests that matter here:

```bash
npm run test:gh-parity  # embedded NOISE_SCRIPT vs grasshopper/components/*.py
npm run test:relief     # Voronoi relief sampler regressions
```

## Phase 4: Reply and Resolve Comments

**Read this ordering note before the first `gh api` call.** Phase 4 is numbered
before Phase 5 but does not run entirely before it. A fixed finding's reply cites
`Fixed in <hash>` and its ledger key must not be written until the fix is
actually committed — so a strict 4-then-5 reading forces you to either invent a
hash or break the ledger rule. Split Phase 4 at the commit instead:

| Step | When | What |
|---|---|---|
| **4a** | before commit | Reply to and resolve every **rejected** finding — FALSE POSITIVE, ALREADY FIXED, NOT APPLICABLE. These cite evidence, not a new hash, so they need nothing from Phase 5. Key rejected embedded findings here, at the moment the rejection is written. |
| **5** | — | Commit and push the fixes (see Phase 5). |
| **4b** | after push | Reply to and resolve every **fixed** finding, citing the real hash. Post the consolidated embedded-findings comment and its ledger keys now. |

Rejections are keyed in 4a because their disposition is complete the moment it is
written — nothing later can change it, and an unkeyed rejection is re-litigated
every round. Fixes are keyed in 4b because a key written before the commit
records work that does not exist yet, and it is unrecoverable: the finding is
never surfaced again, so nobody discovers the gap.

Push before 4b, not just commit. A reply pointing at a hash that exists only in
your local repo is worse than no reply — it reads as done and cannot be checked.

**Resolution rule**: EVERY comment gets resolved after replying — whether it was
FIXED, rejected as FALSE POSITIVE, ALREADY FIXED, or NOT APPLICABLE. Resolution
means "addressed", not "agreed with". A rejection with explanation is a valid
resolution. Do NOT leave rejected comments unresolved.

Reply and resolution strategy differs by source type.

### SOURCE 1 findings (inline review comments — have thread IDs):

These have `comment_id` and `thread_id`. Reply directly to the comment, then
resolve the thread. This applies to ALL classifications — fixed AND rejected.

For VALID BUG / VALID IMPROVEMENT (fixed):
```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments/{comment_id}/replies \
  -f body="Fixed in [commit hash]. [1-sentence description of fix]."
```

For FALSE POSITIVE:
```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments/{comment_id}/replies \
  -f body="Not an issue — [concise explanation with file:line evidence why the code is correct]."
```

For ALREADY FIXED / NOT APPLICABLE:
```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments/{comment_id}/replies \
  -f body="[Already addressed in commit X / Code no longer exists after commit Y]."
```

**Then resolve the thread for ALL of the above** (fixed, rejected, N/A — all get resolved):
```bash
gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "{thread_id}"}) { thread { isResolved } } }'
```

### Embedded findings have no thread to resolve — carry a ledger

Everything in SOURCE 2 `<details>` buckets, Greptile "Additional Comments", and
Greptile summary concerns lives *inside* a comment body. There is no thread ID,
so `resolveReviewThread` cannot touch it and **nothing about replying makes the
finding stop being discoverable.** The bodies are edited in place, so every
autofix round re-fetches and re-parses the same text and re-finds the same
findings — which without a ledger means round 2 "discovers" round 1's work,
re-fixes it, and the loop only terminates on the round cap.

So the consolidated reply doubles as the resolution ledger. Give every embedded
finding a stable key and emit it as an HTML comment in the reply:

```text
<!-- triage:v1:addressed key=<source-comment-id>:<file>:<line>:<slug> -->
```

- `<source-comment-id>` — the numeric id of the comment or review whose body the
  finding was parsed out of. Scoping to it means a *new* summary comment's
  findings are new even at the same file:line.
- `<file>:<line>` — as the reviewer wrote it. Use `0` when it names no line.
- `<slug>` — first 6 words of the finding title, lowercased, non-alphanumerics to
  `-`. This is what survives the line numbers moving under it, which they do on
  every commit.

**Phase 0 of every round must read the ledger back before building the findings
list**, and drop any parsed finding whose key already appears:

```bash
gh api repos/{owner}/{repo}/issues/{number}/comments --paginate \
  --jq '.[].body | scan("triage:v1:addressed key=([^ ]+)")' | sort -u
```

Two rules that keep this honest:

- A key means **addressed**, not fixed — a rejected finding is keyed too, which
  is the entire point: an unkeyed rejection gets re-litigated every round.
- Key a finding **only after** its disposition is real: a rejection in step 4a,
  when the explanation is written; a fix in step 4b, after the commit is pushed.
  Keying at parse time marks work addressed that no one did, and it is invisible
  afterward because the finding never gets re-surfaced.

Reply via the issues API with a consolidated comment covering ALL findings from
that source comment. Each gets its fix description OR rejection reason, and each
gets a key — nothing is left unaddressed and nothing is addressed twice.

```bash
gh api repos/{owner}/{repo}/issues/{number}/comments \
  -f body="Addressed CodeRabbit embedded findings:

**Major:**
- [file:line] — Fixed in [commit hash]. [description]
  <!-- triage:v1:addressed key=5124392413:src/state.ts:381:serialize-config-returns-empty-string -->

**Outside-diff:**
- [file:line] — Not applicable: [explanation with evidence]
  <!-- triage:v1:addressed key=5124392413:src/render.ts:0:camera-update-needs-explicit-render -->

**Nitpicks:**
- [file:line] — Rejected: [explanation why current code is correct]
  <!-- triage:v1:addressed key=5124392413:styles/main.css:44:section-title-uses-warn-token -->
..."
```

### SOURCE 3 findings (Greptile "Additional Comments" in review body):

These live in review body text and have NO thread IDs — so they need the ledger
key too, scoped to the review id:
```bash
gh api repos/{owner}/{repo}/issues/{number}/comments \
  -f body="Addressed Greptile additional comments:
- [file:line] — Fixed in [commit hash]. [description]
  <!-- triage:v1:addressed key=4814100564:cli/stl-to-sbp.ts:88:missing-arg-validation -->
- [file:line] — Rejected: [explanation with evidence]
  <!-- triage:v1:addressed key=4814100564:src/export.ts:166:rhino3dm-cdn-pin -->
..."
```

### Greptile summary findings (concerns from the summary comment):

Also ledger-keyed. The summary comment is edited in place, so its id is stable
across rounds while its *content* is not — key on the concern slug, and treat a
re-worded concern at the same location as new, because Greptile rewriting it
usually means its read of the code changed:
```bash
gh api repos/{owner}/{repo}/issues/{number}/comments \
  -f body="Addressed Greptile summary concerns:
- [file:line] — Fixed in [commit hash]. [description]
  <!-- triage:v1:addressed key=5124407636:.claude/skills/pr-review/SKILL.md:63:wrong-serializeconfig-return-value -->
- [concern] — Rejected: [explanation with evidence]
  <!-- triage:v1:addressed key=5124407636:(none):0:docs-only-merge-is-safe -->
..."
```

### Replies to prior fix comments:

When a reviewer (bot or human) replies to your previous fix comment requesting
further changes, that reply is a new finding. Reply directly to that reply
with your fix or rejection, then resolve the thread if it has a thread ID.

```bash
# Reply to the reply
gh api repos/{owner}/{repo}/pulls/{number}/comments/{reply_comment_id}/replies \
  -f body="[Fixed in commit hash / Rejected: explanation]"
# Resolve thread if applicable
gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "{thread_id}"}) { thread { isResolved } } }'
```

### Phase 4 Completeness Check

Run this after step **4b** — i.e. after the push — since the fixed-finding replies
and their ledger keys do not exist until then. The one item that gates entry to
Phase 5 is the 4a half: every rejected finding replied to, resolved, and keyed.

Verify:
- [ ] Every SOURCE 1 thread has a reply AND is resolved (fixed OR rejected)
- [ ] A consolidated comment covers EVERY actionable CodeRabbit bucket's entries —
      Critical, Major, Minor, Nitpick, Outside-diff, unknown labels (fixed + rejected)
- [ ] A consolidated comment covers ALL Greptile additional comments
- [ ] A consolidated comment covers ALL Greptile summary concerns (if any)
- [ ] A consolidated comment covers ALL `/pr-review` findings without thread IDs
- [ ] Every embedded finding carries a `triage:v1:addressed` ledger key, rejections included
- [ ] Ledger key count == embedded finding count for this round (no key without a
      finding, no finding without a key)
- [ ] All replies to prior fix comments have been answered
- [ ] Zero unresolved threads remain that have been addressed

## Phase 5: Commit and Push

Runs between steps 4a and 4b — the rejections are already replied to and resolved;
the fixed-finding replies are waiting on the hash this phase produces.

1. Stage only the files changed for fixes (explicit paths, never `git add -A`)
2. Commit with a descriptive message:
   ```text
   fix: address PR #<number> code review findings
   ```
3. Push to the current branch
4. Verify the push succeeded — compare the remote head to your local HEAD, do not
   just read the last commit, since a rejected push still leaves a local commit:
   ```bash
   git rev-parse HEAD; git rev-parse @{u}
   gh pr view <number> --json headRefOid --jq '.headRefOid'
   ```
5. **Check the PR is mergeable.** A branch behind a moved `main` reports
   `CONFLICTING`, and no amount of review triage makes the PR green while it does:
   ```bash
   gh pr view <number> --json mergeable,mergeStateStatus,statusCheckRollup
   ```
   If it conflicts, merge `origin/main` in and resolve before continuing — that is
   part of getting the PR green, not a separate task. Resolve by writing each path
   from the blob you intend to keep (`git show <ref>:<path> > <path>`) rather than
   `git checkout --ours/--theirs`, and re-run every gate afterwards: a conflict
   resolution is an edit, and it is the edit most likely to silently drop a fix
   you made earlier in the round.
6. Return to step **4b**: reply to the fixed findings with the pushed hash, post
   the consolidated comment, write the ledger keys, resolve those threads.

## Phase 6: Deploy to Production

After Phase 5 succeeds (commit + push verified), deploy to the live site.

```bash
npm run deploy
```

`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are exported via `~/.zshenv`.

Runs in BOTH modes:
- **Single-pass mode**: Deploy once after Phase 5 completes
- **Autofix mode**: Deploy at the end of EACH round, before the wait cycle

Verify wrangler reports a successful deployment URL before proceeding.

Report deploy status:
```text
Deployed to meshcraft.sawyerdesign.io [success/failed]
```

</workflow>

<comment-sources>
AI REVIEW COMMENT SOURCES — DO NOT MISS ANY

These comments come from 3 different GitHub API surfaces, carrying findings from
4 sources (`/pr-review` shares surfaces 1 and 3 — see the SOURCE 4 section at the
end of this file). Missing an API surface means missing entire categories of
findings.

### API Surface 1: Inline Review Comments (`pulls/{n}/comments`)
These are threaded comments attached to specific file:line in the diff.
- **CodeRabbit inline** — actionable comments posted on diff lines
- **Sentry inline** — error-prone pattern warnings on diff lines
- **Greptile inline** — code review findings on diff lines

### API Surface 2: Top-Level Issue Comments (`issues/{n}/comments`)
These are the big summary comments posted by bots. Findings are EMBEDDED inside
the markdown body in `<details>` HTML blocks that must be parsed.
- **CodeRabbit summary comment** — contains:
  - One `<details>` dropdown per severity bucket — `🔴 Critical`, `🟠 Major`,
    `🟡 Minor`, `🧹 Nitpick`, `⚠️ Outside diff range`, `♻️ Duplicate`, and labels
    not yet invented. All collapsed by default, which is why they get missed.
    Discover them generically (`… comments (N)`); see the actionable/informational
    table in Phase 0 step 3 for which ones count.
  - `Actionable comments posted: N` — count at top; verify you found all N
  - `📜 Review details` — informational, not actionable
  - Note that a CodeRabbit run may post NO buckets at all and put every finding
    in inline comments instead (SOURCE 1), each carrying its own severity label.
    An empty bucket set is not an empty review.

### API Surface 3: Review Bodies (`pulls/{n}/reviews`)
These are the body text of submitted reviews (not the inline comments attached
to them, which are in Surface 1).
- **Greptile review body** — contains:
  - **"Additional Comments"** section with file references and findings that
    could NOT be posted inline (platform limitation). These render after the
    inline comment summary. Each is a separate actionable item.
  - Format: `[N inline comments, N additional comments]` at the top

### Did CodeRabbit actually review this commit? (MANDATORY — check before believing a clean round)

**A rate-limited CodeRabbit run is indistinguishable from a clean one on every surface
this file has told you to read.** It still regenerates its summary comment, still
updates the `📥 Commits` range to `...and <new-head>`, still lists `📒 Files selected
for processing (N)` — and posts no findings, because it never ran. Every check above
then agrees the round is clean.

The truth is only in the `CodeRabbit` **commit status**, whose `description` is either
`Review completed` or `Review rate limited`:

```bash
gh api "repos/{owner}/{repo}/commits/<head-sha>/status" \
  --jq '.statuses[]? | select(.context=="CodeRabbit") | "\(.state) :: \(.description)"'
```

Note `state` is `success` in BOTH cases — a rate-limited review is not a failed check,
so `gh pr checks` shows `pass` and the rollup shows `SUCCESS`. Only the description
distinguishes them. Read the description, never the state.

Verified on PR #18: `768a64e` → `Review completed`, then `8cd4516` and `91c95e8` →
`Review rate limited`. Two commits carrying every round-2 fix looked reviewed-and-clean
on the summary comment and had not been read at all.

**Rules:**
- Run this check on the current head before reporting any round clean. If the
  description is `Review rate limited`, the round is **NOT** clean — it is unreviewed.
- Do not report "0 new findings" for a rate-limited commit. Report "not reviewed
  (rate limited)", which is a different fact and the opposite conclusion.
- A merge commit may have no CodeRabbit status at all; that is also "not reviewed".
- To get a real review once the window resets, comment `@coderabbitai review` on the PR
  and re-check the description until it reads `Review completed`.
- The same asymmetry applies to Greptile: a summary that regenerates is not a review
  that ran. Confirm via its `Last reviewed commit` footer, per the Confidence Gate.

### Completeness Check
After collecting from all 3 surfaces, verify:
- The head commit's CodeRabbit status description reads `Review completed`, not
  `Review rate limited` (see above) — otherwise the round is unreviewed, not clean
- CodeRabbit's "Actionable comments posted: N" matches the total you found —
  summed across ALL its reviews, since each review reports only its own count
- Greptile's "[N inline, N additional]" counts match what you extracted
- The `/pr-review` marker queries were run and their result explained
- No `<details>` blocks were skipped or left unparsed
- Nothing arrived between your first fetch and this check — re-fetch SOURCE 1 and
  SOURCE 3 before declaring the collection complete

### Greptile Summary & Confidence Score (MANDATORY — all modes)
Greptile posts a top-level summary comment (SOURCE 2) that is updated in-place
after each commit. It contains a confidence score (`N/5`) and high-level concerns.
This is a SEPARATE step from collecting inline/additional comments — see Phase 0
step 6 for the full extraction protocol. The confidence score MUST appear in the
final output summary regardless of whether autofix mode is active.
</comment-sources>

<pre-existing-issues>
While investigating and reading files deeply, if you encounter pre-existing
issues — bugs, anti-patterns, missing error handling, stale code — in files
you are ALREADY modifying for fixes, include them in the fix scope.

This is a small codebase (13 source files). If you found a problem in a file
you're already editing, fix it now rather than deferring.

FORBIDDEN:
- "Out of scope for this PR"
- "Pre-existing, will address separately"
- "Not related to the reviewer's comment"
</pre-existing-issues>

<self-critique>
After all fixes are applied and before committing:

1. Anti-pattern search on ALL modified files:
   - `TODO|FIXME|HACK|XXX` in production paths
   - `as any|@ts-ignore` type escape hatches
   - `console.(log|warn|error)` — forbidden in this project
   - Empty catch blocks

2. Verify each fix actually addresses the reviewer's concern — re-read the comment,
   re-read your fix, confirm they match

3. Cross-reference: if two reviewers flagged the same file, ensure your fixes don't conflict

4. Check that no fix introduced a new issue (changed return type breaking callers, etc.)

5. Run `npm run typecheck` and `npm run typecheck:cli` one final time after all
   fixes — the pinned scripts, not `npx tsc`
</self-critique>

<output-format>
After completing triage, present a final summary:

## PR Comment Triage Summary — PR #[number]

### Fixed

| # | File:Line | Reviewer | Issue | Fix Description |
|---|-----------|----------|-------|-----------------|

### False Positives

| # | File:Line | Reviewer | Issue | Why Not Valid |
|---|-----------|----------|-------|---------------|

### Already Fixed / N/A

| # | File:Line | Reviewer | Issue | Status |
|---|-----------|----------|-------|--------|

### Pattern Fixes (bonus — same bug found elsewhere)

| # | File:Line | Original Comment | Fix Description |
|---|-----------|------------------|-----------------|

### Coverage by Category (MANDATORY — no silent omissions)

| Category | Found | Addressed | Skipped |
|----------|-------|-----------|---------|
| Inline comments | N | N | 0 |
| Critical / Major / Minor (CodeRabbit) | N | N | 0 |
| Outside-diff (CodeRabbit) | N | N | 0 |
| Outside-diff (Greptile) | N | N | 0 |
| Nitpicks (CodeRabbit) | N | N | 0 |
| Unrecognized buckets (CodeRabbit) | N | N | 0 |
| Additional comments (Greptile) | N | N | 0 |
| Greptile summary concerns | N | N | 0 |
| `/pr-review` findings | N | N | 0 |
| `/pr-review` outside-diff | N | N | 0 |
| `/pr-review` nitpicks | N | N | 0 |
| Replies to prior fixes | N | N | 0 |
| Sentry inline | N | N | 0 |
| Carried over from prior rounds (ledger) | N | N | 0 |

**Skipped column must be 0 for all rows.** If any row shows skipped > 0,
the round is incomplete.

**Every row is mandatory, including the zeros.** A row omitted because its count
is 0 is indistinguishable from a row omitted because the category was never
queried — and the second is the failure this table exists to catch. If a
`/pr-review` row reads 0, say in the same breath whether `/pr-review` actually
ran on this PR or simply posted nothing.

The `Found` totals must reconcile with Phase 0: the CodeRabbit rows sum to the
actionable-bucket total, which itself matches `Actionable comments posted: N`.

### Greptile Confidence
**Score: [N]/5** (updated: [timestamp], fresh: [yes/no])
**Summary content changed since last round: [yes/no/first-round]**

### Commits
- `[hash]` [message]

### All [N] review threads resolved.
</output-format>

<adversarial-pre-response>
Before presenting triage results:
- Audit assumptions: is each classification (VALID BUG / FALSE POSITIVE / etc.) based on code you actually read, or pattern-matching from the reviewer's comment?
- Mental test suite: could the reviewer be right and your "false positive" dismissal be wrong? Did you check the right file version? Edge cases the reviewer saw that you didn't?
- If self-review finds errors in your classifications, fix silently. A wrong FALSE POSITIVE is worse than investigating a valid concern.
- Review your fixes as a senior dev: off-by-ones, type mismatches, stale references, the thing that makes a reviewer say "did you actually test this?"
</adversarial-pre-response>

<rules>
- Every claim backed by file:line evidence from live code
- Read full function bodies around flagged lines — not just the flagged line
- Anticipate ripple effects BEFORE pushing — reduce the review round-trip cycle
- Reply to EVERY unresolved comment — fixes get a "Fixed in [hash]" reply, false positives get an explanation
- Resolve ALL threads after replying — no orphaned conversations
- Surgical fixes only — don't refactor surrounding code (EXCEPT pre-existing issues in files already being modified)
- Pattern proliferation: if a reviewer found a bug, grep for the same pattern codebase-wide
- NEVER dismiss a comment without reading the actual code first — "looks fine to me" is not a valid response
- **OUTSIDE-DIFF COMMENTS ARE MANDATORY** — never skip CodeRabbit `⚠️ Outside diff range` or Greptile out-of-diff findings
- **NITPICK COMMENTS ARE MANDATORY** — never skip CodeRabbit `🧹 Nitpick` findings
- **DISCOVER BUCKETS GENERICALLY, COUNT THEM BY NAME** — any `… comments (N)` summary is a bucket; only `♻️ Duplicate` and the informational blocks are non-actionable, and an unrecognized label is actionable by default
- **`/pr-review` IS MATCHED BY MARKER, NOT AUTHOR** — and by ALL marker types, not just `finding`
- **EMBEDDED FINDINGS GET A LEDGER KEY** — they have no thread to resolve, so an unkeyed one is rediscovered every round and re-fixed forever
- **GREPTILE SUMMARY IS REFRESHED EVERY ROUND** — re-fetch, re-read the full body, extract new/changed concerns
- **REPLIES ARE FINDINGS** — check for replies to your prior fix comments every round
- **NO CATEGORY MAY BE SILENTLY OMITTED** — the findings table MUST include items from ALL categories. If a category has zero items, state "0 outside-diff", "0 nitpicks", etc. explicitly. Silent omission is forbidden.
</rules>

---

## SOURCE 4: `/pr-review` findings (in-house reviewer — MANDATORY, never skip)

<!-- pr-review-integration:v1 -->

`/pr-review` is the in-house replacement for CodeRabbit and Greptile. In PR mode it posts its
findings to the PR, so this skill must triage them exactly like a paid bot's.

**It does not post as a bot.** It runs under a human account, so every author filter in this
file — `select(.user.login | test("greptile"))`, `== "coderabbitai[bot]"`, and friends — will
skip its findings silently. That silence is the dangerous part: the round looks clean because
the query matched nothing, which is the same failure mode as a rate-limited CodeRabbit run
posting no findings. **Match on the marker, not the author.**

### Fetching

```bash
PR=<number>
OWNER_REPO=<owner>/<repo>

# Inline findings (SOURCE 1 surface) — one per file:line.
# Match EVERY marker type. `finding` alone silently drops outside-diff and nitpick
# findings while the completeness gate below still reports a clean round.
gh api "repos/$OWNER_REPO/pulls/$PR/comments?per_page=100" --paginate \
  --jq '.[] | select(.user.type != "Bot")
             | select(.body | test("pr-review:v1:(finding|outside-diff|nitpick)"))
             | {id, path, line, body}'

# Summary / review body (SOURCE 3 surface)
gh api "repos/$OWNER_REPO/pulls/$PR/reviews?per_page=100" --paginate \
  --jq '.[] | select(.user.type != "Bot")
             | select(.body | contains("pr-review:v1:summary"))
             | {id, body, submitted_at}'
```

**The `.user.type != "Bot"` filter is not redundant** — it is the one author check
this section still needs, and it guards a real false positive rather than causing
one. A marker string is just text, so any comment *quoting* the marker contract
matches: a CodeRabbit review of this very skill file matched
`pr-review:v1:finding` and `pr-review:v1:summary` from the table below and looked
like a `/pr-review` round that never happened. `/pr-review` posts under a human
account and the paid bots do not, so excluding bots keeps every genuine finding
and drops the quotes. If a match still looks like prose about the markers rather
than a finding, read it before counting it.

### Markers

| Marker | Meaning | Triage treatment |
|---|---|---|
| `pr-review:v1:summary` | round wrapper; carries `head=<sha>` | read first — tells you which commit was reviewed |
| `pr-review:v1:finding` | an actionable finding, with `severity=` and `category=` | same as a CodeRabbit inline comment |
| `pr-review:v1:outside-diff` | defect is outside the diff | same as CodeRabbit's outside-diff block — NOT skippable |
| `pr-review:v1:nitpick` | Trivial severity | same as a CodeRabbit nitpick — NOT skippable |

### Staleness check before fixing

The summary carries `pr-review:v1:head=<sha>`. Compare it to the PR's current head. If they
differ, the findings were written against older code: verify each one against live code before
fixing, and skip with a reason any that the intervening commits already resolved. Fixing a
finding that no longer applies is how a fix-loop starts inventing work.

### Feeding the loop back

When a `/pr-review` finding is verified as NOT a real defect, append it to the project layer's
`.claude/skills/pr-review/references/false-positive-log.md` with the reason. That log is the
in-house reviewer's only self-correcting surface; a rejection that is not recorded gets raised
again next round. This is the one triage step that has no equivalent for the paid bots, because
with them there was nowhere to write it.

### Completeness gate

A round is not clean until **every** marker query above — `finding`, `outside-diff`, and
`nitpick` — returns zero unresolved findings. A gate that only ran the `finding` query reports
clean while outside-diff and nitpick findings sit unaddressed, which is the exact failure this
section exists to prevent.

Report all three `/pr-review` counts as their own rows in the coverage table, alongside the
CodeRabbit and Greptile counts. If a marker query returns nothing, confirm `/pr-review` actually
ran on this PR rather than recording it as a clean pass — check for a `pr-review:v1:summary`
review, and if there is none, say so explicitly: "no `/pr-review` run on this PR" is a finding
about coverage, while "0 `/pr-review` findings" claims a clean review that never happened.

`/pr-review` findings without a thread ID follow the embedded-findings rules in Phase 4: they get
a consolidated reply and a `triage:v1:addressed` ledger key, keyed to the review id that carried
them.

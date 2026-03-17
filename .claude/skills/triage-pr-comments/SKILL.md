---
name: triage-pr-comments
description: Triages AI code review comments (CodeRabbit, Sentry, Greptile) on the current branch's PR — verifies each finding against live code, fixes valid issues, resolves conversations, commits and pushes. Handles inline comments, outside-diff comments, nitpicks, and additional comments. Use 'autofix' flag to loop until clean. Use this skill whenever the user mentions PR comments, code review findings, triage, addressing review feedback, or wants to fix issues flagged by AI reviewers on a pull request.
argument-hint: "[optional: 'autofix', PR number, e.g. 'autofix', '29', 'autofix 29']"
---

<task>
Triage AI code review comments on the current branch's PR. $ARGUMENTS
</task>

<autofix-mode>
## Autofix Loop Mode

Parse $ARGUMENTS for the `autofix` flag (case-insensitive). Any remaining
arguments (e.g. PR number) are passed through normally.

Examples: `/triage-pr-comments autofix`, `/triage-pr-comments autofix 29`

When `autofix` is present, after completing Phase 5 (commit and push):

1. **Report round completion**: "Round [N] complete. Waiting 12 minutes for
   reviewers to re-analyze the push..."
2. **Wait 12 minutes**: `sleep 720` — this gives CodeRabbit, Greptile, and
   Sentry time to re-run their reviews on the new commit.
3. **Re-run FULL Phase 0**: Pull ALL comment sources again from all 3 API
   surfaces. This is a COMPLETE re-pull, not a delta check. You MUST:
   - Re-fetch inline review comments (SOURCE 1)
   - Re-fetch top-level issue comments (SOURCE 2) — re-parse ALL `<details>`
     dropdowns including `⚠️ Outside diff range` and `🧹 Nitpick` sections
   - Re-fetch review bodies (SOURCE 3) — re-parse Greptile additional comments
   - **Re-fetch and re-parse the Greptile summary comment** — extract the
     CURRENT confidence score AND re-read ALL concerns/findings in the summary
     body. The summary is updated in-place after each commit, so its content
     CHANGES between rounds. Treat it as a fresh document every round.
   - Re-fetch resolution status via GraphQL (paginated)
4. **Examine ALL unresolved findings** — not just "new" ones. Specifically:
   - Any **outside-diff comments** from CodeRabbit or Greptile that were not
     addressed in prior rounds (these are persistently skipped — FORBIDDEN)
   - Any **nitpick comments** from CodeRabbit that were not addressed
   - Any **Greptile summary concerns** that are new or changed since last round
   - Any **replies** to prior fix comments that request further changes
   - Any NEW inline comments that appeared after the previous commit
   - Previously resolved threads can be skipped (already handled)
5. **Check the Greptile confidence score** (see Greptile Confidence Gate below).
6. **If ANY unaddressed findings exist** (new OR carried over): Run Phases 1–5
   again as a new round. Increment the round counter. Commit message for
   subsequent rounds:
   ```text
   fix: address PR #<number> round-<N> review findings
   ```
7. **If NO new unresolved comments BUT Greptile score is stale or < 4/5**: Wait
   another 12 minutes and re-check. A stale score (updated_at < push timestamp)
   means Greptile has not yet re-analyzed — do NOT trust it. Re-check up to
   3 times (36 min total wait). If still stale or below 4/5 after 3 re-checks,
   report the score and stop — manual review recommended.
8. **If NO new unresolved comments AND Greptile confidence >= 4/5 AND score is
   fresh** (updated_at > push timestamp): Report "All clear after round [N].
   Greptile confidence: [score]. No new review comments." and stop.
9. **Safety cap**: Maximum 10 rounds. If round 10 still produces new comments,
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

**Stop condition**: The autofix loop MUST NOT declare "all clear" unless:
- The Greptile confidence score is **4/5 or 5/5**, AND
- The score is **fresh** (`updated_at` > latest push timestamp).
A score of 3/5 or below, or a stale score, means Greptile still has concerns —
either new comments will appear, or the summary needs manual review.

**Report the score** in every round completion message and in the final summary,
including whether it was fresh or stale at the time of the check.

The autofix loop summary should include all rounds:

```text
## Autofix Summary — PR #[number]
Rounds completed: [N]
Total comments addressed: [N]
Total commits: [list]
Greptile confidence: [score]
Status: [CLEAN | CAPPED at round N with M remaining | CONFIDENCE_LOW]
```

If `autofix` is NOT in $ARGUMENTS, run a single pass (Phases 0–5) as normal.
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

### Completeness Gate (End of Every Round)

Before declaring a round complete, verify:
- [ ] ALL outside-diff comments addressed (not just counted)
- [ ] ALL nitpick comments addressed (not just counted)
- [ ] Greptile summary re-read and concerns extracted
- [ ] ALL replies to prior fix comments checked
- [ ] Findings table includes items from ALL categories (inline, outside-diff,
      nitpick, additional-comment, greptile-summary, reply)
- [ ] No `<details>` dropdowns left unparsed
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
   - CodeRabbit `⚠️ Outside diff range` items — parse from `<details>` in SOURCE 2
   - CodeRabbit `🧹 Nitpick` items — parse from `<details>` in SOURCE 2
   - CodeRabbit actionable items listed at top of summary — parse from SOURCE 2
   - Greptile "Additional Comments" — parse from review body in SOURCE 3
   - Sentry inline comments (SOURCE 1)

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

Source values: inline, review-body, details-dropdown, greptile-summary.
Category values: bug, outside-diff, nitpick, additional-comment, security, performance.

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
   - **No degenerate triangles** — enforce minimum base thickness (0.01") for watertight exports
   - **No TODO/FIXME in production paths**
   - **Type safety** — `strict: true` in tsconfig, no `any` escape hatches
3. **Fix pattern proliferation** — if the same bug exists elsewhere, fix all instances
4. **Fix ripple effects** — update callers, types affected by the change

## Phase 3: Validate

```bash
npx tsc --noEmit     # TypeScript strict-mode check
npm run build        # Full Vite production build (tsc + vite build)
```

Both must pass cleanly before proceeding.

## Phase 4: Reply and Resolve Comments

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

### SOURCE 2 findings (outside-diff + nitpicks from CodeRabbit `<details>` dropdowns):

These are embedded in summary comment `<details>` blocks and have NO thread IDs.
Reply via the issues API with a consolidated comment covering ALL findings
(outside-diff AND nitpicks) from that summary comment. Each finding gets its
fix description OR rejection reason — nothing is left unaddressed.

```bash
gh api repos/{owner}/{repo}/issues/{number}/comments \
  -f body="Addressed CodeRabbit outside-diff and nitpick findings:

**Outside-diff:**
- [file:line] — Fixed in [commit hash]. [description]
- [file:line] — Not applicable: [explanation with evidence]

**Nitpicks:**
- [file:line] — Fixed in [commit hash]. [description]
- [file:line] — Rejected: [explanation why current code is correct]
..."
```

### SOURCE 3 findings (Greptile "Additional Comments" in review body):

These live in review body text and have NO thread IDs. Reply via the issues API:
```bash
gh api repos/{owner}/{repo}/issues/{number}/comments \
  -f body="Addressed Greptile additional comments:
- [file:line] — Fixed in [commit hash]. [description]
- [file:line] — Rejected: [explanation with evidence]
..."
```

### Greptile summary findings (concerns from the summary comment):

Reply via the issues API covering all summary-extracted concerns:
```bash
gh api repos/{owner}/{repo}/issues/{number}/comments \
  -f body="Addressed Greptile summary concerns:
- [file:line] — Fixed in [commit hash]. [description]
- [concern] — Rejected: [explanation with evidence]
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

Before proceeding to Phase 5, verify:
- [ ] Every SOURCE 1 thread has a reply AND is resolved (fixed OR rejected)
- [ ] A consolidated comment covers ALL outside-diff findings (fixed + rejected)
- [ ] A consolidated comment covers ALL nitpick findings (fixed + rejected)
- [ ] A consolidated comment covers ALL Greptile additional comments
- [ ] A consolidated comment covers ALL Greptile summary concerns (if any)
- [ ] All replies to prior fix comments have been answered
- [ ] Zero unresolved threads remain that have been addressed

## Phase 5: Commit and Push

1. Stage only the files changed for fixes (explicit paths, never `git add -A`)
2. Commit with a descriptive message:
   ```text
   fix: address PR #<number> code review findings
   ```
3. Push to the current branch
4. Verify the push succeeded: `gh pr view --json commits --jq '.commits[-1]'`

</workflow>

<comment-sources>
AI REVIEW COMMENT SOURCES — DO NOT MISS ANY

These comments come from 3 different GitHub API surfaces. Missing an API surface
means missing entire categories of findings.

### API Surface 1: Inline Review Comments (`pulls/{n}/comments`)
These are threaded comments attached to specific file:line in the diff.
- **CodeRabbit inline** — actionable comments posted on diff lines
- **Sentry inline** — error-prone pattern warnings on diff lines
- **Greptile inline** — code review findings on diff lines

### API Surface 2: Top-Level Issue Comments (`issues/{n}/comments`)
These are the big summary comments posted by bots. Findings are EMBEDDED inside
the markdown body in `<details>` HTML blocks that must be parsed.
- **CodeRabbit summary comment** — contains:
  - `⚠️ Outside diff range comments (N)` inside a `<details>` dropdown
    → File:line references to code NOT in the diff. Easy to miss because they
    render collapsed by default.
  - `🧹 Nitpick comments (N)` inside a `<details>` dropdown
    → Lower-severity suggestions with file:line references. Also collapsed.
  - `Actionable comments posted: N` — count at top; verify you found all N
  - `📜 Review details` — informational, not actionable

### API Surface 3: Review Bodies (`pulls/{n}/reviews`)
These are the body text of submitted reviews (not the inline comments attached
to them, which are in Surface 1).
- **Greptile review body** — contains:
  - **"Additional Comments"** section with file references and findings that
    could NOT be posted inline (platform limitation). These render after the
    inline comment summary. Each is a separate actionable item.
  - Format: `[N inline comments, N additional comments]` at the top

### Completeness Check
After collecting from all 3 surfaces, verify:
- CodeRabbit's "Actionable comments posted: N" matches the total you found
- Greptile's "[N inline, N additional]" counts match what you extracted
- No `<details>` blocks were skipped or left unparsed

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

5. Run `npx tsc --noEmit` one final time after all fixes
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
| Outside-diff (CodeRabbit) | N | N | 0 |
| Outside-diff (Greptile) | N | N | 0 |
| Nitpicks (CodeRabbit) | N | N | 0 |
| Additional comments (Greptile) | N | N | 0 |
| Greptile summary concerns | N | N | 0 |
| Replies to prior fixes | N | N | 0 |
| Sentry inline | N | N | 0 |

**Skipped column must be 0 for all rows.** If any row shows skipped > 0,
the round is incomplete.

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
- **GREPTILE SUMMARY IS REFRESHED EVERY ROUND** — re-fetch, re-read the full body, extract new/changed concerns
- **REPLIES ARE FINDINGS** — check for replies to your prior fix comments every round
- **NO CATEGORY MAY BE SILENTLY OMITTED** — the findings table MUST include items from ALL categories. If a category has zero items, state "0 outside-diff", "0 nitpicks", etc. explicitly. Silent omission is forbidden.
</rules>

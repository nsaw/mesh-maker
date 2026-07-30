#!/usr/bin/env python3
"""
Map a diff's changed files onto the source-of-truth docs that describe them, so a review
can tell which docs the change just made stale.

Why this exists: a knowledge base is only worth reading if it is true. Generated subsystem
dossiers and hand-authored contracts both rot silently — the code moves, the doc keeps
asserting the old behavior, and six months later a reviewer (human or model) cites a doc
that has been wrong since March. That is worse than having no doc, because it is trusted.

This does not judge whether a doc is wrong. It answers the cheaper question: "which docs
claim to describe a file this diff changed, and has the doc been touched since?" A reviewer
then reads the flagged docs and decides. Silence here is meaningful — it means the diff
touched nothing the KB claims to describe.

Usage:
    check-context-staleness.py                          # working tree vs merge-base main
    check-context-staleness.py --base HEAD~3
    check-context-staleness.py --files a.ts b.ts
    check-context-staleness.py --doc-roots CONTEXT docs .cursor/contracts
"""

import argparse
import os
import re
import subprocess
import sys
from collections import defaultdict

DEFAULT_DOC_ROOTS = ["CONTEXT", "docs", ".cursor/contracts", "ADR", "adr"]
DOC_EXT = (".md", ".mdx", ".yml", ".yaml")

# A doc "references" a file when it names a real repo path. Backticked paths are the common
# case; bare paths in tables are frequent too. Require a slash and a known-ish extension so
# prose words are not mistaken for paths.
#
# The `(?!\w)` tail is load-bearing: without it a short alternative swallows a longer real
# extension — `ts` truncates `.tsx` to `.ts`, `js` truncates `.jsx`, `h` truncates `.html` — and
# the truncated path then matches nothing in the diff, so the doc is silently reported as
# referencing no changed file. A missed hit here is invisible; there is nothing to notice.
PATH_RE = re.compile(
    r"[`'\"]?((?:[\w.@-]+/)+[\w.@-]+\."
    r"(?:pbxproj|gradle|plist|swift|astro|html|json|yaml|mjs|cjs|tsx|jsx|sql|css|yml|"
    r"ts|js|py|sh|m|h)(?!\w))[`'\"]?"
)


class GitError(RuntimeError):
    """A git command this script needs in order to answer at all has failed."""


# argv lists, never `shell=True`: `--base` is caller-supplied and `last_commit_epoch` feeds it
# repo filenames, so an interpolated command string would let `;`, `$(...)`, or a crafted path
# execute in the checkout being reviewed. No shell also means no `||`, so the merge-base
# fallback is an explicit second call in `changed_files`.
#
# Failures RAISE by default. Returning "" on a non-zero exit is worse than crashing here: an
# empty `git diff` is indistinguishable from a clean diff, so a bad ref made the script print
# "nothing to check" and exit 0 — a staleness checker that reports "no docs owed" because it
# could not run is the one failure mode that guarantees nobody notices. Only the two calls whose
# failure is genuinely expected pass `allow_failure`.
def sh(argv, cwd=None, *, allow_failure=False):
    r = subprocess.run(argv, capture_output=True, text=True, cwd=cwd, check=False)
    if r.returncode != 0:
        if allow_failure:
            return ""
        raise GitError(f"{' '.join(argv)} exited {r.returncode}: {r.stderr.strip()[:300]}")
    return r.stdout.strip()


def resolve_base(root, base):
    """Validate a caller-supplied base ref before it reaches a revision range.

    Two distinct problems, both of which need solving before interpolation:

    1. A leading `-` makes git read the value as an OPTION, not a revision. argv form stops
       `;` and `$(...)`, but not `--upload-pack=...` or `--output=...` — argument injection
       survives the shell being gone, so it has to be rejected by value.
    2. A ref that simply does not exist would otherwise surface as an empty diff, i.e. as a
       false "no changes" (see `sh`).
    """
    if base.startswith("-"):
        raise GitError(f"--base {base!r} starts with '-'; refusing to pass it to git as a "
                       f"revision because git would read it as an option")
    if not sh(["git", "rev-parse", "--verify", "--quiet", f"{base}^{{commit}}"],
              cwd=root, allow_failure=True):
        raise GitError(f"--base {base!r} does not resolve to a commit in this repository")
    return base


def changed_files(root, base):
    if base:
        base = resolve_base(root, base)
    else:
        # The only expected failure: a repo with neither `main` nor `master`, or a shallow
        # clone with no common ancestor. Falling back to HEAD (working-tree diffs only) is
        # correct there, and is a real answer rather than a swallowed error.
        base = (sh(["git", "merge-base", "HEAD", "main"], cwd=root, allow_failure=True)
                or sh(["git", "merge-base", "HEAD", "master"], cwd=root, allow_failure=True)
                or "HEAD")
    out = set()
    for argv in (["git", "diff", "--name-only", f"{base}...HEAD", "--"],
                 ["git", "diff", "--name-only", "--"],
                 ["git", "diff", "--cached", "--name-only", "--"]):
        out |= {l for l in sh(argv, cwd=root).splitlines() if l}
    return sorted(out), base


def find_docs(root, doc_roots):
    docs = []
    for dr in doc_roots:
        base = os.path.join(root, dr)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames
                           if not d.startswith(".") and d not in ("node_modules", "_stale", "backup")]
            if ".archive" in dirpath or "/.complete" in dirpath:
                continue
            for fn in filenames:
                if fn.endswith(DOC_EXT):
                    docs.append(os.path.relpath(os.path.join(dirpath, fn), root))
    return sorted(docs)


def last_commit_epoch(root, path):
    # allow_failure here is deliberate and narrow: an untracked or newly added file has no
    # commit, which is a legitimate 0 rather than an error. The caller already treats 0 as
    # "unknown" — `newest_code > doc_epoch > 0` refuses to call a doc stale on a 0.
    v = sh(["git", "log", "-1", "--format=%ct", "--", path], cwd=root, allow_failure=True)
    return int(v) if v.isdigit() else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--base", default=None, help="base ref (default: merge-base with main)")
    ap.add_argument("--files", nargs="*", help="explicit changed files instead of a diff")
    ap.add_argument("--doc-roots", nargs="*", default=DEFAULT_DOC_ROOTS)
    a = ap.parse_args()

    root = os.path.abspath(a.root)

    if a.files:
        changed, base = sorted(a.files), "(explicit)"
    else:
        changed, base = changed_files(root, a.base)

    code_changed = [f for f in changed
                    if not f.endswith(DOC_EXT) or not any(f.startswith(d) for d in a.doc_roots)]
    docs_changed = {f for f in changed if f not in code_changed}

    if not code_changed:
        print("No code files changed — nothing to check.")
        return

    docs = find_docs(root, a.doc_roots)
    if not docs:
        print(f"No SOT docs found under {a.doc_roots}. Nothing to keep current.")
        return

    # doc -> set of changed files it references
    hits = defaultdict(set)
    changed_set = set(code_changed)
    for d in docs:
        try:
            text = open(os.path.join(root, d), errors="ignore").read()
        except OSError:
            continue
        for m in PATH_RE.finditer(text):
            p = m.group(1)
            if p in changed_set:
                hits[d].add(p)
            else:
                # Docs often cite a path relative to a subproject (e.g. `src/db/schema.ts`
                # inside a doc about backend/). Match on suffix as a fallback.
                for c in changed_set:
                    if c.endswith("/" + p):
                        hits[d].add(c)

    print(f"Base: {base}")
    print(f"Changed code files: {len(code_changed)}")
    print(f"SOT docs scanned: {len(docs)} under {', '.join(a.doc_roots)}\n")

    if not hits:
        print("No SOT doc references any changed file. KB upkeep: nothing owed.")
        return

    print("SOT docs describing changed files")
    print("=" * 72)
    now_stale = []
    for d in sorted(hits, key=lambda x: -len(hits[x])):
        doc_epoch = last_commit_epoch(root, d)
        newest_code = max((last_commit_epoch(root, f) for f in hits[d]), default=0)
        touched = d in docs_changed
        if touched:
            status = "UPDATED IN THIS DIFF"
        elif newest_code > doc_epoch > 0:
            status = "STALE — code newer than doc"
            now_stale.append(d)
        else:
            status = "review"
        print(f"\n{d}\n  status: {status}")
        for f in sorted(hits[d]):
            print(f"    - {f}")

    print("\n" + "=" * 72)
    print(f"{len(hits)} doc(s) reference changed files; {len(now_stale)} look stale.")
    if now_stale:
        print("\nRead each stale doc against the diff. If the diff changed behavior the doc")
        print("asserts — a failure mode, a checklist item, an invariant — updating the doc is")
        print("part of this change, not a follow-up. If the doc is still accurate, say so in")
        print("the review so the next reader does not re-check it.")


if __name__ == "__main__":
    # Exit 2 with a one-line reason, not a traceback: this runs as a review gate, and the
    # distinction that matters to the caller is "the KB owes nothing" (0) versus "the check
    # could not run" (2). A traceback blurs that into noise people skim past.
    try:
        main()
    except GitError as e:
        sys.stderr.write(f"check-context-staleness: {e}\n")
        sys.exit(2)

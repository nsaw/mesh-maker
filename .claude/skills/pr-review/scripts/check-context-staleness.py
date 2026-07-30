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
PATH_RE = re.compile(
    r"[`'\"]?((?:[\w.@-]+/)+[\w.@-]+\.(?:ts|tsx|js|jsx|mjs|cjs|swift|m|h|py|sql|json|astro|css|sh|yml|yaml|plist|gradle|pbxproj))[`'\"]?"
)


def sh(cmd, cwd=None):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd)
    return r.stdout.strip() if r.returncode == 0 else ""


def changed_files(root, base):
    if not base:
        base = sh("git merge-base HEAD main || git merge-base HEAD master", cwd=root) or "HEAD"
    out = set()
    for cmd in (f"git diff --name-only {base}...HEAD",
                "git diff --name-only",
                "git diff --cached --name-only"):
        out |= {l for l in sh(cmd, cwd=root).splitlines() if l}
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
    v = sh(f'git log -1 --format=%ct -- "{path}"', cwd=root)
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
    main()

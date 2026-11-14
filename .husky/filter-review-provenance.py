"""Exclude verified local Git commit metadata from the credential scan only."""
import re
import subprocess
import sys


def filter_provenance(path, content):
    if not re.fullmatch(r"\.cursor-cache/summaries/pr\d+-round\d+-[0-9a-f]{7}\.md", path):
        return content
    output = []
    for line in content.splitlines(keepends=True):
        match = re.fullmatch(r"<!-- pr-review:v1:head=([0-9a-f]{40}) -->\n?", line)
        if match:
            try:
                result = subprocess.run(
                    ["git", "cat-file", "-t", match.group(1)],
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False,
                )
            except OSError:
                # Fail closed: the original line still reaches the secret scanner.
                result = None
            if result is not None and result.returncode == 0 and result.stdout == b"commit\n":
                continue
        output.append(line)
    return "".join(output)


if __name__ == "__main__":
    sys.stdout.write(filter_provenance(sys.argv[1], sys.stdin.read()))

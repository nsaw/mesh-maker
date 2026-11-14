"""The scan exemption accepts commit metadata and preserves credential candidates."""
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch

FILTER = runpy.run_path(str(Path(__file__).resolve().parents[1] / ".husky/filter-review-provenance.py"))["filter_provenance"]
REVIEW_PATH = ".cursor-cache/summaries/pr37-round1-abcdef0.md"


class ReviewProvenanceTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous = os.getcwd()
        os.chdir(self.directory.name)
        subprocess.run(["git", "init", "-q", "--object-format=sha1"], check=True)
        tree = subprocess.check_output(["git", "mktree"], input=b"").decode().strip()
        self.commit = subprocess.check_output(
            ["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit-tree", tree],
            input=b"fixture\n",
        ).decode().strip()
        self.marker = "<!-- pr-review:v1:head=" + self.commit + " -->\n"

    def tearDown(self):
        os.chdir(self.previous)
        self.directory.cleanup()

    def test_known_commit_marker_only(self):
        self.assertEqual(FILTER(REVIEW_PATH, "before\n" + self.marker + "after\n"), "before\nafter\n")
        self.assertEqual(FILTER(REVIEW_PATH, self.marker.rstrip("\n")), "")

    def test_other_paths_and_context_remain_scanned(self):
        for path in ["README.md", ".cursor-cache/summaries/other.md", "prefix/" + REVIEW_PATH]:
            self.assertEqual(FILTER(path, self.marker), self.marker)
        for content in ["prefix " + self.marker, self.marker.rstrip("\n") + " suffix\n", self.marker.replace(" -->", " key=secret -->")]:
            self.assertEqual(FILTER(REVIEW_PATH, content), content)

    def test_unknown_hash_and_non_commit_remain_scanned(self):
        for value in ["0" * 40, subprocess.check_output(["git", "mktree"], input=b"").decode().strip()]:
            marker = "<!-- pr-review:v1:head=" + value + " -->\n"
            self.assertEqual(FILTER(REVIEW_PATH, marker), marker)

    def test_credentials_beside_valid_metadata_remain_scanned(self):
        candidate = "abcdef" * 6 + "a"
        content = self.marker + "credential=" + candidate + "\n"
        filtered = FILTER(REVIEW_PATH, content)
        self.assertEqual(filtered, "credential=" + candidate + "\n")
        self.assertRegex(filtered, r"[0-9a-f]{37}")

    def test_git_failure_keeps_original_line(self):
        with patch("subprocess.run", side_effect=OSError("unavailable")):
            self.assertEqual(FILTER(REVIEW_PATH, self.marker), self.marker)


if __name__ == "__main__":
    unittest.main()

"""Offline list (hsk-app spec #test-file-list, #acceptance-file-list)."""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import build_offline as bo  # noqa: E402

SITE = ROOT / "site"


class FileListTest(unittest.TestCase):
    def setUp(self):
        self.files, self.version = bo.read_block((SITE / bo.WORKER).read_text(encoding="utf-8"))

    def test_list_and_version_are_current(self):
        """Fails when a site change was not followed by python3 scripts/build_offline.py."""
        self.assertEqual((self.files, self.version), bo.offline_list())

    def test_every_published_file_once_and_nothing_else(self):
        published = {p.relative_to(SITE).as_posix() for p in SITE.rglob("*") if p.is_file()} - {bo.WORKER}
        self.assertEqual(len(self.files), len(set(self.files)))
        self.assertEqual(set(self.files), published)

    def test_version_follows_contents(self):
        """A changed byte changes the version, so the worker's bytes change with the site."""
        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp) / "site"
            shutil.copytree(SITE, site, ignore=shutil.ignore_patterns("audio", "icons", "fonts"))
            before = bo.offline_list(site)[1]
            (site / "style.css").write_text((site / "style.css").read_text() + "\n")
            self.assertNotEqual(bo.offline_list(site)[1], before)


if __name__ == "__main__":
    unittest.main()

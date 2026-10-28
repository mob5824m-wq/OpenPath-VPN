import unittest
from version import versions


class VersionTests(unittest.TestCase):
    def test_release_and_prerelease(self):
        self.assertEqual(versions("v1.2")["version"], "1.2.0")
        self.assertEqual(versions("v1.2.3-rc.1")["debian_version"], "1.2.3~rc.1")
        self.assertEqual(versions("v1.2.3-rc.1")["base_version"], "1.2.3")
        for tag in ("v1.2;echo", "../v1.2", "v1.2-", "v1.2--rc"):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                versions(tag)

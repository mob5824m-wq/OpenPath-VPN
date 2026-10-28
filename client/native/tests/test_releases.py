import io
import json
import unittest
from urllib.error import HTTPError, URLError

from openpath.releases import ReleaseFeed, matches, normalize

URL = "https://github.com/mob5824m-wq/OpenPath-VPN/releases/"
RELEASE = {"id": 1, "tag_name": "v1.2", "html_url": URL + "tag/v1.2", "assets": [
    {"name": "OpenPath-1.2-win-x64.zip", "browser_download_url": URL + "download/v1.2/win.zip"},
    {"name": "OpenPath-1.2-darwin-arm64.zip", "browser_download_url": URL + "download/v1.2/mac.zip"},
    {"name": "openpath-web.tar.gz", "browser_download_url": URL + "download/v1.2/web.tar.gz"},
    {"name": "bad", "browser_download_url": "javascript:alert(1)"},
]}


class Response:
    status = 200

    def __init__(self, value, headers=None):
        self.content = json.dumps(value).encode()
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def read(self, maximum):
        return self.content[:maximum]


class ReleaseTests(unittest.TestCase):
    def test_filters_and_unsafe_links(self):
        releases = normalize([RELEASE, {**RELEASE, "draft": True}])
        self.assertEqual(len(releases), 1)
        self.assertEqual(len(releases[0]["assets"]), 3)
        self.assertTrue(matches("windows", "OpenPath-v1.2-win-x64.zip"))
        self.assertFalse(matches("windows", "OpenPath-v1.2-darwin-arm64.zip"))
        self.assertTrue(matches("macos", "OpenPath-v1.2-darwin-arm64.zip"))
        self.assertTrue(matches("web", "openpath-web-v1.2.tar.gz"))

    def test_cache_revalidation_and_stale_error(self):
        calls = []
        now = [1.0]
        mode = ["success"]

        def request(req, timeout):
            calls.append((req, timeout))
            if mode[0] == "304":
                raise HTTPError(req.full_url, 304, "Not modified", {}, io.BytesIO())
            if mode[0] == "offline":
                raise URLError("offline")
            return Response([RELEASE], {"ETag": '"abc"'})

        feed = ReleaseFeed(opener=request, now=lambda: now[0])
        self.assertEqual(feed.load()["releases"][0]["tag"], "v1.2")
        feed.load()
        self.assertEqual(len(calls), 1)
        now[0] += 70
        mode[0] = "304"
        self.assertFalse(feed.load()["stale"])
        self.assertEqual(calls[-1][0].get_header("If-none-match"), '"abc"')
        mode[0] = "offline"
        stale = feed.load(force=True)
        self.assertTrue(stale["stale"])
        self.assertIn("Could not reach", stale["warning"])

    def test_no_cache_reports_errors(self):
        def request(*_args, **_kwargs):
            raise URLError("offline")
        with self.assertRaisesRegex(RuntimeError, "Could not reach"):
            ReleaseFeed(opener=request).load()


if __name__ == "__main__":
    unittest.main()

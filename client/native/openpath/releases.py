"""Release metadata for the native UI; links always open outside the app."""
from __future__ import annotations

import json
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

API = "https://api.github.com/repos/mob5824m-wq/OpenPath-VPN/releases?per_page=30"
REPO_PATH = "/mob5824m-wq/OpenPath-VPN/releases/"
MAX_BYTES = 2 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def trusted_link(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        url = urlsplit(value)
        return url.scheme == "https" and url.hostname == "github.com" and not url.username and not url.password and not url.port and url.path.startswith(REPO_PATH)
    except ValueError:
        return False


def normalize(data: object) -> list[dict]:
    if not isinstance(data, list):
        raise ValueError("GitHub returned an invalid release list")
    result = []
    for item in data:
        if not isinstance(item, dict) or item.get("draft") or not isinstance(item.get("id"), int) or not isinstance(item.get("tag_name"), str) or not trusted_link(item.get("html_url")):
            continue
        assets = []
        for asset in item.get("assets", []) if isinstance(item.get("assets"), list) else []:
            if (not isinstance(asset, dict) or not isinstance(asset.get("name"), str) or
                    asset.get("state", "uploaded") != "uploaded" or not trusted_link(asset.get("browser_download_url"))):
                continue
            assets.append({"name": asset["name"][:255], "url": asset["browser_download_url"]})
        result.append({"tag": item["tag_name"][:128], "name": str(item.get("name") or "")[:256],
                       "url": item["html_url"], "assets": assets})
    return result


def matches(platform: str, name: str) -> bool:
    lowered = name.lower()
    patterns = {
        "windows": r"\.(exe|msi)$|(^|[-_ ])(win|windows)([-_. ]|$)",
        "macos": r"\.(dmg|pkg)$|(^|[-_ ])(macos|mac|darwin)([-_. ]|$)",
        "linux": r"\.(deb|rpm|appimage)$|(^|[-_ ])linux([-_. ]|$)",
        "android": r"\.(apk|aab)$|(^|[-_ ])android([-_. ]|$)",
        "ios": r"\.ipa$|(^|[-_ ])ios([-_. ]|$)",
        "web": r"(^|[-_ ])web([-_. ]|$)",
        "server": r"(^|[-_ ])server([-_. ]|$)",
    }
    return platform == "all" or bool(re.search(patterns.get(platform, r"(?!)"), lowered))


class ReleaseFeed:
    def __init__(self, opener=None, now=time.monotonic):
        self.opener = opener or build_opener(NoRedirect()).open
        self.now = now
        self.cache: list[dict] | None = None
        self.etag: str | None = None
        self.fetched_at = 0.0

    def load(self, force: bool = False) -> dict:
        if not force and self.cache is not None and self.now() - self.fetched_at < 60:
            return {"releases": self.cache, "stale": False}
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "OpenPath-Native-Release-Browser", "X-GitHub-Api-Version": "2022-11-28"}
        if self.etag:
            headers["If-None-Match"] = self.etag
        try:
            try:
                response = self.opener(Request(API, headers=headers), timeout=8)
                with response:
                    if getattr(response, "status", 200) == 304 and self.cache is not None:
                        self.fetched_at = self.now()
                        return {"releases": self.cache, "stale": False}
                    if int(response.headers.get("Content-Length", "0")) > MAX_BYTES:
                        raise ValueError("GitHub release response was too large")
                    content = response.read(MAX_BYTES + 1)
                    if len(content) > MAX_BYTES:
                        raise ValueError("GitHub release response was too large")
                    releases = normalize(json.loads(content))
                    self.cache = releases
                    self.etag = response.headers.get("ETag")
                    self.fetched_at = self.now()
                    return {"releases": releases, "stale": False}
            except HTTPError as error:
                if error.code == 304 and self.cache is not None:
                    self.fetched_at = self.now()
                    return {"releases": self.cache, "stale": False}
                if error.code in (403, 429):
                    raise RuntimeError("GitHub API rate limit or access restriction; try again later") from error
                raise RuntimeError(f"GitHub returned HTTP {error.code}") from error
            except (URLError, TimeoutError) as error:
                raise RuntimeError("Could not reach GitHub; check the network connection") from error
        except Exception as error:
            if self.cache is not None:
                return {"releases": self.cache, "stale": True, "warning": str(error)}
            raise RuntimeError(str(error)) from error

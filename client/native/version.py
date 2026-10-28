"""Translate a release tag into installer-safe versions and GitHub step outputs."""
import re
import sys


def versions(tag: str) -> dict[str, str]:
    match = re.fullmatch(r"v(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?", tag)
    if not match or len(tag) > 128:
        raise ValueError("Release tag must be vMAJOR.MINOR[.PATCH][-PRERELEASE]")
    major, minor, patch, prerelease = match.groups()
    base = f"{int(major)}.{int(minor)}.{int(patch or 0)}"
    return {"tag": tag, "version": base + (f"-{prerelease}" if prerelease else ""),
            "base_version": base, "debian_version": base + (f"~{prerelease}" if prerelease else "")}


if __name__ == "__main__":
    for name, value in versions(sys.argv[1]).items():
        print(f"{name}={value}")

#!/usr/bin/env python3
"""Sync MeshCore-EastMesh release binaries locally and build a firmware manifest.

Usage:
  python3 sync_meshcore_releases.py
  python3 sync_meshcore_releases.py --manifest-only
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO = "xJARiD/MeshCore-EastMesh"
API_URL = f"https://api.github.com/repos/{REPO}/releases"
OUTPUT_DIR = Path("firmwares")
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"

FILENAME_RE = re.compile(
    r"^(?P<board>[A-Za-z0-9][A-Za-z0-9_-]*?)_(?P<firmware>repeater_mqtt|companion_radio_wifi)-"
    r"v(?P<meshcore_version>\d+\.\d+\.\d+)"
    r"(?:-eastmesh-v(?P<eastmesh_version>\d+\.\d+\.\d+))?"
    r"-(?P<commit>[0-9a-f]+)"
    r"(?P<merged>-merged)?\.bin$",
    flags=re.IGNORECASE,
)


def fetch_releases() -> list[dict[str, Any]]:
    releases: list[dict[str, Any]] = []
    page = 1
    while True:
        url = f"{API_URL}?per_page=100&page={page}"
        req = urllib.request.Request(
            url,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": "esptool-release-sync",
            },
        )
        with urllib.request.urlopen(req) as response:
            payload = json.load(response)

        if not payload:
            break

        releases.extend(payload)
        if len(payload) < 100:
            break
        page += 1

    return releases


_UNSAFE_PATH_COMPONENT_RE = re.compile(r"[/\\]|^\.+$|\x00")


def _is_safe_path_component(value: str) -> bool:
    return bool(value) and not _UNSAFE_PATH_COMPONENT_RE.search(value)


def parse_asset(asset_name: str) -> dict[str, str] | None:
    match = FILENAME_RE.match(asset_name)
    if not match:
        return None
    parsed = match.groupdict()
    return {
        "board": parsed["board"],
        "firmware": parsed["firmware"],
        "meshcore_version": parsed["meshcore_version"],
        "eastmesh_version": parsed.get("eastmesh_version") or "",
        "commit": parsed["commit"],
        "image_type": "merged_full_flash" if parsed.get("merged") else "app_bin",
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            block = handle.read(1024 * 1024)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def download_if_missing(url: str, destination: Path, dry_run: bool) -> str:
    if destination.exists():
        return "existing"
    if dry_run:
        return "missing"

    destination.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "esptool-release-sync"})
    tmp_destination = destination.with_suffix(destination.suffix + ".part")
    try:
        with urllib.request.urlopen(req) as src, tmp_destination.open("wb") as dst:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                dst.write(chunk)
        tmp_destination.replace(destination)
    except BaseException:
        if tmp_destination.exists():
            tmp_destination.unlink()
        raise
    return "downloaded"


def display_name(raw: str) -> str:
    return raw.replace("_", " ")


def build_manifest(download: bool) -> dict[str, Any]:
    releases = fetch_releases()
    mode = "sync + manifest update" if download else "manifest-only"
    print(f"Fetched {len(releases)} releases from {REPO} ({mode} mode).")
    catalog: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_repository": REPO,
        "source_api": API_URL,
        "release_count": len(releases),
        "boards": {},
    }

    downloaded_count = 0
    skipped_existing = 0
    skipped_missing = 0
    unmatched_assets: list[str] = []
    added_paths: list[str] = []

    for release in releases:
        release_tag = release.get("tag_name", "")
        release_name = release.get("name", "")
        published_at = release.get("published_at", "")
        release_assets = release.get("assets", [])
        release_downloaded = 0
        release_existing = 0
        release_missing = 0
        release_unmatched = 0
        print(
            f"Processing release {release_tag or '(untagged)'}"
            f" with {len(release_assets)} assets..."
        )

        for asset in release_assets:
            name = asset.get("name", "")
            if not name.lower().endswith(".bin"):
                continue

            parsed = parse_asset(name)
            if not parsed:
                unmatched_assets.append(name)
                release_unmatched += 1
                continue

            board = parsed["board"]
            firmware = parsed["firmware"]
            version = release_tag or parsed["meshcore_version"]
            image_type = parsed["image_type"]

            if not _is_safe_path_component(version) or not _is_safe_path_component(name):
                unmatched_assets.append(name)
                release_unmatched += 1
                continue

            relative_path = Path(board) / firmware / version / name
            destination = OUTPUT_DIR / relative_path

            sync_state = download_if_missing(
                asset["browser_download_url"], destination, dry_run=not download
            )
            if sync_state == "downloaded":
                downloaded_count += 1
                release_downloaded += 1
                added_paths.append(relative_path.as_posix())
            elif sync_state == "existing":
                skipped_existing += 1
                release_existing += 1
            else:
                skipped_missing += 1
                release_missing += 1
                # Don't include files that are not present locally in the manifest.
                continue

            address = "0x0000" if image_type == "merged_full_flash" else "0x10000"
            checksum = sha256_file(destination) if destination.exists() else ""

            board_bucket = catalog["boards"].setdefault(
                board,
                {
                    "display_name": display_name(board),
                    "firmwares": {},
                },
            )
            fw_bucket = board_bucket["firmwares"].setdefault(
                firmware,
                {
                    "display_name": display_name(firmware),
                    "versions": {},
                },
            )
            version_bucket = fw_bucket["versions"].setdefault(
                version,
                {
                    "release_name": release_name,
                    "release_tag": release_tag,
                    "published_at": published_at,
                    "meshcore_version": parsed["meshcore_version"],
                    "eastmesh_version": parsed["eastmesh_version"],
                    "commit": parsed["commit"],
                    "images": {},
                },
            )

            version_bucket["images"][image_type] = {
                "file_name": name,
                "path": relative_path.as_posix(),
                "address": address,
                "size": asset.get("size", 0),
                "sha256": checksum,
                "download_url": asset.get("browser_download_url", ""),
            }
        print(
            "  release summary:"
            f" downloaded={release_downloaded},"
            f" existing={release_existing},"
            f" missing_local={release_missing},"
            f" unmatched={release_unmatched}"
        )

    catalog["stats"] = {
        "downloaded": downloaded_count,
        "skipped_existing": skipped_existing,
        "skipped_missing": skipped_missing,
        "added_paths": added_paths,
        "missing_local_files": sum(
            1
            for board in catalog["boards"].values()
            for firmware in board["firmwares"].values()
            for version in firmware["versions"].values()
            for image in version["images"].values()
            if not (OUTPUT_DIR / image["path"]).exists()
        ),
        "unmatched_assets": sorted(set(unmatched_assets)),
    }
    return catalog


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest-only",
        action="store_true",
        help="Build/update manifest without downloading missing binaries.",
    )
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    try:
        manifest = build_manifest(download=not args.manifest_only)
    except urllib.error.URLError as error:
        print(f"Failed to fetch releases: {error}", file=sys.stderr)
        return 1

    stats = manifest["stats"]
    manifest_written = True
    if args.manifest_only and not manifest["boards"] and MANIFEST_PATH.exists():
        manifest_written = False
        print(
            "No local firmware files were found in --manifest-only mode; "
            f"keeping existing manifest at {MANIFEST_PATH} so UI selectors stay populated."
        )
    else:
        MANIFEST_PATH.write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    print(f"Manifest {'updated' if manifest_written else 'kept'}: {MANIFEST_PATH}")
    print(f"Downloaded: {stats['downloaded']}")
    print(f"Skipped existing: {stats['skipped_existing']}")
    print(f"Skipped missing local files: {stats['skipped_missing']}")
    print(f"Missing local files: {stats['missing_local_files']}")
    if stats["added_paths"]:
        print("Added files this run:")
        for path in stats["added_paths"]:
            print(f"  + {path}")
    else:
        print("Added files this run: none")
    if stats["unmatched_assets"]:
        print(f"Skipped unmatched assets: {len(stats['unmatched_assets'])}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

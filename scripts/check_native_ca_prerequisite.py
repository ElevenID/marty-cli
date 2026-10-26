#!/usr/bin/env python3
"""Require graceful native startup failure in an isolated Linux image without CAs."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from uuid import uuid4

IMAGE = "ubuntu@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac"


def absent(result):
    return result.returncode != 0 and any(
        phrase in result.stderr.lower()
        for phrase in (b"no such object", b"no such container")
    )


def cleanup(name, nonce):
    inspected = subprocess.run(
        ["docker", "container", "inspect", name],
        capture_output=True,
        timeout=15,
        check=False,
    )
    if absent(inspected):
        return
    if inspected.returncode != 0:
        raise RuntimeError("Cannot inspect owned CA prerequisite probe")
    details = json.loads(inspected.stdout)
    if (
        len(details) != 1
        or (details[0]["Config"].get("Labels") or {}).get("io.marty.ca-probe") != nonce
    ):
        raise RuntimeError("Preserve unowned CA prerequisite probe")
    identifier = details[0]["Id"]
    subprocess.run(
        ["docker", "stop", "--time", "1", identifier],
        capture_output=True,
        timeout=15,
        check=False,
    )
    gone = subprocess.run(
        ["docker", "container", "inspect", identifier],
        capture_output=True,
        timeout=15,
        check=False,
    )
    if not absent(gone):
        raise RuntimeError("Owned CA prerequisite probe removal is unconfirmed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--expected-version", required=True)
    args = parser.parse_args()
    binary = args.binary.resolve(strict=True)
    if not binary.is_file():
        parser.error("--binary must name an actual native executable")
    nonce = uuid4().hex
    prefix = [
        "docker",
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--user",
        "65534:65534",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--memory",
        "256m",
        "--cpus",
        "1",
        "--tmpfs",
        "/work:rw,nosuid,nodev,size=16777216,mode=1777",
        "--mount",
        f"type=bind,source={binary},target=/inputs/marty,readonly",
        "--env",
        "MARTY_CONFIG_DIR=/work/config",
        "--env",
        "MARTY_API_URL=http://127.0.0.1:9",
        "--env",
        "MARTY_API_KEY=mk_test_ca-fixture",
        "--env",
        "NO_COLOR=1",
        "--entrypoint",
        "/inputs/marty",
    ]
    for phase, arguments in (
        ("version", ["--version"]),
        ("http", ["health", "-o", "json"]),
    ):
        name = "marty-ca-probe-" + phase + "-" + nonce[:12]
        try:
            result = subprocess.run(
                prefix
                + [
                    "--name",
                    name,
                    "--label",
                    "io.marty.ca-probe=" + nonce,
                    IMAGE,
                    *arguments,
                ],
                capture_output=True,
                timeout=180,
                check=False,
            )
        finally:
            cleanup(name, nonce)
        if phase == "version":
            if (
                result.returncode != 0
                or result.stdout.decode("utf-8").strip() != args.expected_version
            ):
                raise RuntimeError(
                    "Native release cannot execute on the minimum Linux image: "
                    + result.stderr.decode("utf-8", errors="replace")[-1000:]
                )
        elif (
            result.returncode != 1
            or result.stdout
            or b"CA certificate store" not in result.stderr
            or b"panicked" in result.stderr
        ):
            raise RuntimeError(
                "Missing CA store did not produce the expected graceful initialization error: "
                + result.stderr.decode("utf-8", errors="replace")[-1000:]
            )
    print(
        json.dumps(
            {
                "version": args.expected_version,
                "missing_ca_error_is_graceful": True,
                "tls_verification_disabled": False,
                "image": IMAGE,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()

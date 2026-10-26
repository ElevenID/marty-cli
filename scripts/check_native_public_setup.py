#!/usr/bin/env python3
"""Exercise a release binary or installed launcher against public setup fixtures."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def verify(prefix, version):
    cases = [
        (
            [
                "orgs",
                "create",
                "--name",
                "acme",
                "--display-name",
                "Acme",
                "-o",
                "json",
            ],
            "/v1/organizations",
            {"name": "acme", "display_name": "Acme", "visibility": "PRIVATE"},
        ),
        (
            [
                "ct",
                "create",
                "--name",
                "Badge",
                "--credential-type",
                "EmployeeCredential",
                "--compliance-profile-id",
                "profile-1",
                "--issuer-did",
                "did:web:issuer.example",
                "--vct",
                "https://issuer.example/employee",
                "-o",
                "json",
            ],
            "/v1/credential-templates",
            {
                "organization_id": "org-selected",
                "name": "Badge",
                "credential_type": "EmployeeCredential",
                "compliance_profile_id": "profile-1",
                "issuer_did": "did:web:issuer.example",
                "vct": "https://issuer.example/employee",
                "credential_payload_format": "SD_JWT_VC",
                "supported_formats": ["SD_JWT_VC"],
                "privacy_posture": "selective_disclosure",
            },
        ),
        (
            ["ct", "publish", "template-1", "-o", "json"],
            "/v1/credential-templates/template-1/activate",
            {},
        ),
    ]
    observed = []
    errors = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            try:
                index = len(observed)
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 <= length <= 65536:
                    raise ValueError("Unexpected request size")
                body = json.loads(self.rfile.read(length))
                observed.append(self.path)
                if index >= len(cases) or (self.path, body) != cases[index][1:]:
                    raise ValueError("Public setup route/body differs")
                if (
                    self.headers.get("X-API-Key") != "mk_test_setup-fixture"
                    or self.headers.get("X-MIP-Version") != "0.5.0"
                    or self.headers.get("Cookie")
                    or self.headers.get("Authorization")
                ):
                    raise ValueError("Public machine authentication differs")
                payload = json.dumps({"id": "fixture-result"}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except (ValueError, TypeError) as error:
                errors.append(str(error))
                self.send_error(400, "Public setup fixture rejected the request")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix="marty-public-setup-") as temporary:
            config = Path(temporary) / "config.json"
            original = b'{"organizationId":"org-original"}'
            config.write_bytes(original)
            env = {
                key: os.environ[key]
                for key in ("PATH", "SystemRoot", "WINDIR", "TEMP", "TMP")
                if key in os.environ
            }
            env.update(
                MARTY_CONFIG_DIR=temporary,
                MARTY_ORG_ID="org-selected",
                MARTY_API_KEY="mk_test_setup-fixture",
                NO_COLOR="1",
                MARTY_API_URL=f"http://127.0.0.1:{server.server_port}",
            )

            def run(args):
                return subprocess.run(
                    prefix + args, env=env, capture_output=True, timeout=20, check=True
                ).stdout

            if run(["--version"]).decode("utf-8").strip() != version:
                raise ValueError("Release binary version differs")
            for args, _, _ in cases:
                if json.loads(run(args)).get("id") != "fixture-result":
                    raise ValueError("Setup response differs")
            if errors or observed != [case[1] for case in cases]:
                raise ValueError("Public setup request sequence differs")
            if (
                config.read_bytes() != original
                or (Path(temporary) / "credentials.json").exists()
            ):
                raise ValueError("Setup replaced credentials or selected organization")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        if thread.is_alive():
            raise RuntimeError("Owned setup fixture did not stop")
    return {
        "version": version,
        "public_setup_requests": len(observed),
        "config_preserved": True,
        "live_gateway_qualified": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--binary", type=Path)
    target.add_argument("--launcher", type=Path)
    parser.add_argument("--node", type=Path)
    parser.add_argument("--expected-version", required=True)
    args = parser.parse_args()
    if args.launcher and not args.node:
        parser.error("--launcher requires --node")
    prefix = (
        [str(args.binary.resolve())]
        if args.binary
        else [str(args.node.resolve()), str(args.launcher.resolve())]
    )
    print(json.dumps(verify(prefix, args.expected_version), sort_keys=True))


if __name__ == "__main__":
    main()

"""Keep runtime probes from stopping unrelated or uninspectable containers."""

import importlib.util
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "native_ca_probe", Path(__file__).parents[1] / "check_native_ca_prerequisite.py"
)
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


class OwnershipTests(unittest.TestCase):
    def test_foreign_unlabeled_and_uninspectable_container_is_preserved(self):
        for failure in ("foreign", "unlabeled", "daemon"):
            with self.subTest(failure=failure):
                labels = (
                    None
                    if failure == "unlabeled"
                    else {"io.marty.ca-probe": "other-owner"}
                )
                response = SimpleNamespace(
                    returncode=1 if failure == "daemon" else 0,
                    stdout=json.dumps([{"Config": {"Labels": labels}}]).encode(),
                    stderr=b"Cannot connect to Docker daemon"
                    if failure == "daemon"
                    else b"",
                )
                with patch.object(
                    PROBE.subprocess, "run", return_value=response
                ) as run:
                    with self.assertRaises(RuntimeError):
                        PROBE.cleanup("probe-name", "expected-owner")
                    self.assertEqual(run.call_count, 1)
                    self.assertEqual(
                        run.call_args.args[0],
                        ["docker", "container", "inspect", "probe-name"],
                    )

    def test_missing_owned_probe_needs_no_stop(self):
        response = SimpleNamespace(
            returncode=1, stdout=b"", stderr=b"No such object: probe-name"
        )
        with patch.object(PROBE.subprocess, "run", return_value=response) as run:
            PROBE.cleanup("probe-name", "expected-owner")
            self.assertEqual(run.call_count, 1)

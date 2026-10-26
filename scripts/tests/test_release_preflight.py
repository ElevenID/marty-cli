"""Installation-token context and the real API sequence's ownership gates."""

import copy
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).parents[1]))
import check_release_absent as guard
import probe_release_lookup as probe

CONTEXT = {
    "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "ElevenID/marty-cli",
    "GITHUB_JOB": "release-lookup-probe", "GITHUB_EVENT_NAME": "workflow_dispatch",
    "GITHUB_REF": "refs/heads/main",
    "GITHUB_WORKFLOW_REF": "ElevenID/marty-cli/.github/workflows/release-preflight.yml@refs/heads/main",
    "GITHUB_SHA": "b" * 40,
}


class DraftServer:
    def __init__(self, *, hidden=False, changed=False, preexisting=False):
        self.hidden, self.changed = hidden, changed
        self.created = self.deleted = 0
        self.draft = {"id": 99, "tag_name": "v0.3.2", "draft": True, "body": "user-owned"} if preexisting else None

    def __call__(self, request, timeout):
        assert timeout == 30
        path = urlsplit(request.full_url).path
        method = request.get_method()
        if "/git/ref/tags/" in path:
            value = {"object": {"sha": "a" * 40}}
        elif "/releases/tags/" in path:
            raise HTTPError(request.full_url, 404, "Not Found", {}, None)
        elif method == "POST" and path.endswith("/releases"):
            assert self.draft is None
            value = json.loads(request.data)
            assert value["draft"] is True and value["prerelease"] is True
            assert value["tag_name"] == "v0.3.2"
            self.created += 1
            self.draft = {**value, "id": 101, "assets": []}
            value = self.draft
        elif method == "GET" and path.endswith("/releases"):
            value = [self.draft] if self.draft and not (self.hidden and self.created) else []
        elif path.endswith("/releases/101"):
            if self.draft is None:
                raise HTTPError(request.full_url, 404, "Not Found", {}, None)
            if method == "DELETE":
                assert self.draft["draft"] is True
                self.deleted += 1
                self.draft = None
                return io.BytesIO(b"")
            if self.changed:
                self.draft["assets"] = [{"id": 7}]
            value = self.draft
        else:
            raise AssertionError("Unexpected API operation: " + method + " " + path)
        return io.BytesIO(json.dumps(value).encode())


class PreflightTests(unittest.TestCase):
    def test_tag_jobs_accept_their_declared_write_token_context(self):
        for job in ("verify-source", "github-release"):
            context = {**CONTEXT, "GITHUB_JOB": job, "GITHUB_EVENT_NAME": "push",
                       "GITHUB_REF": "refs/tags/v0.3.2",
                       "GITHUB_WORKFLOW_REF": "ElevenID/marty-cli/.github/workflows/release.yml@refs/tags/v0.3.2"}
            with self.subTest(job=job), patch.dict(os.environ, context, clear=True):
                guard.ensure_release_absent("ElevenID/marty-cli", "v0.3.2", "fixture-token",
                                            actions_write_token=True, opener=DraftServer())

    def test_installation_context_does_not_require_a_user_role_field(self):
        with patch.dict(os.environ, CONTEXT, clear=True):
            guard.ensure_release_absent("ElevenID/marty-cli", "v0.3.2", "fixture-token",
                                        actions_write_token=True, opener=DraftServer())

    def test_installation_mode_refuses_other_workflow_contexts(self):
        for field, value in (("GITHUB_REF", "refs/heads/feature"), ("GITHUB_JOB", "untrusted"),
                             ("GITHUB_REPOSITORY", "foreign/repository"), ("GITHUB_ACTIONS", "false")):
            context = {**CONTEXT, field: value}
            with self.subTest(field=field), patch.dict(os.environ, context, clear=True), self.assertRaises(guard.ReleaseLookupError):
                guard.ensure_release_absent("ElevenID/marty-cli", "v0.3.2", "fixture-token",
                                            actions_write_token=True, opener=DraftServer())

    def run_probe(self, server, receipt):
        with patch.dict(os.environ, CONTEXT, clear=True):
            return probe.exercise("ElevenID/marty-cli", "v0.3.2", "a" * 40, "a" * 40,
                                   "fixture-token", receipt, opener=server)

    def test_owned_draft_is_detected_and_removed_without_ref_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            server = DraftServer()
            record = self.run_probe(server, path)
            self.assertEqual((server.created, server.deleted), (1, 1))
            self.assertTrue(record["draft_refused"] and record["owned_draft_removed"] and record["tag_unchanged"])
            self.assertEqual(record["result"], "passed")
            self.assertNotIn("fixture-token", path.read_text())

    def test_hidden_draft_fails_preflight_and_still_cleans_owned_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            server = DraftServer(hidden=True)
            with self.assertRaises(RuntimeError):
                self.run_probe(server, path)
            self.assertEqual((server.created, server.deleted), (1, 1))
            self.assertFalse(json.loads(path.read_text())["draft_refused"])

    def test_changed_or_preexisting_release_is_preserved(self):
        for options in ({"changed": True}, {"preexisting": True}):
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                server = DraftServer(**options)
                original = copy.deepcopy(server.draft)
                path = Path(directory) / "receipt.json"
                with self.assertRaises(RuntimeError):
                    self.run_probe(server, path)
                self.assertEqual(server.deleted, 0)
                if original is not None:
                    self.assertEqual(server.draft, original)
                self.assertEqual(json.loads(path.read_text())["result"], "failed")

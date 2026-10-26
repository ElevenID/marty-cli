"""Reject incorrect inventory semantics and unsafe release lookup outcomes."""

import copy
import importlib.util
import io
import json
import unittest
from pathlib import Path
from urllib.error import HTTPError


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / (name + ".py"))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


sboms = module("generate_release_sboms")
releases = module("check_release_absent")


class InventoryTests(unittest.TestCase):
    def test_final_package_requires_bound_build_inventory(self):
        bom = {"bomFormat": "CycloneDX", "metadata": {"component": {
            "name": "marty-cli", "version": "0.3.2"}, "properties": [
                {"name": "cdx:rustc:sbom:target:triple", "value": "test-target"},
                {"name": "marty:build:host", "value": "test-host"}]}}
        sboms.require_build_inventory(bom, "marty-cli", "test-target", "0.3.2")
        for field, value in [("name", "foreign"), ("version", "0.3.1")]:
            bad = copy.deepcopy(bom)
            bad["metadata"]["component"][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                sboms.require_build_inventory(bad, "marty-cli", "test-target", "0.3.2")
        for index in (0, 1):
            bad = copy.deepcopy(bom)
            bad["metadata"]["properties"].pop(index)
            with self.subTest(missing=index), self.assertRaises(ValueError):
                sboms.require_build_inventory(bad, "marty-cli", "test-target", "0.3.2")

    def test_sdk_root_and_version_are_required(self):
        bom = {"bomFormat": "CycloneDX", "metadata": {"component": {
            "name": "marty-api-core", "version": "0.3.2", "purl": "pkg:npm/%40elevenid/marty-api-core@0.3.2"}}}
        # npm uses the unscoped name in the name field, retaining scope in purl.
        sboms.npm_identity(bom, "@elevenid/marty-api-core", "0.3.2")
        for field, value in [("name", "marty-cli"), ("version", "0.3.1"),
                             ("purl", "pkg:npm/%40elevenid/marty-cli@0.3.2")]:
            bad = copy.deepcopy(bom)
            bad["metadata"]["component"][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                sboms.npm_identity(bad, "@elevenid/marty-api-core", "0.3.2")

    def graph(self):
        packages = [{"id": name, "name": name, "version": "0.3.2"} for name in ("root", "normal", "build", "dev")]
        packages[1]["source"] = "registry+https://github.com/rust-lang/crates.io-index"
        metadata = {"packages": packages, "workspace_members": ["root"], "resolve": {"nodes": [
            {"id": "root", "deps": [{"pkg": name, "dep_kinds": [{"kind": kind}]}
                                     for name, kind in [("normal", None), ("build", "build"), ("dev", "dev")]]},
            *[{"id": name, "deps": []} for name in ("normal", "build", "dev")],
        ]}}
        root = {"bom-ref": "root", "name": "root", "version": "0.3.2"}
        bom = {"bomFormat": "CycloneDX", "metadata": {"component": root, "properties": [
            {"name": "cdx:rustc:sbom:target:triple", "value": "test-target"}]}, "components": [
            {"bom-ref": "normal", "name": "normal", "version": "0.3.2",
             "hashes": [{"alg": "SHA-256", "content": "f" * 64}]},
            {"bom-ref": "build", "name": "build", "version": "0.3.2"}],
            "dependencies": [{"ref": "root", "dependsOn": ["normal", "build"]},
                             {"ref": "normal", "dependsOn": []}, {"ref": "build", "dependsOn": []}]}
        return bom, metadata

    def test_production_graph_includes_build_but_excludes_development_dependencies(self):
        bom, metadata = self.graph()
        sboms.rust_graph(bom, metadata, "root", "test-target", "0.3.2", {("normal", "0.3.2"): "f" * 64})
        for mutation in ("missing", "extra_dev", "version", "edge", "hash", "target"):
            bad = copy.deepcopy(bom)
            if mutation == "missing":
                bad["components"].pop()
            elif mutation == "extra_dev":
                bad["components"].append({"bom-ref": "dev", "name": "dev", "version": "0.3.2"})
            elif mutation == "version":
                bad["components"][0]["version"] = "0.3.1"
            elif mutation == "edge":
                bad["dependencies"][0]["dependsOn"] = []
            elif mutation == "hash":
                bad["components"][0]["hashes"] = []
            else:
                bad["metadata"]["properties"] = []
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                sboms.rust_graph(bad, metadata, "root", "test-target", "0.3.2", {("normal", "0.3.2"): "f" * 64})

    def test_package_selected_tree_excludes_workspace_feature_extras(self):
        bom, metadata = self.graph()
        metadata["packages"].append({"id": "feature-extra", "name": "feature-extra", "version": "0.3.2"})
        metadata["resolve"]["nodes"].append({"id": "feature-extra", "deps": []})
        metadata["resolve"]["nodes"][1]["deps"] = [
            {"pkg": "feature-extra", "dep_kinds": [{"kind": None}]}]
        raw = copy.deepcopy(bom)
        raw["components"].append({"bom-ref": "feature-extra", "name": "feature-extra", "version": "0.3.2"})
        raw["dependencies"][1]["dependsOn"] = ["feature-extra"]
        raw["dependencies"].append({"ref": "feature-extra", "dependsOn": []})
        sboms.rust_graph(raw, metadata, "root", "test-target", "0.3.2", {("normal", "0.3.2"): "f" * 64})
        tree = "0root v0.3.2 (owned source)\n1normal v0.3.2\n[build-dependencies]\n1build v0.3.2\n"
        expected = {"root": {"normal", "build"}, "normal": set(), "build": set()}
        selected = sboms.production_tree(tree, metadata, "root", "0.3.2")
        self.assertEqual(selected, expected)
        sboms.rust_graph(bom, metadata, "root", "test-target", "0.3.2",
                         {("normal", "0.3.2"): "f" * 64}, selected)
        for bad in ("", "0foreign v0.3.2", "0root v0.3.2\n2normal v0.3.2",
                    "0root v0.3.2\n0root v0.3.2", "0root v0.3.2\nunknown-format"):
            with self.subTest(tree=bad), self.assertRaises(ValueError):
                sboms.production_tree(bad, metadata, "root", "0.3.2")


class ReleaseTests(unittest.TestCase):
    def lookup(self, status):
        def opener(request, timeout):
            self.assertEqual(timeout, 30)
            self.assertIn("api.github.com/repos/ElevenID/marty-cli", request.full_url)
            raise HTTPError(request.full_url, status, "fixture", {}, None)
        return opener

    def test_tag_not_found_does_not_prove_draft_absence(self):
        for status in (404, 401, 403, 429, 500):
            with self.subTest(status=status), self.assertRaises(releases.ReleaseLookupError):
                releases.ensure_release_absent("ElevenID/marty-cli", "v0.3.2", "fixture-token", opener=self.lookup(status))

    def test_published_release_refuses_overwrite(self):
        payload = json.dumps({"tag_name": "v0.3.2", "draft": False}).encode()
        with self.assertRaises(releases.ReleaseAlreadyExistsError):
            releases.ensure_release_absent("ElevenID/marty-cli", "v0.3.2", "fixture-token",
                                           opener=lambda *args, **kwargs: io.BytesIO(payload))

    def paginated(self, *, draft=False, push=True, invalid=False):
        def opener(request, timeout):
            self.assertEqual(timeout, 30)
            if "/releases/tags/" in request.full_url:
                raise HTTPError(request.full_url, 404, "Not Found", {}, None)
            if request.full_url.endswith("/marty-cli"):
                payload = {"permissions": {"push": push}}
            elif request.full_url.endswith("page=1"):
                payload = [{"tag_name": f"older-{i}", "draft": False} for i in range(100)]
            elif request.full_url.endswith("page=2"):
                payload = ["malformed"] if invalid else [{"tag_name": "v0.3.2", "draft": True}] if draft else []
            else:
                self.fail("Unexpected release lookup URL")
            return io.BytesIO(json.dumps(payload).encode())
        return opener

    def test_draft_on_later_page_refuses_overwrite(self):
        with self.assertRaises(releases.ReleaseAlreadyExistsError):
            releases.ensure_release_absent("ElevenID/marty-cli", "v0.3.2", "fixture-token",
                                           opener=self.paginated(draft=True))

    def test_visible_exhausted_history_proves_absence(self):
        releases.ensure_release_absent("ElevenID/marty-cli", "v0.3.2", "fixture-token",
                                       opener=self.paginated())

    def test_hidden_drafts_and_malformed_history_fail_closed(self):
        for options in ({"push": False}, {"invalid": True}):
            with self.subTest(options=options), self.assertRaises(releases.ReleaseLookupError):
                releases.ensure_release_absent("ElevenID/marty-cli", "v0.3.2", "fixture-token",
                                               opener=self.paginated(**options))

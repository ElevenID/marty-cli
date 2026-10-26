#!/usr/bin/env python3
"""Generate package inventories and verify Rust production graphs before release."""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import shutil
import subprocess
import tomllib
from pathlib import Path
from urllib.parse import unquote
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "darwin-x64": "x86_64-apple-darwin",
    "darwin-arm64": "aarch64-apple-darwin",
    "win32-x64": "x86_64-pc-windows-msvc",
    "win32-arm64": "aarch64-pc-windows-msvc",
    "wasm": "wasm32-unknown-unknown",
}


def run(arguments: list[str]) -> str:
    result = subprocess.run(arguments, cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                            check=False, timeout=180)
    if result.returncode:
        raise RuntimeError(f"SBOM command failed: {Path(arguments[0]).name}")
    return result.stdout


def npm_identity(bom: dict, package: str, version: str) -> None:
    component = bom.get("metadata", {}).get("component", {})
    if (bom.get("bomFormat") != "CycloneDX" or component.get("version") != version
            or component.get("name") != package.rsplit("/", 1)[-1]
            or unquote(component.get("purl", "")) != f"pkg:npm/{package}@{version}"):
        raise ValueError("npm SBOM describes the wrong package or version")


def rust_graph(bom: dict, metadata: dict, package: str, target: str, version: str,
               checksums: dict[tuple[str, str], str],
               selected: dict[str, set[str]] | None = None) -> None:
    packages = {item["id"]: item for item in metadata["packages"]}
    roots = [item for item in packages.values() if item["name"] == package
             and item["version"] == version and item["id"] in metadata["workspace_members"]]
    if len(roots) != 1:
        raise ValueError("Cargo SBOM root is not an exact workspace package")
    root = roots[0]["id"]
    nodes = {item["id"]: item for item in metadata["resolve"]["nodes"]}
    production = {
        identity: {dep["pkg"] for dep in item["deps"]
                   if any(kind["kind"] != "dev" for kind in dep["dep_kinds"])}
        for identity, item in nodes.items()
    }
    if selected is not None:
        if root not in selected or any(identity not in production or not peers <= production[identity]
                                       for identity, peers in selected.items()):
            raise ValueError("Selected build tree differs from Cargo metadata")
        production = selected
    closure, pending = {root}, [root]
    while pending:
        for identity in production[pending.pop()]:
            if identity not in closure:
                closure.add(identity)
                pending.append(identity)
    if selected is not None and closure != set(selected):
        raise ValueError("Selected build tree contains disconnected dependencies")
    component = bom.get("metadata", {}).get("component", {})
    properties = bom.get("metadata", {}).get("properties", [])
    if (bom.get("bomFormat") != "CycloneDX" or component.get("bom-ref") != root
            or component.get("name") != package or component.get("version") != version
            or {"name": "cdx:rustc:sbom:target:triple", "value": target} not in properties):
        raise ValueError("Rust SBOM root, version or target is incorrect")
    components = [component, *bom.get("components", [])]
    actual = {item["bom-ref"]: item for item in components}
    if len(actual) != len(components) or set(actual) != closure:
        raise ValueError("Rust SBOM omits or adds production dependencies")
    edges = {item["ref"]: set(item.get("dependsOn", [])) for item in bom["dependencies"]}
    for identity in closure:
        if (actual[identity].get("name") != packages[identity]["name"]
                or actual[identity].get("version") != packages[identity]["version"]
                or edges.get(identity, set()) != production[identity]):
            raise ValueError("Rust SBOM component or dependency edge differs from Cargo")
        item = packages[identity]
        if str(item.get("source", "")).startswith("registry+"):
            expected = checksums.get((item["name"], item["version"]))
            if not expected or {"alg": "SHA-256", "content": expected} not in actual[identity].get("hashes", []):
                raise ValueError("Rust SBOM registry checksum differs from Cargo.lock")


def production_tree(text: str, metadata: dict, package: str, version: str) -> dict[str, set[str]]:
    """Read package-selected Cargo normal/build edges without dev feature unification."""
    identities = {}
    for item in metadata["packages"]:
        identities.setdefault((item["name"], item["version"]), []).append(item["id"])
    graph, stack = {}, []
    for line in text.splitlines():
        if not line.strip() or line.strip() == "[build-dependencies]":
            continue
        match = re.fullmatch(r"([0-9]+)(\S+) v(\S+)(?: .*)?", line)
        if match is None:
            raise ValueError("Cargo production tree has an unknown line")
        depth, name, release = int(match[1]), match[2], match[3]
        candidates = identities.get((name, release), [])
        if len(candidates) != 1 or depth > len(stack):
            raise ValueError("Cargo production tree has ambiguous identity or depth")
        identity = candidates[0]
        if not stack and (depth != 0 or (name, release) != (package, version)):
            raise ValueError("Cargo production tree starts with the wrong package")
        if stack and depth == 0:
            raise ValueError("Cargo production tree has more than one root")
        graph.setdefault(identity, set())
        if depth:
            graph[stack[depth - 1]].add(identity)
        stack = stack[:depth] + [identity]
    if not graph:
        raise ValueError("Cargo production tree is empty")
    return graph


def write(output: Path, name: str, document: dict) -> None:
    with (output / name).open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(document, indent=2) + "\n")


def npm_inventories(version: str) -> tuple[dict, dict]:
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        raise ValueError("npm is required for release inventories")
    inventory = {}
    manifests = {}
    directories = {"marty-cli": ROOT, "marty-api-core": ROOT / "packages/api-core"}
    directories.update({f"marty-cli-{alias}": ROOT / f"packages/cli-{alias}"
                        for alias in TARGETS if alias != "wasm"})
    for name, directory in directories.items():
        manifest = json.loads((directory / "package.json").read_text(encoding="utf-8"))
        manifests[name] = manifest
        if name != "marty-cli" and any(manifest.get(field) for field in (
                "dependencies", "optionalDependencies", "peerDependencies")):
            raise ValueError("New npm production dependencies require inventory graph support")
        bom = json.loads(run([npm, "--prefix", str(directory), "sbom", "--workspaces=false",
                              "--omit=dev", "--sbom-format", "cyclonedx"]))
        # npm uses the folder basename as the display name with --prefix.
        # Canonicalize only that label; purl/version must independently match.
        bom["metadata"]["component"]["name"] = manifest["name"].rsplit("/", 1)[-1]
        npm_identity(bom, manifest["name"], version)
        inventory[name] = bom
    return inventory, manifests


def host_target() -> str:
    matches = re.findall(r"^host: (\S+)$", run(["rustc", "-vV"]), re.MULTILINE)
    if len(matches) != 1:
        raise ValueError("Rust build host identity is absent")
    return matches[0]


def require_build_inventory(bom: dict, package: str, target: str, version: str) -> None:
    component = bom.get("metadata", {}).get("component", {})
    properties = bom.get("metadata", {}).get("properties", [])
    if (bom.get("bomFormat") != "CycloneDX" or component.get("name") != package
            or component.get("version") != version
            or {"name": "cdx:rustc:sbom:target:triple", "value": target} not in properties
            or not any(item.get("name") == "marty:build:host" and item.get("value")
                       for item in properties)):
        raise ValueError("Native build job inventory has the wrong package, version or target")


def generate(output: Path, cyclonedx: str, targets: list[str], *, rust_only: bool = False,
             require_all: bool = False) -> None:
    output.mkdir(parents=True, exist_ok=True)
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    lock = (ROOT / "Cargo.lock").read_bytes()
    checksums = {(item["name"], item["version"]): item["checksum"]
                 for item in tomllib.loads(lock.decode("utf-8"))["package"] if "checksum" in item}
    prefix = "marty-sbom-" + uuid4().hex
    inventory, manifests = ({}, {}) if rust_only else npm_inventories(version)
    base_url = f"https://github.com/ElevenID/marty-cli/releases/download/v{version}/"
    for alias in targets:
        target = TARGETS[alias]
        package = "marty-api-client" if alias == "wasm" else "marty-cli"
        metadata = json.loads(run(["cargo", "metadata", "--locked", "--format-version", "1",
                                   "--filter-platform", target]))
        generated = [Path(item["manifest_path"]).parent / f"{prefix}_{target}.cdx.json"
                     for item in metadata["packages"] if item["id"] in metadata["workspace_members"]]
        if any(path.exists() or path.is_symlink() for path in generated):
            raise ValueError("SBOM temporary output already exists")
        try:
            run([cyclonedx, "cyclonedx", "--format", "json", "--spec-version", "1.5",
                 "--target", target, "--target-in-filename", "--override-filename", prefix])
            source = ROOT / f"crates/{package}/{prefix}_{target}.cdx.json"
            bom = json.loads(source.read_text(encoding="utf-8"))
            rust_graph(bom, metadata, package, target, version, checksums)
            selected = production_tree(run([
                "cargo", "tree", "--locked", "--color", "never", "--package", package,
                "--target", target, "--edges", "normal,build", "--prefix", "depth",
                "--format", "{p}", "--no-dedupe", "--charset", "ascii",
            ]), metadata, package, version)
            # Cargo metadata resolves workspace/dev features together. The
            # package-selected tree is the build's production graph. Retain
            # the generator's checked component metadata for precisely that set.
            bom["components"] = [item for item in bom["components"] if item["bom-ref"] in selected]
            bom["dependencies"] = [{"ref": identity, "dependsOn": sorted(peers)}
                                   for identity, peers in sorted(selected.items())]
            rust_graph(bom, metadata, package, target, version, checksums, selected)
            bom["metadata"]["properties"].append({"name": "marty:build:host", "value": host_target()})
            if (ROOT / "Cargo.lock").read_bytes() != lock:
                raise ValueError("SBOM generation changed the release dependency lock")
            filename = f"{package}-{alias}-rust-sbom.cdx.json"
            write(output, filename, bom)
        finally:
            for path in generated:
                if not path.resolve().is_relative_to(ROOT) or path.is_symlink():
                    raise ValueError("SBOM temporary output escaped the source workspace")
                if path.is_file():
                    path.unlink()
    if rust_only:
        if (ROOT / "Cargo.lock").read_bytes() != lock:
            raise ValueError("SBOM generation changed the release dependency lock")
        print(f"Validated {len(targets)} Rust build target graphs")
        return
    for alias, target in TARGETS.items():
        package = "marty-api-client" if alias == "wasm" else "marty-cli"
        filename = f"{package}-{alias}-rust-sbom.cdx.json"
        if require_all:
            bom = json.loads((output / filename).read_text(encoding="utf-8"))
            require_build_inventory(bom, package, target, version)
        owner = "marty-api-core" if alias == "wasm" else f"marty-cli-{alias}"
        inventory[owner]["metadata"]["component"].setdefault("externalReferences", []).append(
            {"type": "bom", "url": base_url + filename})
    # The launcher declares six optional native packages. Preserve that family
    # inventory even when npm cannot install unpublished optional registry names.
    launcher = inventory["marty-cli"]
    expected_optional = {f"@elevenid/marty-cli-{alias}": version for alias in TARGETS if alias != "wasm"}
    if (manifests["marty-cli"].get("dependencies")
            or manifests["marty-cli"].get("peerDependencies")
            or manifests["marty-cli"].get("optionalDependencies") != expected_optional):
        raise ValueError("Launcher production dependencies differ from the reviewed package family")
    root = launcher["metadata"]["component"]
    root_edge = {"ref": root["bom-ref"], "dependsOn": []}
    # npm can include the workspace's development/link inventory. The actual
    # launcher has only the exact optional production family checked above.
    launcher["dependencies"] = graph = [root_edge]
    launcher["components"] = components = []
    for alias in TARGETS:
        if alias == "wasm":
            continue
        name = f"marty-cli-{alias}"
        child = copy.deepcopy(inventory[name]["metadata"]["component"])
        child["scope"] = "optional"
        child.setdefault("externalReferences", []).append(
            {"type": "bom", "url": base_url + name + "-npm-sbom.cdx.json"})
        components[:] = [item for item in components if item["bom-ref"] != child["bom-ref"]]
        components.append(child)
        graph.append({"ref": child["bom-ref"], "dependsOn": []})
        root_edge.setdefault("dependsOn", [])
        root_edge["dependsOn"] = sorted(set(root_edge["dependsOn"]) | {child["bom-ref"]})
    for name, bom in inventory.items():
        filename = name + ("-sbom.cdx.json" if name in ("marty-cli", "marty-api-core")
                           else "-npm-sbom.cdx.json")
        write(output, filename, bom)
    if (ROOT / "Cargo.lock").read_bytes() != lock:
        raise ValueError("SBOM generation changed the release dependency lock")
    print(f"Validated {len(inventory)} npm inventories and {len(targets)} Rust target graphs")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cyclonedx", default="cargo-cyclonedx")
    parser.add_argument("--targets", nargs="+", choices=TARGETS, default=[])
    parser.add_argument("--host-native", action="store_true")
    parser.add_argument("--rust-only", action="store_true")
    parser.add_argument("--require-all", action="store_true")
    args = parser.parse_args()
    if args.host_native:
        aliases = [name for name, triple in TARGETS.items() if triple == host_target()]
        if len(aliases) != 1:
            raise ValueError("Rust host is not a supported native build target")
        args.targets.extend(aliases)
    if not args.targets or len(set(args.targets)) != len(args.targets):
        raise ValueError("Select unique Rust build targets")
    generate(args.output.resolve(), args.cyclonedx, args.targets,
             rust_only=args.rust_only, require_all=args.require_all)

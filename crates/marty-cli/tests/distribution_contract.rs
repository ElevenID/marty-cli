use std::{fs, path::Path, process::Command};

use serde_json::Value;

fn root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("workspace root")
}

#[test]
fn npm_adapter_executes_the_native_binary() {
    let output = Command::new("node")
        .arg(root().join("bin/marty.js"))
        .arg("--version")
        .current_dir(root())
        .output()
        .expect("npm adapter process");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim(),
        env!("CARGO_PKG_VERSION")
    );
}

#[test]
fn all_platform_packages_match_the_native_release_version() {
    let root_manifest: Value = serde_json::from_slice(
        &fs::read(root().join("package.json")).expect("root package manifest"),
    )
    .expect("root package JSON");
    assert_eq!(root_manifest["version"], env!("CARGO_PKG_VERSION"));
    assert!(root_manifest.get("dependencies").is_none());

    let targets = [
        ("darwin-arm64", "darwin", "arm64"),
        ("darwin-x64", "darwin", "x64"),
        ("linux-arm64", "linux", "arm64"),
        ("linux-x64", "linux", "x64"),
        ("win32-arm64", "win32", "arm64"),
        ("win32-x64", "win32", "x64"),
    ];
    for (target, os, cpu) in targets {
        let manifest: Value = serde_json::from_slice(
            &fs::read(root().join(format!("packages/cli-{target}/package.json")))
                .expect("platform package manifest"),
        )
        .expect("platform package JSON");
        assert_eq!(manifest["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(manifest["os"][0], os);
        assert_eq!(manifest["cpu"][0], cpu);
        assert_eq!(
            root_manifest["optionalDependencies"][format!("@elevenid/marty-cli-{target}")],
            env!("CARGO_PKG_VERSION")
        );
    }
}

//! Transitional proof that the native port preserves the legacy CLI's observable
//! dry-run contracts. Remove this test together with the legacy implementation.

use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

use serde::Deserialize;
use serde_json::Value;
use tempfile::TempDir;

#[derive(Debug, Deserialize)]
struct Case {
    name: String,
    args: Vec<String>,
    #[serde(default)]
    config: Option<Value>,
    #[serde(default)]
    exit_code: Option<i32>,
}

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn configure_home(home: &Path, config: Option<&Value>) {
    if let Some(config) = config {
        let directory = home.join(".marty");
        fs::create_dir_all(&directory).expect("configuration directory");
        fs::write(
            directory.join("config.json"),
            serde_json::to_vec(config).expect("serialized config"),
        )
        .expect("configuration file");
    }
}

fn run(mut command: Command, home: &Path, args: &[String]) -> Output {
    command
        .args(args)
        .env("HOME", home)
        .env("USERPROFILE", home)
        .env_remove("MARTY_API_URL")
        .env_remove("MARTY_API_KEY")
        .env_remove("MARTY_ORG_ID")
        .env("NO_COLOR", "1")
        .output()
        .expect("CLI process")
}

fn dry_run_contract(output: &Output) -> Option<(String, Value)> {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = stdout.lines();
    let action = lines.next()?.strip_prefix("[dry-run] ")?.to_owned();
    let payload = serde_json::from_str::<Value>(&lines.collect::<Vec<_>>().join("\n")).ok()?;
    Some((action, payload))
}

#[test]
fn rust_matches_legacy_dry_run_contracts_before_cutover() {
    let root = repository_root();
    if !root.join("bin/marty.js").exists() {
        return;
    }
    let cases: Vec<Case> =
        serde_json::from_str(include_str!("../../../tests/behavior/cli_cases.json"))
            .expect("behavior vectors");

    for case in cases {
        let rust_home = TempDir::new().expect("Rust temporary home");
        let node_home = TempDir::new().expect("Node temporary home");
        configure_home(rust_home.path(), case.config.as_ref());
        configure_home(node_home.path(), case.config.as_ref());

        let rust = run(
            Command::new(env!("CARGO_BIN_EXE_marty")),
            rust_home.path(),
            &case.args,
        );
        let mut node_command = Command::new("node");
        node_command
            .arg(root.join("bin/marty.js"))
            .current_dir(&root);
        let node = run(node_command, node_home.path(), &case.args);
        let expected_code = case.exit_code.unwrap_or(0);
        assert_eq!(
            rust.status.code(),
            Some(expected_code),
            "{} Rust status",
            case.name
        );
        assert_eq!(
            node.status.code(),
            Some(expected_code),
            "{} Node status\nstdout: {}\nstderr: {}",
            case.name,
            String::from_utf8_lossy(&node.stdout),
            String::from_utf8_lossy(&node.stderr)
        );

        if let (Some(rust_contract), Some(node_contract)) =
            (dry_run_contract(&rust), dry_run_contract(&node))
        {
            assert_eq!(
                rust_contract, node_contract,
                "{} dry-run contract",
                case.name
            );
        }
    }
}

use std::{fs, path::Path, process::Command};

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
    #[serde(default)]
    stdout_contains: Vec<String>,
    #[serde(default)]
    stderr_contains: Vec<String>,
}

fn isolated_command(home: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_marty"));
    command
        .env("HOME", home)
        .env("USERPROFILE", home)
        .env_remove("MARTY_API_URL")
        .env_remove("MARTY_API_KEY")
        .env_remove("MARTY_ORG_ID")
        .env("NO_COLOR", "1");
    command
}

#[test]
fn language_neutral_command_vectors_hold() {
    let cases: Vec<Case> =
        serde_json::from_str(include_str!("../../../tests/behavior/cli_cases.json"))
            .expect("behavior vectors must be valid JSON");

    for case in cases {
        let home = TempDir::new().expect("temporary home");
        if let Some(config) = &case.config {
            let directory = home.path().join(".marty");
            fs::create_dir_all(&directory).expect("configuration directory");
            fs::write(
                directory.join("config.json"),
                serde_json::to_vec(config).expect("serialized config"),
            )
            .expect("configuration file");
        }
        let output = isolated_command(home.path())
            .args(&case.args)
            .output()
            .unwrap_or_else(|error| panic!("{} failed to start: {error}", case.name));
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert_eq!(
            output.status.code(),
            Some(case.exit_code.unwrap_or(0)),
            "{} returned the wrong status\nstdout: {stdout}\nstderr: {stderr}",
            case.name
        );
        for expected in case.stdout_contains {
            assert!(
                stdout.contains(&expected),
                "{} stdout omitted {expected:?}\nstdout: {stdout}",
                case.name
            );
        }
        for expected in case.stderr_contains {
            assert!(
                stderr.contains(&expected),
                "{} stderr omitted {expected:?}\nstderr: {stderr}",
                case.name
            );
        }
    }
}

#[test]
fn auth_and_config_persist_across_processes() {
    let home = TempDir::new().expect("temporary home");
    let login = isolated_command(home.path())
        .args(["auth", "login", "--api-key", "secret-test-key"])
        .output()
        .expect("login command");
    assert!(login.status.success());

    let whoami = isolated_command(home.path())
        .args(["auth", "whoami", "--output", "json"])
        .output()
        .expect("whoami command");
    assert!(whoami.status.success());
    let info: Value = serde_json::from_slice(&whoami.stdout).expect("whoami JSON");
    assert_eq!(info["type"], "api_key");
    assert_ne!(info["key"], "secret-test-key");

    let credentials =
        fs::read_to_string(home.path().join(".marty/credentials.json")).expect("credential file");
    assert!(credentials.contains("secret-test-key"));

    let switch = isolated_command(home.path())
        .args(["orgs", "switch", "org-123"])
        .output()
        .expect("org switch");
    assert!(switch.status.success());
    let current = isolated_command(home.path())
        .args(["orgs", "current"])
        .output()
        .expect("current org");
    assert_eq!(String::from_utf8_lossy(&current.stdout).trim(), "org-123");
}

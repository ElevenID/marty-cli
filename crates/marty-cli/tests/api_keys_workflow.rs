use std::{fs, path::Path, process::Command};

use serde_json::{Value, json};
use tempfile::TempDir;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_json, header, method, path, query_param},
};

fn command(config: &Path, api_url: &str) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_marty"));
    command
        .env("MARTY_CONFIG_DIR", config)
        .env("MARTY_API_URL", api_url)
        .env("MARTY_API_KEY", "mk_live_operator-fixture")
        .env_remove("MARTY_ORG_ID")
        .env("NO_COLOR", "1");
    command
}

fn run(config: &Path, api_url: &str, args: &[&str]) -> Value {
    let output = command(config, api_url).args(args).output().unwrap();
    assert!(
        output.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    serde_json::from_slice(&output.stdout).unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn machine_key_lifecycle_uses_public_tenant_scope_without_session_or_credential_replacement()
{
    let server = MockServer::start().await;
    let config = TempDir::new().unwrap();
    let original = br#"{"organizationId":"org-original"}"#;
    fs::write(config.path().join("config.json"), original).unwrap();
    let body = json!({"name":"Reader", "scopes":["credentials:read"], "is_test":false});
    Mock::given(method("POST"))
        .and(path("/v1/api-keys"))
        .and(query_param("organization_id", "org-selected"))
        .and(header("x-api-key", "mk_live_operator-fixture"))
        .and(|request: &wiremock::Request| !request.headers.contains_key("cookie"))
        .and(body_json(body))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id":"key-1", "organization_id":"org-selected", "name":"Reader",
            "key":"mk_live_new-fixture", "scopes":["credentials:read"]
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/api-keys"))
        .and(query_param("organization_id", "org-selected"))
        .and(query_param("limit", "0"))
        .and(query_param("offset", "4"))
        .and(header("x-api-key", "mk_live_operator-fixture"))
        .and(|request: &wiremock::Request| !request.headers.contains_key("cookie"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/v1/api-keys/key-1"))
        .and(query_param("organization_id", "org-selected"))
        .and(header("x-api-key", "mk_live_operator-fixture"))
        .and(|request: &wiremock::Request| !request.headers.contains_key("cookie"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"success":true})))
        .expect(1)
        .mount(&server)
        .await;

    let created = run(
        config.path(),
        &server.uri(),
        &[
            "api-keys",
            "create",
            "--organization-id",
            "org-selected",
            "--name",
            "Reader",
            "--scope",
            "credentials:read",
        ],
    );
    assert_eq!(created["key"], "mk_live_new-fixture");
    assert_eq!(
        run(
            config.path(),
            &server.uri(),
            &[
                "api-keys",
                "list",
                "--organization-id",
                "org-selected",
                "--limit",
                "0",
                "--offset",
                "4",
            ]
        ),
        json!([])
    );
    assert_eq!(
        run(
            config.path(),
            &server.uri(),
            &[
                "api-keys",
                "revoke",
                "key-1",
                "--organization-id",
                "org-selected",
            ]
        ),
        json!({"success":true})
    );
    assert_eq!(
        fs::read(config.path().join("config.json")).unwrap(),
        original
    );
    assert!(!config.path().join("credentials.json").exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn key_creation_dry_run_does_not_send_a_request() {
    let server = MockServer::start().await;
    let config = TempDir::new().unwrap();
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;
    let output = command(config.path(), &server.uri())
        .args([
            "api-keys",
            "create",
            "--organization-id",
            "org-1",
            "--name",
            "Reader",
            "--scope",
            "credentials:read",
            "--dry-run",
        ])
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("[dry-run] POST"));
    assert!(!config.path().join("credentials.json").exists());
}

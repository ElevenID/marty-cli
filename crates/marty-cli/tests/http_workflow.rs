use std::{fs, path::Path, process::Command};

use serde_json::{Value, json};
use tempfile::TempDir;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_json, header, method, path, query_param},
};

fn command(home: &Path, api_url: &str) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_marty"));
    command
        .env("HOME", home)
        .env("USERPROFILE", home)
        .env("MARTY_API_URL", api_url)
        .env_remove("MARTY_ORG_ID")
        .env("NO_COLOR", "1");
    command
}

fn run_json(home: &Path, api_url: &str, args: &[&str]) -> Value {
    let output = command(home, api_url)
        .args(args)
        .output()
        .expect("CLI process");
    assert!(
        output.status.success(),
        "command failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("JSON output")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_binary_preserves_authenticated_gateway_workflow() {
    let server = MockServer::start().await;
    let home = TempDir::new().expect("temporary home");

    Mock::given(method("GET"))
        .and(path("/health"))
        .and(header("x-api-key", "smoke-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "status": "healthy",
            "services": {"gateway": "healthy", "database": "ok"}
        })))
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/organizations"))
        .and(header("x-api-key", "smoke-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "organizations": [{"id": "org-123", "name": "Acme", "role": "admin"}]
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/application-templates"))
        .and(query_param("organization_id", "org-123"))
        .and(header("x-api-key", "smoke-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "templates": [{"id": "tpl-1", "name": "Badge", "status": "active"}]
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/flows/verify"))
        .and(header("x-api-key", "smoke-key"))
        .and(body_json(json!({
            "organization_id": "org-123",
            "presentation_policy_id": "policy-1"
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "sess-1", "status": "pending"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let login = command(home.path(), &server.uri())
        .args(["auth", "login", "--api-key", "smoke-key"])
        .output()
        .expect("login");
    assert!(login.status.success());
    assert_eq!(
        run_json(home.path(), &server.uri(), &["health", "-o", "json"])["status"],
        "healthy"
    );
    let env_home = TempDir::new().expect("environment-auth home");
    let env_health = command(env_home.path(), &server.uri())
        .env("MARTY_API_KEY", "smoke-key")
        .args(["health", "-o", "json"])
        .output()
        .expect("environment-auth health");
    assert!(env_health.status.success());
    assert_eq!(
        run_json(home.path(), &server.uri(), &["orgs", "list", "-o", "json"])[0]["id"],
        "org-123"
    );

    let switched = command(home.path(), &server.uri())
        .args(["orgs", "switch", "org-123"])
        .output()
        .expect("switch org");
    assert!(switched.status.success());
    assert_eq!(
        run_json(
            home.path(),
            &server.uri(),
            &["templates", "list", "-o", "json"]
        )[0]["id"],
        "tpl-1"
    );
    assert_eq!(
        run_json(
            home.path(),
            &server.uri(),
            &["verify", "start", "--policy", "policy-1", "-o", "json"]
        )["id"],
        "sess-1"
    );

    let credentials = fs::read_to_string(home.path().join(".marty/credentials.json"))
        .expect("credential persistence");
    assert!(credentials.contains("smoke-key"));
}

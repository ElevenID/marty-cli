use std::{fs, path::Path, process::Command};

use serde_json::{Value, json};
use tempfile::TempDir;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_json, header, method, path},
};

const CLAIMS: &str = r#"[{"name":"given_name","display":{"label":"Given name"}}]"#;

fn command(config: &Path, api_url: &str) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_marty"));
    command
        .env("MARTY_CONFIG_DIR", config)
        .env("MARTY_API_URL", api_url)
        .env("MARTY_API_KEY", "mk_test_setup-fixture")
        .env("MARTY_ORG_ID", "org-selected")
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
    serde_json::from_slice(&output.stdout).unwrap()
}

fn machine_auth(request: &wiremock::Request) -> bool {
    !request.headers.contains_key("cookie") && !request.headers.contains_key("authorization")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn organization_creation_uses_authenticated_owner_and_public_fields() {
    let server = MockServer::start().await;
    let config = TempDir::new().unwrap();
    Mock::given(method("POST"))
        .and(path("/v1/organizations"))
        .and(header("x-api-key", "mk_test_setup-fixture"))
        .and(machine_auth)
        .and(body_json(
            json!({"name":"acme", "display_name":"Acme", "visibility":"PRIVATE"}),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id":"org-created"})))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        run(
            config.path(),
            &server.uri(),
            &[
                "orgs",
                "create",
                "--name",
                "acme",
                "--display-name",
                "Acme",
                "-o",
                "json"
            ]
        )["id"],
        "org-created"
    );
    assert!(!config.path().join("config.json").exists());
    assert!(!config.path().join("credentials.json").exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn template_creation_sends_public_identity_and_consistent_formats() {
    let server = MockServer::start().await;
    let config = TempDir::new().unwrap();
    let original = br#"{"organizationId":"org-original"}"#;
    fs::write(config.path().join("config.json"), original).unwrap();
    Mock::given(method("POST"))
        .and(path("/v1/credential-templates"))
        .and(header("x-api-key", "mk_test_setup-fixture"))
        .and(machine_auth)
        .and(body_json(json!({
            "organization_id":"org-selected", "name":"Badge", "credential_type":"EmployeeCredential",
            "compliance_profile_id":"profile-1", "trust_profile_id":"trust-1",
            "credential_payload_format":"SD_JWT_VC", "supported_formats":["SD_JWT_VC"],
            "privacy_posture":"selective_disclosure", "vct":"https://issuer.example/employee",
            "claims":[{"name":"given_name","display":{"label":"Given name"}}],
            "issuer_did":"did:web:issuer.example"
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id":"template-1", "status":"draft"})))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        run(
            config.path(),
            &server.uri(),
            &[
                "ct",
                "create",
                "--name",
                "Badge",
                "--credential-type",
                "EmployeeCredential",
                "--compliance-profile-id",
                "profile-1",
                "--trust-profile-id",
                "trust-1",
                "--issuer-did",
                "did:web:issuer.example",
                "--vct",
                "https://issuer.example/employee",
                "--claims",
                CLAIMS,
                "-o",
                "json"
            ]
        )["status"],
        "draft"
    );
    assert_eq!(
        fs::read(config.path().join("config.json")).unwrap(),
        original
    );
    assert!(!config.path().join("credentials.json").exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn activation_and_legacy_publish_use_public_lifecycle_without_force_bypass() {
    let server = MockServer::start().await;
    let config = TempDir::new().unwrap();
    Mock::given(method("POST"))
        .and(path("/v1/credential-templates/template-1/activate"))
        .and(header("x-api-key", "mk_test_setup-fixture"))
        .and(machine_auth)
        .and(body_json(json!({})))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"id":"template-1", "status":"active"})),
        )
        .expect(2)
        .mount(&server)
        .await;
    assert_eq!(
        run(
            config.path(),
            &server.uri(),
            &["ct", "publish", "template-1", "-o", "json"]
        )["status"],
        "active"
    );
    assert_eq!(
        run(
            config.path(),
            &server.uri(),
            &["ct", "activate", "template-1", "-o", "json"]
        )["status"],
        "active"
    );
    let requests = server.received_requests().await.unwrap();
    assert!(requests.iter().all(|request| request.url.query().is_none()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn mdoc_template_uses_explicit_doctype_without_unintended_sd_jwt_defaults() {
    let server = MockServer::start().await;
    let config = TempDir::new().unwrap();
    Mock::given(method("POST"))
        .and(path("/v1/credential-templates"))
        .and(header("x-api-key", "mk_test_setup-fixture"))
        .and(machine_auth)
        .and(body_json(json!({
            "organization_id":"org-selected", "name":"Mobile document", "credential_type":"MobileDocument",
            "compliance_profile_id":"profile-1", "credential_payload_format":"MDOC", "supported_formats":["MDOC"],
            "privacy_posture":"selective_disclosure", "doctype":"org.iso.18013.5.1.mDL",
            "claims":[{"name":"given_name","display":{"label":"Given name"}}],
            "issuer_did":"did:web:issuer.example", "issuance_protocol":"OID4VCI_PRE_AUTH"
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id":"mdoc-template"})))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        run(
            config.path(),
            &server.uri(),
            &[
                "ct",
                "create",
                "--name",
                "Mobile document",
                "--credential-type",
                "MobileDocument",
                "--compliance-profile-id",
                "profile-1",
                "--issuer-did",
                "did:web:issuer.example",
                "--format",
                "mso_mdoc",
                "--doctype",
                "org.iso.18013.5.1.mDL",
                "--issuance-protocol",
                "OID4VCI_PRE_AUTH",
                "--claims",
                CLAIMS,
                "-o",
                "json"
            ]
        )["id"],
        "mdoc-template"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unsupported_overrides_and_missing_public_inputs_fail_before_http() {
    let server = MockServer::start().await;
    let config = TempDir::new().unwrap();
    let base = [
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
        "--claims",
        CLAIMS,
    ];
    let mut cases = vec![
        (
            vec!["orgs", "create", "--name", "acme", "--owner-id", "spoof"],
            "--owner-id",
        ),
        (vec!["ct", "publish", "template-1", "--force"], "--force"),
        ([&base[..8], &["--claims", CLAIMS]].concat(), "--issuer-did"),
        ([&base[..10], &["--claims", CLAIMS]].concat(), "--vct"),
        (base[..12].to_vec(), "--claims"),
    ];
    for (extra, message) in [
        (vec!["--key-access-mode", "key_vault"], "--key-access-mode"),
        (vec!["--issuer-algorithm", "ES256"], "--issuer-algorithm"),
        (
            vec!["--claims", "{}"],
            "--claims must be a nonempty JSON array",
        ),
        (
            vec!["--claims", "[]"],
            "--claims must be a nonempty JSON array",
        ),
        (
            vec!["--format", "unsupported"],
            "Unsupported template --format",
        ),
        (vec!["--format", "MDOC"], "--doctype is required"),
    ] {
        let mut args = base.to_vec();
        if extra.first() == Some(&"--claims") {
            args.truncate(args.len() - 2);
        }
        args.extend(extra);
        cases.push((args, message));
    }
    for (args, message) in cases {
        let output = command(config.path(), &server.uri())
            .args(&args)
            .output()
            .unwrap();
        assert!(!output.status.success(), "{args:?} unexpectedly succeeded");
        assert!(
            String::from_utf8_lossy(&output.stderr).contains(message),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    assert!(server.received_requests().await.unwrap().is_empty());
    assert!(!config.path().join("config.json").exists());
    assert!(!config.path().join("credentials.json").exists());
}

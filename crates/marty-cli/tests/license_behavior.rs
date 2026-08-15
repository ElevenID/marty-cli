use std::{fs, path::Path, process::Command};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{
    Signer, SigningKey,
    pkcs8::{EncodePublicKey, spki::der::pem::LineEnding},
};
use serde_json::{Value, json};
use tempfile::TempDir;

fn command(home: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_marty"));
    command
        .env("HOME", home)
        .env("USERPROFILE", home)
        .env("NO_COLOR", "1");
    command
}

fn license(claims: &Value) -> (String, String) {
    let key = SigningKey::from_bytes(&[7_u8; 32]);
    let header = URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(&json!({"alg": "EdDSA", "typ": "JWT"})).expect("header"));
    let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).expect("claims"));
    let signing_input = format!("{header}.{payload}");
    let signature = URL_SAFE_NO_PAD.encode(key.sign(signing_input.as_bytes()).to_bytes());
    let public_key = key
        .verifying_key()
        .to_public_key_pem(LineEnding::LF)
        .expect("public key PEM");
    (format!("{signing_input}.{signature}"), public_key)
}

fn valid_claims(tier: &str) -> Value {
    let now = chrono::Utc::now().timestamp();
    json!({
        "iss": "marty-license-issuer",
        "sub": "org-1",
        "org_name": "Test Organization",
        "jti": "lic-1",
        "iat": now - 60,
        "exp": now + 86_400,
        "plan_tier": tier,
        "features": ["verification"],
        "entitled_products": ["ui-app", "verifier"]
    })
}

#[test]
fn activate_status_and_deactivate_preserve_local_license_workflow() {
    let home = TempDir::new().expect("temporary home");
    let (token, _) = license(&valid_claims("institution"));
    let activated = command(home.path())
        .args(["license", "activate", &token])
        .output()
        .expect("activate");
    assert!(activated.status.success());
    assert!(String::from_utf8_lossy(&activated.stdout).contains("Test Organization"));

    let status = command(home.path())
        .args(["license", "status", "--output", "json"])
        .output()
        .expect("status");
    assert!(status.status.success());
    let info: Value = serde_json::from_slice(&status.stdout).expect("status JSON");
    assert_eq!(info["license_id"], "lic-1");
    assert_eq!(info["plan_tier"], "institution");

    let deactivated = command(home.path())
        .args(["license", "deactivate"])
        .output()
        .expect("deactivate");
    assert!(deactivated.status.success());
    assert!(!home.path().join(".marty/license.key").exists());
}

#[test]
fn selfhost_install_verifies_signature_policy_and_writes_only_token() {
    for tier in ["sandbox", "program", "institution", "system"] {
        let home = TempDir::new().expect("temporary home");
        let secret_dir = home.path().join("secrets");
        let token_file = home.path().join("license.jwt");
        let key_file = home.path().join("public.pem");
        let env_file = home.path().join("selfhost.env");
        let (token, key) = license(&valid_claims(tier));
        fs::write(&token_file, &token).expect("token fixture");
        fs::write(&key_file, key).expect("key fixture");
        fs::write(
            &env_file,
            format!(
                "SELFHOST_SECRET_DIR={}\nMARTY_LICENSE_REQUIRED_ISSUER=marty-license-issuer\nMARTY_LICENSE_REQUIRED_PLAN_TIER={tier}\nMARTY_LICENSE_REQUIRED_PRODUCTS=ui-app,verifier\n",
                secret_dir.display()
            ),
        )
        .expect("environment fixture");

        let installed = command(home.path())
            .args([
                "license",
                "install-selfhost",
                "--env-file",
                env_file.to_str().expect("env path"),
                "--token-file",
                token_file.to_str().expect("token path"),
                "--public-key-file",
                key_file.to_str().expect("key path"),
            ])
            .output()
            .expect("install-selfhost");
        assert!(
            installed.status.success(),
            "{}",
            String::from_utf8_lossy(&installed.stderr)
        );
        assert_eq!(
            fs::read_to_string(secret_dir.join("license_key"))
                .expect("installed token")
                .trim(),
            token
        );
        assert!(!secret_dir.join("license_public_key").exists());
    }
}

#[test]
fn selfhost_install_fails_closed_for_tampering_and_unsupported_tiers() {
    let home = TempDir::new().expect("temporary home");
    let (token, key) = license(&valid_claims("professional"));
    let token_file = home.path().join("license.jwt");
    let key_file = home.path().join("public.pem");
    fs::write(&token_file, token).expect("token fixture");
    fs::write(&key_file, key).expect("key fixture");

    let rejected = command(home.path())
        .args([
            "license",
            "install-selfhost",
            "--secret-dir",
            home.path().join("secrets").to_str().expect("secret path"),
            "--token-file",
            token_file.to_str().expect("token path"),
            "--public-key-file",
            key_file.to_str().expect("key path"),
        ])
        .output()
        .expect("install-selfhost");
    assert_eq!(rejected.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&rejected.stderr);
    assert!(stderr.contains("unsupported"));
    assert!(stderr.contains("expected one of"));
    assert!(!home.path().join("secrets/license_key").exists());
}

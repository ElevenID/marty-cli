use std::{
    collections::BTreeSet,
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{TimeZone, Utc};
use clap::{Args, Subcommand};
use ed25519_dalek::{Signature, Verifier, VerifyingKey, pkcs8::DecodePublicKey};
use marty_api_client::ApiClient;
use reqwest::header::HeaderMap;
use serde_json::{Value, json};

use crate::{
    config::{config_dir, load_config, load_credentials},
    output::{OutputFormat, print_value},
};

const DEFAULT_ISSUER: &str = "marty-license-issuer";
const EMBEDDED_PUBLIC_KEY: &str = include_str!("selfhost-production.pem");
const KNOWN_TIERS: [&str; 4] = ["institution", "program", "sandbox", "system"];

#[derive(Debug, Args)]
pub struct LicenseArgs {
    #[command(subcommand)]
    command: LicenseCommand,
}

#[derive(Debug, Subcommand)]
enum LicenseCommand {
    Activate {
        token: String,
    },
    Status {
        #[arg(short, long, value_enum, default_value_t = OutputFormat::Table)]
        output: OutputFormat,
    },
    Validate {
        #[arg(short, long, value_enum, default_value_t = OutputFormat::Table)]
        output: OutputFormat,
    },
    #[command(name = "install-selfhost")]
    InstallSelfhost {
        #[arg(long, default_value = ".env.selfhost.production.local")]
        env_file: PathBuf,
        #[arg(long)]
        secret_dir: Option<PathBuf>,
        #[arg(long)]
        token_file: Option<PathBuf>,
        #[arg(long)]
        token_stdin: bool,
        #[arg(long)]
        public_key_file: Option<PathBuf>,
        #[arg(long)]
        public_key_stdin: bool,
    },
    Deactivate,
}

pub async fn run(args: LicenseArgs, global: Option<OutputFormat>) -> Result<()> {
    match args.command {
        LicenseCommand::Activate { token } => activate(&token),
        LicenseCommand::Status { mut output } => {
            if let Some(global) = global {
                output = global;
            }
            status(output)
        }
        LicenseCommand::Validate { mut output } => {
            if let Some(global) = global {
                output = global;
            }
            validate_online(output).await
        }
        LicenseCommand::InstallSelfhost {
            env_file,
            secret_dir,
            token_file,
            token_stdin,
            public_key_file,
            public_key_stdin,
        } => install_selfhost(
            &env_file,
            secret_dir.as_deref(),
            token_file.as_deref(),
            token_stdin,
            public_key_file.as_deref(),
            public_key_stdin,
        ),
        LicenseCommand::Deactivate => deactivate(),
    }
}

fn license_file() -> Result<PathBuf> {
    Ok(config_dir()?.join("license.key"))
}

fn decode_segment(segment: &str, label: &str) -> Result<Value> {
    let bytes = URL_SAFE_NO_PAD
        .decode(segment)
        .with_context(|| format!("License token {label} is not valid base64url JSON."))?;
    let value: Value = serde_json::from_slice(&bytes)
        .with_context(|| format!("License token {label} is not valid base64url JSON."))?;
    if !value.is_object() {
        bail!("License token {label} must be a JSON object.");
    }
    Ok(value)
}

fn jwt_parts(token: &str) -> Result<(&str, &str, &str)> {
    let mut parts = token.trim().split('.');
    let values = (parts.next(), parts.next(), parts.next(), parts.next());
    match values {
        (Some(header), Some(payload), Some(signature), None) => Ok((header, payload, signature)),
        _ => bail!("License token must be a JWT with three segments."),
    }
}

fn payload(token: &str) -> Result<Value> {
    let (_, payload, _) = jwt_parts(token)?;
    decode_segment(payload, "payload")
}

fn write_private(path: &Path, value: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        set_dir_mode(parent)?;
    }
    let mut options = fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    set_file_mode(&mut options);
    let mut file = options.open(path)?;
    writeln!(file, "{}", value.trim())?;
    Ok(())
}

fn activate(token: &str) -> Result<()> {
    if token.split('.').count() != 3 {
        bail!("Invalid license token — expected a JWT (three dot-separated segments).");
    }
    let claims = payload(token)?;
    write_private(&license_file()?, token)?;
    println!(
        "License activated.\n  Organization: {}\n  Plan:         {}\n  Expires:      {}",
        claim_display(&claims, "org_name", "sub", "unknown"),
        claims
            .get("plan_tier")
            .and_then(Value::as_str)
            .unwrap_or("unknown"),
        format_date(claims.get("exp").and_then(Value::as_i64))
    );
    Ok(())
}

fn read_license() -> Result<Option<String>> {
    let path = license_file()?;
    if path.exists() {
        Ok(Some(fs::read_to_string(path)?.trim().to_owned()))
    } else {
        Ok(None)
    }
}

fn status(output: OutputFormat) -> Result<()> {
    let token =
        read_license()?.context("No license activated. Run: marty license activate <token>")?;
    let claims = payload(&token)?;
    let exp = claims.get("exp").and_then(Value::as_i64);
    let calls = match claims.get("api_calls_limit").and_then(Value::as_i64) {
        Some(0) => "unlimited".to_owned(),
        Some(value) => value.to_string(),
        None => "N/A".to_owned(),
    };
    let info = json!({"license_id": claims.get("jti").and_then(Value::as_str).unwrap_or("N/A"), "organization": claim_display(&claims, "org_name", "sub", "N/A"), "plan_tier": claims.get("plan_tier").and_then(Value::as_str).unwrap_or("unknown"), "products": string_list(&claims, "entitled_products").join(", "), "features": string_list(&claims, "features").join(", "), "registry_access": if claims.get("registry_access").and_then(Value::as_bool).unwrap_or(false) {"yes"} else {"no"}, "api_calls_limit": calls, "issued": format_date(claims.get("iat").and_then(Value::as_i64)), "expires": format_date(exp), "expiry_status": days_until(exp), "deployment_mode": claims.get("deployment_mode").and_then(Value::as_str).unwrap_or("N/A")});
    print_value(&info, output)
}

async fn validate_online(output: OutputFormat) -> Result<()> {
    let token =
        read_license()?.context("No license activated. Run: marty license activate <token>")?;
    let claims = payload(&token)?;
    let jti = claims
        .get("jti")
        .and_then(Value::as_str)
        .context("License has no JTI claim — cannot validate online.")?;
    let config = load_config()?;
    let creds = load_credentials()?;
    let mut headers = HeaderMap::new();
    if let Some(key) = creds.api_key {
        headers.insert("X-API-Key", key.parse()?);
    }
    let result = ApiClient::new(&config.api_url, headers)?
        .get(&format!("/v1/licenses/validate/{jti}"))
        .await?;
    print_value(
        &json!({"license_id": jti, "status": result.get("status").and_then(Value::as_str).unwrap_or("unknown"), "valid": if result.get("valid").and_then(Value::as_bool).unwrap_or(false) {"yes"} else {"no"}, "message": result.get("message")}),
        output,
    )
}

fn install_selfhost(
    env_file: &Path,
    secret_dir: Option<&Path>,
    token_file: Option<&Path>,
    token_stdin: bool,
    public_key_file: Option<&Path>,
    public_key_stdin: bool,
) -> Result<()> {
    ensure_source(token_file.is_some(), token_stdin, "License token", true)?;
    ensure_source(
        public_key_file.is_some(),
        public_key_stdin,
        "License public key",
        false,
    )?;
    if token_stdin && public_key_stdin {
        bail!("License token and public key cannot both come from stdin in the same invocation.");
    }
    let env = load_env(env_file)?;
    let secret_dir = secret_dir
        .map(Path::to_path_buf)
        .or_else(|| env.get("SELFHOST_SECRET_DIR").map(PathBuf::from))
        .context("SELFHOST_SECRET_DIR is required via --secret-dir or the env file.")?;
    let token = if token_stdin {
        read_stdin("License token")?
    } else {
        read_text(
            token_file.context("License token file is required")?,
            "License token file",
        )?
    };
    let public_key = if public_key_stdin {
        read_stdin("License public key")?
    } else if let Some(path) = public_key_file {
        read_text(path, "License public key file")?
    } else {
        EMBEDDED_PUBLIC_KEY.trim().to_owned()
    };
    let claims = validate_selfhost(&token, &public_key, &env)?;
    write_private(&secret_dir.join("license_key"), &token)?;
    println!(
        "Self-host license installed.\n  Organization: {}\n  Plan:         {}\n  Expires:      {}",
        claim_display(&claims, "org_name", "sub", "N/A"),
        claims
            .get("plan_tier")
            .and_then(Value::as_str)
            .unwrap_or("unknown"),
        format_date(claims.get("exp").and_then(Value::as_i64))
    );
    Ok(())
}

fn validate_selfhost(
    token: &str,
    public_key_pem: &str,
    env: &std::collections::HashMap<String, String>,
) -> Result<Value> {
    if placeholder(token) {
        bail!("License token still uses a shipped placeholder value.");
    }
    if placeholder(public_key_pem) {
        bail!("License public key still uses a shipped placeholder value.");
    }
    let (header_part, payload_part, signature_part) = jwt_parts(token)?;
    let header = decode_segment(header_part, "header")?;
    let claims = decode_segment(payload_part, "payload")?;
    if header.get("alg").and_then(Value::as_str) != Some("EdDSA") {
        bail!(
            "License token must use EdDSA; received {}.",
            header.get("alg").unwrap_or(&Value::Null)
        );
    }
    let key = VerifyingKey::from_public_key_pem(public_key_pem)
        .context("License public key is not a valid PEM-encoded Ed25519 public key.")?;
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(signature_part)
        .context("License token is not valid base64url JSON.")?;
    let signature =
        Signature::from_slice(&signature_bytes).context("License signature is invalid.")?;
    key.verify(
        format!("{header_part}.{payload_part}").as_bytes(),
        &signature,
    )
    .context("License signature is invalid.")?;
    let issuer = required_string(&claims, "iss")?;
    required_string(&claims, "sub")?;
    required_integer(&claims, "iat")?;
    let exp = required_integer(&claims, "exp")?;
    let tier = optional_tier(claims.get("plan_tier"), "License claim plan_tier")?;
    let features = checked_list(&claims, "features")?;
    let products = checked_list(&claims, "entitled_products")?;
    if tier.is_none() && features.is_empty() && products.is_empty() {
        bail!("License must include features, entitled products, or a plan tier.");
    }
    let required_issuer = env
        .get("MARTY_LICENSE_REQUIRED_ISSUER")
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_ISSUER);
    if issuer != required_issuer {
        bail!("License issuer {issuer:?} does not match required issuer {required_issuer:?}.");
    }
    let now = Utc::now().timestamp();
    if let Some(nbf) = claims
        .get("nbf")
        .filter(|value| !value.is_null())
        .map(|_| required_integer(&claims, "nbf"))
        .transpose()?
        && now < nbf
    {
        bail!("License is not active yet.");
    }
    if now >= exp {
        bail!(
            "License expired at {}.",
            Utc.timestamp_opt(exp, 0)
                .single()
                .context("invalid license expiry")?
                .to_rfc3339()
        );
    }
    if let Some(required) = optional_tier(
        env.get("MARTY_LICENSE_REQUIRED_PLAN_TIER")
            .map(|value| Value::String(value.clone()))
            .as_ref(),
        "Required plan tier",
    )? && tier.as_deref() != Some(&required)
    {
        bail!(
            "License plan tier {:?} does not satisfy required tier {:?}.",
            tier.as_deref().unwrap_or("none"),
            required
        );
    }
    let missing = csv(env.get("MARTY_LICENSE_REQUIRED_PRODUCTS"))
        .into_iter()
        .filter(|required| !has_product(&products, required))
        .collect::<BTreeSet<_>>();
    if !missing.is_empty() {
        bail!(
            "License is missing required entitled products: {}.",
            missing.into_iter().collect::<Vec<_>>().join(", ")
        );
    }
    Ok(claims)
}

fn required_string<'a>(claims: &'a Value, name: &str) -> Result<&'a str> {
    let value = claims
        .get(name)
        .context(format!("License claim {name} is required."))?
        .as_str()
        .context(format!("License claim {name} must be a string."))?
        .trim();
    if value.is_empty() {
        bail!("License claim {name} cannot be blank.");
    }
    Ok(value)
}
fn required_integer(claims: &Value, name: &str) -> Result<i64> {
    claims
        .get(name)
        .context(format!("License claim {name} is required."))?
        .as_i64()
        .context(format!("License claim {name} must be an integer."))
}
fn optional_tier(value: Option<&Value>, label: &str) -> Result<Option<String>> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    let tier = value
        .as_str()
        .context(format!("{label} must be a string."))?
        .trim()
        .to_ascii_lowercase();
    if tier.is_empty() {
        return Ok(None);
    }
    if !KNOWN_TIERS.contains(&tier.as_str()) {
        bail!(
            "{label} {:?} is unsupported; expected one of {}.",
            value.as_str().unwrap_or_default(),
            KNOWN_TIERS.join(", ")
        );
    }
    Ok(Some(tier))
}
fn checked_list(claims: &Value, name: &str) -> Result<Vec<String>> {
    let Some(value) = claims.get(name) else {
        return Ok(Vec::new());
    };
    let list = value
        .as_array()
        .context(format!("License claim {name} must be a list of strings."))?;
    list.iter()
        .map(|item| {
            item.as_str()
                .map(str::trim)
                .map(ToOwned::to_owned)
                .context(format!("License claim {name} must contain only strings."))
        })
        .filter(|item| item.as_ref().is_ok_and(|value| !value.is_empty()))
        .collect()
}
fn has_product(products: &[String], product: &str) -> bool {
    if products.is_empty() {
        product == "verifier"
    } else {
        products
            .iter()
            .any(|value| value == "*" || value == product)
    }
}
fn placeholder(value: &str) -> bool {
    [
        "change-me",
        "change_me",
        "changeme",
        "replace-me",
        "replace_me",
    ]
    .iter()
    .any(|prefix| value.trim().to_ascii_lowercase().starts_with(prefix))
}
fn csv(value: Option<&String>) -> Vec<String> {
    value
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}
fn string_list(claims: &Value, name: &str) -> Vec<String> {
    claims
        .get(name)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}
fn claim_display<'a>(
    claims: &'a Value,
    primary: &str,
    secondary: &str,
    fallback: &'a str,
) -> &'a str {
    claims
        .get(primary)
        .and_then(Value::as_str)
        .or_else(|| claims.get(secondary).and_then(Value::as_str))
        .unwrap_or(fallback)
}
fn format_date(epoch: Option<i64>) -> String {
    epoch
        .and_then(|value| Utc.timestamp_opt(value, 0).single())
        .map_or_else(
            || "N/A".to_owned(),
            |value| value.format("%Y-%m-%d %H:%M:%S UTC").to_string(),
        )
}
fn days_until(epoch: Option<i64>) -> String {
    let Some(epoch) = epoch else {
        return "N/A".to_owned();
    };
    let days = (epoch - Utc::now().timestamp()).div_euclid(86_400);
    match days {
        value if value < 0 => format!("expired {}d ago", value.unsigned_abs()),
        0 => "expires today".to_owned(),
        value => format!("{value}d remaining"),
    }
}
fn ensure_source(file: bool, stdin: bool, label: &str, required: bool) -> Result<()> {
    let count = u8::from(file) + u8::from(stdin);
    if required && count != 1 {
        bail!("{label} requires exactly one source: either the file option or the stdin option.");
    }
    if !required && count > 1 {
        bail!("{label} accepts at most one source: either the file option or the stdin option.");
    }
    Ok(())
}
fn read_text(path: &Path, label: &str) -> Result<String> {
    let value = fs::read_to_string(path)
        .with_context(|| format!("{label} could not be read from {}.", path.display()))?
        .trim()
        .to_owned();
    if value.is_empty() {
        bail!("{label} is empty.");
    }
    Ok(value)
}
fn read_stdin(label: &str) -> Result<String> {
    let mut value = String::new();
    io::stdin().read_to_string(&mut value)?;
    let value = value.trim().to_owned();
    if value.is_empty() {
        bail!("{label} was not provided on stdin.");
    }
    Ok(value)
}
fn load_env(path: &Path) -> Result<std::collections::HashMap<String, String>> {
    if !path.exists() {
        return Ok(std::collections::HashMap::new());
    }
    Ok(fs::read_to_string(path)?
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            line.split_once('=')
                .map(|(key, value)| (key.trim().to_owned(), value.trim().to_owned()))
        })
        .collect())
}

fn deactivate() -> Result<()> {
    let path = license_file()?;
    if path.exists() {
        fs::remove_file(path)?;
        println!("License deactivated and removed from ~/.marty/license.key");
    } else {
        println!("No license currently activated.");
    }
    Ok(())
}

#[cfg(unix)]
fn set_dir_mode(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}
#[cfg(not(unix))]
#[allow(clippy::unnecessary_wraps)]
fn set_dir_mode(_path: &Path) -> Result<()> {
    Ok(())
}
#[cfg(unix)]
fn set_file_mode(options: &mut fs::OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
}
#[cfg(not(unix))]
fn set_file_mode(_options: &mut fs::OpenOptions) {}

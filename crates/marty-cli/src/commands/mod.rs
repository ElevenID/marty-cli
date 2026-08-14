#![allow(clippy::large_enum_variant, clippy::too_many_lines)]

use std::io::IsTerminal;

use anyhow::{Context, Result, bail};
use chrono::{DateTime, Local};
use clap::{Args, Parser, Subcommand};
use dialoguer::{Input, Password, Select};
use marty_api_client::{ApiClient, query};
use reqwest::header::{AUTHORIZATION, COOKIE, HeaderMap, HeaderValue};
use serde_json::{Value, json};
use url::form_urlencoded::byte_serialize;

use crate::{
    config::{
        Config, Credentials, clear_credentials, config_dir, load_config, load_credentials,
        save_config, save_credentials,
    },
    license,
    output::{OutputFormat, dry_run, parse_json, parse_object, print_table, print_value, scalar},
};

#[derive(Debug, Parser)]
#[command(
    name = "marty",
    about = "Command-line client for the Marty Identity Platform",
    disable_version_flag = true
)]
pub struct Cli {
    #[arg(long, global = true, value_enum)]
    global_output: Option<OutputFormat>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Manage authentication.
    Auth(AuthArgs),
    /// Check platform service health.
    Health(OutputArgs),
    /// Manage organizations.
    Orgs(OrgsArgs),
    /// Manage credentials.
    #[command(visible_alias = "creds")]
    Credentials(CredentialsArgs),
    /// Manage credential applications.
    #[command(visible_alias = "apps")]
    Applications(ApplicationsArgs),
    /// Verification operations.
    Verify(VerifyArgs),
    /// Manage flows.
    Flows(FlowsArgs),
    /// Manage credential templates.
    Templates(TemplatesArgs),
    /// Manage credential templates used for issuance.
    #[command(name = "credential-templates", visible_alias = "ct")]
    CredentialTemplates(CredentialTemplatesArgs),
    /// Manage compliance profiles.
    Compliance(ComplianceArgs),
    /// Manage trust profiles.
    Trust(TrustArgs),
    /// View and set CLI configuration.
    Config(ConfigArgs),
    /// Interactive first-time setup.
    Init(InitArgs),
    /// Test automation commands.
    Test(TestArgs),
    /// Generate shell completion scripts.
    Completion { shell: String },
    /// Manage license activation and status.
    License(license::LicenseArgs),
}

#[derive(Debug, Clone, Args)]
struct OutputArgs {
    #[arg(short, long, value_enum, default_value_t = OutputFormat::Table)]
    output: OutputFormat,
}

#[derive(Debug, Args)]
struct AuthArgs {
    #[command(subcommand)]
    command: AuthCommand,
}

#[derive(Debug, Subcommand)]
enum AuthCommand {
    Login {
        #[arg(long)]
        api_key: Option<String>,
        #[arg(long)]
        client_id: Option<String>,
        #[arg(long)]
        client_secret: Option<String>,
        #[arg(long)]
        token_url: Option<String>,
    },
    Logout,
    Whoami(OutputArgs),
}

#[derive(Debug, Args)]
struct OrgsArgs {
    #[command(subcommand)]
    command: OrgsCommand,
}

#[derive(Debug, Subcommand)]
enum OrgsCommand {
    List(OutputArgs),
    Create {
        #[arg(long)]
        name: String,
        #[arg(long)]
        display_name: Option<String>,
        #[arg(long)]
        owner_id: Option<String>,
        #[arg(long, default_value = "PRIVATE")]
        visibility: String,
        #[command(flatten)]
        output: OutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
    Inspect {
        org_id: String,
        #[command(flatten)]
        output: JsonOutputArgs,
    },
    Switch {
        org_id: String,
    },
    Current,
}

#[derive(Debug, Clone, Args)]
struct JsonOutputArgs {
    #[arg(short, long, value_enum, default_value_t = OutputFormat::Json)]
    output: OutputFormat,
}

#[derive(Debug, Clone, Args)]
struct ListArgs {
    #[arg(short, long, value_enum, default_value_t = OutputFormat::Table)]
    output: OutputFormat,
    #[arg(long, default_value = "50")]
    limit: String,
}

#[derive(Debug, Args)]
struct CredentialsArgs {
    #[command(subcommand)]
    command: CredentialsCommand,
}

#[derive(Debug, Subcommand)]
enum CredentialsCommand {
    List {
        #[command(flatten)]
        list: ListArgs,
        #[arg(long)]
        org: bool,
        #[arg(long)]
        status: Option<String>,
    },
    Inspect {
        credential_id: String,
        #[arg(long)]
        org: bool,
        #[command(flatten)]
        output: JsonOutputArgs,
    },
    Revoke {
        credential_id: String,
        #[arg(long)]
        reason: Option<String>,
        #[arg(long)]
        immediate: bool,
        #[arg(long)]
        dry_run: bool,
    },
    Issue {
        #[arg(long)]
        credential_template_id: String,
        #[arg(long)]
        flow_execution_id: String,
        #[arg(long)]
        subject_claims: String,
        #[arg(long)]
        holder_identifier: Option<String>,
        #[command(flatten)]
        output: JsonOutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
    Verify {
        #[arg(long)]
        credential: String,
        #[command(flatten)]
        output: JsonOutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
}

#[derive(Debug, Args)]
struct ApplicationsArgs {
    #[command(subcommand)]
    command: ApplicationsCommand,
}

#[derive(Debug, Subcommand)]
enum ApplicationsCommand {
    List {
        #[command(flatten)]
        list: ListArgs,
        #[arg(long)]
        org: bool,
        #[arg(long)]
        status: Option<String>,
    },
    Inspect {
        application_id: String,
        #[arg(long)]
        org: bool,
        #[command(flatten)]
        output: JsonOutputArgs,
    },
    Apply {
        application_template_id: Option<String>,
        #[arg(long, default_value = "{}")]
        form_data: String,
        #[arg(long, default_value = "{}")]
        integration_context: String,
        #[command(flatten)]
        output: OutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
    Submit {
        application_id: String,
        #[arg(long)]
        dry_run: bool,
    },
    Withdraw {
        application_id: String,
        #[arg(long)]
        reason: Option<String>,
        #[arg(long)]
        dry_run: bool,
    },
    Claim {
        application_id: String,
        #[command(flatten)]
        output: OutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
    Approve {
        application_id: String,
        #[arg(long)]
        notes: Option<String>,
        #[arg(long)]
        dry_run: bool,
    },
    Reject {
        application_id: String,
        #[arg(long)]
        reason: String,
        #[arg(long)]
        notes: Option<String>,
        #[arg(long)]
        dry_run: bool,
    },
    #[command(name = "request-info")]
    RequestInfo {
        application_id: String,
        #[arg(long)]
        message: String,
        #[arg(long, num_args = 1..)]
        missing: Vec<String>,
        #[arg(long)]
        deadline: Option<String>,
        #[arg(long)]
        dry_run: bool,
    },
    Issue {
        application_id: String,
        #[command(flatten)]
        output: OutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
}

#[derive(Debug, Args)]
struct VerifyArgs {
    #[command(subcommand)]
    command: VerifyCommand,
}

#[derive(Debug, Subcommand)]
enum VerifyCommand {
    Start {
        #[arg(long)]
        policy: Option<String>,
        #[arg(long)]
        trust_profile: Option<String>,
        #[command(flatten)]
        output: OutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
    Status {
        session_id: String,
        #[command(flatten)]
        output: JsonOutputArgs,
    },
    Submit {
        session_id: String,
        #[arg(long)]
        presentation: String,
        #[command(flatten)]
        output: JsonOutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
    Evaluate {
        #[arg(long)]
        credential: String,
        #[arg(long)]
        policy: Option<String>,
        #[arg(long)]
        trust_profile: Option<String>,
        #[command(flatten)]
        output: JsonOutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
    Sessions(#[command(flatten)] ListArgs),
    Inspect {
        session_id: String,
        #[command(flatten)]
        output: JsonOutputArgs,
    },
}

#[derive(Debug, Args)]
struct FlowsArgs {
    #[command(subcommand)]
    command: FlowsCommand,
}

#[derive(Debug, Subcommand)]
enum FlowsCommand {
    List(#[command(flatten)] ListArgs),
    Inspect {
        flow_id: String,
        #[command(flatten)]
        output: JsonOutputArgs,
    },
    Create {
        #[arg(long)]
        name: String,
        #[arg(long)]
        flow_type: String,
        #[arg(long)]
        credential_template_id: String,
        #[arg(long, default_value = "auto")]
        approval_strategy: String,
        #[arg(long)]
        description: Option<String>,
        #[command(flatten)]
        output: JsonOutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
    Execute {
        flow_id: String,
        #[arg(long)]
        context_data: Option<String>,
        #[command(flatten)]
        output: JsonOutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
    Approve {
        flow_id: String,
        execution_id: String,
        #[arg(long)]
        comment: Option<String>,
        #[command(flatten)]
        output: JsonOutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
}

#[derive(Debug, Args)]
struct TemplatesArgs {
    #[command(subcommand)]
    command: TemplatesCommand,
}

#[derive(Debug, Subcommand)]
enum TemplatesCommand {
    List(OutputArgs),
    Inspect {
        template_id: String,
        #[command(flatten)]
        output: JsonOutputArgs,
    },
}

#[derive(Debug, Args)]
struct CredentialTemplatesArgs {
    #[command(subcommand)]
    command: CredentialTemplatesCommand,
}

#[derive(Debug, Subcommand)]
enum CredentialTemplatesCommand {
    List(#[command(flatten)] ListArgs),
    Inspect {
        template_id: String,
        #[command(flatten)]
        output: JsonOutputArgs,
    },
    Create {
        #[arg(long)]
        name: String,
        #[arg(long)]
        credential_type: String,
        #[arg(long)]
        compliance_profile_id: String,
        #[arg(long)]
        trust_profile_id: String,
        #[arg(long, default_value = "SD_JWT_VC")]
        format: String,
        #[arg(long)]
        vct: Option<String>,
        #[arg(long)]
        claims: Option<String>,
        #[arg(long, default_value = "key_vault")]
        key_access_mode: String,
        #[arg(long, default_value = "ES256")]
        issuer_algorithm: String,
        #[arg(long)]
        issuer_did: Option<String>,
        #[arg(long, default_value = "selective_disclosure")]
        privacy_posture: String,
        #[command(flatten)]
        output: JsonOutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
    Publish {
        template_id: String,
        #[arg(long)]
        force: bool,
        #[command(flatten)]
        output: JsonOutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
}

#[derive(Debug, Args)]
struct ComplianceArgs {
    #[command(subcommand)]
    command: ComplianceCommand,
}

#[derive(Debug, Subcommand)]
enum ComplianceCommand {
    List(#[command(flatten)] ListArgs),
    Inspect {
        profile_id: String,
        #[command(flatten)]
        output: JsonOutputArgs,
    },
    Create {
        #[arg(long)]
        name: String,
        #[arg(long)]
        compliance_code: String,
        #[arg(long, default_value = "SD_JWT_VC")]
        credential_format: String,
        #[arg(long, default_value = "OID4VCI")]
        issuance_protocol: String,
        #[arg(long, default_value = "OID4VP")]
        presentation_protocol: String,
        #[arg(long)]
        revocation_mechanism: Option<String>,
        #[command(flatten)]
        output: JsonOutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
}

#[derive(Debug, Args)]
struct TrustArgs {
    #[command(subcommand)]
    command: TrustCommand,
}

#[derive(Debug, Subcommand)]
enum TrustCommand {
    List(#[command(flatten)] ListArgs),
    Inspect {
        profile_id: String,
        #[command(flatten)]
        output: JsonOutputArgs,
    },
    Create {
        #[arg(long)]
        name: String,
        #[arg(long, default_value = "standard")]
        profile_type: String,
        #[arg(long)]
        allowed_algorithms: Option<String>,
        #[arg(long)]
        supported_formats: Option<String>,
        #[arg(long, default_value = "software")]
        key_storage: String,
        #[command(flatten)]
        output: JsonOutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
}

#[derive(Debug, Args)]
struct ConfigArgs {
    #[command(subcommand)]
    command: ConfigCommand,
}

#[derive(Debug, Subcommand)]
enum ConfigCommand {
    Show(OutputArgs),
    Set { key: String, value: String },
}

#[derive(Debug, Args)]
struct InitArgs {
    #[arg(long)]
    api_url: Option<String>,
    #[arg(long)]
    api_key: Option<String>,
}

#[derive(Debug, Args)]
struct TestArgs {
    #[command(subcommand)]
    command: TestCommand,
}

#[derive(Debug, Subcommand)]
enum TestCommand {
    E2e {
        #[arg(long)]
        application_template: Option<String>,
        #[arg(long)]
        credential_template: Option<String>,
        #[arg(long)]
        policy: Option<String>,
        #[arg(long, default_value = "full")]
        scenario: String,
        #[command(flatten)]
        output: OutputArgs,
        #[arg(long)]
        dry_run: bool,
    },
    Health(OutputArgs),
}

pub async fn run(cli: Cli) -> Result<()> {
    let global_output = cli.global_output;
    match cli.command {
        Command::Auth(args) => run_auth(args, global_output).await,
        Command::Health(mut args) => {
            apply_global(&mut args.output, global_output);
            run_health(args.output).await
        }
        Command::Orgs(args) => run_orgs(args, global_output).await,
        Command::Credentials(args) => run_credentials(args, global_output).await,
        Command::Applications(args) => run_applications(args, global_output).await,
        Command::Verify(args) => run_verify(args, global_output).await,
        Command::Flows(args) => run_flows(args, global_output).await,
        Command::Templates(args) => run_templates(args, global_output).await,
        Command::CredentialTemplates(args) => run_credential_templates(args, global_output).await,
        Command::Compliance(args) => run_compliance(args, global_output).await,
        Command::Trust(args) => run_trust(args, global_output).await,
        Command::Config(args) => run_config(args, global_output),
        Command::Init(args) => run_init(args).await,
        Command::Test(args) => run_test(args, global_output).await,
        Command::Completion { shell } => run_completion(&shell),
        Command::License(args) => license::run(args, global_output).await,
    }
}

pub fn exit_code(error: &anyhow::Error) -> i32 {
    error
        .downcast_ref::<CliExit>()
        .map_or(1, |error| error.code)
}

pub fn should_print_error(error: &anyhow::Error) -> bool {
    error
        .downcast_ref::<CliExit>()
        .is_none_or(|error| error.print)
}

#[derive(Debug, thiserror::Error)]
#[error("{message}")]
struct CliExit {
    code: i32,
    message: String,
    print: bool,
}

fn usage_error(message: impl Into<String>) -> anyhow::Error {
    CliExit {
        code: 2,
        message: message.into(),
        print: true,
    }
    .into()
}

fn silent_failure() -> anyhow::Error {
    CliExit {
        code: 1,
        message: String::new(),
        print: false,
    }
    .into()
}

fn apply_global(output: &mut OutputFormat, global: Option<OutputFormat>) {
    if let Some(global) = global {
        *output = global;
    }
}

fn encode(value: &str) -> String {
    byte_serialize(value.as_bytes()).collect()
}

fn require_org(config: &Config) -> Result<&str> {
    config
        .organization_id
        .as_deref()
        .context("No active organization. Run: marty orgs switch <id>")
}

fn list_from<'a>(data: &'a Value, keys: &[&str]) -> &'a [Value] {
    if let Some(items) = data.as_array() {
        return items;
    }
    keys.iter()
        .find_map(|key| data.get(*key).and_then(Value::as_array).map(Vec::as_slice))
        .unwrap_or(&[])
}

fn headers(credentials: &Credentials) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    if let Ok(api_key) = std::env::var("MARTY_API_KEY")
        && !api_key.is_empty()
    {
        headers.insert("X-API-Key", HeaderValue::from_str(&api_key)?);
        return Ok(headers);
    }
    match credentials.credential_type.as_deref() {
        Some("api_key") if credentials.api_key.is_some() => {
            headers.insert(
                "X-API-Key",
                HeaderValue::from_str(credentials.api_key.as_deref().unwrap_or_default())?,
            );
        }
        Some("oauth2") if credentials.access_token.is_some() => {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!(
                    "Bearer {}",
                    credentials.access_token.as_deref().unwrap_or_default()
                ))?,
            );
        }
        Some("session") if credentials.session_id.is_some() => {
            headers.insert(
                COOKIE,
                HeaderValue::from_str(&format!(
                    "sessionId={}",
                    credentials.session_id.as_deref().unwrap_or_default()
                ))?,
            );
        }
        _ => {}
    }
    Ok(headers)
}

fn client() -> Result<ApiClient> {
    let config = load_config()?;
    ApiClient::new(&config.api_url, headers(&load_credentials()?)?).map_err(Into::into)
}

fn json_object(entries: impl IntoIterator<Item = (&'static str, Option<Value>)>) -> Value {
    Value::Object(
        entries
            .into_iter()
            .filter_map(|(key, value)| value.map(|value| (key.to_owned(), value)))
            .collect(),
    )
}

fn date(value: Option<&str>) -> String {
    value
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Local).format("%x").to_string())
        .unwrap_or_default()
}

// Command handlers are kept below so argument definitions and behavior remain reviewable together.

async fn run_auth(args: AuthArgs, global: Option<OutputFormat>) -> Result<()> {
    match args.command {
        AuthCommand::Login {
            api_key: Some(api_key),
            ..
        } => {
            save_credentials(&Credentials {
                credential_type: Some("api_key".to_owned()),
                api_key: Some(api_key),
                saved_at: Some(
                    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                ),
                ..Credentials::default()
            })?;
            println!("Logged in with API key.");
        }
        AuthCommand::Login {
            client_id: Some(client_id),
            client_secret: Some(client_secret),
            token_url,
            ..
        } => {
            login_oauth(&client_id, &client_secret, token_url.as_deref()).await?;
            println!("Logged in with client credentials.");
        }
        AuthCommand::Login { .. } => {
            if !std::io::stdin().is_terminal() {
                return Err(usage_error(
                    "Provide --api-key or both --client-id and --client-secret.",
                ));
            }
            let method = Select::new()
                .with_prompt("How would you like to authenticate?")
                .items(["API Key", "Client Credentials (OAuth2)"])
                .default(0)
                .interact()?;
            if method == 0 {
                let api_key: String = Password::new().with_prompt("API Key").interact()?;
                if api_key.is_empty() {
                    return Err(usage_error("API key cannot be empty."));
                }
                save_credentials(&Credentials {
                    credential_type: Some("api_key".to_owned()),
                    api_key: Some(api_key),
                    saved_at: Some(
                        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    ),
                    ..Credentials::default()
                })?;
                println!("Logged in with API key.");
            } else {
                let client_id: String = Input::new().with_prompt("Client ID").interact_text()?;
                let client_secret: String =
                    Password::new().with_prompt("Client Secret").interact()?;
                let token_url: String = Input::new()
                    .with_prompt("Token URL (leave blank for default)")
                    .allow_empty(true)
                    .interact_text()?;
                if client_id.is_empty() || client_secret.is_empty() {
                    return Err(usage_error("Client ID and secret are required."));
                }
                login_oauth(
                    &client_id,
                    &client_secret,
                    (!token_url.is_empty()).then_some(token_url.as_str()),
                )
                .await?;
                println!("Logged in with client credentials.");
            }
        }
        AuthCommand::Logout => {
            clear_credentials()?;
            println!("Logged out.");
        }
        AuthCommand::Whoami(mut output) => {
            apply_global(&mut output.output, global);
            let credentials = load_credentials()?;
            let info = match credentials.credential_type.as_deref() {
                Some("api_key") => {
                    let key = credentials.api_key.unwrap_or_default();
                    let masked = if key.is_empty() {
                        "(none)".to_owned()
                    } else {
                        format!(
                            "{}…{}",
                            &key[..key.len().min(8)],
                            &key[key.len().saturating_sub(4)..]
                        )
                    };
                    Some(json!({"type": "api_key", "key": masked, "savedAt": credentials.saved_at}))
                }
                Some("oauth2") => {
                    let expired = credentials
                        .expires_at
                        .as_deref()
                        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                        .is_some_and(|value| value < chrono::Utc::now());
                    Some(
                        json!({"type": "oauth2", "expiresAt": credentials.expires_at, "savedAt": credentials.saved_at, "expired": expired}),
                    )
                }
                _ => None,
            };
            if let Some(info) = info {
                print_value(&info, output.output)?;
            } else {
                println!("Not logged in. Run: marty auth login");
            }
        }
    }
    Ok(())
}

async fn run_health(output: OutputFormat) -> Result<()> {
    let data = client()?.get("/health").await?;
    if output.is_json() {
        print_value(&data, output)?;
    } else {
        let overall = data
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        println!("Platform: {} {overall}\n", status_symbol(overall));
        if let Some(services) = data.get("services").and_then(Value::as_object) {
            let rows: Vec<Value> = services.iter().map(|(name, info)| {
                let status = info.as_str().or_else(|| info.get("status").and_then(Value::as_str)).unwrap_or("unknown");
                json!({"service": name, "status": format!("{} {status}", status_symbol(status))})
            }).collect();
            print_table(&rows, &[("service", "SERVICE"), ("status", "STATUS")]);
        }
    }
    if matches!(
        data.get("status").and_then(Value::as_str),
        Some("unhealthy" | "down" | "error")
    ) {
        return Err(silent_failure());
    }
    Ok(())
}

async fn login_oauth(client_id: &str, client_secret: &str, token_url: Option<&str>) -> Result<()> {
    let endpoint = token_url.map_or_else(
        || {
            format!(
                "{}/auth/realms/marty/protocol/openid-connect/token",
                load_config().map_or_else(
                    |_| "http://localhost:8000".to_owned(),
                    |value| value.api_url,
                )
            )
        },
        ToOwned::to_owned,
    );
    let response = reqwest::Client::new()
        .post(&endpoint)
        .form(&[
            ("grant_type", "client_credentials"),
            ("client_id", client_id),
            ("client_secret", client_secret),
        ])
        .send()
        .await
        .context("token request failed")?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_else(|_| status.to_string());
        bail!("Token request failed ({}): {text}", status.as_u16());
    }
    let data: Value = response
        .json()
        .await
        .context("token response was not valid JSON")?;
    let expires_at = data
        .get("expires_in")
        .and_then(Value::as_i64)
        .and_then(|seconds| {
            chrono::Utc::now().checked_add_signed(chrono::Duration::seconds(seconds))
        })
        .map(|value| value.to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    save_credentials(&Credentials {
        credential_type: Some("oauth2".to_owned()),
        access_token: data
            .get("access_token")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        refresh_token: data
            .get("refresh_token")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        expires_at,
        saved_at: Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
        ..Credentials::default()
    })?;
    Ok(())
}

fn status_symbol(status: &str) -> &'static str {
    match status.to_ascii_lowercase().as_str() {
        "healthy" | "up" | "ok" => "●",
        "degraded" | "warning" => "◐",
        "unhealthy" | "down" | "error" => "○",
        _ => "?",
    }
}

async fn run_orgs(args: OrgsArgs, global: Option<OutputFormat>) -> Result<()> {
    match args.command {
        OrgsCommand::List(mut output) => {
            apply_global(&mut output.output, global);
            let data = client()?.get("/v1/organizations").await?;
            let list = list_from(&data, &["organizations"]);
            if output.output.is_json() {
                print_value(&Value::Array(list.to_vec()), output.output)?;
            } else {
                let active = load_config()?.organization_id;
                let rows = list.iter().map(|org| json!({"active": if org.get("id").and_then(Value::as_str) == active.as_deref() {"*"} else {""}, "id": org["id"], "name": org["name"], "role": org.get("role").unwrap_or(&Value::Null)})).collect::<Vec<_>>();
                print_table(
                    &rows,
                    &[
                        ("active", " "),
                        ("id", "ID"),
                        ("name", "NAME"),
                        ("role", "ROLE"),
                    ],
                );
            }
        }
        OrgsCommand::Create {
            name,
            display_name,
            owner_id,
            visibility,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let body = json_object([
                ("name", Some(json!(name))),
                (
                    "display_name",
                    Some(json!(display_name.unwrap_or_else(|| name.clone()))),
                ),
                ("owner_id", owner_id.map(Value::String)),
                ("visibility", Some(json!(visibility))),
            ]);
            if !dry_run(is_dry, "POST /v1/organizations", Some(&body))? {
                print_value(
                    &client()?.post("/v1/organizations", &body).await?,
                    output.output,
                )?;
            }
        }
        OrgsCommand::Inspect { org_id, mut output } => {
            apply_global(&mut output.output, global);
            print_value(
                &client()?
                    .get(&format!("/v1/organizations/{}", encode(&org_id)))
                    .await?,
                output.output,
            )?;
        }
        OrgsCommand::Switch { org_id } => {
            save_config(|config| config.organization_id = Some(org_id.clone()))?;
            println!("Active organization set to: {org_id}");
        }
        OrgsCommand::Current => {
            println!(
                "{}",
                load_config()?.organization_id.unwrap_or_else(|| {
                    "No active organization. Run: marty orgs switch <id>".to_owned()
                })
            );
        }
    }
    Ok(())
}

async fn run_templates(args: TemplatesArgs, global: Option<OutputFormat>) -> Result<()> {
    match args.command {
        TemplatesCommand::List(mut output) => {
            apply_global(&mut output.output, global);
            let config = load_config()?;
            let data = client()?
                .get(&format!(
                    "/v1/application-templates?organization_id={}",
                    encode(require_org(&config)?)
                ))
                .await?;
            let list = list_from(&data, &["templates"]);
            if output.output.is_json() {
                print_value(&Value::Array(list.to_vec()), output.output)?;
            } else {
                print_table(
                    &rows(
                        list,
                        &[
                            ("id", &["id"]),
                            ("name", &["name"]),
                            ("type", &["credential_type", "type"]),
                            ("status", &["status"]),
                        ],
                    ),
                    &[
                        ("id", "ID"),
                        ("name", "NAME"),
                        ("type", "TYPE"),
                        ("status", "STATUS"),
                    ],
                );
            }
        }
        TemplatesCommand::Inspect {
            template_id,
            mut output,
        } => {
            apply_global(&mut output.output, global);
            print_value(
                &client()?
                    .get(&format!(
                        "/v1/application-templates/{}",
                        encode(&template_id)
                    ))
                    .await?,
                output.output,
            )?;
        }
    }
    Ok(())
}

fn rows(items: &[Value], columns: &[(&str, &[&str])]) -> Vec<Value> {
    items
        .iter()
        .map(|item| {
            Value::Object(
                columns
                    .iter()
                    .map(|(target, sources)| {
                        let value = sources
                            .iter()
                            .find_map(|source| item.get(*source).filter(|value| !value.is_null()))
                            .cloned()
                            .unwrap_or(Value::String(String::new()));
                        ((*target).to_owned(), value)
                    })
                    .collect(),
            )
        })
        .collect()
}

async fn run_credentials(args: CredentialsArgs, global: Option<OutputFormat>) -> Result<()> {
    match args.command {
        CredentialsCommand::List {
            mut list,
            org,
            status,
        } => {
            apply_global(&mut list.output, global);
            let config = load_config()?;
            let mut params = vec![("limit", list.limit)];
            if let Some(status) = status {
                params.push(("status", status));
            }
            if org {
                params.push(("organization_id", require_org(&config)?.to_owned()));
            }
            let path = if org {
                "/v1/issued-credentials"
            } else {
                "/v1/issued-credentials/mine"
            };
            let data = client()?.get(&format!("{path}?{}", query(params))).await?;
            let items = list_from(&data, &["items"]);
            if list.output.is_json() {
                print_value(&Value::Array(items.to_vec()), list.output)?;
            } else {
                let display = items.iter().map(|item| json!({"id": item["id"], "type": item.get("credential_type").or_else(|| item.get("type")).unwrap_or(&Value::Null), "status": item.get("status").unwrap_or(&Value::Null), "issued": date(item.get("issued_at").and_then(Value::as_str))})).collect::<Vec<_>>();
                print_table(
                    &display,
                    &[
                        ("id", "ID"),
                        ("type", "TYPE"),
                        ("status", "STATUS"),
                        ("issued", "ISSUED"),
                    ],
                );
            }
        }
        CredentialsCommand::Inspect {
            credential_id,
            org,
            mut output,
        } => {
            apply_global(&mut output.output, global);
            let data = if org {
                client()?
                    .get(&format!(
                        "/v1/issued-credentials/{}",
                        encode(&credential_id)
                    ))
                    .await?
            } else {
                let inventory = client()?
                    .get("/v1/issued-credentials/mine?limit=500")
                    .await?;
                list_from(&inventory, &["items"])
                    .iter()
                    .find(|item| item.get("id").and_then(Value::as_str) == Some(&credential_id))
                    .cloned()
                    .with_context(|| {
                        format!("Credential {credential_id} was not found in your inventory")
                    })?
            };
            print_value(&data, output.output)?;
        }
        CredentialsCommand::Revoke {
            credential_id,
            reason,
            immediate,
            dry_run: is_dry,
        } => {
            let body = json_object([
                ("reason", reason.map(Value::String)),
                ("immediate", immediate.then_some(Value::Bool(true))),
            ]);
            let display_path = format!("/v1/issued-credentials/{credential_id}/revoke");
            if !dry_run(is_dry, &format!("POST {display_path}"), Some(&body))? {
                client()?
                    .post(
                        &format!("/v1/issued-credentials/{}/revoke", encode(&credential_id)),
                        &body,
                    )
                    .await?;
                println!("Credential {credential_id} revoked.");
            }
        }
        CredentialsCommand::Issue {
            credential_template_id,
            flow_execution_id,
            subject_claims,
            holder_identifier,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let body = json_object([
                (
                    "credential_template_id",
                    Some(json!(credential_template_id)),
                ),
                ("flow_execution_id", Some(json!(flow_execution_id))),
                (
                    "subject_claims",
                    Some(parse_json(&subject_claims, "--subject-claims")?),
                ),
                ("holder_identifier", holder_identifier.map(Value::String)),
            ]);
            if !dry_run(is_dry, "POST /v1/credentials/issue", Some(&body))? {
                print_value(
                    &client()?.post("/v1/credentials/issue", &body).await?,
                    output.output,
                )?;
            }
        }
        CredentialsCommand::Verify {
            credential,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let body = json!({"credential": credential});
            if !dry_run(is_dry, "POST /v1/credentials/verify", Some(&body))? {
                print_value(
                    &client()?.post("/v1/credentials/verify", &body).await?,
                    output.output,
                )?;
            }
        }
    }
    Ok(())
}

fn org_applicants(config: &Config) -> Result<String> {
    Ok(format!(
        "/v1/organizations/{}/applicants",
        encode(require_org(config)?)
    ))
}

async fn reviewer_action(api: &ApiClient, base: &str, action: &str, body: &Value) -> Result<Value> {
    api.post(&format!("{base}/lock"), &json!({})).await?;
    let result = api.post(&format!("{base}/{action}"), body).await;
    let unlock = api.delete(&format!("{base}/lock")).await;
    match (result, unlock) {
        (Ok(value), Ok(_)) => Ok(value),
        (Err(error), _) | (Ok(_), Err(error)) => Err(error.into()),
    }
}

fn offer_uri(value: &Value) -> Option<&str> {
    value
        .get("credential_offer_uri")
        .or_else(|| value.get("offer_url"))
        .and_then(Value::as_str)
}

async fn run_applications(args: ApplicationsArgs, global: Option<OutputFormat>) -> Result<()> {
    const MINE: &str = "/v1/me/applications";
    match args.command {
        ApplicationsCommand::List {
            mut list,
            org,
            status,
        } => {
            apply_global(&mut list.output, global);
            let config = load_config()?;
            let path = if org {
                org_applicants(&config)?
            } else {
                MINE.to_owned()
            };
            let mut params = vec![("limit", list.limit)];
            if org && let Some(status) = &status {
                params.push(("status", status.clone()));
            }
            let data = client()?.get(&format!("{path}?{}", query(params))).await?;
            let mut items = list_from(&data, &["items"]).to_vec();
            if !org && let Some(status) = status {
                items.retain(|item| {
                    item.get("status")
                        .and_then(Value::as_str)
                        .is_some_and(|value| value.eq_ignore_ascii_case(&status))
                });
            }
            if list.output.is_json() {
                print_value(&Value::Array(items), list.output)?;
            } else {
                let display = items.iter().map(|item| json!({"id": item["id"], "template": item.get("application_template_id").or_else(|| item.get("credential_template_id")).unwrap_or(&Value::Null), "status": item.get("status").unwrap_or(&Value::Null), "claim": item.get("claim_state").unwrap_or(&Value::Null), "created": date(item.get("created_at").and_then(Value::as_str))})).collect::<Vec<_>>();
                print_table(
                    &display,
                    &[
                        ("id", "ID"),
                        ("template", "TEMPLATE"),
                        ("status", "STATUS"),
                        ("claim", "CLAIM"),
                        ("created", "CREATED"),
                    ],
                );
            }
        }
        ApplicationsCommand::Inspect {
            application_id,
            org,
            mut output,
        } => {
            apply_global(&mut output.output, global);
            let config = load_config()?;
            let path = if org {
                format!("{}/{}", org_applicants(&config)?, encode(&application_id))
            } else {
                format!("{MINE}/{}", encode(&application_id))
            };
            print_value(&client()?.get(&path).await?, output.output)?;
        }
        ApplicationsCommand::Apply {
            application_template_id,
            form_data,
            integration_context,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let config = load_config()?;
            let org_id = require_org(&config)?.to_owned();
            let template_id = if let Some(template_id) = application_template_id {
                template_id
            } else {
                if !std::io::stdin().is_terminal() {
                    bail!("applicationTemplateId argument is required in non-interactive mode");
                }
                let data = client()?
                    .get(&format!(
                        "/v1/application-templates?organization_id={}",
                        encode(&org_id)
                    ))
                    .await?;
                let templates = list_from(&data, &["items", "templates"]);
                if templates.is_empty() {
                    bail!("No active Application Templates found for this organization.");
                }
                let labels = templates
                    .iter()
                    .map(|template| {
                        format!(
                            "{} - {}",
                            template
                                .get("name")
                                .or_else(|| template.get("id"))
                                .map(scalar)
                                .unwrap_or_default(),
                            template
                                .get("description")
                                .and_then(Value::as_str)
                                .unwrap_or("(no description)")
                        )
                    })
                    .collect::<Vec<_>>();
                let selected = Select::new()
                    .with_prompt("Select an Application Template:")
                    .items(&labels)
                    .default(0)
                    .interact()?;
                templates[selected]
                    .get("id")
                    .and_then(Value::as_str)
                    .context("selected application template has no id")?
                    .to_owned()
            };
            let body = json!({"organization_id": org_id, "application_template_id": template_id, "form_data": parse_object(&form_data, "--form-data")?, "integration_context": parse_object(&integration_context, "--integration-context")?});
            if dry_run(is_dry, "POST /v1/me/applications", Some(&body))? {
                return Ok(());
            }
            let api = client()?;
            let current = api.get(&format!("{MINE}?limit=100")).await?;
            let existing = list_from(&current, &["items"])
                .iter()
                .find(|item| {
                    item.get("application_template_id").and_then(Value::as_str)
                        == Some(&template_id)
                        && !matches!(
                            item.get("status")
                                .and_then(Value::as_str)
                                .map(str::to_ascii_lowercase)
                                .as_deref(),
                            Some("rejected" | "withdrawn" | "expired")
                        )
                })
                .cloned();
            let (id, application, was_existing) = if let Some(existing) = existing {
                let id = existing
                    .get("id")
                    .and_then(Value::as_str)
                    .context("application response has no id")?
                    .to_owned();
                let result = if existing
                    .get("claim_state")
                    .and_then(Value::as_str)
                    .is_some_and(|value| value.eq_ignore_ascii_case("OFFER_READY"))
                {
                    api.post(&format!("{MINE}/{}/claim", encode(&id)), &json!({}))
                        .await?
                } else {
                    existing
                };
                (id, result, true)
            } else {
                let created = api.post(MINE, &body).await?;
                let id = created
                    .get("id")
                    .and_then(Value::as_str)
                    .context("application response has no id")?
                    .to_owned();
                let submitted = api
                    .post(&format!("{MINE}/{}/submit", encode(&id)), &json!({}))
                    .await?;
                let result = if submitted
                    .get("claim_state")
                    .and_then(Value::as_str)
                    .is_some_and(|value| value.eq_ignore_ascii_case("OFFER_READY"))
                {
                    api.post(&format!("{MINE}/{}/claim", encode(&id)), &json!({}))
                        .await?
                } else {
                    submitted
                };
                (id, result, false)
            };
            if output.output.is_json() {
                print_value(
                    &json_object([
                        ("applicationId", Some(json!(id))),
                        ("application", Some(application)),
                        (
                            "existingApplication",
                            was_existing.then_some(Value::Bool(true)),
                        ),
                    ]),
                    output.output,
                )?;
            } else {
                println!(
                    "{}: {id}",
                    if was_existing {
                        "Existing application found"
                    } else {
                        "Application submitted"
                    }
                );
                if let Some(uri) = offer_uri(&application) {
                    println!("Credential offer: {uri}");
                }
                if application.get("claim_state").and_then(Value::as_str) == Some("BLOCKED") {
                    println!(
                        "{}",
                        application
                            .pointer("/claim_blocker/message")
                            .and_then(Value::as_str)
                            .unwrap_or("Credential issuance is waiting on the issuer.")
                    );
                }
            }
        }
        ApplicationsCommand::Submit {
            application_id,
            dry_run: is_dry,
        } => {
            let path = format!("{MINE}/{}/submit", encode(&application_id));
            if !dry_run(is_dry, &format!("POST {path}"), Some(&json!({})))? {
                let value = client()?.post(&path, &json!({})).await?;
                println!(
                    "Application {application_id} submitted with status {}.",
                    scalar(&value["status"])
                );
            }
        }
        ApplicationsCommand::Withdraw {
            application_id,
            reason,
            dry_run: is_dry,
        } => {
            let path = format!("{MINE}/{}/withdraw", encode(&application_id));
            let body = json_object([("reason", reason.map(Value::String))]);
            if !dry_run(is_dry, &format!("POST {path}"), Some(&body))? {
                client()?.post(&path, &body).await?;
                println!("Application {application_id} withdrawn.");
            }
        }
        ApplicationsCommand::Claim {
            application_id,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let path = format!("{MINE}/{}/claim", encode(&application_id));
            if !dry_run(is_dry, &format!("POST {path}"), Some(&json!({})))? {
                let value = client()?.post(&path, &json!({})).await?;
                if output.output.is_json() {
                    print_value(&value, output.output)?;
                } else if let Some(uri) = offer_uri(&value) {
                    println!("Credential offer: {uri}");
                } else {
                    println!("Application {application_id} is not offer-ready.");
                }
            }
        }
        ApplicationsCommand::Approve {
            application_id,
            notes,
            dry_run: is_dry,
        } => {
            review(
                &application_id,
                "approve",
                json_object([("notes", notes.map(Value::String))]),
                is_dry,
                "approved",
            )
            .await?;
        }
        ApplicationsCommand::Reject {
            application_id,
            reason,
            notes,
            dry_run: is_dry,
        } => {
            review(
                &application_id,
                "reject",
                json_object([
                    ("reason", Some(Value::String(reason))),
                    ("notes", notes.map(Value::String)),
                ]),
                is_dry,
                "rejected",
            )
            .await?;
        }
        ApplicationsCommand::RequestInfo {
            application_id,
            message,
            missing,
            deadline,
            dry_run: is_dry,
        } => {
            review(
                &application_id,
                "request-information",
                json_object([
                    ("message", Some(Value::String(message))),
                    ("missing_items", Some(json!(missing))),
                    ("deadline", deadline.map(Value::String)),
                ]),
                is_dry,
                "information-requested",
            )
            .await?;
        }
        ApplicationsCommand::Issue {
            application_id,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let path = format!(
                "{}/{}/issue",
                org_applicants(&load_config()?)?,
                encode(&application_id)
            );
            if !dry_run(is_dry, &format!("POST {path}"), Some(&json!({})))? {
                let value = client()?.post(&path, &json!({})).await?;
                if output.output.is_json() {
                    print_value(&value, output.output)?;
                } else {
                    println!("Credential issuance initiated for application {application_id}.");
                    if let Some(uri) = offer_uri(&value) {
                        println!("Offer URI: {uri}");
                    }
                }
            }
        }
    }
    Ok(())
}

async fn review(
    application_id: &str,
    action: &str,
    body: Value,
    is_dry: bool,
    outcome: &str,
) -> Result<()> {
    let base = format!(
        "{}/{}",
        org_applicants(&load_config()?)?,
        encode(application_id)
    );
    let path = format!("{base}/{action}");
    if dry_run(is_dry, &format!("POST {path}"), Some(&body))? {
        return Ok(());
    }
    reviewer_action(&client()?, &base, action, &body).await?;
    match outcome {
        "approved" => println!("Application {application_id} approved."),
        "rejected" => println!("Application {application_id} rejected."),
        _ => println!("Information requested for application {application_id}."),
    }
    Ok(())
}

async fn run_verify(args: VerifyArgs, global: Option<OutputFormat>) -> Result<()> {
    match args.command {
        VerifyCommand::Start {
            policy,
            trust_profile,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let config = load_config()?;
            let policy = if let Some(policy) = policy {
                policy
            } else {
                if !std::io::stdin().is_terminal() {
                    bail!("--policy is required in non-interactive mode");
                }
                let org = require_org(&config)?;
                let data = client()?
                    .get(&format!(
                        "/v1/presentation-policies?organization_id={}",
                        encode(org)
                    ))
                    .await?;
                let policies = list_from(&data, &["policies"]);
                if policies.is_empty() {
                    bail!("No presentation policies found. Create one first.");
                }
                let labels = policies
                    .iter()
                    .map(|policy| {
                        format!(
                            "{} — {}",
                            policy
                                .get("name")
                                .or_else(|| policy.get("id"))
                                .map(scalar)
                                .unwrap_or_default(),
                            policy
                                .get("description")
                                .and_then(Value::as_str)
                                .unwrap_or("(no description)")
                        )
                    })
                    .collect::<Vec<_>>();
                let selected = Select::new()
                    .with_prompt("Select a presentation policy:")
                    .items(&labels)
                    .default(0)
                    .interact()?;
                policies[selected]
                    .get("id")
                    .and_then(Value::as_str)
                    .context("selected presentation policy has no id")?
                    .to_owned()
            };
            let body = json_object([
                ("presentation_policy_id", Some(Value::String(policy))),
                ("trust_profile_id", trust_profile.map(Value::String)),
                ("organization_id", config.organization_id.map(Value::String)),
            ]);
            if !dry_run(is_dry, "POST /v1/flows/verify", Some(&body))? {
                let value = client()?.post("/v1/flows/verify", &body).await?;
                if output.output.is_json() {
                    print_value(&value, output.output)?;
                } else {
                    println!(
                        "Session: {}",
                        value
                            .get("id")
                            .or_else(|| value.get("session_id"))
                            .map(scalar)
                            .unwrap_or_default()
                    );
                    if let Some(uri) = value.get("request_uri").and_then(Value::as_str) {
                        println!("Request URI: {uri}");
                    }
                    if let Some(status) = value.get("status").and_then(Value::as_str) {
                        println!("Status: {status}");
                    }
                }
            }
        }
        VerifyCommand::Status {
            session_id,
            mut output,
        } => {
            apply_global(&mut output.output, global);
            print_value(
                &client()?
                    .get(&format!("/v1/flows/instances/{}", encode(&session_id)))
                    .await?,
                output.output,
            )?;
        }
        VerifyCommand::Submit {
            session_id,
            presentation,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let body = parse_json(&presentation, "--presentation")?;
            let display = format!("/v1/flows/instances/{session_id}/submit");
            if !dry_run(is_dry, &format!("POST {display}"), Some(&body))? {
                print_value(
                    &client()?
                        .post(
                            &format!("/v1/flows/instances/{}/submit", encode(&session_id)),
                            &body,
                        )
                        .await?,
                    output.output,
                )?;
            }
        }
        VerifyCommand::Evaluate {
            credential,
            policy,
            trust_profile,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let token = serde_json::from_str::<Value>(&credential)
                .map_or(credential, |value| value.to_string());
            let body = json_object([
                ("vp_token", Some(Value::String(token))),
                ("trust_profile_id", trust_profile.map(Value::String)),
            ]);
            let path = policy.map_or_else(
                || "/v1/presentation-policies/evaluate".to_owned(),
                |id| format!("/v1/presentation-policies/{}/evaluate", encode(&id)),
            );
            if !dry_run(is_dry, &format!("POST {path}"), Some(&body))? {
                print_value(&client()?.post(&path, &body).await?, output.output)?;
            }
        }
        VerifyCommand::Sessions(mut list) => {
            apply_global(&mut list.output, global);
            let config = load_config()?;
            let data = client()?
                .get(&format!(
                    "/v1/flows/instances?{}",
                    query([
                        ("organization_id", require_org(&config)?.to_owned()),
                        ("limit", list.limit)
                    ])
                ))
                .await?;
            let items = list_from(&data, &["sessions"]);
            if list.output.is_json() {
                print_value(&Value::Array(items.to_vec()), list.output)?;
            } else {
                let display = items.iter().map(|item| json!({"id": item.get("id").or_else(|| item.get("session_id")).unwrap_or(&Value::Null), "status": item.get("status").unwrap_or(&Value::Null), "policy": item.get("presentation_policy_id").unwrap_or(&Value::Null), "created": date(item.get("created_at").and_then(Value::as_str))})).collect::<Vec<_>>();
                print_table(
                    &display,
                    &[
                        ("id", "ID"),
                        ("status", "STATUS"),
                        ("policy", "POLICY"),
                        ("created", "CREATED"),
                    ],
                );
            }
        }
        VerifyCommand::Inspect {
            session_id,
            mut output,
        } => {
            apply_global(&mut output.output, global);
            print_value(
                &client()?
                    .get(&format!(
                        "/v1/flows/instances/{}/result",
                        encode(&session_id)
                    ))
                    .await?,
                output.output,
            )?;
        }
    }
    Ok(())
}

async fn run_flows(args: FlowsArgs, global: Option<OutputFormat>) -> Result<()> {
    match args.command {
        FlowsCommand::List(mut list) => {
            apply_global(&mut list.output, global);
            let config = load_config()?;
            let mut params = vec![("limit", list.limit)];
            if let Some(org) = config.organization_id {
                params.push(("organization_id", org));
            }
            let data = client()?
                .get(&format!("/v1/flows/definitions?{}", query(params)))
                .await?;
            let items = list_from(&data, &["flows"]);
            if list.output.is_json() {
                print_value(&Value::Array(items.to_vec()), list.output)?;
            } else {
                print_table(
                    &rows(
                        items,
                        &[
                            ("id", &["id"]),
                            ("name", &["name"]),
                            ("type", &["flow_type", "type"]),
                            ("status", &["status"]),
                        ],
                    ),
                    &[
                        ("id", "ID"),
                        ("name", "NAME"),
                        ("type", "TYPE"),
                        ("status", "STATUS"),
                    ],
                );
            }
        }
        FlowsCommand::Inspect {
            flow_id,
            mut output,
        } => {
            apply_global(&mut output.output, global);
            print_value(
                &client()?
                    .get(&format!("/v1/flows/definitions/{}", encode(&flow_id)))
                    .await?,
                output.output,
            )?;
        }
        FlowsCommand::Create {
            name,
            flow_type,
            credential_template_id,
            approval_strategy,
            description,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let config = load_config()?;
            let body = json_object([
                ("organization_id", Some(json!(require_org(&config)?))),
                ("name", Some(json!(name))),
                ("flow_type", Some(json!(flow_type))),
                (
                    "credential_template_id",
                    Some(json!(credential_template_id)),
                ),
                ("approval_strategy", Some(json!(approval_strategy))),
                ("description", description.map(Value::String)),
            ]);
            if !dry_run(is_dry, "POST /v1/flows/definitions", Some(&body))? {
                print_value(
                    &client()?.post("/v1/flows/definitions", &body).await?,
                    output.output,
                )?;
            }
        }
        FlowsCommand::Execute {
            flow_id,
            context_data,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let body = json_object([
                ("flow_definition_id", Some(json!(flow_id))),
                (
                    "initial_context",
                    context_data
                        .map(|value| parse_json(&value, "--context-data"))
                        .transpose()?,
                ),
            ]);
            if !dry_run(is_dry, "POST /v1/flows/instances", Some(&body))? {
                print_value(
                    &client()?.post("/v1/flows/instances", &body).await?,
                    output.output,
                )?;
            }
        }
        FlowsCommand::Approve {
            flow_id: _,
            execution_id,
            comment,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let body = json!({"step_result": "success", "data": comment.map_or_else(|| json!({}), |comment| json!({"comment": comment}))});
            let display = format!("/v1/flows/instances/{execution_id}/advance");
            if !dry_run(is_dry, &format!("POST {display}"), Some(&body))? {
                print_value(
                    &client()?
                        .post(
                            &format!("/v1/flows/instances/{}/advance", encode(&execution_id)),
                            &body,
                        )
                        .await?,
                    output.output,
                )?;
            }
        }
    }
    Ok(())
}

async fn run_credential_templates(
    args: CredentialTemplatesArgs,
    global: Option<OutputFormat>,
) -> Result<()> {
    match args.command {
        CredentialTemplatesCommand::List(mut list) => {
            apply_global(&mut list.output, global);
            let config = load_config()?;
            let mut params = vec![("limit", list.limit)];
            if let Some(org) = config.organization_id {
                params.push(("organization_id", org));
            }
            let data = client()?
                .get(&format!("/v1/credential-templates?{}", query(params)))
                .await?;
            let items = list_from(&data, &["templates"]);
            if list.output.is_json() {
                print_value(&Value::Array(items.to_vec()), list.output)?;
            } else {
                print_table(
                    &rows(
                        items,
                        &[
                            ("id", &["id"]),
                            ("name", &["name"]),
                            ("type", &["credential_type"]),
                            ("format", &["credential_payload_format"]),
                            ("status", &["status"]),
                        ],
                    ),
                    &[
                        ("id", "ID"),
                        ("name", "NAME"),
                        ("type", "TYPE"),
                        ("format", "FORMAT"),
                        ("status", "STATUS"),
                    ],
                );
            }
        }
        CredentialTemplatesCommand::Inspect {
            template_id,
            mut output,
        } => {
            apply_global(&mut output.output, global);
            print_value(
                &client()?
                    .get(&format!(
                        "/v1/credential-templates/{}",
                        encode(&template_id)
                    ))
                    .await?,
                output.output,
            )?;
        }
        CredentialTemplatesCommand::Create {
            name,
            credential_type,
            compliance_profile_id,
            trust_profile_id,
            format,
            vct,
            claims,
            key_access_mode,
            issuer_algorithm,
            issuer_did,
            privacy_posture,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let config = load_config()?;
            let body = json_object([
                ("organization_id", Some(json!(require_org(&config)?))),
                ("name", Some(json!(name))),
                ("credential_type", Some(json!(credential_type))),
                ("compliance_profile_id", Some(json!(compliance_profile_id))),
                ("trust_profile_id", Some(json!(trust_profile_id))),
                ("credential_payload_format", Some(json!(format))),
                ("key_access_mode", Some(json!(key_access_mode))),
                ("issuer_algorithm", Some(json!(issuer_algorithm))),
                ("privacy_posture", Some(json!(privacy_posture))),
                ("vct", vct.map(Value::String)),
                ("issuer_did", issuer_did.map(Value::String)),
                (
                    "claims",
                    claims
                        .map(|value| parse_json(&value, "--claims"))
                        .transpose()?,
                ),
            ]);
            if !dry_run(is_dry, "POST /v1/credential-templates", Some(&body))? {
                print_value(
                    &client()?.post("/v1/credential-templates", &body).await?,
                    output.output,
                )?;
            }
        }
        CredentialTemplatesCommand::Publish {
            template_id,
            force,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let display = format!("/v1/credential-templates/{template_id}/publish");
            if !dry_run(is_dry, &format!("POST {display}"), Some(&json!({})))? {
                let query = if force { "force=true" } else { "" };
                print_value(
                    &client()?
                        .post(
                            &format!(
                                "/v1/credential-templates/{}/publish?{query}",
                                encode(&template_id)
                            ),
                            &json!({}),
                        )
                        .await?,
                    output.output,
                )?;
            }
        }
    }
    Ok(())
}

async fn run_compliance(args: ComplianceArgs, global: Option<OutputFormat>) -> Result<()> {
    match args.command {
        ComplianceCommand::List(mut list) => {
            apply_global(&mut list.output, global);
            let config = load_config()?;
            let mut params = vec![("limit", list.limit)];
            if let Some(org) = config.organization_id {
                params.push(("organization_id", org));
            }
            let data = client()?
                .get(&format!("/v1/compliance-profiles?{}", query(params)))
                .await?;
            let items = list_from(&data, &["profiles"]);
            if list.output.is_json() {
                print_value(&Value::Array(items.to_vec()), list.output)?;
            } else {
                print_table(
                    &rows(
                        items,
                        &[
                            ("id", &["id"]),
                            ("name", &["name"]),
                            ("code", &["compliance_code"]),
                            ("format", &["credential_format"]),
                        ],
                    ),
                    &[
                        ("id", "ID"),
                        ("name", "NAME"),
                        ("code", "CODE"),
                        ("format", "FORMAT"),
                    ],
                );
            }
        }
        ComplianceCommand::Inspect {
            profile_id,
            mut output,
        } => {
            apply_global(&mut output.output, global);
            print_value(
                &client()?
                    .get(&format!("/v1/compliance-profiles/{}", encode(&profile_id)))
                    .await?,
                output.output,
            )?;
        }
        ComplianceCommand::Create {
            name,
            compliance_code,
            credential_format,
            issuance_protocol,
            presentation_protocol,
            revocation_mechanism,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let config = load_config()?;
            let body = json_object([
                ("organization_id", Some(json!(require_org(&config)?))),
                ("name", Some(json!(name))),
                ("compliance_code", Some(json!(compliance_code))),
                ("credential_format", Some(json!(credential_format))),
                ("issuance_protocol", Some(json!(issuance_protocol))),
                ("presentation_protocol", Some(json!(presentation_protocol))),
                (
                    "revocation_mechanism",
                    revocation_mechanism.map(Value::String),
                ),
            ]);
            if !dry_run(is_dry, "POST /v1/compliance-profiles", Some(&body))? {
                print_value(
                    &client()?.post("/v1/compliance-profiles", &body).await?,
                    output.output,
                )?;
            }
        }
    }
    Ok(())
}

async fn run_trust(args: TrustArgs, global: Option<OutputFormat>) -> Result<()> {
    match args.command {
        TrustCommand::List(mut list) => {
            apply_global(&mut list.output, global);
            let config = load_config()?;
            let mut params = vec![("limit", list.limit)];
            if let Some(org) = config.organization_id {
                params.push(("organization_id", org));
            }
            let data = client()?
                .get(&format!("/v1/trust-profiles?{}", query(params)))
                .await?;
            let items = list_from(&data, &["profiles"]);
            if list.output.is_json() {
                print_value(&Value::Array(items.to_vec()), list.output)?;
            } else {
                print_table(
                    &rows(
                        items,
                        &[
                            ("id", &["id"]),
                            ("name", &["name"]),
                            ("type", &["profile_type"]),
                        ],
                    ),
                    &[("id", "ID"), ("name", "NAME"), ("type", "TYPE")],
                );
            }
        }
        TrustCommand::Inspect {
            profile_id,
            mut output,
        } => {
            apply_global(&mut output.output, global);
            print_value(
                &client()?
                    .get(&format!("/v1/trust-profiles/{}", encode(&profile_id)))
                    .await?,
                output.output,
            )?;
        }
        TrustCommand::Create {
            name,
            profile_type,
            allowed_algorithms,
            supported_formats,
            key_storage,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let config = load_config()?;
            let body = json_object([
                ("organization_id", Some(json!(require_org(&config)?))),
                ("name", Some(json!(name))),
                ("profile_type", Some(json!(profile_type))),
                ("key_storage", Some(json!(key_storage))),
                (
                    "allowed_algorithms",
                    allowed_algorithms
                        .map(|value| parse_json(&value, "--allowed-algorithms"))
                        .transpose()?,
                ),
                (
                    "supported_formats",
                    supported_formats
                        .map(|value| parse_json(&value, "--supported-formats"))
                        .transpose()?,
                ),
            ]);
            if !dry_run(is_dry, "POST /v1/trust-profiles", Some(&body))? {
                print_value(
                    &client()?.post("/v1/trust-profiles", &body).await?,
                    output.output,
                )?;
            }
        }
    }
    Ok(())
}

fn run_config(args: ConfigArgs, global: Option<OutputFormat>) -> Result<()> {
    match args.command {
        ConfigCommand::Show(mut output) => {
            apply_global(&mut output.output, global);
            let config = load_config()?;
            print_value(
                &json!({"apiUrl": config.api_url, "organizationId": config.organization_id, "configDir": config_dir()?}),
                output.output,
            )?;
        }
        ConfigCommand::Set { key, value } => {
            match key.as_str() {
                "apiUrl" => save_config(|config| config.api_url.clone_from(&value))?,
                "organizationId" => {
                    save_config(|config| config.organization_id = Some(value.clone()))?;
                }
                _ => {
                    return Err(usage_error(format!(
                        "Unknown key: {key}. Allowed: apiUrl, organizationId"
                    )));
                }
            }
            println!("{key} = {value}");
        }
    }
    Ok(())
}

async fn run_init(args: InitArgs) -> Result<()> {
    if !std::io::stdin().is_terminal() && args.api_key.is_none() {
        bail!("marty init requires an interactive terminal, or pass --api-key");
    }
    println!("\n  Welcome to the Marty CLI setup wizard.");
    println!("  Config will be stored in {}/\n", config_dir()?.display());
    let current = load_config()?;
    let api_url = if let Some(api_url) = args.api_url {
        api_url
    } else {
        Input::new()
            .with_prompt("API base URL")
            .default(current.api_url)
            .interact_text()?
    };
    save_config(|config| config.api_url.clone_from(&api_url))?;
    println!("  API URL: {api_url}");
    if let Some(api_key) = args.api_key {
        save_credentials(&Credentials {
            credential_type: Some("api_key".to_owned()),
            api_key: Some(api_key),
            saved_at: Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
            ..Credentials::default()
        })?;
        println!("  Authenticated with API key.");
    } else if !logged_in()? {
        let method = Select::new()
            .with_prompt("Authentication method:")
            .items([
                "API Key",
                "Client Credentials (OAuth2)",
                "Skip (configure later)",
            ])
            .default(0)
            .interact()?;
        match method {
            0 => {
                let api_key = Password::new().with_prompt("API Key").interact()?;
                if !api_key.is_empty() {
                    save_credentials(&Credentials {
                        credential_type: Some("api_key".to_owned()),
                        api_key: Some(api_key),
                        saved_at: Some(
                            chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                        ),
                        ..Credentials::default()
                    })?;
                    println!("  Authenticated with API key.");
                }
            }
            1 => {
                let client_id: String = Input::new().with_prompt("Client ID").interact_text()?;
                let client_secret = Password::new().with_prompt("Client Secret").interact()?;
                let token_url: String = Input::new()
                    .with_prompt("Token URL (leave blank for default)")
                    .allow_empty(true)
                    .interact_text()?;
                if !client_id.is_empty() && !client_secret.is_empty() {
                    login_oauth(
                        &client_id,
                        &client_secret,
                        (!token_url.is_empty()).then_some(token_url.as_str()),
                    )
                    .await?;
                    println!("  Authenticated with client credentials.");
                }
            }
            _ => println!("  Skipping authentication. Run \"marty auth login\" later."),
        }
    } else {
        let credentials = load_credentials()?;
        println!(
            "  Already authenticated ({}).",
            credentials.credential_type.as_deref().unwrap_or("unknown")
        );
    }
    if logged_in()? {
        match client()?.get("/v1/organizations").await {
            Ok(data) => {
                let orgs = list_from(&data, &["organizations"]);
                if orgs.is_empty() {
                    println!("  No organizations found.");
                } else if orgs.len() == 1 {
                    let id = orgs[0]["id"]
                        .as_str()
                        .context("organization has no id")?
                        .to_owned();
                    save_config(|config| config.organization_id = Some(id))?;
                    println!(
                        "  Organization: {}",
                        orgs[0]
                            .get("name")
                            .map_or_else(|| scalar(&orgs[0]["id"]), scalar)
                    );
                } else {
                    let labels = orgs
                        .iter()
                        .map(|org| {
                            let name = org
                                .get("name")
                                .or_else(|| org.get("id"))
                                .map(scalar)
                                .unwrap_or_default();
                            org.get("role")
                                .and_then(Value::as_str)
                                .map_or(name.clone(), |role| format!("{name} ({role})"))
                        })
                        .collect::<Vec<_>>();
                    let selected = Select::new()
                        .with_prompt("Select your organization:")
                        .items(&labels)
                        .default(0)
                        .interact()?;
                    let id = orgs[selected]
                        .get("id")
                        .and_then(Value::as_str)
                        .context("selected organization has no id")?
                        .to_owned();
                    save_config(|config| config.organization_id = Some(id))?;
                    println!(
                        "  Organization: {}",
                        orgs[selected]
                            .get("name")
                            .map_or_else(|| scalar(&orgs[selected]["id"]), scalar)
                    );
                }
            }
            Err(_) => println!("  Could not fetch organizations (check API URL and auth)."),
        }
    }
    println!(
        "\n  Setup complete! Try:\n    marty health\n    marty credentials list\n    marty applications list\n"
    );
    Ok(())
}

fn logged_in() -> Result<bool> {
    let credentials = load_credentials()?;
    Ok(credentials.credential_type.is_some()
        && (credentials.api_key.is_some()
            || credentials.access_token.is_some()
            || credentials.session_id.is_some()))
}

#[derive(Debug)]
struct Step {
    name: String,
    status: &'static str,
    elapsed: u128,
    result: Option<Value>,
    error: Option<String>,
}

async fn step<F, Fut>(
    steps: &mut Vec<Step>,
    name: &str,
    is_dry: bool,
    operation: F,
) -> Result<Value>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<Value>>,
{
    let started = std::time::Instant::now();
    if !is_dry {
        println!("  ▸ {name}…");
    }
    let result = if is_dry {
        Ok(json!({"_dryRun": true}))
    } else {
        operation().await
    };
    let elapsed = started.elapsed().as_millis();
    match result {
        Ok(value) => {
            if !is_dry {
                println!("    ✓ {name} ({elapsed}ms)");
            }
            steps.push(Step {
                name: name.to_owned(),
                status: "pass",
                elapsed,
                result: Some(value.clone()),
                error: None,
            });
            Ok(value)
        }
        Err(error) => {
            let message = error.to_string();
            println!("    ✗ {name} — {message} ({elapsed}ms)");
            steps.push(Step {
                name: name.to_owned(),
                status: "fail",
                elapsed,
                result: None,
                error: Some(message),
            });
            Err(error)
        }
    }
}

fn report(steps: &[Step], started: std::time::Instant, format: OutputFormat) -> Result<bool> {
    let failed = steps.iter().filter(|step| step.status == "fail").count();
    let passed = steps.len() - failed;
    let elapsed = started.elapsed().as_millis();
    if format.is_json() {
        let entries = steps
            .iter()
            .map(|step| {
                json_object([
                    ("name", Some(json!(step.name))),
                    ("status", Some(json!(step.status))),
                    ("elapsed", Some(json!(step.elapsed))),
                    ("result", step.result.clone()),
                    ("error", step.error.clone().map(Value::String)),
                ])
            })
            .collect::<Vec<_>>();
        print_value(
            &json!({"summary": {"total": steps.len(), "passed": passed, "failed": failed, "elapsed": elapsed}, "steps": entries}),
            format,
        )?;
    } else {
        println!(
            "\nResults: {passed} passed, {failed} failed, {} total ({elapsed}ms)",
            steps.len()
        );
        for item in steps.iter().filter(|step| step.status == "fail") {
            println!(
                "  FAIL: {} — {}",
                item.name,
                item.error.as_deref().unwrap_or_default()
            );
        }
    }
    Ok(failed == 0)
}

async fn run_test(args: TestArgs, global: Option<OutputFormat>) -> Result<()> {
    match args.command {
        TestCommand::Health(mut output) => {
            apply_global(&mut output.output, global);
            let started = std::time::Instant::now();
            let mut steps = Vec::new();
            if !output.output.is_json() {
                println!("Running health check test\n");
            }
            let api = client()?;
            let _ = step(&mut steps, "Health check", false, || async {
                let data = api.get("/health").await?;
                if !matches!(
                    data.get("status").and_then(Value::as_str),
                    Some("healthy" | "ok")
                ) {
                    bail!("Unexpected health status: {}", scalar(&data["status"]));
                }
                Ok(data)
            })
            .await;
            if !report(&steps, started, output.output)? {
                bail!("health test failed");
            }
        }
        TestCommand::E2e {
            application_template,
            credential_template,
            policy,
            scenario,
            mut output,
            dry_run: is_dry,
        } => {
            apply_global(&mut output.output, global);
            let started = std::time::Instant::now();
            let mut steps = Vec::new();
            let quiet = output.output.is_json();
            if !quiet {
                if is_dry {
                    println!("[dry-run] Would run scenario: {scenario}");
                }
                println!("Running e2e scenario: {scenario}\n");
            }
            if !is_dry && !logged_in()? {
                bail!("Not authenticated. Run: marty auth login --api-key <key>");
            }
            let api = client()?;
            let config = load_config()?;
            let result: Result<()> = async {
                if matches!(scenario.as_str(), "health" | "full") { step(&mut steps, "Health check", is_dry, || async { let data = api.get("/health").await?; if !matches!(data.get("status").and_then(Value::as_str), Some("healthy" | "ok")) { bail!("Unexpected health status: {}", scalar(&data["status"])); } Ok(data) }).await?; }
                if matches!(scenario.as_str(), "issuance" | "full") {
                    let template = application_template.as_deref().context("--application-template is required for issuance scenario")?; let body = json!({"organization_id": config.organization_id, "application_template_id": template, "form_data": {}, "integration_context": {"source": "marty-cli-e2e"}});
                    let created = step(&mut steps, "Create application", is_dry, || async { Ok(api.post("/v1/me/applications", &body).await?) }).await?; let id = created.get("id").and_then(Value::as_str).unwrap_or_default().to_owned();
                    let submitted = step(&mut steps, "Submit application", is_dry, || async { Ok(api.post(&format!("/v1/me/applications/{}/submit", encode(&id)), &json!({})).await?) }).await?;
                    if submitted.get("claim_state").and_then(Value::as_str).is_some_and(|value| value.eq_ignore_ascii_case("OFFER_READY")) { step(&mut steps, "Claim credential offer", is_dry, || async { Ok(api.post(&format!("/v1/me/applications/{}/claim", encode(&id)), &json!({})).await?) }).await?; }
                }
                if matches!(scenario.as_str(), "verification" | "full") { let policy = policy.as_deref().context("--policy is required for verification scenario")?; let body = json_object([("presentation_policy_id", Some(json!(policy))), ("organization_id", config.organization_id.clone().map(Value::String))]); let session = step(&mut steps, "Start verification session", is_dry, || async { Ok(api.post("/v1/flows/verify", &body).await?) }).await?; let id = session.get("id").or_else(|| session.get("session_id")).and_then(Value::as_str).unwrap_or_default(); step(&mut steps, "Check session status", is_dry, || async { Ok(api.get(&format!("/v1/flows/instances/{}", encode(id))).await?) }).await?; }
                if matches!(scenario.as_str(), "wallet-interop" | "full") { let template = credential_template.as_deref().context("--credential-template is required for wallet-interop scenario")?; let org = config.organization_id.as_deref().unwrap_or_default(); let metadata = step(&mut steps, "Fetch issuer metadata", is_dry, || async { let data = api.get(&format!("/.well-known/openid-credential-issuer/org/{org}")).await?; if data.get("credential_issuer").is_none() || data.get("credential_configurations_supported").is_none() { bail!("Issuer metadata is incomplete"); } Ok(data) }).await?; let offer = step(&mut steps, "Create credential offer", is_dry, || async { Ok(api.post("/v1/issuance", &json!({"organization_id": org, "credential_template_id": template, "claims": {"given_name": "CLI-Interop", "family_name": "Test", "date_of_birth": "1990-01-01"}})).await?) }).await?; step(&mut steps, "Validate offer structure", is_dry, || async { let uri = offer.get("credential_offer_uri").and_then(Value::as_str).context("No credential_offer_uri in issuance response")?; if !uri.contains("credential_offer=") && !uri.contains("credential_offer_uri=") { bail!("Offer URI missing credential_offer or credential_offer_uri parameter"); } Ok(json!({"offer": uri})) }).await?; if metadata.get("nonce_endpoint").is_some() { step(&mut steps, "Validate nonce endpoint", is_dry, || async { let data = api.post("/v1/issuance/nonce", &json!({})).await?; if data.get("c_nonce").is_none() { bail!("Nonce response missing c_nonce"); } Ok(data) }).await?; } }
                if !matches!(scenario.as_str(), "health" | "issuance" | "verification" | "wallet-interop" | "full") { bail!("Unknown scenario: {scenario}"); }
                Ok(())
            }.await;
            let passed = report(&steps, started, output.output)?;
            if result.is_err() || !passed {
                bail!("e2e scenario failed");
            }
        }
    }
    Ok(())
}

fn run_completion(shell: &str) -> Result<()> {
    const COMMANDS: &str = "auth health orgs credentials applications verify flows templates credential-templates compliance trust config test init license completion";
    match shell {
        "bash" => println!(
            r#"# marty bash completion
_marty_completions() {{
  local cur="${{COMP_WORDS[COMP_CWORD]}}"
  if [[ ${{COMP_CWORD}} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "{COMMANDS}" -- "$cur") )
  else
    COMPREPLY=( $(compgen -W "--output --help --dry-run --version" -- "$cur") )
  fi
}}
complete -F _marty_completions marty"#
        ),
        "zsh" => println!(
            r"#compdef marty
_marty() {{
  local -a commands
  commands=({COMMANDS})
  _describe -t commands 'marty command' commands
}}
_marty"
        ),
        "fish" => println!(
            r#"# marty fish completion
set -l commands {COMMANDS}
complete -c marty -f
complete -c marty -n "not __fish_seen_subcommand_from $commands" -a "$commands"
complete -c marty -l output -s o -d "Output format" -a "table json json-compact""#
        ),
        _ => bail!("Unknown shell: {shell}. Supported: bash, zsh, fish"),
    }
    Ok(())
}

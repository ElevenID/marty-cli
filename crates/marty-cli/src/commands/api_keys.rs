use anyhow::Result;
use chrono::DateTime;
use clap::{Args, Subcommand};
use marty_api_client::query;
use serde_json::{Value, json};

use super::{JsonOutputArgs, apply_global, client, encode, json_object, require_org};
use crate::{
    config::load_config,
    output::{OutputFormat, dry_run, print_value},
};

#[derive(Debug, Args)]
pub(super) struct ApiKeysArgs {
    /// Organization to manage; defaults to the active organization.
    #[arg(long, global = true, value_parser = nonblank)]
    organization_id: Option<String>,
    #[command(subcommand)]
    command: ApiKeysCommand,
}

#[derive(Debug, Subcommand)]
enum ApiKeysCommand {
    /// List key metadata; secret values are not recoverable.
    List {
        #[arg(long, default_value_t = 100, value_parser = clap::value_parser!(u16).range(0..=500))]
        limit: u16,
        #[arg(long, default_value_t = 0)]
        offset: u32,
        #[command(flatten)]
        output: JsonOutputArgs,
    },
    /// Create a key. The secret is returned once in the output's key field.
    Create {
        #[arg(long, value_parser = nonblank)]
        name: String,
        /// Explicit scopes; repeat the flag or separate scopes with commas.
        #[arg(long = "scope", required = true, value_delimiter = ',', value_parser = nonblank)]
        scopes: Vec<String>,
        #[arg(long)]
        description: Option<String>,
        /// Future RFC 3339 expiry, checked against server time by the API.
        #[arg(long, value_parser = expiry)]
        expires_at: Option<String>,
        /// Create a test-prefixed key; does not select a sandbox deployment.
        #[arg(long)]
        is_test: bool,
        #[arg(long)]
        dry_run: bool,
        #[command(flatten)]
        output: JsonOutputArgs,
    },
    /// Revoke a key in the selected organization.
    Revoke {
        #[arg(value_parser = nonblank)]
        key_id: String,
        #[arg(long)]
        dry_run: bool,
        #[command(flatten)]
        output: JsonOutputArgs,
    },
}

fn nonblank(value: &str) -> std::result::Result<String, String> {
    if value.trim().is_empty() {
        Err("value must not be blank".into())
    } else {
        Ok(value.to_owned())
    }
}

fn expiry(value: &str) -> std::result::Result<String, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|_| value.to_owned())
        .map_err(|_| "expiry must be an RFC 3339 timestamp".into())
}

pub(super) async fn run(args: ApiKeysArgs, global: Option<OutputFormat>) -> Result<()> {
    let mut config = load_config()?;
    if let Some(organization_id) = args.organization_id {
        config.organization_id = Some(organization_id);
    }
    let organization = require_org(&config)?.to_owned();
    match args.command {
        ApiKeysCommand::List {
            limit,
            offset,
            mut output,
        } => {
            apply_global(&mut output.output, global);
            let endpoint = format!(
                "/v1/api-keys?{}",
                query([
                    ("organization_id", organization),
                    ("limit", limit.to_string()),
                    ("offset", offset.to_string()),
                ])
            );
            print_value(&client()?.get(&endpoint).await?, output.output)?;
        }
        ApiKeysCommand::Create {
            name,
            scopes,
            description,
            expires_at,
            is_test,
            dry_run: is_dry,
            mut output,
        } => {
            apply_global(&mut output.output, global);
            let endpoint = format!(
                "/v1/api-keys?{}",
                query([("organization_id", organization)])
            );
            let body = json_object([
                ("name", Some(json!(name))),
                ("scopes", Some(json!(scopes))),
                ("description", description.map(Value::String)),
                ("expires_at", expires_at.map(Value::String)),
                ("is_test", Some(json!(is_test))),
            ]);
            if !dry_run(is_dry, &format!("POST {endpoint}"), Some(&body))? {
                print_value(&client()?.post(&endpoint, &body).await?, output.output)?;
            }
        }
        ApiKeysCommand::Revoke {
            key_id,
            dry_run: is_dry,
            mut output,
        } => {
            apply_global(&mut output.output, global);
            let endpoint = format!(
                "/v1/api-keys/{}?{}",
                encode(&key_id),
                query([("organization_id", organization)])
            );
            if !dry_run(is_dry, &format!("DELETE {endpoint}"), None)? {
                print_value(&client()?.delete(&endpoint).await?, output.output)?;
            }
        }
    }
    Ok(())
}

use anyhow::{Result, bail};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum OutputFormat {
    Table,
    Json,
    JsonCompact,
}

impl OutputFormat {
    pub fn is_json(self) -> bool {
        matches!(self, Self::Json | Self::JsonCompact)
    }
}

pub fn print_value(value: &Value, format: OutputFormat) -> Result<()> {
    match format {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(value)?),
        OutputFormat::JsonCompact => println!("{}", serde_json::to_string(value)?),
        OutputFormat::Table => {
            if let Some(object) = value.as_object() {
                for (key, value) in object {
                    println!("{key}: {}", scalar(value));
                }
            } else {
                println!("{}", scalar(value));
            }
        }
    }
    Ok(())
}

pub fn print_table(rows: &[Value], columns: &[(&str, &str)]) {
    if rows.is_empty() {
        println!("(no results)");
        return;
    }
    let widths: Vec<usize> = columns
        .iter()
        .map(|(key, title)| {
            rows.iter()
                .map(|row| scalar(&row[*key]).chars().count())
                .max()
                .unwrap_or_default()
                .max(title.chars().count())
        })
        .collect();
    println!(
        "{}",
        columns
            .iter()
            .zip(&widths)
            .map(|((_, title), width)| format!(" {title:<width$} "))
            .collect::<Vec<_>>()
            .join("│")
    );
    println!(
        "{}",
        widths
            .iter()
            .map(|width| "─".repeat(width + 2))
            .collect::<Vec<_>>()
            .join("┼")
    );
    for row in rows {
        println!(
            "{}",
            columns
                .iter()
                .zip(&widths)
                .map(|((key, _), width)| format!(" {:<width$} ", scalar(&row[*key])))
                .collect::<Vec<_>>()
                .join("│")
        );
    }
}

pub fn dry_run(active: bool, action: &str, payload: Option<&Value>) -> Result<bool> {
    if !active {
        return Ok(false);
    }
    println!("[dry-run] {action}");
    if let Some(payload) = payload {
        println!("{}", serde_json::to_string_pretty(payload)?);
    }
    Ok(true)
}

pub fn parse_json(value: &str, option: &str) -> Result<Value> {
    serde_json::from_str(value).map_err(|_| anyhow::anyhow!("{option} must be valid JSON"))
}

pub fn parse_object(value: &str, option: &str) -> Result<Value> {
    let parsed = parse_json(value, option)?;
    if !parsed.is_object() {
        bail!("{option} must be a JSON object");
    }
    Ok(parsed)
}

pub fn scalar(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        value => value.to_string(),
    }
}

use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default = "default_api_url")]
    pub api_url: String,
    #[serde(default)]
    pub organization_id: Option<String>,
}

fn default_api_url() -> String {
    "http://localhost:8000".to_owned()
}

impl Default for Config {
    fn default() -> Self {
        Self {
            api_url: default_api_url(),
            organization_id: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    #[serde(rename = "type", default)]
    pub credential_type: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub saved_at: Option<String>,
}

pub fn config_dir() -> Result<PathBuf> {
    if let Some(directory) = env::var_os("MARTY_CONFIG_DIR") {
        return Ok(PathBuf::from(directory));
    }
    platform_home_dir()
        .or_else(dirs::home_dir)
        .map(|home| home.join(".marty"))
        .context("could not determine the current user's home directory")
}

#[cfg(windows)]
fn platform_home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE").map(PathBuf::from)
}

#[cfg(not(windows))]
fn platform_home_dir() -> Option<PathBuf> {
    env::var_os("HOME").map(PathBuf::from)
}

fn read_json<T: DeserializeOwned + Default>(path: &Path) -> T {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let parent = path.parent().context("configuration path has no parent")?;
    fs::create_dir_all(parent).with_context(|| format!("could not create {}", parent.display()))?;
    set_private_dir_permissions(parent)?;
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    let mut options = fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    set_private_file_options(&mut options);
    let mut file = options
        .open(path)
        .with_context(|| format!("could not write {}", path.display()))?;
    file.write_all(&bytes)?;
    Ok(())
}

pub fn load_config() -> Result<Config> {
    let path = config_dir()?.join("config.json");
    let mut config: Config = read_json(&path);
    if let Ok(value) = env::var("MARTY_API_URL")
        && !value.is_empty()
    {
        config.api_url = value;
    }
    if let Ok(value) = env::var("MARTY_ORG_ID")
        && !value.is_empty()
    {
        config.organization_id = Some(value);
    }
    Ok(config)
}

pub fn save_config(update: impl FnOnce(&mut Config)) -> Result<()> {
    let path = config_dir()?.join("config.json");
    let mut config: Config = read_json(&path);
    update(&mut config);
    write_json(&path, &config)
}

pub fn load_credentials() -> Result<Credentials> {
    Ok(read_json(&config_dir()?.join("credentials.json")))
}

pub fn save_credentials(credentials: &Credentials) -> Result<()> {
    write_json(&config_dir()?.join("credentials.json"), credentials)
}

pub fn clear_credentials() -> Result<()> {
    save_credentials(&Credentials::default())
}

#[cfg(unix)]
fn set_private_dir_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(not(unix))]
#[allow(clippy::unnecessary_wraps)]
fn set_private_dir_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file_options(options: &mut fs::OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
}

#[cfg(not(unix))]
fn set_private_file_options(_options: &mut fs::OpenOptions) {}

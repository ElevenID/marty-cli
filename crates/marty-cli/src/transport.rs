use anyhow::Result;
use marty_api_client::{ApiClient, ApiError};
use reqwest::header::HeaderMap;

pub(crate) const INITIALIZATION_CONTEXT: &str = "HTTP transport initialization failed; ensure the OS CA certificate store is installed and readable";

pub(crate) fn client(base_url: &str, headers: HeaderMap) -> Result<ApiClient> {
    ApiClient::new(base_url, headers).map_err(|error| {
        let initialization = matches!(&error, ApiError::Network(cause) if cause.is_builder());
        let error = anyhow::Error::new(error);
        if initialization {
            error.context(INITIALIZATION_CONTEXT)
        } else {
            error
        }
    })
}

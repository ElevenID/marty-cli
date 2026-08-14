//! Canonical native HTTP client for the Marty Identity Platform.

use std::time::Duration;

use reqwest::{Method, StatusCode, header::HeaderMap};
use serde::Serialize;
use serde_json::Value;
use thiserror::Error;
use tokio::time::sleep;
use url::Url;
use uuid::Uuid;

pub const MIP_VERSION: &str = "0.4.1";

const RETRYABLE_STATUSES: [StatusCode; 6] = [
    StatusCode::REQUEST_TIMEOUT,
    StatusCode::TOO_MANY_REQUESTS,
    StatusCode::INTERNAL_SERVER_ERROR,
    StatusCode::BAD_GATEWAY,
    StatusCode::SERVICE_UNAVAILABLE,
    StatusCode::GATEWAY_TIMEOUT,
];

#[derive(Debug, Clone)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
    pub backoff_multiplier: f64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_delay: Duration::from_secs(1),
            max_delay: Duration::from_secs(10),
            backoff_multiplier: 2.0,
        }
    }
}

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("Unable to connect to the Marty API: {0}")]
    Network(#[source] reqwest::Error),
    #[error("{message}")]
    Response {
        status: StatusCode,
        message: String,
        body: Value,
    },
    #[error("invalid API URL: {0}")]
    InvalidUrl(#[from] url::ParseError),
    #[error("failed to encode request body: {0}")]
    Encode(#[from] serde_json::Error),
}

impl ApiError {
    #[must_use]
    pub fn status(&self) -> Option<StatusCode> {
        match self {
            Self::Response { status, .. } => Some(*status),
            _ => None,
        }
    }

    #[must_use]
    pub fn body(&self) -> Option<&Value> {
        match self {
            Self::Response { body, .. } => Some(body),
            _ => None,
        }
    }

    #[must_use]
    pub fn code(&self) -> Option<&str> {
        self.body()?.get("error")?.get("code")?.as_str()
    }

    #[must_use]
    pub fn is_auth_error(&self) -> bool {
        self.status() == Some(StatusCode::UNAUTHORIZED)
            || self.code().is_some_and(|code| code.starts_with("AUTH."))
    }

    #[must_use]
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Network(_) => true,
            Self::Response { status, body, .. } => {
                RETRYABLE_STATUSES.contains(status)
                    || body
                        .pointer("/error/recovery_action")
                        .and_then(Value::as_str)
                        == Some("retry")
            }
            Self::InvalidUrl(_) | Self::Encode(_) => false,
        }
    }
}

#[derive(Clone)]
pub struct ApiClient {
    base_url: Url,
    client: reqwest::Client,
    default_headers: HeaderMap,
    retry_policy: RetryPolicy,
}

impl ApiClient {
    /// Creates a client with the supplied API origin and request headers.
    ///
    /// # Errors
    ///
    /// Returns [`ApiError::InvalidUrl`] when `base_url` is not a valid URL.
    pub fn new(base_url: &str, default_headers: HeaderMap) -> Result<Self, ApiError> {
        let base_url = Url::parse(&format!("{}/", base_url.trim_end_matches('/')))?;
        Ok(Self {
            base_url,
            client: reqwest::Client::new(),
            default_headers,
            retry_policy: RetryPolicy::default(),
        })
    }

    #[must_use]
    pub fn with_retry_policy(mut self, retry_policy: RetryPolicy) -> Self {
        self.retry_policy = retry_policy;
        self
    }

    /// Sends a GET request and decodes its JSON response.
    ///
    /// # Errors
    ///
    /// Returns an [`ApiError`] for transport, URL, or non-success response failures.
    pub async fn get(&self, endpoint: &str) -> Result<Value, ApiError> {
        self.request(Method::GET, endpoint, Option::<&Value>::None)
            .await
    }

    /// Sends a JSON POST request and decodes its JSON response.
    ///
    /// # Errors
    ///
    /// Returns an [`ApiError`] for encoding, transport, URL, or response failures.
    pub async fn post<T: Serialize + ?Sized>(
        &self,
        endpoint: &str,
        body: &T,
    ) -> Result<Value, ApiError> {
        self.request(Method::POST, endpoint, Some(body)).await
    }

    /// Sends a JSON PUT request and decodes its JSON response.
    ///
    /// # Errors
    ///
    /// Returns an [`ApiError`] for encoding, transport, URL, or response failures.
    pub async fn put<T: Serialize + ?Sized>(
        &self,
        endpoint: &str,
        body: &T,
    ) -> Result<Value, ApiError> {
        self.request(Method::PUT, endpoint, Some(body)).await
    }

    /// Sends a JSON PATCH request and decodes its JSON response.
    ///
    /// # Errors
    ///
    /// Returns an [`ApiError`] for encoding, transport, URL, or response failures.
    pub async fn patch<T: Serialize + ?Sized>(
        &self,
        endpoint: &str,
        body: &T,
    ) -> Result<Value, ApiError> {
        self.request(Method::PATCH, endpoint, Some(body)).await
    }

    /// Sends a DELETE request and decodes its JSON response.
    ///
    /// # Errors
    ///
    /// Returns an [`ApiError`] for transport, URL, or non-success response failures.
    pub async fn delete(&self, endpoint: &str) -> Result<Value, ApiError> {
        self.request(Method::DELETE, endpoint, Option::<&Value>::None)
            .await
    }

    async fn request<T: Serialize + ?Sized>(
        &self,
        method: Method,
        endpoint: &str,
        body: Option<&T>,
    ) -> Result<Value, ApiError> {
        let url = if endpoint.starts_with("http://") || endpoint.starts_with("https://") {
            Url::parse(endpoint)?
        } else {
            self.base_url.join(endpoint.trim_start_matches('/'))?
        };
        let encoded_body = body.map(serde_json::to_vec).transpose()?;
        let mut attempt = 0_u32;

        loop {
            let mut request = self
                .client
                .request(method.clone(), url.clone())
                .headers(self.default_headers.clone())
                .header("Accept", "application/json")
                .header("X-Request-ID", Uuid::new_v4().to_string())
                .header("X-MIP-Version", MIP_VERSION);
            if let Some(bytes) = &encoded_body {
                request = request
                    .header("Content-Type", "application/json")
                    .body(bytes.clone());
            }

            match request.send().await {
                Ok(response) => {
                    let status = response.status();
                    let status_text = status
                        .canonical_reason()
                        .unwrap_or("Request failed")
                        .to_owned();
                    let bytes = response.bytes().await.map_err(ApiError::Network)?;
                    let value = if bytes.is_empty() {
                        Value::Null
                    } else {
                        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
                    };

                    if status.is_success() {
                        return Ok(value);
                    }

                    let error = ApiError::Response {
                        status,
                        message: response_message(&value).unwrap_or(status_text),
                        body: value,
                    };
                    if method != Method::GET
                        || !error.is_retryable()
                        || attempt >= self.retry_policy.max_retries
                    {
                        return Err(error);
                    }
                }
                Err(error) => {
                    if method != Method::GET || attempt >= self.retry_policy.max_retries {
                        return Err(ApiError::Network(error));
                    }
                }
            }

            let multiplier = self
                .retry_policy
                .backoff_multiplier
                .powi(attempt.cast_signed());
            let jitter = rand::random_range(0.75..=1.25);
            let delay = self.retry_policy.base_delay.mul_f64(multiplier * jitter);
            sleep(delay.min(self.retry_policy.max_delay)).await;
            attempt += 1;
        }
    }

    pub async fn report_client_error(&self, payload: &Value) -> Option<Value> {
        self.post("/v1/notifications/client-errors", payload)
            .await
            .ok()
    }
}

fn response_message(body: &Value) -> Option<String> {
    body.pointer("/error/user_message")
        .or_else(|| body.pointer("/error/message"))
        .or_else(|| body.pointer("/error_description/message"))
        .or_else(|| body.get("message"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

#[must_use]
pub fn query(params: impl IntoIterator<Item = (impl Into<String>, impl Into<String>)>) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in params {
        serializer.append_pair(&key.into(), &value.into());
    }
    serializer.finish()
}

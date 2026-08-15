use gloo_timers::future::TimeoutFuture;
use js_sys::{Array, Error, Function, JSON, Object, Promise, Reflect};
use wasm_bindgen::{JsCast, JsValue, prelude::wasm_bindgen};
use wasm_bindgen_futures::JsFuture;
use web_sys::{Headers, Response, UrlSearchParams};

use crate::MIP_VERSION;

const RETRYABLE_STATUSES: [u16; 6] = [408, 429, 500, 502, 503, 504];

#[derive(Debug, Clone)]
struct BrowserRetryPolicy {
    max_retries: u32,
    base_delay_ms: f64,
    max_delay_ms: f64,
    backoff_multiplier: f64,
    retryable_statuses: Vec<u16>,
    retryable_errors: Vec<String>,
}

impl Default for BrowserRetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_delay_ms: 1_000.0,
            max_delay_ms: 10_000.0,
            backoff_multiplier: 2.0,
            retryable_statuses: RETRYABLE_STATUSES.to_vec(),
            retryable_errors: vec!["TypeError".to_owned(), "NetworkError".to_owned()],
        }
    }
}

impl BrowserRetryPolicy {
    fn from_js(value: &JsValue) -> Self {
        let defaults = Self::default();
        Self {
            max_retries: number_property(value, "maxRetries")
                .map_or(defaults.max_retries, nonnegative_u32),
            base_delay_ms: number_property(value, "baseDelay").unwrap_or(defaults.base_delay_ms),
            max_delay_ms: number_property(value, "maxDelay").unwrap_or(defaults.max_delay_ms),
            backoff_multiplier: number_property(value, "backoffMultiplier")
                .unwrap_or(defaults.backoff_multiplier),
            retryable_statuses: u16_array_property(value, "retryableStatuses")
                .unwrap_or(defaults.retryable_statuses),
            retryable_errors: string_array_property(value, "retryableErrors")
                .unwrap_or(defaults.retryable_errors),
        }
    }

    fn delay(&self, attempt: u32) -> u32 {
        let exponential = self.base_delay_ms * self.backoff_multiplier.powi(attempt.cast_signed());
        let capped = exponential.min(self.max_delay_ms);
        let jitter = capped * 0.25 * (js_sys::Math::random() * 2.0 - 1.0);
        nonnegative_u32((capped + jitter).round())
    }
}

#[wasm_bindgen(js_name = MartyApiClient)]
pub struct BrowserApiClient {
    base_url: String,
    request_options: Option<Function>,
}

#[wasm_bindgen(js_class = MartyApiClient)]
impl BrowserApiClient {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(base_url: String, request_options: Option<Function>) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            request_options,
        }
    }

    #[wasm_bindgen(js_name = fetchWithRetry)]
    pub async fn fetch_with_retry(
        &self,
        url: String,
        options: JsValue,
        retry_config: JsValue,
    ) -> Result<Response, JsValue> {
        let method = string_property(&options, "method")
            .unwrap_or_else(|| "GET".to_owned())
            .to_ascii_uppercase();
        let policy = if method == "GET" {
            BrowserRetryPolicy::from_js(&retry_config)
        } else {
            BrowserRetryPolicy {
                max_retries: 0,
                ..BrowserRetryPolicy::default()
            }
        };

        for attempt in 0..=policy.max_retries {
            match self.fetch_once(&url, &method, &options).await {
                Ok(response) if response.ok() => return Ok(response),
                Ok(response)
                    if method == "GET"
                        && attempt < policy.max_retries
                        && policy.retryable_statuses.contains(&response.status()) =>
                {
                    TimeoutFuture::new(policy.delay(attempt)).await;
                }
                Ok(response) => return Err(parse_error_response(response).await),
                Err(error)
                    if method == "GET"
                        && attempt < policy.max_retries
                        && is_retryable_transport(&error, &policy) =>
                {
                    TimeoutFuture::new(policy.delay(attempt)).await;
                }
                Err(error) => return Err(error),
            }
        }
        Err(Error::new("Request failed after retries").into())
    }

    #[wasm_bindgen(js_name = apiRequest)]
    pub async fn api_request(
        &self,
        endpoint: String,
        options: JsValue,
    ) -> Result<JsValue, JsValue> {
        let options = copy_object(&options);
        let url = self.url_with_params(&endpoint, &options)?;
        ensure_json_content_type(&options)?;
        let response = self
            .fetch_with_retry(url, options, JsValue::UNDEFINED)
            .await?;
        let content_type = response.headers().get("Content-Type")?;
        if content_type.is_none_or(|value| !value.contains("application/json")) {
            return Ok(JsValue::NULL);
        }
        JsFuture::from(response.json()?).await
    }

    pub async fn get(&self, endpoint: String, options: JsValue) -> Result<JsValue, JsValue> {
        let options = copy_object(&options);
        set_property(&options, "method", &JsValue::from_str("GET"))?;
        self.api_request(endpoint, options).await
    }

    pub async fn post(
        &self,
        endpoint: String,
        data: JsValue,
        options: JsValue,
    ) -> Result<JsValue, JsValue> {
        let options = copy_object(&options);
        set_json_body(&options, "POST", &data)?;
        self.api_request(endpoint, options).await
    }

    pub async fn put(
        &self,
        endpoint: String,
        data: JsValue,
        options: JsValue,
    ) -> Result<JsValue, JsValue> {
        let options = copy_object(&options);
        set_json_body(&options, "PUT", &data)?;
        self.api_request(endpoint, options).await
    }

    pub async fn patch(
        &self,
        endpoint: String,
        data: JsValue,
        options: JsValue,
    ) -> Result<JsValue, JsValue> {
        let options = copy_object(&options);
        set_json_body(&options, "PATCH", &data)?;
        self.api_request(endpoint, options).await
    }

    #[wasm_bindgen(js_name = delete)]
    pub async fn delete(&self, endpoint: String, options: JsValue) -> Result<JsValue, JsValue> {
        let options = copy_object(&options);
        set_property(&options, "method", &JsValue::from_str("DELETE"))?;
        self.api_request(endpoint, options).await
    }

    #[wasm_bindgen(js_name = reportClientError)]
    pub async fn report_client_error(&self, report: JsValue) -> JsValue {
        self.post(
            "/v1/notifications/client-errors".to_owned(),
            report,
            Object::new().into(),
        )
        .await
        .unwrap_or(JsValue::NULL)
    }
}

impl BrowserApiClient {
    async fn fetch_once(
        &self,
        url: &str,
        method: &str,
        options: &JsValue,
    ) -> Result<Response, JsValue> {
        let environment = self.request_options.as_ref().map_or_else(
            || Ok(Object::new().into()),
            |function| function.call0(&JsValue::NULL),
        )?;
        let headers = merged_headers(&environment, options)?;
        headers.set("X-Request-ID", &uuid::Uuid::new_v4().to_string())?;
        headers.set("X-MIP-Version", MIP_VERSION)?;

        let init = Object::new();
        if environment.is_object() {
            Object::assign(&init, &environment.unchecked_into::<Object>());
        }
        if options.is_object() {
            Object::assign(&init, &options.clone().unchecked_into::<Object>());
        }
        set_property(init.as_ref(), "method", &JsValue::from_str(method))?;
        set_property(init.as_ref(), "headers", headers.as_ref())?;
        Reflect::delete_property(init.as_ref(), &JsValue::from_str("params"))?;

        let global = js_sys::global();
        let fetch = Reflect::get(&global, &JsValue::from_str("fetch"))?
            .dyn_into::<Function>()
            .map_err(|_| Error::new("global fetch is unavailable"))?;
        let promise = fetch
            .call2(&global, &JsValue::from_str(url), init.as_ref())?
            .dyn_into::<Promise>()?;
        let response = JsFuture::from(promise).await?;
        response.dyn_into::<Response>()
    }

    fn url_with_params(&self, endpoint: &str, options: &JsValue) -> Result<String, JsValue> {
        let mut url = if endpoint.starts_with("http://") || endpoint.starts_with("https://") {
            endpoint.to_owned()
        } else {
            format!("{}{}", self.base_url, endpoint)
        };
        if let Some(params) = property(options, "params").filter(JsValue::is_object) {
            let params = params.unchecked_into::<Object>();
            let encoded =
                UrlSearchParams::new_with_str_sequence_sequence(&Object::entries(&params))?
                    .to_string()
                    .as_string()
                    .unwrap_or_default();
            if !encoded.is_empty() {
                url.push(if url.contains('?') { '&' } else { '?' });
                url.push_str(&encoded);
            }
        }
        Ok(url)
    }
}

fn ensure_object(value: &JsValue) -> JsValue {
    if value.is_object() {
        value.clone()
    } else {
        Object::new().into()
    }
}

fn copy_object(value: &JsValue) -> JsValue {
    let copy = Object::new();
    if value.is_object() {
        Object::assign(&copy, &value.clone().unchecked_into::<Object>());
    }
    copy.into()
}

fn property(value: &JsValue, name: &str) -> Option<JsValue> {
    if !value.is_object() {
        return None;
    }
    Reflect::get(value, &JsValue::from_str(name))
        .ok()
        .filter(|value| !value.is_null() && !value.is_undefined())
}

fn set_property(target: &JsValue, name: &str, value: &JsValue) -> Result<(), JsValue> {
    let target = ensure_object(target);
    Reflect::set(&target, &JsValue::from_str(name), value).map(|_| ())
}

fn string_property(value: &JsValue, name: &str) -> Option<String> {
    property(value, name).and_then(|value| value.as_string())
}

fn number_property(value: &JsValue, name: &str) -> Option<f64> {
    property(value, name).and_then(|value| value.as_f64())
}

fn u16_array_property(value: &JsValue, name: &str) -> Option<Vec<u16>> {
    let values = property(value, name)?;
    Array::is_array(&values).then(|| {
        Array::from(&values)
            .iter()
            .filter_map(|value| value.as_f64())
            .map(nonnegative_u32)
            .filter_map(|value| u16::try_from(value).ok())
            .collect()
    })
}

fn string_array_property(value: &JsValue, name: &str) -> Option<Vec<String>> {
    let values = property(value, name)?;
    Array::is_array(&values).then(|| {
        Array::from(&values)
            .iter()
            .filter_map(|value| value.as_string())
            .collect()
    })
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn nonnegative_u32(value: f64) -> u32 {
    value.clamp(0.0, f64::from(u32::MAX)) as u32
}

fn merged_headers(environment: &JsValue, options: &JsValue) -> Result<Headers, JsValue> {
    let headers = Headers::new()?;
    headers.set("Accept", "application/json")?;
    append_headers(&headers, property(environment, "headers").as_ref())?;
    append_headers(&headers, property(options, "headers").as_ref())?;
    Ok(headers)
}

fn append_headers(headers: &Headers, source: Option<&JsValue>) -> Result<(), JsValue> {
    let Some(source) = source.filter(|value| value.is_object()) else {
        return Ok(());
    };
    let source = source.clone().unchecked_into::<Object>();
    for entry in Object::entries(&source).iter() {
        let pair = Array::from(&entry);
        if let (Some(name), Some(value)) = (pair.get(0).as_string(), pair.get(1).as_string()) {
            headers.set(&name, &value)?;
        }
    }
    Ok(())
}

fn ensure_json_content_type(options: &JsValue) -> Result<(), JsValue> {
    let options = ensure_object(options);
    let headers = property(&options, "headers").unwrap_or_else(|| Object::new().into());
    if !Reflect::has(&headers, &JsValue::from_str("Content-Type"))? {
        Reflect::set(
            &headers,
            &JsValue::from_str("Content-Type"),
            &JsValue::from_str("application/json"),
        )?;
    }
    Reflect::set(&options, &JsValue::from_str("headers"), &headers)?;
    Ok(())
}

fn set_json_body(options: &JsValue, method: &str, data: &JsValue) -> Result<(), JsValue> {
    set_property(options, "method", &JsValue::from_str(method))?;
    let body = JSON::stringify(data)?;
    set_property(options, "body", &body.into())
}

fn is_retryable_transport(error: &JsValue, policy: &BrowserRetryPolicy) -> bool {
    string_property(error, "name").is_some_and(|name| policy.retryable_errors.contains(&name))
        || matches!(
            string_property(error, "code").as_deref(),
            Some("ECONNRESET" | "ETIMEDOUT")
        )
}

async fn parse_error_response(response: Response) -> JsValue {
    let status = response.status();
    let status_text = response.status_text();
    let request_id = response.headers().get("X-Request-ID").ok().flatten();
    let parsed = match response.json() {
        Ok(promise) => JsFuture::from(promise).await.ok(),
        Err(_) => None,
    };
    let envelope = parsed.map_or_else(
        || fallback_error(status, &status_text, request_id.as_deref()),
        |data| normalize_error_envelope(status, &status_text, request_id.as_deref(), &data),
    );
    let message = property_path(&envelope, &["error", "message"])
        .and_then(|value| value.as_string())
        .unwrap_or(status_text);
    let error = Error::new(&message);
    let value: JsValue = error.into();
    let _ = Reflect::set(
        &value,
        &JsValue::from_str("status"),
        &JsValue::from_f64(f64::from(status)),
    );
    let _ = Reflect::set(&value, &JsValue::from_str("response"), &envelope);
    if let Some(request_id) = request_id {
        let _ = Reflect::set(
            &value,
            &JsValue::from_str("requestId"),
            &JsValue::from_str(&request_id),
        );
    }
    value
}

fn normalize_error_envelope(
    status: u16,
    status_text: &str,
    request_id: Option<&str>,
    data: &JsValue,
) -> JsValue {
    if property(data, "error").is_some() || property(data, "errors").is_some() {
        return data.clone();
    }
    let detail = string_property(data, "detail")
        .or_else(|| string_property(data, "message"))
        .unwrap_or_else(|| status_text.to_owned());
    let envelope = Object::new();
    let error = Object::new();
    let _ = Reflect::set(
        &error,
        &JsValue::from_str("code"),
        &JsValue::from_str(&format!("HTTP_{status}")),
    );
    let _ = Reflect::set(
        &error,
        &JsValue::from_str("message"),
        &JsValue::from_str(&detail),
    );
    let _ = Reflect::set(
        &error,
        &JsValue::from_str("user_message"),
        &JsValue::from_str(&detail),
    );
    let _ = Reflect::set(
        &error,
        &JsValue::from_str("severity"),
        &JsValue::from_str(if status >= 500 { "high" } else { "low" }),
    );
    let _ = Reflect::set(
        &error,
        &JsValue::from_str("recovery_action"),
        &JsValue::from_str(if status >= 500 { "retry" } else { "fail_fast" }),
    );
    let _ = Reflect::set(&envelope, &JsValue::from_str("error"), &error);
    if let Some(request_id) = request_id {
        let _ = Reflect::set(
            &envelope,
            &JsValue::from_str("request_id"),
            &JsValue::from_str(request_id),
        );
    }
    envelope.into()
}

fn fallback_error(status: u16, status_text: &str, request_id: Option<&str>) -> JsValue {
    let envelope = Object::new();
    let error = Object::new();
    let _ = Reflect::set(
        &error,
        &JsValue::from_str("code"),
        &JsValue::from_str(&format!("HTTP_{status}")),
    );
    let _ = Reflect::set(
        &error,
        &JsValue::from_str("message"),
        &JsValue::from_str(status_text),
    );
    let _ = Reflect::set(
        &error,
        &JsValue::from_str("user_message"),
        &JsValue::from_str("An unexpected error occurred"),
    );
    let _ = Reflect::set(
        &error,
        &JsValue::from_str("severity"),
        &JsValue::from_str("high"),
    );
    let _ = Reflect::set(
        &error,
        &JsValue::from_str("recovery_action"),
        &JsValue::from_str("retry"),
    );
    let _ = Reflect::set(&envelope, &JsValue::from_str("error"), &error);
    if let Some(request_id) = request_id {
        let _ = Reflect::set(
            &envelope,
            &JsValue::from_str("request_id"),
            &JsValue::from_str(request_id),
        );
    }
    envelope.into()
}

fn property_path(value: &JsValue, path: &[&str]) -> Option<JsValue> {
    path.iter()
        .try_fold(value.clone(), |current, name| property(&current, name))
}

fn message_value(value: &JsValue) -> Option<String> {
    if let Some(value) = value
        .as_string()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    {
        return Some(value);
    }
    if let Some(value) = value.as_f64() {
        return Some(value.to_string());
    }
    if let Some(value) = value.as_bool() {
        return Some(value.to_string());
    }
    if Array::is_array(value) {
        let messages = Array::from(value)
            .iter()
            .filter_map(|item| message_value(&item))
            .collect::<Vec<_>>();
        return (!messages.is_empty()).then(|| messages.join("; "));
    }
    [
        "user_message",
        "message",
        "error_description",
        "detail",
        "description",
        "error",
    ]
    .iter()
    .find_map(|name| property(value, name).and_then(|item| message_value(&item)))
}

#[wasm_bindgen(js_name = mipVersion)]
#[must_use]
pub fn mip_version() -> String {
    MIP_VERSION.to_owned()
}

#[wasm_bindgen(js_name = getErrorMessage)]
pub fn get_error_message(error: &JsValue) -> String {
    for path in [
        &["error_description"][..],
        &["detail"][..],
        &["response", "error", "user_message"][..],
        &["response", "error_description"][..],
        &["response", "data", "error_description"][..],
        &["response", "data", "detail"][..],
    ] {
        if let Some(message) = property_path(error, path).and_then(|value| message_value(&value)) {
            return message;
        }
    }
    if let Some(errors) = property_path(error, &["response", "errors"]).filter(Array::is_array)
        && let Some(message) = message_value(&Array::from(&errors).get(0))
    {
        return message;
    }
    if let Some(message) = property(error, "message").and_then(|value| message_value(&value)) {
        if message.contains("Failed to fetch") || message.contains("NetworkError") {
            return "Unable to connect to the server. Please check your internet connection."
                .to_owned();
        }
        return message;
    }
    "An unexpected error occurred. Please try again.".to_owned()
}

#[wasm_bindgen(js_name = getErrorCode)]
pub fn get_error_code(error: &JsValue) -> Option<String> {
    property_path(error, &["response", "error", "code"]).and_then(|value| value.as_string())
}

#[wasm_bindgen(js_name = isAuthError)]
pub fn is_auth_error(error: &JsValue) -> bool {
    get_error_code(error).is_some_and(|code| code.starts_with("AUTH."))
        || number_property(error, "status") == Some(401.0)
}

#[wasm_bindgen(js_name = isRetryableError)]
pub fn is_retryable_error(error: &JsValue) -> bool {
    matches!(
        property_path(error, &["response", "error", "recovery_action"])
            .and_then(|value| value.as_string())
            .as_deref(),
        Some("retry" | "retry_with_backoff")
    )
}

#[wasm_bindgen(js_name = handleApiError)]
pub fn handle_api_error(error: JsValue) -> JsValue {
    if property(&error, "response").is_some() {
        error
    } else {
        Error::new(&get_error_message(&error)).into()
    }
}

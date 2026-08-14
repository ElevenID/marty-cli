use std::time::Duration;

use marty_api_client::{ApiClient, ApiError, MIP_VERSION, RetryPolicy};
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::json;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_json, header, method, path},
};

#[tokio::test]
async fn sends_protocol_and_caller_headers_with_json_body() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/items"))
        .and(header("x-api-key", "test-key"))
        .and(header("x-mip-version", MIP_VERSION))
        .and(header("accept", "application/json"))
        .and(header("content-type", "application/json"))
        .and(body_json(json!({"name": "Ada"})))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": "item-1"})))
        .expect(1)
        .mount(&server)
        .await;

    let mut headers = HeaderMap::new();
    headers.insert("X-API-Key", HeaderValue::from_static("test-key"));
    let client = ApiClient::new(&server.uri(), headers).expect("client");
    let result = client
        .post("/v1/items", &json!({"name": "Ada"}))
        .await
        .expect("request succeeds");
    assert_eq!(result, json!({"id": "item-1"}));
}

#[tokio::test]
async fn preserves_structured_error_details() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/audit-events"))
        .respond_with(ResponseTemplate::new(501).set_body_json(json!({
            "error": "service_error",
            "error_description": {
                "error": "audit_log_unavailable",
                "message": "Audit storage is unavailable."
            },
            "message_id": "msg-1"
        })))
        .expect(1)
        .mount(&server)
        .await;
    let client = ApiClient::new(&server.uri(), HeaderMap::new())
        .expect("client")
        .with_retry_policy(RetryPolicy {
            max_retries: 0,
            ..RetryPolicy::default()
        });

    let error = client
        .get("/v1/audit-events")
        .await
        .expect_err("request must fail");
    match error {
        ApiError::Response {
            status,
            message,
            body,
        } => {
            assert_eq!(status.as_u16(), 501);
            assert_eq!(message, "Audit storage is unavailable.");
            assert_eq!(body["message_id"], "msg-1");
        }
        error => panic!("unexpected error: {error}"),
    }
}

#[tokio::test]
async fn retries_get_but_never_retries_post() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/retry"))
        .respond_with(
            ResponseTemplate::new(503).set_body_json(json!({"error": {"message": "later"}})),
        )
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/retry"))
        .respond_with(
            ResponseTemplate::new(503).set_body_json(json!({"error": {"message": "later"}})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let client = ApiClient::new(&server.uri(), HeaderMap::new())
        .expect("client")
        .with_retry_policy(RetryPolicy {
            max_retries: 1,
            base_delay: Duration::ZERO,
            max_delay: Duration::ZERO,
            backoff_multiplier: 1.0,
        });

    assert!(client.get("/retry").await.is_err());
    assert!(client.post("/retry", &json!({})).await.is_err());
}

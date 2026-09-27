use std::io;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AppError;

const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const FETCH_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Fast,
    Ok,
    Slow,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NetErrorKind {
    Dns,
    Tls,
    Connect,
    Timeout,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub reachable: bool,
    pub status: Option<u16>,
    pub latency_ms: u64,
    pub tier: Tier,
    pub error_kind: Option<NetErrorKind>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedModels {
    pub source: String,
    pub ids: Vec<String>,
}

pub fn probe(base_url: &str, key: Option<&str>) -> ProbeResult {
    let started = Instant::now();
    let agent = agent(PROBE_TIMEOUT);
    let mut request = agent.get(base_url);
    if let Some(key) = key {
        request = request.header("Authorization", format!("Bearer {key}"));
    }

    let result = request.call();
    let latency_ms = elapsed_ms(started);
    match result {
        Ok(response) => ProbeResult {
            reachable: true,
            status: Some(response.status().as_u16()),
            latency_ms,
            tier: tier_for(latency_ms),
            error_kind: None,
        },
        Err(error) => ProbeResult {
            reachable: false,
            status: None,
            latency_ms,
            tier: tier_for(latency_ms),
            error_kind: Some(probe_error_kind(&error)),
        },
    }
}

pub fn fetch_models(base_url: &str, key: Option<&str>) -> Result<FetchedModels, AppError> {
    let base_url = base_url.trim_end_matches('/');
    let agent = agent(FETCH_TIMEOUT);
    let models_url = format!("{base_url}/models");
    let first = request_text(&agent, &models_url, key)?;

    if matches!(first.status, 400 | 404) {
        let fallback_url = format!("{base_url}/v1/models");
        let fallback = request_text(&agent, &fallback_url, key)?;
        return finish_model_response("v1/models", fallback);
    }

    finish_model_response("models", first)
}

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(timeout))
        .timeout_global(Some(timeout))
        .http_status_as_error(false)
        .max_redirects(0)
        .proxy(None)
        .build()
        .new_agent()
}

fn elapsed_ms(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

fn tier_for(ms: u64) -> Tier {
    if ms < 300 {
        Tier::Fast
    } else if ms < 1200 {
        Tier::Ok
    } else {
        Tier::Slow
    }
}

fn probe_error_kind(error: &ureq::Error) -> NetErrorKind {
    match error {
        ureq::Error::HostNotFound => NetErrorKind::Dns,
        ureq::Error::Tls(_) | ureq::Error::Rustls(_) => NetErrorKind::Tls,
        ureq::Error::Timeout(_) => NetErrorKind::Timeout,
        ureq::Error::Io(error) => match error.kind() {
            io::ErrorKind::TimedOut => NetErrorKind::Timeout,
            io::ErrorKind::NotFound => NetErrorKind::Dns,
            _ => NetErrorKind::Connect,
        },
        _ => NetErrorKind::Connect,
    }
}

struct ResponseText {
    status: u16,
    body: String,
}

fn request_text(
    agent: &ureq::Agent,
    url: &str,
    key: Option<&str>,
) -> Result<ResponseText, AppError> {
    let mut request = agent.get(url);
    if let Some(key) = key {
        request = request.header("Authorization", format!("Bearer {key}"));
    }

    let mut response = request
        .call()
        .map_err(|_| network_error("provider connection failed"))?;
    let status = response.status().as_u16();
    let body = response
        .body_mut()
        .read_to_string()
        .map_err(|_| network_error("provider response could not be read"))?;
    Ok(ResponseText { status, body })
}

fn finish_model_response(source: &str, response: ResponseText) -> Result<FetchedModels, AppError> {
    if !(200..300).contains(&response.status) {
        return Err(network_error(&format!("HTTP status {}", response.status)));
    }

    let ids = parse_model_ids(&response.body)?;
    Ok(FetchedModels {
        source: source.to_owned(),
        ids,
    })
}

fn network_error(message: &str) -> AppError {
    AppError::NetworkUnreachable {
        message: message.to_owned(),
    }
}

fn parse_error() -> AppError {
    AppError::ModelFetchParse {
        message: "invalid model response".to_owned(),
    }
}

fn parse_model_ids(body: &str) -> Result<Vec<String>, AppError> {
    let root: Value = serde_json::from_str(body).map_err(|_| parse_error())?;
    match root {
        Value::Array(items) => ids_from_items(&items, false),
        Value::Object(object) => {
            if let Some(data) = object.get("data") {
                let items = data.as_array().ok_or_else(parse_error)?;
                ids_from_items(items, false)
            } else if let Some(models) = object.get("models") {
                let items = models.as_array().ok_or_else(parse_error)?;
                ids_from_items(items, true)
            } else {
                Err(parse_error())
            }
        }
        _ => Err(parse_error()),
    }
}

fn ids_from_items(items: &[Value], prefer_slug: bool) -> Result<Vec<String>, AppError> {
    items
        .iter()
        .map(|item| {
            let object = item.as_object().ok_or_else(parse_error)?;
            let value = if prefer_slug {
                object.get("slug").or_else(|| object.get("id"))
            } else {
                object.get("id")
            }
            .and_then(Value::as_str)
            .ok_or_else(parse_error)?;
            Ok(value.to_owned())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread::{self, JoinHandle};

    struct CannedResponse {
        status: u16,
        body: String,
    }

    fn start_server(responses: Vec<CannedResponse>) -> (String, JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test listener");
        let address = listener.local_addr().expect("read listener address");
        let handle = thread::spawn(move || {
            let mut requests = Vec::with_capacity(responses.len());
            for response in responses {
                let (mut stream, _) = listener.accept().expect("accept local test request");
                let mut request = Vec::new();
                let mut chunk = [0_u8; 1024];
                loop {
                    let count = stream.read(&mut chunk).expect("read local test request");
                    if count == 0 {
                        break;
                    }
                    request.extend_from_slice(&chunk[..count]);
                    if request.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                requests.push(String::from_utf8_lossy(&request).into_owned());
                let header = format!(
                    "HTTP/1.1 {} OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    response.status,
                    response.body.len()
                );
                stream
                    .write_all(header.as_bytes())
                    .expect("write local test headers");
                stream
                    .write_all(response.body.as_bytes())
                    .expect("write local test body");
                stream.flush().expect("flush local test response");
            }
            requests
        });
        (format!("http://{address}"), handle)
    }

    fn response(status: u16, body: &str) -> CannedResponse {
        CannedResponse {
            status,
            body: body.to_owned(),
        }
    }

    #[test]
    fn tier_boundaries() {
        assert_eq!(tier_for(0), Tier::Fast);
        assert_eq!(tier_for(299), Tier::Fast);
        assert_eq!(tier_for(300), Tier::Ok);
        assert_eq!(tier_for(1199), Tier::Ok);
        assert_eq!(tier_for(1200), Tier::Slow);
    }

    #[test]
    fn probe_200_is_reachable_and_uses_exact_url() {
        let (base_url, server) = start_server(vec![response(200, "ok")]);
        let result = probe(&format!("{base_url}/health?check=1"), None);
        let requests = server.join().expect("join local test server");

        assert!(result.reachable);
        assert_eq!(result.status, Some(200));
        assert_eq!(result.error_kind, None);
        assert!(requests[0].starts_with("GET /health?check=1 HTTP/1.1\r\n"));
    }

    #[test]
    fn probe_401_is_still_reachable() {
        let (base_url, server) = start_server(vec![response(401, "")]);
        let result = probe(&base_url, None);
        server.join().expect("join local test server");

        assert!(result.reachable);
        assert_eq!(result.status, Some(401));
        assert_eq!(result.error_kind, None);
    }

    #[test]
    fn probe_closed_port_reports_connect_error() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind closed-port listener");
        let address = listener.local_addr().expect("read closed-port address");
        drop(listener);

        let result = probe(&format!("http://{address}/x"), None);

        assert!(!result.reachable);
        assert_eq!(result.status, None);
        assert_eq!(result.error_kind, Some(NetErrorKind::Connect));
    }

    #[test]
    fn fetch_parses_data_ids() {
        let (base_url, server) = start_server(vec![response(
            200,
            r#"{"data":[{"id":"one"},{"id":"two"}]}"#,
        )]);
        let result = fetch_models(&base_url, None).expect("fetch data models");
        server.join().expect("join local test server");

        assert_eq!(result.source, "models");
        assert_eq!(result.ids, ["one", "two"]);
    }

    #[test]
    fn fetch_falls_back_to_v1_models_after_404() {
        let (base_url, server) = start_server(vec![
            response(404, ""),
            response(200, r#"{"data":[{"id":"fallback"}]}"#),
        ]);
        let result = fetch_models(&base_url, None).expect("fetch fallback models");
        let requests = server.join().expect("join local test server");

        assert_eq!(result.source, "v1/models");
        assert_eq!(result.ids, ["fallback"]);
        assert!(requests[0].starts_with("GET /models HTTP/1.1\r\n"));
        assert!(requests[1].starts_with("GET /v1/models HTTP/1.1\r\n"));
    }

    #[test]
    fn fetch_parses_models_slugs_and_bare_array() {
        let (base_url, server) = start_server(vec![response(
            200,
            r#"{"models":[{"slug":"slugged"},{"id":"identified"}]}"#,
        )]);
        let models = fetch_models(&base_url, None).expect("fetch models slugs");
        server.join().expect("join local test server");
        assert_eq!(models.ids, ["slugged", "identified"]);

        assert_eq!(
            parse_model_ids(r#"[{"id":"bare"}]"#).expect("parse bare models"),
            ["bare"]
        );
    }

    #[test]
    fn fetch_parses_bare_array_over_http() {
        let (base_url, server) = start_server(vec![response(200, r#"[{"id":"bare"}]"#)]);
        let models = fetch_models(&base_url, None).expect("fetch bare models");
        server.join().expect("join local test server");

        assert_eq!(models.source, "models");
        assert_eq!(models.ids, ["bare"]);
    }

    #[test]
    fn garbage_body_is_model_fetch_parse_error() {
        let (base_url, server) = start_server(vec![response(200, "garbage")]);
        let error = fetch_models(&base_url, None).expect_err("garbage should fail parsing");
        server.join().expect("join local test server");

        assert!(matches!(error, AppError::ModelFetchParse { .. }));
    }

    #[test]
    fn authorization_header_is_sent_when_key_is_given() {
        let (base_url, server) = start_server(vec![response(200, "")]);
        let result = probe(&base_url, Some("TEST-NOT-A-REAL-KEY"));
        let requests = server.join().expect("join local test server");

        assert!(result.reachable);
        // HTTP header names are case-insensitive; ureq (via the `http` crate) sends them lowercased.
        let auth_line = requests[0]
            .split("\r\n")
            .find(|line| line.to_ascii_lowercase().starts_with("authorization:"))
            .expect("authorization header present");
        assert_eq!(
            auth_line.split_once(':').map(|(_, value)| value.trim()),
            Some("Bearer TEST-NOT-A-REAL-KEY")
        );
    }

    #[test]
    fn secret_in_url_does_not_reach_error_or_debug_output() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind secret test listener");
        let address = listener.local_addr().expect("read secret test address");
        drop(listener);
        let url = format!("http://user:SECRETSEGMENT@{address}/x");

        let probe_result = probe(&url, None);
        let probe_debug = format!("{probe_result:?}");
        assert!(!probe_debug.contains("SECRETSEGMENT"));

        let error = fetch_models(&url, None).expect_err("closed URL should fail fetch");
        let error_debug = format!("{error:?}");
        let error_display = error.to_string();
        assert!(!error_debug.contains("SECRETSEGMENT"));
        assert!(!error_display.contains("SECRETSEGMENT"));
    }
}

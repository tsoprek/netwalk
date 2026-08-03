//! Local loopback reverse proxy for in-app Browse tabs.
//!
//! Lab device web UIs often use self-signed or lab-private HTTPS
//! certificates. The embedded WebView has no portable "ignore certificate
//! error" switch, so Browse tabs use this loopback proxy for the pragmatic
//! path: the native client accepts the upstream certificate, then serves the
//! response to the child WebView over local HTTP.

use anyhow::{anyhow, Context, Result};
use futures_util::{SinkExt, StreamExt};
use reqwest::header::{HeaderMap, HeaderName, ACCEPT_ENCODING, HOST};
use reqwest::{Client, Method, StatusCode, Url};
use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::Role;
use tokio_tungstenite::{client_async_tls_with_config, Connector, WebSocketStream};

const IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_HEADER_BYTES: usize = 128 * 1024;
const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;
const DIAGNOSTIC_TARGET: &str = "catwalk_client::browse_proxy";
static NEXT_PROXY_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_CONNECTION_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, serde::Serialize)]
pub struct BrowserProxy {
    pub host: String,
    pub port: u16,
    pub url: String,
}

struct HttpRequest {
    method: Method,
    target: String,
    version: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

struct UpstreamResponse {
    status: StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
}

type ProxyCookieJar = Arc<Mutex<BTreeMap<String, String>>>;

pub async fn open(
    upstream_base: String,
    resolve_to_loopback: bool,
    public_base: Option<String>,
) -> Result<BrowserProxy> {
    let upstream = parse_upstream_base(&upstream_base)?;
    let public_upstream = match public_base {
        Some(raw) if !raw.trim().is_empty() => parse_upstream_base(&raw)?,
        _ => upstream.clone(),
    };
    let client = build_client(&upstream, resolve_to_loopback)?;
    let local_host = "127.0.0.1".to_string();
    let listener = TcpListener::bind(format!("{local_host}:0"))
        .await
        .context("bind browse proxy loopback")?;
    let port = listener.local_addr()?.port();
    let url = format!("http://{local_host}:{port}/");
    let cookies = Arc::new(Mutex::new(BTreeMap::new()));
    let proxy_id = NEXT_PROXY_ID.fetch_add(1, Ordering::Relaxed);

    tracing::info!(
        target: DIAGNOSTIC_TARGET,
        proxy_id,
        local_port = port,
        upstream_scheme = upstream.scheme(),
        upstream_authority = %authority_for(&upstream),
        public_authority = %authority_for(&public_upstream),
        resolve_to_loopback,
        "browse proxy opened"
    );

    tokio::spawn(async move {
        if let Err(e) = run_listener(
            listener,
            upstream,
            public_upstream,
            client,
            cookies,
            port,
            proxy_id,
        )
        .await
        {
            tracing::warn!(target: DIAGNOSTIC_TARGET, proxy_id, error = %e, "browse proxy listener ended");
        }
    });

    Ok(BrowserProxy {
        host: local_host,
        port,
        url,
    })
}

fn parse_upstream_base(raw: &str) -> Result<Url> {
    let trimmed = raw.trim();
    let mut url = Url::parse(trimmed).with_context(|| format!("parse upstream URL {trimmed}"))?;
    match url.scheme() {
        "http" | "https" => {}
        scheme => anyhow::bail!("unsupported browse proxy scheme {scheme}"),
    }
    if url.host_str().is_none() {
        anyhow::bail!("browse proxy upstream must include a host");
    }
    url.set_fragment(None);
    Ok(url)
}

fn build_client(upstream: &Url, resolve_to_loopback: bool) -> Result<Client> {
    let mut builder = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        // The loopback side always writes its own Content-Length. Decode any
        // compression returned by an appliance here so a strict external
        // browser never receives decoded bytes with stale encoding metadata.
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .zstd(true)
        .use_rustls_tls()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true);

    if resolve_to_loopback {
        let host = upstream
            .host_str()
            .ok_or_else(|| anyhow!("browse proxy upstream must include a host"))?;
        builder = builder.resolve(host, SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0));
    }

    builder.build().context("build browse proxy HTTP client")
}

async fn run_listener(
    listener: TcpListener,
    upstream: Url,
    public_upstream: Url,
    client: Client,
    cookies: ProxyCookieJar,
    public_port: u16,
    proxy_id: u64,
) -> Result<()> {
    loop {
        let accept = listener.accept();
        let (mut local, peer) = match tokio::time::timeout(IDLE_TIMEOUT, accept).await {
            Ok(Ok(pair)) => pair,
            Ok(Err(e)) => return Err(e).context("accept browse proxy client"),
            Err(_) => {
                tracing::info!(target: DIAGNOSTIC_TARGET, proxy_id, "browse proxy idle, closing loopback listener");
                return Ok(());
            }
        };
        let connection_id = NEXT_CONNECTION_ID.fetch_add(1, Ordering::Relaxed);

        let upstream = upstream.clone();
        let public_upstream = public_upstream.clone();
        let client = client.clone();
        let cookies = cookies.clone();
        tokio::spawn(async move {
            tracing::debug!(
                target: DIAGNOSTIC_TARGET,
                proxy_id,
                connection_id,
                client = %peer,
                "browse proxy browser connected"
            );
            if let Err(e) = handle_connection(
                &mut local,
                &upstream,
                &public_upstream,
                &client,
                &cookies,
                public_port,
                proxy_id,
                connection_id,
            )
            .await
            {
                let detail = format_error_chain(&e);
                tracing::warn!(
                    target: DIAGNOSTIC_TARGET,
                    proxy_id,
                    connection_id,
                    error = %detail,
                    "browse proxy request failed"
                );
                let _ = write_error_response(&mut local, 502, "Browse proxy error", &detail).await;
            }
        });
    }
}

async fn handle_connection(
    stream: &mut TcpStream,
    upstream: &Url,
    public_upstream: &Url,
    client: &Client,
    cookies: &ProxyCookieJar,
    public_port: u16,
    proxy_id: u64,
    connection_id: u64,
) -> Result<()> {
    let request = read_request(stream).await?;
    tracing::info!(
        target: DIAGNOSTIC_TARGET,
        proxy_id,
        connection_id,
        method = %request.method,
        http_version = %request.version,
        path = %diagnostic_request_path(&request.target),
        header_count = request.headers.len(),
        body_bytes = request.body.len(),
        accept_encoding = request_header(&request, "accept-encoding").unwrap_or(""),
        range = request_header(&request, "range").unwrap_or(""),
        user_agent = request_header(&request, "user-agent").unwrap_or(""),
        "browse proxy request received"
    );
    let local_origin = request_local_origin(&request, public_port);
    let url = upstream_url(upstream, &request.target)?;
    let public_url = upstream_url(public_upstream, &request.target)?;

    if is_websocket_upgrade(&request) {
        return proxy_websocket(
            stream,
            &request,
            &url,
            &public_url,
            cookies,
            proxy_id,
            connection_id,
        )
        .await;
    }

    let response = match send_upstream(
        client,
        &request,
        &url,
        &public_url,
        &local_origin,
        cookies,
        public_port,
        proxy_id,
        connection_id,
    )
    .await
    {
        Ok(response) => response,
        Err(https_error) if should_retry_without_tls(&https_error, &url) => {
            let http_url = url_with_scheme(&url, "http")?;
            let public_http_url = url_with_scheme(&public_url, "http")?;
            tracing::info!(
                https_error = %format_error_chain(&https_error),
                retry_url = %http_url,
                "browse proxy retrying HTTPS failure as plain HTTP"
            );
            match send_upstream(
                client,
                &request,
                &http_url,
                &public_http_url,
                &local_origin,
                cookies,
                public_port,
                proxy_id,
                connection_id,
            )
            .await
            {
                Ok(response) if is_plain_http_to_https_port_response(&response) => {
                    anyhow::bail!(
                        "HTTPS request failed and HTTP fallback reached an HTTPS-only nginx listener\n{}",
                        format_error_chain(&https_error)
                    );
                }
                Ok(response) => response,
                Err(http_error) => {
                    anyhow::bail!(
                        "HTTPS request failed, then HTTP fallback failed\n{}\n\nHTTP fallback:\n{}",
                        format_error_chain(&https_error),
                        format_error_chain(&http_error)
                    );
                }
            }
        }
        Err(error) => return Err(error),
    };
    write_response(
        stream,
        response,
        public_upstream,
        &local_origin,
        proxy_id,
        connection_id,
    )
    .await
}

fn header_has_token(value: &str, wanted: &str) -> bool {
    value
        .split(',')
        .any(|token| token.trim().eq_ignore_ascii_case(wanted))
}

fn is_websocket_upgrade(request: &HttpRequest) -> bool {
    request.method == Method::GET
        && request_header(request, "upgrade")
            .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
        && request_header(request, "connection")
            .is_some_and(|value| header_has_token(value, "upgrade"))
        && request_header(request, "sec-websocket-key").is_some()
        && request_header(request, "sec-websocket-version")
            .is_some_and(|value| value.trim() == "13")
}

fn websocket_url(http_url: &Url) -> Result<Url> {
    let mut url = http_url.clone();
    let scheme = match url.scheme() {
        "http" => "ws",
        "https" => "wss",
        other => anyhow::bail!("unsupported WebSocket upstream scheme {other}"),
    };
    url.set_scheme(scheme)
        .map_err(|_| anyhow!("set WebSocket upstream scheme"))?;
    Ok(url)
}

fn public_origin(public_url: &Url) -> String {
    format!("{}://{}", public_url.scheme(), authority_for(public_url))
}

fn set_ws_header(
    request: &mut tokio_tungstenite::tungstenite::http::Request<()>,
    name: &'static str,
    value: &str,
) -> Result<()> {
    let value =
        HeaderValue::from_str(value).with_context(|| format!("invalid WebSocket {name} header"))?;
    request
        .headers_mut()
        .insert(HeaderName::from_static(name), value);
    Ok(())
}

async fn proxy_websocket(
    browser_stream: &mut TcpStream,
    browser_request: &HttpRequest,
    upstream_url: &Url,
    public_url: &Url,
    cookies: &ProxyCookieJar,
    proxy_id: u64,
    connection_id: u64,
) -> Result<()> {
    let public_ws_url = websocket_url(public_url)?;
    let mut upstream_request = public_ws_url
        .as_str()
        .into_client_request()
        .context("build upstream WebSocket request")?;

    set_ws_header(&mut upstream_request, "host", &authority_for(public_url))?;
    set_ws_header(&mut upstream_request, "origin", &public_origin(public_url))?;
    for name in [
        "sec-websocket-key",
        "sec-websocket-version",
        "sec-websocket-protocol",
        "authorization",
        "user-agent",
        "accept-language",
    ] {
        if let Some(value) = request_header(browser_request, name) {
            set_ws_header(&mut upstream_request, name, value.trim())?;
        }
    }
    // Compression extensions cannot be forwarded transparently when the
    // proxy terminates and recreates WebSocket framing. Omitting the offer is
    // valid and makes both sides exchange uncompressed frames.
    upstream_request
        .headers_mut()
        .remove("sec-websocket-extensions");

    let browser_cookie = request_header(browser_request, "cookie")
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let native_cookie = cookie_header(cookies).await;
    let combined_cookie = match browser_cookie {
        Some(value) => merge_cookie_headers(value, &native_cookie),
        None => native_cookie,
    };
    if !combined_cookie.is_empty() {
        set_ws_header(&mut upstream_request, "cookie", &combined_cookie)?;
    }

    let connect_host = upstream_url
        .host_str()
        .ok_or_else(|| anyhow!("WebSocket upstream must include a host"))?;
    let connect_port = upstream_url
        .port_or_known_default()
        .ok_or_else(|| anyhow!("WebSocket upstream must include a port"))?;
    let tcp = tokio::time::timeout(
        REQUEST_TIMEOUT,
        TcpStream::connect((connect_host, connect_port)),
    )
    .await
    .context("WebSocket upstream TCP connect timed out")?
    .with_context(|| format!("connect WebSocket upstream {connect_host}:{connect_port}"))?;

    let connector = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
        .context("build untrusted WebSocket TLS connector")?;
    let (upstream_ws, response) = tokio::time::timeout(
        REQUEST_TIMEOUT,
        client_async_tls_with_config(
            upstream_request,
            tcp,
            None,
            Some(Connector::NativeTls(connector)),
        ),
    )
    .await
    .context("WebSocket upstream handshake timed out")?
    .context("WebSocket upstream handshake failed")?;

    store_response_cookies(cookies, response.headers()).await;
    write_websocket_handshake(browser_stream, response.headers()).await?;
    tracing::info!(
        target: DIAGNOSTIC_TARGET,
        proxy_id,
        connection_id,
        path = %diagnostic_request_path(public_url.path()),
        upstream_authority = %authority_for(public_url),
        "browse proxy WebSocket established"
    );

    let browser_ws = WebSocketStream::from_raw_socket(browser_stream, Role::Server, None).await;
    let (mut browser_tx, mut browser_rx) = browser_ws.split();
    let (mut upstream_tx, mut upstream_rx) = upstream_ws.split();
    let mut browser_frames = 0_u64;
    let mut upstream_frames = 0_u64;

    let relay_result: Result<()> = async {
        loop {
            tokio::select! {
                message = browser_rx.next() => match message {
                    Some(Ok(message)) => {
                        let closing = message.is_close();
                        browser_frames += 1;
                        upstream_tx.send(message).await.context("relay browser WebSocket frame")?;
                        if closing { break; }
                    }
                    Some(Err(error)) => return Err(error).context("read browser WebSocket frame"),
                    None => break,
                },
                message = upstream_rx.next() => match message {
                    Some(Ok(message)) => {
                        let closing = message.is_close();
                        upstream_frames += 1;
                        browser_tx.send(message).await.context("relay upstream WebSocket frame")?;
                        if closing { break; }
                    }
                    Some(Err(error)) => return Err(error).context("read upstream WebSocket frame"),
                    None => break,
                },
            }
        }
        Ok(())
    }
    .await;

    if let Err(error) = relay_result {
        // The HTTP 101 response has already been sent, so an HTTP error page
        // would itself be an invalid WebSocket frame. Log and close instead.
        tracing::warn!(
            target: DIAGNOSTIC_TARGET,
            proxy_id,
            connection_id,
            error = %format_error_chain(&error),
            "browse proxy WebSocket relay ended"
        );
    }

    tracing::info!(
        target: DIAGNOSTIC_TARGET,
        proxy_id,
        connection_id,
        browser_frames,
        upstream_frames,
        "browse proxy WebSocket closed"
    );
    Ok(())
}

async fn write_websocket_handshake(stream: &mut TcpStream, headers: &HeaderMap) -> Result<()> {
    let mut out =
        b"HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n"
            .to_vec();
    for name in ["sec-websocket-accept", "sec-websocket-protocol"] {
        if let Some(value) = headers.get(name).and_then(|value| value.to_str().ok()) {
            out.extend_from_slice(format!("{name}: {value}\r\n").as_bytes());
        }
    }
    for value in headers.get_all("set-cookie") {
        if let Ok(value) = value.to_str() {
            out.extend_from_slice(
                format!("Set-Cookie: {}\r\n", rewrite_set_cookie(value)).as_bytes(),
            );
        }
    }
    out.extend_from_slice(b"\r\n");
    stream
        .write_all(&out)
        .await
        .context("write browser WebSocket handshake")
}

async fn send_upstream(
    client: &Client,
    request: &HttpRequest,
    url: &Url,
    public_url: &Url,
    local_origin: &str,
    cookies: &ProxyCookieJar,
    public_port: u16,
    proxy_id: u64,
    connection_id: u64,
) -> Result<UpstreamResponse> {
    let started = Instant::now();
    let mut builder = client
        .request(request.method.clone(), url.clone())
        .header(ACCEPT_ENCODING, "identity")
        .header(HOST, authority_for(public_url));

    for (name, value) in &request.headers {
        if should_skip_request_header(name) {
            continue;
        }
        if let Ok(header_name) = HeaderName::from_bytes(name.as_bytes()) {
            let value =
                rewrite_request_header(name, value.trim(), public_url, local_origin, public_port);
            builder = builder.header(header_name, value);
        }
    }

    let native_cookie_header = cookie_header(cookies).await;
    let browser_cookie = request
        .headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("cookie"))
        .map(|(_, value)| value.trim())
        .filter(|value| !value.is_empty());
    let combined_cookie = match browser_cookie {
        Some(browser_cookie) => merge_cookie_headers(browser_cookie, &native_cookie_header),
        None => native_cookie_header,
    };
    if !combined_cookie.is_empty() {
        builder = builder.header("cookie", combined_cookie);
    }

    if !request.body.is_empty() {
        builder = builder.body(request.body.clone());
    }

    let response = builder
        .send()
        .await
        .map_err(reqwest::Error::without_url)
        .with_context(|| format!("proxy upstream {}://{}", url.scheme(), authority_for(url)))?;
    let status = response.status();
    let response_version = format!("{:?}", response.version());
    let mut headers = response.headers().clone();
    store_response_cookies(cookies, &headers).await;
    let mut body = response
        .bytes()
        .await
        .map_err(reqwest::Error::without_url)
        .with_context(|| {
            format!(
                "read upstream response {}://{}",
                url.scheme(),
                authority_for(url)
            )
        })?
        .to_vec();
    let csrfguard_domain_rewritten = rewrite_csrfguard_domain(
        &mut body,
        header_text(&headers, "content-type"),
        public_url,
        local_origin,
    );
    if csrfguard_domain_rewritten {
        // Validators describe the upstream representation and become stale
        // when the generated script's expected domain is adjusted.
        headers.remove("etag");
        headers.remove("content-md5");
        headers.remove("digest");
    }
    tracing::info!(
        target: DIAGNOSTIC_TARGET,
        proxy_id,
        connection_id,
        method = %request.method,
        path = %diagnostic_request_path(url.path()),
        status = status.as_u16(),
        upstream_http_version = %response_version,
        content_type = header_text(&headers, "content-type"),
        content_encoding = header_text(&headers, "content-encoding"),
        content_length = header_text(&headers, "content-length"),
        transfer_encoding = header_text(&headers, "transfer-encoding"),
        body_bytes = body.len(),
        csrfguard_domain_rewritten,
        elapsed_ms = started.elapsed().as_millis(),
        "browse proxy upstream response received"
    );
    if status.is_client_error() {
        tracing::info!(
            method = %request.method,
            %url,
            status = status.as_u16(),
            "browse proxy upstream client error"
        );
    }

    Ok(UpstreamResponse {
        status,
        headers,
        body,
    })
}

async fn cookie_header(cookies: &ProxyCookieJar) -> String {
    cookies
        .lock()
        .await
        .iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; ")
}

fn merge_cookie_headers(browser_cookie: &str, native_cookie: &str) -> String {
    if browser_cookie.trim().is_empty() {
        return native_cookie.to_string();
    }
    if native_cookie.trim().is_empty() {
        return browser_cookie.to_string();
    }

    let mut seen = BTreeMap::new();
    for part in browser_cookie.split(';') {
        let part = part.trim();
        if let Some((name, _)) = part.split_once('=') {
            seen.insert(name.trim().to_ascii_lowercase(), ());
        }
    }

    let mut merged = browser_cookie.to_string();
    for part in native_cookie.split(';') {
        let part = part.trim();
        let Some((name, _)) = part.split_once('=') else {
            continue;
        };
        if !seen.contains_key(&name.trim().to_ascii_lowercase()) {
            merged.push_str("; ");
            merged.push_str(part);
        }
    }
    merged
}

async fn store_response_cookies(cookies: &ProxyCookieJar, headers: &HeaderMap) {
    let mut jar = cookies.lock().await;
    for value in headers.get_all("set-cookie").iter() {
        let Ok(value) = value.to_str() else {
            continue;
        };
        let Some((name, cookie_value)) = parse_set_cookie_name_value(value) else {
            continue;
        };
        let lower = value.to_ascii_lowercase();
        if lower.contains("max-age=0") || lower.contains("max-age=-") {
            jar.remove(&name);
        } else {
            jar.insert(name, cookie_value);
        }
    }
}

fn parse_set_cookie_name_value(value: &str) -> Option<(String, String)> {
    let first = value.split(';').next()?.trim();
    let (name, cookie_value) = first.split_once('=')?;
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    Some((name.to_string(), cookie_value.trim().to_string()))
}

async fn read_request(stream: &mut TcpStream) -> Result<HttpRequest> {
    let mut buf = Vec::with_capacity(8 * 1024);
    let header_end = loop {
        if let Some(pos) = find_header_end(&buf) {
            break pos;
        }
        if buf.len() >= MAX_HEADER_BYTES {
            anyhow::bail!("request headers too large");
        }
        let mut chunk = [0u8; 4096];
        let n = stream.read(&mut chunk).await.context("read request")?;
        if n == 0 {
            anyhow::bail!("client closed before sending a request");
        }
        buf.extend_from_slice(&chunk[..n]);
    };

    let headers_raw = &buf[..header_end];
    let body_start = header_end + 4;
    let mut body = if body_start < buf.len() {
        buf[body_start..].to_vec()
    } else {
        Vec::new()
    };

    let headers_text = std::str::from_utf8(headers_raw).context("request headers are not UTF-8")?;
    let mut lines = headers_text.split("\r\n");
    let request_line = lines.next().ok_or_else(|| anyhow!("empty request"))?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| anyhow!("missing request method"))?;
    let target = parts
        .next()
        .ok_or_else(|| anyhow!("missing request target"))?;
    let method = Method::from_bytes(method.as_bytes()).context("unsupported request method")?;

    let mut headers = Vec::new();
    let mut content_length = 0usize;
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("content-length") {
            content_length = value
                .trim()
                .parse::<usize>()
                .context("invalid Content-Length")?;
            if content_length > MAX_BODY_BYTES {
                anyhow::bail!("request body too large");
            }
        }
        headers.push((name.trim().to_string(), value.trim().to_string()));
    }

    while body.len() < content_length {
        let mut chunk = vec![0u8; (content_length - body.len()).min(16 * 1024)];
        let n = stream.read(&mut chunk).await.context("read request body")?;
        if n == 0 {
            anyhow::bail!("client closed before request body completed");
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(content_length);

    Ok(HttpRequest {
        method,
        target: target.to_string(),
        version: parts.next().unwrap_or("unknown").to_string(),
        headers,
        body,
    })
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn upstream_url(upstream: &Url, target: &str) -> Result<Url> {
    let path_query = if target.starts_with("http://") || target.starts_with("https://") {
        let absolute = Url::parse(target).context("parse absolute request target")?;
        match absolute.query() {
            Some(q) => format!("{}?{q}", absolute.path()),
            None => absolute.path().to_string(),
        }
    } else {
        target.to_string()
    };

    let mut url = upstream.clone();
    let (path, query) = match path_query.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (path_query.as_str(), None),
    };
    url.set_path(if path.is_empty() { "/" } else { path });
    url.set_query(query);
    url.set_fragment(None);
    Ok(url)
}

fn url_with_scheme(url: &Url, scheme: &str) -> Result<Url> {
    let mut next = url.clone();
    next.set_scheme(scheme)
        .map_err(|_| anyhow!("failed to set URL scheme to {scheme}"))?;
    Ok(next)
}

fn should_retry_without_tls(error: &anyhow::Error, url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    if matches!(url.port_or_known_default(), Some(443 | 8443)) {
        return false;
    }
    let text = format_error_chain(error).to_ascii_lowercase();
    [
        "bad protocol version",
        "wrong version number",
        "tls",
        "ssl",
        "handshake",
        "record",
        "protocol version",
        "unexpected eof",
        "received fatal alert",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}

fn is_plain_http_to_https_port_response(response: &UpstreamResponse) -> bool {
    if response.status != StatusCode::BAD_REQUEST {
        return false;
    }
    String::from_utf8_lossy(&response.body)
        .to_ascii_lowercase()
        .contains("plain http request was sent to https port")
}

async fn write_response(
    stream: &mut TcpStream,
    response: UpstreamResponse,
    upstream: &Url,
    local_origin: &str,
    proxy_id: u64,
    connection_id: u64,
) -> Result<()> {
    let status = response.status;
    let headers = response.headers;
    let body = response.body;
    let reason = status.canonical_reason().unwrap_or("");
    let upstream_content_encoding = header_text(&headers, "content-encoding").to_string();
    let upstream_header_count = headers.len();
    let body_looks_gzip = body.starts_with(&[0x1f, 0x8b]);
    let upstream_location = header_text(&headers, "location");
    let rewritten_location = if upstream_location.is_empty() {
        None
    } else {
        Some(rewrite_location(upstream_location, upstream, local_origin))
    };
    let redirect_url = Url::parse(upstream_location).ok();
    let redirect_authority = redirect_url.as_ref().map(authority_for).unwrap_or_default();
    let redirect_path = redirect_url
        .as_ref()
        .map(|url| diagnostic_request_path(url.path()))
        .unwrap_or_else(|| diagnostic_request_path(upstream_location));
    let redirect_rewritten = rewritten_location
        .as_deref()
        .is_some_and(|location| location != upstream_location);

    let mut out = Vec::new();
    out.extend_from_slice(format!("HTTP/1.1 {} {reason}\r\n", status.as_u16()).as_bytes());

    let mut emitted_location = false;
    for (name, value) in headers.iter() {
        let name_str = name.as_str();
        if should_skip_response_header(name_str) {
            continue;
        }
        let Ok(value_str) = value.to_str() else {
            continue;
        };
        if name_str.eq_ignore_ascii_case("location") {
            // Location is a singleton field. Some appliances emit duplicate
            // values, which Firefox rejects as corrupted content.
            if emitted_location {
                continue;
            }
            emitted_location = true;
            let rewritten = rewritten_location.as_deref().unwrap_or(value_str);
            out.extend_from_slice(format!("Location: {rewritten}\r\n").as_bytes());
        } else if name_str.eq_ignore_ascii_case("set-cookie") {
            let rewritten = rewrite_set_cookie(value_str);
            out.extend_from_slice(format!("Set-Cookie: {rewritten}\r\n").as_bytes());
        } else {
            out.extend_from_slice(format!("{name_str}: {value_str}\r\n").as_bytes());
        }
    }

    out.extend_from_slice(format!("Content-Length: {}\r\n", body.len()).as_bytes());
    out.extend_from_slice(b"Connection: close\r\n\r\n");
    out.extend_from_slice(&body);
    stream
        .write_all(&out)
        .await
        .context("write proxy response")?;
    let _ = stream.shutdown().await;
    tracing::info!(
        target: DIAGNOSTIC_TARGET,
        proxy_id,
        connection_id,
        status = status.as_u16(),
        response_bytes = out.len(),
        body_bytes = body.len(),
        upstream_header_count,
        content_encoding = %upstream_content_encoding,
        body_looks_gzip,
        redirect_authority = %redirect_authority,
        redirect_path = %redirect_path,
        redirect_rewritten,
        connection = "close",
        "browse proxy response sent to browser"
    );
    Ok(())
}

fn request_header<'a>(request: &'a HttpRequest, wanted: &str) -> Option<&'a str> {
    request
        .headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(wanted))
        .map(|(_, value)| value.as_str())
}

fn header_text<'a>(headers: &'a HeaderMap, name: &str) -> &'a str {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
}

fn diagnostic_request_path(target: &str) -> String {
    let absolute_path = if target.starts_with("http://") || target.starts_with("https://") {
        Url::parse(target).ok().map(|url| url.path().to_string())
    } else {
        None
    };
    let path = absolute_path.as_deref().unwrap_or_else(|| {
        target
            .split_once('?')
            .map(|(path, _)| path)
            .unwrap_or(target)
    });
    if path.len() > 256 {
        "[path longer than 256 bytes]".to_string()
    } else {
        path.to_string()
    }
}

fn rewrite_csrfguard_domain(
    body: &mut Vec<u8>,
    content_type: &str,
    public_url: &Url,
    local_origin: &str,
) -> bool {
    let is_javascript_servlet = public_url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .is_some_and(|name| name.eq_ignore_ascii_case("JavaScriptServlet"));
    if !is_javascript_servlet || !content_type.to_ascii_lowercase().contains("javascript") {
        return false;
    }
    let Some(public_host) = public_url.host_str() else {
        return false;
    };
    let Some(local_host) = Url::parse(local_origin)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
    else {
        return false;
    };
    if public_host.eq_ignore_ascii_case(&local_host) {
        return false;
    }
    let Ok(script) = std::str::from_utf8(body) else {
        return false;
    };
    // Limit rewriting to the recognizable OWASP-generated script. The token
    // and all request-protection logic remain unchanged; only the domain that
    // is compared with document.domain follows the loopback reverse proxy.
    if !script.contains("OWASP CSRFGuard") || !script.contains(public_host) {
        return false;
    }
    *body = script.replace(public_host, &local_host).into_bytes();
    true
}

fn should_skip_request_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "host"
            | "content-length"
            | "accept-encoding"
            | "cookie"
    )
}

fn should_skip_response_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "content-length"
            // Alternate-service routes describe the appliance origin. If
            // exposed on loopback, an external browser can try to bypass the
            // ConneCat proxy (most commonly via HTTP/3).
            | "alt-svc"
            // Appliance UIs commonly ship headers that are correct on the
            // device origin but break after we re-serve the page from local
            // loopback. CSP in particular can block the app's own JS bundle
            // and leave only the "JavaScript disabled" <noscript> message.
            | "content-security-policy"
            | "content-security-policy-report-only"
            | "x-frame-options"
            | "cross-origin-opener-policy"
            | "cross-origin-embedder-policy"
            | "cross-origin-resource-policy"
    )
}

#[cfg(test)]
mod tests {
    use super::{
        build_client, diagnostic_request_path, open, rewrite_csrfguard_domain, rewrite_location,
        should_skip_request_header, should_skip_response_header,
    };
    use futures_util::{SinkExt, StreamExt};
    use reqwest::header::{CONTENT_ENCODING, CONTENT_LENGTH};
    use std::sync::{Arc, Mutex as StdMutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::http::HeaderValue;
    use tokio_tungstenite::tungstenite::Message;

    #[test]
    fn proxy_owns_request_compression_negotiation() {
        assert!(should_skip_request_header("Accept-Encoding"));
    }

    #[test]
    fn proxy_does_not_expose_upstream_connection_routes() {
        assert!(should_skip_response_header("Transfer-Encoding"));
        assert!(should_skip_response_header("Content-Length"));
        assert!(should_skip_response_header("Alt-Svc"));
    }

    #[test]
    fn diagnostic_path_excludes_queries_and_absolute_url_credentials() {
        assert_eq!(diagnostic_request_path("/status?token=secret"), "/status");
        assert_eq!(
            diagnostic_request_path("https://user:password@example.test/admin?token=secret"),
            "/admin"
        );
    }

    #[test]
    fn redirect_rewrite_normalizes_default_ports() {
        let upstream = reqwest::Url::parse("https://172.18.6.182/").unwrap();
        assert_eq!(
            rewrite_location(
                "https://172.18.6.182:443/login?next=%2F",
                &upstream,
                "http://127.0.0.1:55432"
            ),
            "http://127.0.0.1:55432/login?next=%2F"
        );
        assert_eq!(
            rewrite_location(
                "https://other.example.test/login",
                &upstream,
                "http://127.0.0.1:55432"
            ),
            "https://other.example.test/login"
        );
    }

    #[test]
    fn csrfguard_script_uses_loopback_browser_domain() {
        let public_url =
            reqwest::Url::parse("https://172.18.6.182/admin/JavaScriptServlet").unwrap();
        let mut body = br#"/* OWASP CSRFGuard */ var domainOrigin = '172.18.6.182';"#.to_vec();
        assert!(rewrite_csrfguard_domain(
            &mut body,
            "text/javascript;charset=UTF-8",
            &public_url,
            "http://127.0.0.1:56064"
        ));
        assert_eq!(
            std::str::from_utf8(&body).unwrap(),
            "/* OWASP CSRFGuard */ var domainOrigin = '127.0.0.1';"
        );
    }

    #[tokio::test]
    async fn upstream_compression_is_decoded_before_relay() {
        const GZIP_HELLO: &[u8] = &[
            0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xcb, 0x48, 0xcd, 0xc9,
            0xc9, 0x07, 0x00, 0x86, 0xa6, 0x10, 0x36, 0x05, 0x00, 0x00, 0x00,
        ];
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 4096];
            let _ = stream.read(&mut request).await.unwrap();
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                GZIP_HELLO.len()
            );
            stream.write_all(head.as_bytes()).await.unwrap();
            stream.write_all(GZIP_HELLO).await.unwrap();
        });

        let url = reqwest::Url::parse(&format!("http://{address}/")).unwrap();
        let response = build_client(&url, false)
            .unwrap()
            .get(url)
            .send()
            .await
            .unwrap();
        assert!(!response.headers().contains_key(CONTENT_ENCODING));
        assert!(!response.headers().contains_key(CONTENT_LENGTH));
        assert_eq!(response.bytes().await.unwrap().as_ref(), b"hello");
    }

    #[tokio::test]
    async fn websocket_upgrade_rewrites_origin_and_relays_frames() {
        let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream_address = upstream_listener.local_addr().unwrap();
        let observed = Arc::new(StdMutex::new(None));
        let observed_by_server = observed.clone();
        let upstream_task = tokio::spawn(async move {
            let (stream, _) = upstream_listener.accept().await.unwrap();
            let mut websocket = tokio_tungstenite::accept_hdr_async(
                stream,
                move |request: &tokio_tungstenite::tungstenite::handshake::server::Request,
                      response: tokio_tungstenite::tungstenite::handshake::server::Response| {
                    let host = request
                        .headers()
                        .get("host")
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or("")
                        .to_string();
                    let origin = request
                        .headers()
                        .get("origin")
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or("")
                        .to_string();
                    *observed_by_server.lock().unwrap() = Some((host, origin));
                    Ok(response)
                },
            )
            .await
            .unwrap();
            if let Some(Ok(message)) = websocket.next().await {
                websocket.send(message).await.unwrap();
            }
        });

        let proxy = open(
            format!("http://{upstream_address}"),
            false,
            Some("http://cockpit.example.test:9090".to_string()),
        )
        .await
        .unwrap();
        let websocket_url = format!("ws://{}:{}/cockpit/socket", proxy.host, proxy.port);
        let mut request = websocket_url.into_client_request().unwrap();
        request
            .headers_mut()
            .insert("origin", HeaderValue::from_static("http://127.0.0.1:12345"));
        let (mut browser, _) = tokio_tungstenite::connect_async(request).await.unwrap();
        browser
            .send(Message::Text("cockpit-frame".into()))
            .await
            .unwrap();
        assert_eq!(
            browser.next().await.unwrap().unwrap(),
            Message::Text("cockpit-frame".into())
        );
        browser.close(None).await.unwrap();
        upstream_task.await.unwrap();

        assert_eq!(
            observed.lock().unwrap().clone(),
            Some((
                "cockpit.example.test:9090".to_string(),
                "http://cockpit.example.test:9090".to_string(),
            ))
        );
    }
}

fn authority_for(url: &Url) -> String {
    let Some(host) = url.host_str() else {
        return String::new();
    };
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host,
    }
}

fn origin_for(url: &Url) -> String {
    format!("{}://{}", url.scheme(), authority_for(url))
}

fn request_local_origin(request: &HttpRequest, public_port: u16) -> String {
    request
        .headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("host"))
        .and_then(|(_, value)| {
            let authority = value.trim();
            if authority.is_empty() || authority.contains('/') || authority.contains('\\') {
                None
            } else {
                Some(format!("http://{authority}"))
            }
        })
        .unwrap_or_else(|| format!("http://127.0.0.1:{public_port}"))
}

fn local_origins(local_origin: &str, public_port: u16) -> Vec<String> {
    let mut origins = vec![local_origin.trim_end_matches('/').to_string()];
    for fallback in [
        format!("http://127.0.0.1:{public_port}"),
        format!("http://localhost:{public_port}"),
    ] {
        if !origins.iter().any(|v| v == &fallback) {
            origins.push(fallback);
        }
    }
    origins
}

fn rewrite_request_header(
    name: &str,
    value: &str,
    public_url: &Url,
    local_origin: &str,
    public_port: u16,
) -> String {
    let lower = name.to_ascii_lowercase();
    if lower == "origin" {
        if local_origins(local_origin, public_port)
            .iter()
            .any(|local| value == local)
        {
            return origin_for(public_url);
        }
        return value.to_string();
    }
    if lower == "referer" {
        let public = origin_for(public_url);
        for local in local_origins(local_origin, public_port) {
            if let Some(rest) = value.strip_prefix(&local) {
                return format!("{public}{rest}");
            }
        }
    }
    value.to_string()
}

fn rewrite_location(value: &str, upstream: &Url, local_origin: &str) -> String {
    let local_origin = local_origin.trim_end_matches('/');
    if value.starts_with('/') {
        return value.to_string();
    }
    let Ok(redirect) = Url::parse(value) else {
        return value.to_string();
    };
    if !matches!(redirect.scheme(), "http" | "https") {
        return value.to_string();
    }
    let same_host = redirect.host_str().zip(upstream.host_str()).is_some_and(
        |(redirect_host, upstream_host)| redirect_host.eq_ignore_ascii_case(upstream_host),
    );
    // Treat an explicitly written default port (:443/:80) and an omitted
    // default port as the same origin. String-prefix matching does not.
    let same_port = redirect.port() == upstream.port()
        || (redirect.scheme() == upstream.scheme()
            && redirect.port_or_known_default() == upstream.port_or_known_default());
    if !same_host || !same_port {
        return value.to_string();
    }

    let mut rewritten = format!("{local_origin}{}", redirect.path());
    if let Some(query) = redirect.query() {
        rewritten.push('?');
        rewritten.push_str(query);
    }
    if let Some(fragment) = redirect.fragment() {
        rewritten.push('#');
        rewritten.push_str(fragment);
    }
    rewritten
}

fn rewrite_set_cookie(value: &str) -> String {
    let mut parts = value.split(';');
    let Some(name_value) = parts.next() else {
        return value.to_string();
    };
    let cookie_name = name_value
        .split_once('=')
        .map(|(name, _)| name.trim())
        .unwrap_or("");
    let requires_secure_prefix =
        cookie_name.starts_with("__Host-") || cookie_name.starts_with("__Secure-");

    let mut rewritten = vec![name_value.trim().to_string()];
    for part in parts {
        let trimmed = part.trim();
        if trimmed.eq_ignore_ascii_case("secure") {
            if requires_secure_prefix {
                rewritten.push(trimmed.to_string());
            }
            continue;
        }
        if trimmed.eq_ignore_ascii_case("partitioned")
            || trimmed.to_ascii_lowercase().starts_with("domain=")
        {
            continue;
        }
        if trimmed.eq_ignore_ascii_case("samesite=none") {
            rewritten.push("SameSite=Lax".to_string());
        } else {
            rewritten.push(trimmed.to_string());
        }
    }
    rewritten.join("; ")
}

fn format_error_chain(error: &anyhow::Error) -> String {
    error
        .chain()
        .enumerate()
        .map(|(idx, cause)| {
            if idx == 0 {
                cause.to_string()
            } else {
                format!("caused by: {cause}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

async fn write_error_response(
    stream: &mut TcpStream,
    status: u16,
    title: &str,
    detail: &str,
) -> Result<()> {
    let body = format!("{title}\n{detail}\n");
    let response = format!(
        "HTTP/1.1 {status} Bad Gateway\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .await
        .context("write proxy error")
}

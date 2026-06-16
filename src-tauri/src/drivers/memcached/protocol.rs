use crate::connection::model::ConnectionConfig;
use crate::error::AppError;
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::net::TcpStream;

/// A single key-value entry from memcached.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemcachedEntry {
    pub key: String,
    pub flags: u32,
    pub size_bytes: u64,
    pub expiration: Option<i64>,
    pub value: Option<String>,
}

/// Result of listing keys from memcached.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemcachedKeyList {
    pub keys: Vec<String>,
    pub total_keys: usize,
    pub truncated: bool,
}

/// Server info from memcached stats.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemcachedServerInfo {
    pub version: String,
    pub uptime_seconds: u64,
    pub curr_items: u64,
    pub total_items: u64,
    pub bytes_used: u64,
    pub limit_maxbytes: u64,
    pub curr_connections: u64,
    pub total_connections: u64,
}

pub struct MemcachedDriver;

impl MemcachedDriver {
    /// Connect to a memcached server and return version string.
    pub async fn test(config: &ConnectionConfig) -> Result<String, AppError> {
        let stream = connect_tcp(config).await?;
        let (reader, mut writer) = split_stream(stream);
        let info = stats(reader, &mut writer).await?;
        Ok(format!("memcached {}", info.version))
    }

    /// List all keys from the memcached server.
    /// Uses `lru_crawler metadump all` if available, falls back to `stats cachedump`.
    pub async fn list_keys(
        config: &ConnectionConfig,
        search: Option<&str>,
    ) -> Result<MemcachedKeyList, AppError> {
        let stream = connect_tcp(config).await?;
        let (reader, mut writer) = split_stream(stream);
        let all_keys = metadump_all(reader, &mut writer).await?;

        let filtered: Vec<String> = if let Some(pat) = search {
            let lower = pat.to_lowercase();
            all_keys
                .into_iter()
                .filter(|k| k.to_lowercase().contains(&lower))
                .collect()
        } else {
            all_keys
        };

        let total = filtered.len();
        // Cap at 5000 keys to avoid overwhelming the frontend
        let truncated = total > 5000;
        let keys: Vec<String> = filtered.into_iter().take(5000).collect();

        Ok(MemcachedKeyList {
            total_keys: keys.len(),
            keys,
            truncated,
        })
    }

    /// Get a single key's value and metadata.
    pub async fn get_item(
        config: &ConnectionConfig,
        key: &str,
    ) -> Result<MemcachedEntry, AppError> {
        let stream = connect_tcp(config).await?;
        let (mut reader, mut writer) = split_stream(stream);

        let cmd = format!("get {key}\r\n");
        writer.write_all(cmd.as_bytes()).await?;
        writer.flush().await?;

        let mut line = String::new();
        reader.read_line(&mut line).await?;

        if line == "END\r\n" {
            return Err(AppError::KeyNotFound(key.to_string()));
        }

        // Parse VALUE line: VALUE <key> <flags> <bytes> [<cas>]
        let parts: Vec<&str> = line.trim_end_matches("\r\n").split(' ').collect();
        if parts.len() < 4 || parts[0] != "VALUE" {
            return Err(AppError::MemcachedProtocolError(format!(
                "unexpected response: {line}"
            )));
        }

        let flags: u32 = parts[2]
            .parse()
            .map_err(|_| AppError::MemcachedProtocolError("invalid flags".into()))?;
        let byte_count: usize = parts[3]
            .parse()
            .map_err(|_| AppError::MemcachedProtocolError("invalid byte count".into()))?;

        // Read data block
        let mut data_buf = vec![0u8; byte_count + 2]; // +2 for trailing \r\n
        reader.read_exact(&mut data_buf).await?;
        let value = String::from_utf8_lossy(&data_buf[..byte_count]).to_string();

        // Read END
        let mut end_line = String::new();
        reader.read_line(&mut end_line).await?;

        Ok(MemcachedEntry {
            key: key.to_string(),
            flags,
            size_bytes: byte_count as u64,
            expiration: None,
            value: Some(value),
        })
    }

    /// Delete a key from memcached.
    pub async fn delete_item(
        config: &ConnectionConfig,
        key: &str,
    ) -> Result<(), AppError> {
        let stream = connect_tcp(config).await?;
        let (mut reader, mut writer) = split_stream(stream);

        let cmd = format!("delete {key}\r\n");
        writer.write_all(cmd.as_bytes()).await?;
        writer.flush().await?;

        let mut line = String::new();
        reader.read_line(&mut line).await?;

        match line.trim_end_matches("\r\n") {
            "DELETED" => Ok(()),
            "NOT_FOUND" => Err(AppError::KeyNotFound(key.to_string())),
            other => Err(AppError::MemcachedProtocolError(format!(
                "unexpected delete response: {other}"
            ))),
        }
    }

    /// Flush all keys from memcached.
    pub async fn flush_all(config: &ConnectionConfig) -> Result<(), AppError> {
        let stream = connect_tcp(config).await?;
        let (mut reader, mut writer) = split_stream(stream);

        writer.write_all(b"flush_all\r\n").await?;
        writer.flush().await?;

        let mut line = String::new();
        reader.read_line(&mut line).await?;

        if line.trim_end_matches("\r\n") == "OK" {
            Ok(())
        } else {
            Err(AppError::MemcachedProtocolError(format!(
                "unexpected flush_all response: {line}"
            )))
        }
    }

    /// Get full server stats.
    pub async fn get_stats(
        config: &ConnectionConfig,
    ) -> Result<MemcachedServerInfo, AppError> {
        let stream = connect_tcp(config).await?;
        let (reader, mut writer) = split_stream(stream);
        stats(reader, &mut writer).await
    }
}

// ── Internal helpers ──

async fn connect_tcp(config: &ConnectionConfig) -> Result<TcpStream, AppError> {
    let addr = format!("{}:{}", config.host, config.port);
    let stream = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        TcpStream::connect(&addr),
    )
    .await
    .map_err(|_| AppError::ConnectionFailed(format!("连接超时: {addr}")))?
    .map_err(|e| AppError::ConnectionFailed(format!("无法连接到 {addr}: {e}")))?;

    Ok(stream)
}

fn split_stream(
    stream: TcpStream,
) -> (
    BufReader<tokio::io::ReadHalf<TcpStream>>,
    BufWriter<tokio::io::WriteHalf<TcpStream>>,
) {
    let (rh, wh) = tokio::io::split(stream);
    (BufReader::new(rh), BufWriter::new(wh))
}

async fn stats(
    mut reader: BufReader<tokio::io::ReadHalf<TcpStream>>,
    writer: &mut BufWriter<tokio::io::WriteHalf<TcpStream>>,
) -> Result<MemcachedServerInfo, AppError> {
    writer.write_all(b"stats\r\n").await?;
    writer.flush().await?;

    let mut version = String::new();
    let mut uptime = 0u64;
    let mut curr_items = 0u64;
    let mut total_items = 0u64;
    let mut bytes_used = 0u64;
    let mut limit_maxbytes = 0u64;
    let mut curr_connections = 0u64;
    let mut total_connections = 0u64;

    loop {
        let mut line = String::new();
        reader.read_line(&mut line).await?;

        if line == "END\r\n" {
            break;
        }

        let trimmed = line.trim_end_matches("\r\n");
        let parts: Vec<&str> = trimmed.splitn(3, ' ').collect();
        if parts.len() >= 3 && parts[0] == "STAT" {
            match parts[1] {
                "version" => version = parts[2].to_string(),
                "uptime" => uptime = parts[2].parse().unwrap_or(0),
                "curr_items" => curr_items = parts[2].parse().unwrap_or(0),
                "total_items" => total_items = parts[2].parse().unwrap_or(0),
                "bytes" => bytes_used = parts[2].parse().unwrap_or(0),
                "limit_maxbytes" => limit_maxbytes = parts[2].parse().unwrap_or(0),
                "curr_connections" => curr_connections = parts[2].parse().unwrap_or(0),
                "total_connections" => total_connections = parts[2].parse().unwrap_or(0),
                _ => {}
            }
        }
    }

    Ok(MemcachedServerInfo {
        version,
        uptime_seconds: uptime,
        curr_items,
        total_items,
        bytes_used,
        limit_maxbytes,
        curr_connections,
        total_connections,
    })
}

/// Collect all keys using `lru_crawler metadump all`, falling back to
/// `stats items` + `stats cachedump` slab-by-slab.
async fn metadump_all(
    mut reader: BufReader<tokio::io::ReadHalf<TcpStream>>,
    writer: &mut BufWriter<tokio::io::WriteHalf<TcpStream>>,
) -> Result<Vec<String>, AppError> {
    // Try lru_crawler metadump first
    writer.write_all(b"lru_crawler metadump all\r\n").await?;
    writer.flush().await?;

    let mut keys = Vec::new();
    let mut line = String::new();
    reader.read_line(&mut line).await?;

    if line.starts_with("ERROR") || line.starts_with("CLIENT_ERROR") {
        // Fallback to stats cachedump
        return cachedump_fallback(reader, writer).await;
    }

    // Parse first line of metadump (which we already have)
    parse_metadump_line(&line, &mut keys);

    loop {
        let mut next = String::new();
        reader.read_line(&mut next).await?;
        if next == "END\r\n" {
            break;
        }
        parse_metadump_line(&next, &mut keys);
    }

    Ok(keys)
}

fn parse_metadump_line(line: &str, keys: &mut Vec<String>) {
    let trimmed = line.trim_end_matches("\r\n");
    // key=somekey exp=... la=... ...
    if let Some(key_part) = trimmed.split(' ').next() {
        if let Some(key) = key_part.strip_prefix("key=") {
            if !key.is_empty() {
                keys.push(percent_decode(key));
            }
        }
    }
}

async fn cachedump_fallback(
    mut reader: BufReader<tokio::io::ReadHalf<TcpStream>>,
    writer: &mut BufWriter<tokio::io::WriteHalf<TcpStream>>,
) -> Result<Vec<String>, AppError> {
    // Get slab IDs from stats items
    writer.write_all(b"stats items\r\n").await?;
    writer.flush().await?;

    let mut slab_ids = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).await?;
        if line == "END\r\n" {
            break;
        }
        let trimmed = line.trim_end_matches("\r\n");
        let parts: Vec<&str> = trimmed.splitn(3, ' ').collect();
        if parts.len() >= 3 && parts[0] == "STAT" && parts[1].starts_with("items:") {
            // STAT items:1:number 42 → slab 1
            let slab_part = parts[1].strip_prefix("items:").unwrap_or("");
            if let Some(slab_id) = slab_part.split(':').next() {
                if !slab_ids.contains(&slab_id.to_string()) {
                    slab_ids.push(slab_id.to_string());
                }
            }
        }
    }

    let mut keys = Vec::new();

    // We need a fresh connection for cachedump since the previous read consumed END
    // But we already have the reader/writer — let's try on the same connection
    for slab_id in &slab_ids {
        let cmd = format!("stats cachedump {slab_id} 0\r\n");
        writer.write_all(cmd.as_bytes()).await?;
        writer.flush().await?;

        loop {
            let mut line = String::new();
            reader.read_line(&mut line).await?;
            if line == "END\r\n" {
                break;
            }
            let trimmed = line.trim_end_matches("\r\n");
            // ITEM <key> [<bytes> b; <exp> s]
            let parts: Vec<&str> = trimmed.splitn(2, ' ').collect();
            if parts.len() >= 2 && parts[0] == "ITEM" {
                let key = parts[1]
                    .split(' ')
                    .next()
                    .unwrap_or("");
                if !key.is_empty() {
                    keys.push(key.to_string());
                }
            }
        }
    }

    Ok(keys)
}

/// Decode percent-encoded keys from memcached metadump output.
/// `lru_crawler metadump all` double-encodes keys (e.g. `%253A` instead of `%3A`).
/// We decode exactly one pass to recover the actual stored key.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(hi << 4 | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'A'..=b'F' => Some(b - b'A' + 10),
        b'a'..=b'f' => Some(b - b'a' + 10),
        _ => None,
    }
}

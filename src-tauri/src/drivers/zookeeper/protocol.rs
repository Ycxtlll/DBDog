use crate::connection::model::ConnectionConfig;
use crate::error::AppError;
use serde::Serialize;
use std::time::Duration;
use zookeeper::CreateMode;

use super::raw_client::{self, ZkRawClient};

/// A single ZooKeeper node (znode).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZkNode {
    pub path: String,
    pub data: String,
    pub data_length: u32,
    pub num_children: u32,
    pub czxid: i64,
    pub mzxid: i64,
    pub ctime: i64,
    pub mtime: i64,
    pub version: i32,
    pub child_version: i32,
    pub acl_version: i32,
    pub ephemeral_owner: i64,
    pub pzxid: i64,
}

/// A flat list of child nodes at a given path (for the sidebar tree).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZkChildList {
    pub path: String,
    pub children: Vec<String>,
    pub total_children: usize,
    pub truncated: bool,
}

/// Tree node for recursive tree building.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZkTreeNode {
    pub name: String,
    pub path: String,
    pub num_children: u32,
    pub is_ephemeral: bool,
    pub children: Option<Vec<ZkTreeNode>>,
}

/// Server info from ZooKeeper `mntr` four-letter word.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZkServerInfo {
    pub mode: String,
    pub version: String,
    pub znode_count: u64,
    pub connections: u64,
    pub outstanding: u64,
    pub latency_avg: f64,
    pub latency_min: f64,
    pub latency_max: f64,
    pub received: u64,
    pub sent: u64,
}

/// Stateless driver — every method opens a fresh ZK connection, operates,
/// and cleanly closes it inside a single `spawn_blocking`.
pub struct ZkDriver;

impl ZkDriver {
    /// Create a ZK connection, probe "/", run `f`, then close.
    async fn with_zk<T, F>(config: &ConnectionConfig, f: F) -> Result<T, AppError>
    where
        F: FnOnce(&mut ZkRawClient) -> Result<T, AppError> + Send + 'static,
        T: Send + 'static,
    {
        let host = config.host.clone();
        let port = config.port;

        tokio::task::spawn_blocking(move || {
            let mut client = ZkRawClient::connect(&host, port, Duration::from_secs(10))?;

            // Probe the session
            client
                .get_children("/")
                .map_err(|e| AppError::ConnectionFailed(format!("ZK 会话建立失败: {e}")))?;

            let result = f(&mut client);

            // Close MUST happen inside spawn_blocking — clean TCP shutdown
            if let Err(e) = client.close() {
                if result.is_err() {
                    return Err(AppError::ZookeeperError(format!("ZK close failed: {e}")));
                }
            }

            result
        })
        .await
        .map_err(|e| AppError::ZookeeperError(format!("spawn_blocking 失败: {e}")))?
    }

    /// Test connection — probe "/".
    pub async fn test(config: &ConnectionConfig) -> Result<String, AppError> {
        Self::with_zk(config, |zk| {
            let count = zk.get_children("/").map(|c| c.len()).map_err(|e| {
                AppError::ConnectionFailed(format!("ZK 测试失败: {e}"))
            })?;
            Ok(format!("ZooKeeper ({} children at /)", count))
        })
        .await
    }

    pub async fn list_children(
        config: &ConnectionConfig,
        path: &str,
    ) -> Result<ZkChildList, AppError> {
        let p = if path.is_empty() {
            "/".to_string()
        } else {
            path.to_string()
        };

        Self::with_zk(config, move |zk| {
            let children = zk
                .get_children(&p)?;

            let total = children.len();
            let truncated = total > 10000;
            let limited: Vec<String> = children.into_iter().take(10000).collect();

            Ok(ZkChildList {
                path: p.clone(),
                children: limited,
                total_children: total,
                truncated,
            })
        })
        .await
    }

    pub async fn get_node(
        config: &ConnectionConfig,
        path: &str,
    ) -> Result<ZkNode, AppError> {
        let p = if path.is_empty() {
            "/".to_string()
        } else {
            path.to_string()
        };

        Self::with_zk(config, move |zk| {
            let (data, stat) = zk.get_data(&p)?;
            let text = String::from_utf8_lossy(&data).to_string();

            Ok(ZkNode {
                path: p.clone(),
                data: text,
                data_length: stat.data_length as u32,
                num_children: stat.num_children as u32,
                czxid: stat.czxid,
                mzxid: stat.mzxid,
                ctime: stat.ctime,
                mtime: stat.mtime,
                version: stat.version,
                child_version: stat.cversion,
                acl_version: stat.aversion,
                ephemeral_owner: stat.ephemeral_owner,
                pzxid: stat.pzxid,
            })
        })
        .await
    }

    pub async fn create_node(
        config: &ConnectionConfig,
        path: &str,
        data: &str,
        ephemeral: bool,
        sequential: bool,
    ) -> Result<String, AppError> {
        let p = path.to_string();
        let d = data.to_string();

        Self::with_zk(config, move |zk| {
            let mode = match (ephemeral, sequential) {
                (false, false) => CreateMode::Persistent,
                (false, true) => CreateMode::PersistentSequential,
                (true, false) => CreateMode::Ephemeral,
                (true, true) => CreateMode::EphemeralSequential,
            };

            let (acls, flags) = raw_client::create_mode_flags(mode, ephemeral, sequential);
            zk.create(&p, d.as_bytes(), &acls, flags)
        })
        .await
    }

    pub async fn delete_node(
        config: &ConnectionConfig,
        path: &str,
    ) -> Result<(), AppError> {
        let p = path.to_string();

        Self::with_zk(config, move |zk| {
            // Get current version for conditional delete
            let (_, stat) = zk.get_data(&p)?;
            zk.delete(&p, stat.version)
        })
        .await
    }

    pub async fn set_data(
        config: &ConnectionConfig,
        path: &str,
        data: &str,
    ) -> Result<ZkNode, AppError> {
        let p = path.to_string();
        let d = data.to_string();
        Self::with_zk(config, move |zk| {
            let (_, stat) = zk.get_data(&p)?;
            let new_stat = zk
                .set_data(&p, d.as_bytes(), stat.version)?;

            Ok(ZkNode {
                path: p.clone(),
                data: d,
                data_length: new_stat.data_length as u32,
                num_children: new_stat.num_children as u32,
                czxid: new_stat.czxid,
                mzxid: new_stat.mzxid,
                ctime: new_stat.ctime,
                mtime: new_stat.mtime,
                version: new_stat.version,
                child_version: new_stat.cversion,
                acl_version: new_stat.aversion,
                ephemeral_owner: new_stat.ephemeral_owner,
                pzxid: new_stat.pzxid,
            })
        })
        .await
    }

    pub async fn get_tree(
        config: &ConnectionConfig,
        path: &str,
        max_depth: u32,
    ) -> Result<ZkTreeNode, AppError> {
        let p = if path.is_empty() {
            "/".to_string()
        } else {
            path.to_string()
        };

        Self::with_zk(config, move |zk| build_tree(zk, &p, "", 0, max_depth)).await
    }

    /// Get server info via `mntr` four-letter word over raw TCP (no ZK session needed).
    pub async fn get_server_info(
        config: &ConnectionConfig,
    ) -> Result<ZkServerInfo, AppError> {
        let addr = format!("{}:{}", config.host, config.port);
        let stream = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::net::TcpStream::connect(&addr),
        )
        .await
        .map_err(|_| AppError::ConnectionFailed("ZK 连接超时".into()))?
        .map_err(|e| AppError::ConnectionFailed(format!("无法连接 ZK: {e}")))?;

        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let (mut reader, mut writer) = stream.into_split();

        writer.write_all(b"mntr").await?;
        writer.shutdown().await?;

        let mut response = Vec::new();
        reader.read_to_end(&mut response).await?;

        let text = String::from_utf8_lossy(&response);
        parse_mntr(&text)
    }
}

// ── Internal helpers ──────────────────────────────────────────────────

fn build_tree(
    zk: &mut ZkRawClient,
    root: &str,
    name: &str,
    depth: u32,
    max_depth: u32,
) -> Result<ZkTreeNode, AppError> {
    let children = zk
        .get_children(root)?;

    let (is_ephemeral, num_children) = match zk.get_data(root) {
        Ok((_, stat)) => (stat.ephemeral_owner != 0, stat.num_children as u32),
        Err(_) => (false, children.len() as u32),
    };

    let child_nodes = if depth < max_depth && !children.is_empty() {
        let mut nodes = Vec::new();
        let limit = children.len().min(200);
        let mut sorted = children.clone();
        sorted.sort();
        for child in sorted.into_iter().take(limit) {
            let child_path = if root == "/" {
                format!("/{child}")
            } else {
                format!("{root}/{child}")
            };
            match build_tree(zk, &child_path, &child, depth + 1, max_depth) {
                Ok(node) => nodes.push(node),
                Err(_) => continue,
            }
        }
        Some(nodes)
    } else if !children.is_empty() {
        Some(vec![])
    } else {
        None
    };

    Ok(ZkTreeNode {
        name: if name.is_empty() {
            root.to_string()
        } else {
            name.to_string()
        },
        path: root.to_string(),
        num_children,
        is_ephemeral,
        children: child_nodes,
    })
}

fn parse_mntr(response: &str) -> Result<ZkServerInfo, AppError> {
    let mut mode = String::new();
    let mut version = String::new();

    let mut znode_count = 0u64;
    let mut connections = 0u64;
    let mut outstanding = 0u64;
    let mut latency_avg = 0.0f64;
    let mut latency_min = 0.0f64;
    let mut latency_max = 0.0f64;
    let mut received = 0u64;
    let mut sent = 0u64;

    for line in response.lines() {
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        if parts.len() < 2 {
            continue;
        }
        match parts[0] {
            "zk_server_state" => mode = parts[1].to_string(),
            "zk_version" => version = parts[1].to_string(),
            "zk_znode_count" => znode_count = parts[1].parse().unwrap_or(0),
            "zk_watch_count" => {}
            "zk_num_alive_connections" => connections = parts[1].parse().unwrap_or(0),
            "zk_outstanding_requests" => outstanding = parts[1].parse().unwrap_or(0),
            "zk_avg_latency" => latency_avg = parts[1].parse().unwrap_or(0.0),
            "zk_min_latency" => latency_min = parts[1].parse().unwrap_or(0.0),
            "zk_max_latency" => latency_max = parts[1].parse().unwrap_or(0.0),
            "zk_packets_received" => received = parts[1].parse().unwrap_or(0),
            "zk_packets_sent" => sent = parts[1].parse().unwrap_or(0),
            _ => {}
        }
    }

    if version.is_empty() {
        version = "unknown".to_string();
    }
    if mode.is_empty() {
        mode = "unknown".to_string();
    }

    Ok(ZkServerInfo {
        mode,
        version,
        znode_count,
        connections,
        outstanding,
        latency_avg,
        latency_min,
        latency_max,
        received,
        sent,
    })
}

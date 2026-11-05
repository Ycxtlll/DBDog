use crate::connection::model::{ConnectionConfig, DatabaseType, ServerInfo};
use crate::drivers::memcached::MemcachedDriver;
use crate::drivers::zookeeper::ZkDriver;
use crate::drivers::mysql::metadata::MySqlDriver;
use crate::drivers::postgres::PgDriver;
use crate::drivers::{DatabaseDriver, DatabaseMetadata};
use crate::error::AppError;
use crate::state::AppState;
use serde::Serialize;
use std::time::Instant;
use uuid::Uuid;

#[tauri::command]
pub async fn list_connections(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ConnectionConfig>, AppError> {
    state.storage.load_all().await
}

#[tauri::command]
pub async fn save_connection(
    state: tauri::State<'_, AppState>,
    config: ConnectionConfig,
) -> Result<ConnectionConfig, AppError> {
    state.storage.save(&config).await?;
    Ok(config)
}

#[tauri::command]
pub async fn delete_connection(
    state: tauri::State<'_, AppState>,
    id: Uuid,
) -> Result<(), AppError> {
    state.pool_manager.disconnect(&id).await;
    state.pg_pool_manager.disconnect(&id).await;
    stop_tunnel(&state, id).await;
    state.schema_cache.invalidate_connection(&id);
    state.session_databases.remove(&id);
    state.storage.delete(id).await
}

/// Kill the SSH tunnel process previously started for this connection.
async fn stop_tunnel(state: &AppState, id: Uuid) {
    if let Some((_, mut child)) = state.ssh_processes.remove(&id) {
        let _ = child.kill().await;
    }
}

/// When the config enables an SSH tunnel, spawn `ssh -N -L` on a free local
/// port and point the config's host/port at that forward. Uses the system
/// OpenSSH client, so auth is key-file / agent only (the CLI cannot answer
/// interactive password prompts — BatchMode fails fast instead of hanging).
async fn start_tunnel_if_enabled(
    state: &AppState,
    id: Uuid,
    config: &mut ConnectionConfig,
) -> Result<(), AppError> {
    if !config.ssh_enabled.unwrap_or(false) {
        return Ok(());
    }
    let ssh_host = config
        .ssh_host
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::ConfigError("SSH 隧道需要填写 SSH 主机".to_string()))?;
    let ssh_user = config
        .ssh_user
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::ConfigError("SSH 隧道需要填写 SSH 用户".to_string()))?;
    let ssh_port = config.ssh_port.unwrap_or(22);

    // Find a free local port for the forward.
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| AppError::ConfigError(format!("no free local port: {}", e)))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| AppError::ConfigError(format!("no free local port: {}", e)))?
        .port();
    drop(listener);

    let mut cmd = tokio::process::Command::new("ssh");
    cmd.arg("-N")
        .arg("-T")
        .args(["-o", "ExitOnForwardFailure=yes"])
        .args(["-o", "StrictHostKeyChecking=accept-new"])
        .args(["-o", "BatchMode=yes"]);
    if let Some(key) = config.ssh_key_path.as_deref().filter(|s| !s.is_empty()) {
        cmd.args(["-i", key]);
    }
    cmd.args(["-p", &ssh_port.to_string()]);
    cmd.arg("-L").arg(format!(
        "127.0.0.1:{}:{}:{}",
        local_port, config.host, config.port
    ));
    cmd.arg(format!("{}@{}", ssh_user, ssh_host));
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        AppError::ConfigError(format!(
            "无法启动 ssh（{}）。SSH 隧道依赖系统 OpenSSH，且仅支持密钥/agent 认证",
            e
        ))
    })?;

    // Wait until the forward answers — or ssh exits early (bad key, refused
    // auth), in which case surface its stderr.
    let started = Instant::now();
    loop {
        if started.elapsed() > std::time::Duration::from_secs(10) {
            let _ = child.kill().await;
            return Err(AppError::ConfigError(
                "SSH 隧道 10 秒内未就绪（目标端口不可达或认证失败）".to_string(),
            ));
        }
        match child.try_wait() {
            Ok(Some(_status)) => {
                let output = child.wait_with_output().await;
                let stderr = output
                    .ok()
                    .map(|o| String::from_utf8_lossy(&o.stderr).trim().to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "ssh exited immediately (key rejected? host unreachable?)".to_string());
                return Err(AppError::ConfigError(format!("SSH 隧道启动失败: {}", stderr)));
            }
            Ok(None) => {}
            Err(e) => return Err(AppError::ConfigError(format!("ssh: {}", e))),
        }
        if tokio::net::TcpStream::connect(("127.0.0.1", local_port))
            .await
            .is_ok()
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }

    // Replace any previous tunnel for this connection.
    if let Some(mut old) = state.ssh_processes.insert(id, child) {
        let _ = old.kill().await;
    }

    config.host = "127.0.0.1".to_string();
    config.port = local_port;
    Ok(())
}

#[tauri::command]
pub async fn test_connection(
    state: tauri::State<'_, AppState>,
    config: ConnectionConfig,
) -> Result<String, AppError> {
    // When editing a saved connection the form leaves the password blank
    // ("keep existing"); merge the stored credential so Test actually works.
    let mut config = merge_stored_password(&state, config).await;
    if matches!(config.db_type, DatabaseType::Mysql | DatabaseType::Postgresql) {
        start_tunnel_if_enabled(&state, config.id, &mut config).await?;
    }
    let result = match config.db_type {
        DatabaseType::Mysql => {
            let driver = MySqlDriver::new();
            driver.test(&config).await
        }
        DatabaseType::Postgresql => PgDriver::new().test(&config).await,
        DatabaseType::Memcached => MemcachedDriver::test(&config).await,
        DatabaseType::Zookeeper => ZkDriver::test(&config).await,
    };
    // A one-shot test must not leak the tunnel process.
    stop_tunnel(&state, config.id).await;
    result
}

/// When editing a saved connection the form leaves the password blank
/// ("keep existing"); merge the stored credential back in.
async fn merge_stored_password(
    state: &AppState,
    config: ConnectionConfig,
) -> ConnectionConfig {
    if config.db_type == DatabaseType::Mysql && config.password.is_none() {
        match state.storage.load_all().await {
            Ok(configs) => configs
                .into_iter()
                .find(|c| c.id == config.id)
                .map(|stored| {
                    let mut merged = config.clone();
                    merged.password = stored.password;
                    merged
                })
                .unwrap_or(config),
            Err(_) => config,
        }
    } else {
        config
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticStep {
    /// Stable machine name (resolve/tcp/handshake/auth/grants); the frontend
    /// renders localized labels.
    pub name: String,
    pub ok: bool,
    pub detail: String,
    pub latency_ms: Option<u64>,
}

/// Connection doctor: walk the MySQL connect path step by step — DNS
/// resolve, TCP (IPv4 preferred: WSL/NAT setups often forward only
/// 127.0.0.1 while a dead ::1 breaks naive ordering), server handshake
/// (version + auth plugin), login, grant overview. Stops at the first
/// failing step so the user sees exactly where it broke.
#[tauri::command]
pub async fn diagnose_connection(
    state: tauri::State<'_, AppState>,
    config: ConnectionConfig,
) -> Result<Vec<DiagnosticStep>, AppError> {
    if config.db_type != DatabaseType::Mysql {
        return Err(AppError::DriverNotSupported(
            "Diagnostics are available for MySQL connections".to_string(),
        ));
    }
    let mut steps: Vec<DiagnosticStep> = Vec::new();
    let push = |steps: &mut Vec<DiagnosticStep>, name: &str, ok: bool, detail: String, started: Instant| {
        steps.push(DiagnosticStep {
            name: name.to_string(),
            ok,
            detail,
            latency_ms: Some(started.elapsed().as_millis() as u64),
        });
    };

    // 1. DNS resolve
    let started = Instant::now();
    let addrs: Vec<std::net::SocketAddr> = match tokio::net::lookup_host((
        config.host.as_str(),
        config.port,
    ))
    .await
    {
        Ok(addrs) => {
            let all: Vec<std::net::SocketAddr> = addrs.collect();
            let v4 = all.iter().filter(|a| a.is_ipv4()).count();
            let v6 = all.iter().filter(|a| a.is_ipv6()).count();
            let detail = format!("{}: {} IPv4, {} IPv6", config.host, v4, v6);
            push(&mut steps, "resolve", true, detail, started);
            // IPv4 first — see the doc comment.
            let mut sorted = all;
            sorted.sort_by_key(|a| a.is_ipv6());
            sorted
        }
        Err(e) => {
            push(
                &mut steps,
                "resolve",
                false,
                format!("{}: {}", config.host, e),
                started,
            );
            return Ok(steps);
        }
    };

    // 2. TCP connect
    let started = Instant::now();
    let mut stream: Option<tokio::net::TcpStream> = None;
    let mut last_err = String::new();
    for addr in &addrs {
        match tokio::time::timeout(
            std::time::Duration::from_secs(3),
            tokio::net::TcpStream::connect(addr),
        )
        .await
        {
            Ok(Ok(s)) => {
                stream = Some(s);
                push(
                    &mut steps,
                    "tcp",
                    true,
                    format!("{} connected", addr),
                    started,
                );
                break;
            }
            Ok(Err(e)) => last_err = format!("{}: {}", addr, e),
            Err(_) => last_err = format!("{}: timeout (3s)", addr),
        }
    }
    if stream.is_none() {
        push(&mut steps, "tcp", false, last_err, started);
        return Ok(steps);
    }
    let mut stream = stream.unwrap();

    // 3. MySQL handshake — read the greeting packet on the same socket and
    // pull out the server version and default auth plugin.
    let started = Instant::now();
    let greeting = read_greeting(&mut stream).await;
    match greeting {
        Some((version, plugin)) => {
            let detail = format!("MySQL {} (auth: {})", version, plugin);
            push(&mut steps, "handshake", true, detail, started);
        }
        None => {
            push(
                &mut steps,
                "handshake",
                false,
                "not a MySQL server (no valid greeting packet)".to_string(),
                started,
            );
            return Ok(steps);
        }
    }

    // 4. Login (sqlx full auth incl. caching_sha2 over RSA)
    let config = merge_stored_password(&state, config).await;
    let started = Instant::now();
    let driver = MySqlDriver::new();
    let pool = match driver.connect(&config).await {
        Ok(pool) => {
            let user = config.username.clone();
            push(&mut steps, "auth", true, format!("logged in as {}", user), started);
            pool
        }
        Err(e) => {
            push(&mut steps, "auth", false, e.to_string(), started);
            return Ok(steps);
        }
    };

    // 5. Grant overview
    let started = Instant::now();
    let grants: Vec<(String,)> =
        sqlx::query_as("SHOW GRANTS").fetch_all(&pool).await?;
    let is_admin = grants
        .iter()
        .any(|(g,)| g.to_uppercase().contains("ALL PRIVILEGES"));
    let detail = if is_admin {
        format!("{} grant entries (administrator)", grants.len())
    } else {
        format!("{} grant entries", grants.len())
    };
    push(&mut steps, "grants", true, detail, started);
    pool.close().await;

    Ok(steps)
}

/// Read and parse a MySQL handshake greeting: returns (server version,
/// auth plugin name).
async fn read_greeting(stream: &mut tokio::net::TcpStream) -> Option<(String, String)> {
    let mut header = [0u8; 4];
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        tokio::io::AsyncReadExt::read_exact(stream, &mut header),
    )
    .await
    .ok()?
    .ok()?;
    let len = u32::from_le_bytes([header[0], header[1], header[2], 0]) as usize;
    let mut payload = vec![0u8; len];
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        tokio::io::AsyncReadExt::read_exact(stream, &mut payload),
    )
    .await
    .ok()?
    .ok()?;

    // payload[0] = protocol version (10); then NUL-terminated server version.
    if payload.first() != Some(&10) {
        return None;
    }
    let rest = &payload[1..];
    let version_end = rest.iter().position(|&b| b == 0)?;
    let version = String::from_utf8_lossy(&rest[..version_end]).into_owned();
    let plugin = [
        "caching_sha2_password",
        "mysql_native_password",
        "sha256_password",
        "mysql_clear_password",
    ]
    .iter()
    .find(|name| {
        let bytes = name.as_bytes();
        rest.windows(bytes.len()).any(|w| w == bytes)
    })
    .map(|s| s.to_string())
    .unwrap_or_else(|| "unknown".to_string());
    Some((version, plugin))
}

#[tauri::command]
pub async fn connect(
    state: tauri::State<'_, AppState>,
    id: Uuid,
) -> Result<ServerInfo, AppError> {
    let configs = state.storage.load_all().await?;
    let config = configs
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::ConnectionNotFound(id.to_string()))?;

    match config.db_type {
        DatabaseType::Memcached => {
            let version = MemcachedDriver::test(&config).await?;
            Ok(ServerInfo {
                version,
                connection_id: format!("{}:{}", config.host, config.port),
            })
        }
        DatabaseType::Zookeeper => {
            let version = ZkDriver::test(&config).await?;
            Ok(ServerInfo {
                version,
                connection_id: format!("{}:{}", config.host, config.port),
            })
        }
        DatabaseType::Mysql => connect_mysql(state, id, config).await,
        DatabaseType::Postgresql => connect_pg(state, id, config).await,
    }
}


async fn connect_mysql(
    state: tauri::State<'_, AppState>,
    id: Uuid,
    mut config: ConnectionConfig,
) -> Result<ServerInfo, AppError> {
    if state.pool_manager.is_connected(&id) {
        if let Some(pool) = state.pool_manager.get(&id) {
            if let Ok(row) = sqlx::query_as::<_, (String, u64)>(
                "SELECT VERSION(), CONNECTION_ID()",
            )
            .fetch_one(&pool)
            .await
            {
                return Ok(ServerInfo {
                    version: row.0,
                    connection_id: row.1.to_string(),
                });
            }
        }
        // Probe on the existing pool failed — drop the stale pool and
        // reconnect instead of erroring out until an explicit disconnect.
        state.pool_manager.disconnect(&id).await;
    }

    if config.password.as_deref().is_some_and(|s| s.is_empty()) {
        config.password = None;
    }

    // SSH tunnel first (rewrites host/port to the local forward) — the
    // login below then goes through the tunnel.
    start_tunnel_if_enabled(&state, id, &mut config).await?;

    if config.password.is_none() {
        return Err(AppError::PasswordRequired);
    }
    let driver = MySqlDriver::new();
    let pool = driver.connect(&config).await?;

    let row: (String, u64) = sqlx::query_as("SELECT VERSION(), CONNECTION_ID()")
        .fetch_one(&pool)
        .await
        .map_err(|e| AppError::QueryFailed(e.to_string()))?;

    state.pool_manager.connect(id, pool.clone()).await;

    // Remember the configured default database so queries that don't pin a
    // database explicitly can be reset to it (a pooled connection keeps
    // whatever `USE` ran last on it).
    if let Some(ref db) = config.database {
        state.session_databases.insert(id, db.clone());
    }

    let server_info = ServerInfo {
        version: row.0,
        connection_id: row.1.to_string(),
    };

    // Warm up schema cache asynchronously
    let cache = state.schema_cache.clone();
    let pool_clone = pool.clone();
    tokio::spawn(async move {
        let meta = MySqlDriver::new();
        if let Ok(dbs) = meta.fetch_databases(&pool_clone).await {
            cache.set_databases(id, &dbs);
        }
    });

    Ok(server_info)
}

async fn connect_pg(
    state: tauri::State<'_, AppState>,
    id: Uuid,
    mut config: ConnectionConfig,
) -> Result<ServerInfo, AppError> {
    if state.pg_pool_manager.is_connected(&id) {
        if let Some(pool) = state.pg_pool_manager.get(&id) {
            if let Ok(row) = sqlx::query_as::<_, (String, i32)>(
                "SELECT version(), pg_backend_pid()",
            )
            .fetch_one(&pool)
            .await
            {
                return Ok(ServerInfo {
                    version: row.0,
                    connection_id: row.1.to_string(),
                });
            }
        }
        state.pg_pool_manager.disconnect(&id).await;
    }

    if config.password.as_deref().is_some_and(|s| s.is_empty()) {
        config.password = None;
    }

    // SSH tunnel first (rewrites host/port to the local forward).
    start_tunnel_if_enabled(&state, id, &mut config).await?;

    let driver = PgDriver::new();
    let pool = driver.connect(&config).await?;

    let row: (String, i32) = sqlx::query_as("SELECT version(), pg_backend_pid()")
        .fetch_one(&pool)
        .await
        .map_err(|e| AppError::QueryFailed(e.to_string()))?;

    state.pg_pool_manager.connect(id, pool).await;

    // The tab's schema selection for PostgreSQL is pinned per query
    // (set_config) — remember the configured database like MySQL does.
    if let Some(ref db) = config.database {
        state.session_databases.insert(id, db.clone());
    }

    Ok(ServerInfo {
        version: row.0,
        connection_id: row.1.to_string(),
    })
}

#[tauri::command]
pub async fn disconnect(state: tauri::State<'_, AppState>, id: Uuid) -> Result<(), AppError> {
    state.pool_manager.disconnect(&id).await;
    state.pg_pool_manager.disconnect(&id).await;
    stop_tunnel(&state, id).await;
    state.schema_cache.invalidate_connection(&id);
    state.session_databases.remove(&id);
    Ok(())
}

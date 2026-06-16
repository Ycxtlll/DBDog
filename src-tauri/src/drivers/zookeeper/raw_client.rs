//! Minimal ZooKeeper wire-protocol client using `std::net::TcpStream`.
//!
//! The `zookeeper` crate (v0.8.0, unmaintained) uses `mio` 0.6 which has a
//! known null-pointer dereference on Windows when a socket is dropped while
//! polling.  This module replaces the I/O layer entirely — it speaks the ZK
//! wire protocol directly over blocking TCP, all inside `spawn_blocking`.
//!
//! We reuse `zookeeper` crate types (`Stat`, `Acl`, `CreateMode`, `ZkError`)
//! so the rest of the driver doesn't change.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use zookeeper::{Acl, CreateMode, Stat, ZkError};

use crate::error::AppError;

// ── Wire format helpers ──────────────────────────────────────────────

fn write_i32(w: &mut dyn Write, v: i32) -> std::io::Result<()> {
    w.write_all(&v.to_be_bytes())
}

fn write_i64(w: &mut dyn Write, v: i64) -> std::io::Result<()> {
    w.write_all(&v.to_be_bytes())
}

fn read_i32(r: &mut dyn Read) -> std::io::Result<i32> {
    let mut buf = [0u8; 4];
    r.read_exact(&mut buf)?;
    Ok(i32::from_be_bytes(buf))
}

fn read_i64(r: &mut dyn Read) -> std::io::Result<i64> {
    let mut buf = [0u8; 8];
    r.read_exact(&mut buf)?;
    Ok(i64::from_be_bytes(buf))
}

fn write_buffer(w: &mut dyn Write, data: &[u8]) -> std::io::Result<()> {
    write_i32(w, data.len() as i32)?;
    w.write_all(data)
}

fn read_buffer(r: &mut dyn Read) -> std::io::Result<Vec<u8>> {
    let len = read_i32(r)?;
    let len = if len < 0 { 0 } else { len as usize };
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf)?;
    Ok(buf)
}

fn write_string(w: &mut dyn Write, s: &str) -> std::io::Result<()> {
    write_buffer(w, s.as_bytes())
}

fn read_string(r: &mut dyn Read) -> std::io::Result<String> {
    let raw = read_buffer(r)?;
    Ok(String::from_utf8_lossy(&raw).into_owned())
}

fn write_bool(w: &mut dyn Write, v: bool) -> std::io::Result<()> {
    w.write_all(&[v as u8])
}

fn read_bool(r: &mut dyn Read) -> std::io::Result<bool> {
    let mut buf = [0u8; 1];
    r.read_exact(&mut buf)?;
    Ok(buf[0] != 0)
}

fn write_acl_vec(w: &mut dyn Write, acls: &[Acl]) -> std::io::Result<()> {
    write_i32(w, acls.len() as i32)?;
    for _acl in acls {
        // Permission::ALL = 31 (read=1, write=2, create=4, delete=8, admin=16)
        write_i32(w, 31)?;
        write_string(w, "world")?;
        write_string(w, "anyone")?;
    }
    Ok(())
}

// ── Length-prefixed frame I/O ────────────────────────────────────────

/// Write a length-prefixed payload: [4-byte BE len] [payload].
/// `len` is the payload length (NOT including the 4-byte prefix).
fn send_frame(w: &mut dyn Write, payload: &[u8]) -> std::io::Result<()> {
    write_i32(w, payload.len() as i32)?;
    w.write_all(payload)
}

/// Read a length-prefixed frame. Returns the payload bytes.
fn recv_frame(r: &mut dyn Read) -> std::io::Result<Vec<u8>> {
    let len = read_i32(r)?;
    if len < 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "negative frame length",
        ));
    }
    let mut buf = vec![0u8; len as usize];
    r.read_exact(&mut buf)?;
    Ok(buf)
}

// ── Protocol structs (re-implemented, NOT reusing zookeeper::proto which is private) ──

struct ConnectRequest {
    protocol_version: i32,
    last_zxid_seen: i64,
    timeout: i32,
    session_id: i64,
    passwd: Vec<u8>,
    read_only: bool,
}

impl ConnectRequest {
    fn initial(timeout_ms: u32) -> Self {
        Self {
            protocol_version: 0,
            last_zxid_seen: 0,
            timeout: timeout_ms as i32,
            session_id: 0,
            passwd: vec![0u8; 16],
            read_only: false,
        }
    }

    fn write_to(&self, w: &mut dyn Write) -> std::io::Result<()> {
        write_i32(w, self.protocol_version)?;
        write_i64(w, self.last_zxid_seen)?;
        write_i32(w, self.timeout)?;
        write_i64(w, self.session_id)?;
        write_buffer(w, &self.passwd)?;
        write_bool(w, self.read_only)
    }
}

struct ConnectResponse {
    #[allow(dead_code)]
    protocol_version: i32,
    #[allow(dead_code)]
    timeout: i32,
    session_id: i64,
    #[allow(dead_code)]
    passwd: Vec<u8>,
    #[allow(dead_code)]
    read_only: bool,
}

impl ConnectResponse {
    fn read_from(r: &mut dyn Read) -> std::io::Result<Self> {
        let protocol_version = read_i32(r)?;
        let timeout = read_i32(r)?;
        let session_id = read_i64(r)?;
        let passwd = read_buffer(r)?;
        // Older ZK servers don't send the readonly flag
        let read_only = read_bool(r).unwrap_or(false);
        Ok(Self { protocol_version, timeout, session_id, passwd, read_only })
    }
}

struct RequestHeader {
    xid: i32,
    opcode: i32,
}

impl RequestHeader {
    fn write_to(&self, w: &mut dyn Write) -> std::io::Result<()> {
        write_i32(w, self.xid)?;
        write_i32(w, self.opcode)
    }
}

struct ReplyHeader {
    #[allow(dead_code)]
    xid: i32,
    #[allow(dead_code)]
    zxid: i64,
    err: i32,
}

impl ReplyHeader {
    fn read_from(r: &mut dyn Read) -> std::io::Result<Self> {
        let xid = read_i32(r)?;
        let zxid = read_i64(r)?;
        let err = read_i32(r)?;
        Ok(Self { xid, zxid, err })
    }

    fn to_zk_result(&self) -> Result<(), ZkError> {
        if self.err == 0 {
            Ok(())
        } else {
            // ZkError::from(self.err) — use the known error variants
            Err(map_error_code(self.err))
        }
    }
}

fn map_error_code(code: i32) -> ZkError {
    match code {
        -101 => ZkError::NoNode,
        -110 => ZkError::NodeExists,
        -111 => ZkError::NotEmpty,
        -103 => ZkError::BadVersion,
        -102 => ZkError::NoAuth,
        -115 => ZkError::AuthFailed,
        -112 => ZkError::SessionExpired,
        -4 => ZkError::ConnectionLoss,
        -7 => ZkError::OperationTimeout,
        -108 => ZkError::NoChildrenForEphemerals,
        _ => ZkError::Unimplemented,
    }
}

fn read_stat(r: &mut dyn Read) -> std::io::Result<Stat> {
    Ok(Stat {
        czxid: read_i64(r)?,
        mzxid: read_i64(r)?,
        ctime: read_i64(r)?,
        mtime: read_i64(r)?,
        version: read_i32(r)?,
        cversion: read_i32(r)?,
        aversion: read_i32(r)?,
        ephemeral_owner: read_i64(r)?,
        data_length: read_i32(r)?,
        num_children: read_i32(r)?,
        pzxid: read_i64(r)?,
    })
}

// ── OpCodes ──────────────────────────────────────────────────────────

const OP_CREATE: i32 = 1;
const OP_DELETE: i32 = 2;
const OP_GET_DATA: i32 = 4;
const OP_SET_DATA: i32 = 5;
const OP_GET_CHILDREN: i32 = 8;
const OP_PING: i32 = 11;

// ── Raw client ───────────────────────────────────────────────────────

pub struct ZkRawClient {
    stream: TcpStream,
    session_id: i64,
    xid: i32,
}

impl ZkRawClient {
    /// Connect to a ZK server and perform the handshake.
    pub fn connect(host: &str, port: u16, timeout: Duration) -> Result<Self, AppError> {
        let addr = format!("{host}:{port}");
        let stream = TcpStream::connect_timeout(
            &addr.parse().map_err(|e| AppError::ConnectionFailed(format!("无效地址: {e}")))?,
            timeout,
        )
        .map_err(|e| AppError::ConnectionFailed(format!("ZK 连接失败 ({}): {e}", addr)))?;

        stream
            .set_read_timeout(Some(Duration::from_secs(15)))
            .map_err(|e| AppError::ConnectionFailed(format!("set_read_timeout: {e}")))?;

        let mut client = Self {
            stream,
            session_id: 0,
            xid: 0,
        };

        client.handshake(timeout)?;
        Ok(client)
    }

    fn handshake(&mut self, timeout: Duration) -> Result<(), AppError> {
        let req = ConnectRequest::initial(timeout.as_millis() as u32);

        let mut payload = Vec::new();
        req.write_to(&mut payload)
            .map_err(|e| AppError::ZookeeperError(format!("序列化连接请求失败: {e}")))?;

        send_frame(&mut self.stream, &payload)
            .map_err(|e| AppError::ConnectionFailed(format!("发送连接请求失败: {e}")))?;

        let resp_payload = recv_frame(&mut self.stream)
            .map_err(|e| AppError::ConnectionFailed(format!("读取连接响应失败: {e}")))?;

        let resp = ConnectResponse::read_from(&mut &resp_payload[..])
            .map_err(|e| AppError::ConnectionFailed(format!("解析连接响应失败: {e}")))?;

        if resp.session_id == 0 {
            return Err(AppError::ConnectionFailed("ZK 服务端拒绝连接 (session_id=0)".into()));
        }

        self.session_id = resp.session_id;
        Ok(())
    }

    /// Send a request and read the reply. Returns the reply payload (after the header).
    fn request(&mut self, opcode: i32, req_body: &[u8]) -> Result<Vec<u8>, AppError> {
        self.xid += 1;
        let xid = self.xid;

        let header = RequestHeader { xid, opcode };

        let mut payload = Vec::new();
        header
            .write_to(&mut payload)
            .map_err(|e| AppError::ZookeeperError(format!("序列化请求头失败: {e}")))?;
        payload.extend_from_slice(req_body);

        send_frame(&mut self.stream, &payload)
            .map_err(|e| AppError::ZookeeperError(format!("发送请求失败: {e}")))?;

        let resp_payload =
            recv_frame(&mut self.stream)
                .map_err(|e| AppError::ZookeeperError(format!("读取响应失败: {e}")))?;

        let mut cursor = &resp_payload[..];
        let reply = ReplyHeader::read_from(&mut cursor)
            .map_err(|e| AppError::ZookeeperError(format!("解析响应头失败: {e}")))?;

        reply.to_zk_result().map_err(|e| map_zk_err(e, ""))?;

        Ok(cursor.to_vec())
    }

    fn ping(&mut self) -> Result<(), AppError> {
        self.request(OP_PING, &[])?;
        Ok(())
    }

    // ── Public operations ─────────────────────────────────────────

    pub fn get_children(&mut self, path: &str) -> Result<Vec<String>, AppError> {
        let mut body = Vec::new();
        write_string(&mut body, path)
            .map_err(|e| AppError::ZookeeperError(format!("序列化失败: {e}")))?;
        write_bool(&mut body, false) // watch = false
            .map_err(|e| AppError::ZookeeperError(format!("序列化失败: {e}")))?;

        let resp = self.request(OP_GET_CHILDREN, &body)?;
        let mut cursor = &resp[..];

        let count = read_i32(&mut cursor)
            .map_err(|e| AppError::ZookeeperError(format!("解析子节点列表失败: {e}")))?;
        let mut children = Vec::with_capacity(count as usize);
        for _ in 0..count {
            children.push(
                read_string(&mut cursor)
                    .map_err(|e| AppError::ZookeeperError(format!("解析子节点名失败: {e}")))?,
            );
        }
        Ok(children)
    }

    pub fn get_data(&mut self, path: &str) -> Result<(Vec<u8>, Stat), AppError> {
        let mut body = Vec::new();
        write_string(&mut body, path)
            .map_err(|e| AppError::ZookeeperError(format!("序列化失败: {e}")))?;
        write_bool(&mut body, false) // watch = false
            .map_err(|e| AppError::ZookeeperError(format!("序列化失败: {e}")))?;

        let resp = self.request(OP_GET_DATA, &body)?;
        let mut cursor = &resp[..];

        let data = read_buffer(&mut cursor)
            .map_err(|e| AppError::ZookeeperError(format!("解析节点数据失败: {e}")))?;
        let stat = read_stat(&mut cursor)
            .map_err(|e| AppError::ZookeeperError(format!("解析节点状态失败: {e}")))?;
        Ok((data, stat))
    }


    pub fn create(
        &mut self,
        path: &str,
        data: &[u8],
        acls: &[Acl],
        flags: i32,
    ) -> Result<String, AppError> {
        let mut body = Vec::new();
        write_string(&mut body, path)
            .map_err(|e| AppError::ZookeeperError(format!("序列化失败: {e}")))?;
        write_buffer(&mut body, data)
            .map_err(|e| AppError::ZookeeperError(format!("序列化失败: {e}")))?;
        write_acl_vec(&mut body, acls)
            .map_err(|e| AppError::ZookeeperError(format!("序列化失败: {e}")))?;
        write_i32(&mut body, flags)
            .map_err(|e| AppError::ZookeeperError(format!("序列化失败: {e}")))?;

        let resp = self.request(OP_CREATE, &body)?;
        read_string(&mut &resp[..])
            .map_err(|e| AppError::ZookeeperError(format!("解析创建响应失败: {e}")))
    }

    pub fn delete(&mut self, path: &str, version: i32) -> Result<(), AppError> {
        let mut body = Vec::new();
        write_string(&mut body, path)
            .map_err(|e| AppError::ZookeeperError(format!("序列化失败: {e}")))?;
        write_i32(&mut body, version)
            .map_err(|e| AppError::ZookeeperError(format!("序列化失败: {e}")))?;

        self.request(OP_DELETE, &body)?;
        Ok(())
    }

    pub fn set_data(
        &mut self,
        path: &str,
        data: &[u8],
        version: i32,
    ) -> Result<Stat, AppError> {
        let mut body = Vec::new();
        write_string(&mut body, path)
            .map_err(|e| AppError::ZookeeperError(format!("序列化失败: {e}")))?;
        write_buffer(&mut body, data)
            .map_err(|e| AppError::ZookeeperError(format!("序列化失败: {e}")))?;
        write_i32(&mut body, version)
            .map_err(|e| AppError::ZookeeperError(format!("序列化失败: {e}")))?;

        let resp = self.request(OP_SET_DATA, &body)?;
        read_stat(&mut &resp[..])
            .map_err(|e| AppError::ZookeeperError(format!("解析 set_data 响应失败: {e}")))
    }

    /// Graceful close: send a ping first (to flush any pending watcher
    /// events), then shutdown the TCP stream.
    pub fn close(mut self) -> Result<(), AppError> {
        // Best-effort ping — ignore errors
        let _ = self.ping();
        let _ = self.stream.shutdown(std::net::Shutdown::Both);
        Ok(())
    }
}


pub fn map_zk_err(e: ZkError, path: &str) -> AppError {
    match e {
        ZkError::NoNode => AppError::KeyNotFound(path.to_string()),
        ZkError::NodeExists => AppError::ZookeeperError(format!("节点已存在: {path}")),
        ZkError::NotEmpty => AppError::ZookeeperError(format!("节点非空，无法删除: {path}")),
        ZkError::BadVersion => AppError::ZookeeperError(format!("版本冲突: {path}")),
        _ => AppError::ZookeeperError(format!("ZK 操作失败 ({path}): {e:?}")),
    }
}

// ── CreateMode flags ─────────────────────────────────────────────────

pub fn create_mode_flags(mode: CreateMode, _ephemeral: bool, _sequential: bool) -> (Vec<Acl>, i32) {
    let acls = vec![Acl::new(
        zookeeper::Permission::ALL,
        "world",
        "anyone",
    )];
    let flags = match mode {
        CreateMode::Persistent => 0,
        CreateMode::PersistentSequential => 2,
        CreateMode::Ephemeral => 1,
        CreateMode::EphemeralSequential => 3,
        CreateMode::Container => 0,
    };
    (acls, flags)
}

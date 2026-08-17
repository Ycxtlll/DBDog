//! Minimal ZooKeeper wire-protocol client using `std::net::TcpStream`.
//!
//! Speaks the ZK wire protocol directly over blocking TCP. No `mio`, no
//! `zookeeper` crate — just length-prefixed framing and Jute-like
//! serialization for the subset of the protocol we need.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use crate::error::AppError;

// ── Our own ZK types ─────────────────────────────────────────────────

/// Node statistics from ZK responses.
#[derive(Debug, Clone, Default)]
pub struct ZkStat {
    pub czxid: i64,
    pub mzxid: i64,
    pub ctime: i64,
    pub mtime: i64,
    pub version: i32,
    pub cversion: i32,
    pub aversion: i32,
    pub ephemeral_owner: i64,
    pub data_length: i32,
    pub num_children: i32,
    pub pzxid: i64,
}

/// ZK error codes we care about.
#[derive(Debug)]
pub enum ZkError {
    NoNode,
    NodeExists,
    NotEmpty,
    BadVersion,
    NoAuth,
    AuthFailed,
    SessionExpired,
    ConnectionLoss,
    OperationTimeout,
    NoChildrenForEphemerals,
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
        _ => ZkError::ConnectionLoss,
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

fn read_stat(r: &mut dyn Read) -> std::io::Result<ZkStat> {
    Ok(ZkStat {
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

// ── Length-prefixed frame I/O ────────────────────────────────────────

fn send_frame(w: &mut dyn Write, payload: &[u8]) -> std::io::Result<()> {
    write_i32(w, payload.len() as i32)?;
    w.write_all(payload)
}

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

// ── Protocol structs ─────────────────────────────────────────────────

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
    session_id: i64,
}

impl ConnectResponse {
    fn read_from(r: &mut dyn Read) -> std::io::Result<Self> {
        let _protocol_version = read_i32(r)?;
        let _timeout = read_i32(r)?;
        let session_id = read_i64(r)?;
        let _passwd = read_buffer(r)?;
        let _read_only = read_bool(r).unwrap_or(false);
        Ok(Self { session_id })
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
    err: i32,
}

impl ReplyHeader {
    fn read_from(r: &mut dyn Read) -> std::io::Result<Self> {
        let _xid = read_i32(r)?;
        let _zxid = read_i64(r)?;
        let err = read_i32(r)?;
        Ok(Self { err })
    }

    fn to_zk_result(&self) -> Result<(), ZkError> {
        if self.err == 0 {
            Ok(())
        } else {
            Err(map_error_code(self.err))
        }
    }
}

// ── OpCodes ──────────────────────────────────────────────────────────

const OP_GET_DATA: i32 = 4;
const OP_GET_CHILDREN: i32 = 8;
const OP_CLOSE_SESSION: i32 = -11;

// ── Raw client ───────────────────────────────────────────────────────

pub struct ZkRawClient {
    stream: TcpStream,
    xid: i32,
}

impl ZkRawClient {
    /// Connect to a ZK server and perform the handshake.
    pub fn connect(host: &str, port: u16, timeout: Duration) -> Result<Self, AppError> {
        let addr = format!("{host}:{port}");
        // Resolve via DNS so hostnames (and multi-A-record hosts) work;
        // `SocketAddr::from_str` would only accept literal IP:port strings.
        let candidates = addr
            .to_socket_addrs()
            .map_err(|e| AppError::ConnectionFailed(format!("无法解析地址 {addr}: {e}")))?;
        let mut last_err = None;
        let mut stream = None;
        for sockaddr in candidates {
            match TcpStream::connect_timeout(&sockaddr, timeout) {
                Ok(s) => {
                    stream = Some(s);
                    break;
                }
                Err(e) => last_err = Some(e),
            }
        }
        let stream = stream.ok_or_else(|| {
            AppError::ConnectionFailed(format!(
                "ZK 连接失败 ({}): {}",
                addr,
                last_err.map(|e| e.to_string()).unwrap_or_else(|| "no address".into())
            ))
        })?;

        stream
            .set_read_timeout(Some(Duration::from_secs(15)))
            .map_err(|e| AppError::ConnectionFailed(format!("set_read_timeout: {e}")))?;

        let mut client = Self { stream, xid: 0 };
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
            return Err(AppError::ConnectionFailed(
                "ZK 服务端拒绝连接 (session_id=0)".into(),
            ));
        }

        Ok(())
    }

    /// Send a request and read the reply. Returns the reply payload (after the header).
    fn request(&mut self, opcode: i32, req_body: &[u8]) -> Result<Vec<u8>, AppError> {
        self.xid += 1;
        let header = RequestHeader {
            xid: self.xid,
            opcode,
        };

        let mut payload = Vec::new();
        header
            .write_to(&mut payload)
            .map_err(|e| AppError::ZookeeperError(format!("序列化请求头失败: {e}")))?;
        payload.extend_from_slice(req_body);

        send_frame(&mut self.stream, &payload)
            .map_err(|e| AppError::ZookeeperError(format!("发送请求失败: {e}")))?;

        let resp_payload = recv_frame(&mut self.stream)
            .map_err(|e| AppError::ZookeeperError(format!("读取响应失败: {e}")))?;

        let mut cursor = &resp_payload[..];
        let reply = ReplyHeader::read_from(&mut cursor)
            .map_err(|e| AppError::ZookeeperError(format!("解析响应头失败: {e}")))?;

        reply
            .to_zk_result()
            .map_err(|e| map_zk_err(e, ""))?;

        Ok(cursor.to_vec())
    }

    // ── Public (read-only) operations ─────────────────────────────────

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

    pub fn get_data(&mut self, path: &str) -> Result<(Vec<u8>, ZkStat), AppError> {
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

    /// Graceful close — send the close-session opcode so the server drops
    /// the session immediately instead of waiting for the session timeout,
    /// then shut the socket down. Best effort: errors are swallowed.
    pub fn close(mut self) -> Result<(), AppError> {
        let _ = self.request(OP_CLOSE_SESSION, &[]);
        let _ = self.stream.shutdown(std::net::Shutdown::Both);
        Ok(())
    }
}

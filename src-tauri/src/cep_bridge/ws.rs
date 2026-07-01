use std::{
    collections::HashMap,
    io::{self, Read, Write},
    net::TcpStream,
};

const WEBSOCKET_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_HTTP_HEADER_BYTES: usize = 16 * 1024;
const MAX_FRAME_BYTES: u64 = 1024 * 1024;

pub enum WsMessage {
    Text(String),
    Ping(Vec<u8>),
    Pong,
    Close,
}

pub fn accept(stream: &mut TcpStream, expected_token: &str) -> io::Result<()> {
    let request = read_http_request(stream)?;
    let request = parse_request(&request)?;

    if request.path != "/cep" {
        write_http_error(stream, 404, "Not Found")?;
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid path"));
    }

    let token = request.query.get("token").map(String::as_str).unwrap_or("");
    if token != expected_token {
        write_http_error(stream, 403, "Forbidden")?;
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "invalid token",
        ));
    }

    let Some(key) = request.headers.get("sec-websocket-key") else {
        write_http_error(stream, 400, "Bad Request")?;
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "missing websocket key",
        ));
    };

    let accept = websocket_accept_key(key);
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Accept: {accept}\r\n\r\n"
    );
    stream.write_all(response.as_bytes())
}

pub fn read_message(stream: &mut TcpStream) -> io::Result<WsMessage> {
    let mut header = [0u8; 2];
    stream.read_exact(&mut header)?;

    let opcode = header[0] & 0x0f;
    let masked = (header[1] & 0x80) != 0;
    let mut len = (header[1] & 0x7f) as u64;

    if len == 126 {
        let mut bytes = [0u8; 2];
        stream.read_exact(&mut bytes)?;
        len = u16::from_be_bytes(bytes) as u64;
    } else if len == 127 {
        let mut bytes = [0u8; 8];
        stream.read_exact(&mut bytes)?;
        len = u64::from_be_bytes(bytes);
    }

    if len > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "websocket frame too large",
        ));
    }

    let mut mask = [0u8; 4];
    if masked {
        stream.read_exact(&mut mask)?;
    }

    let mut payload = vec![0u8; len as usize];
    if len > 0 {
        stream.read_exact(&mut payload)?;
    }

    if masked {
        for (index, byte) in payload.iter_mut().enumerate() {
            *byte ^= mask[index % 4];
        }
    }

    match opcode {
        0x1 => String::from_utf8(payload)
            .map(WsMessage::Text)
            .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err)),
        0x8 => Ok(WsMessage::Close),
        0x9 => Ok(WsMessage::Ping(payload)),
        0xa => Ok(WsMessage::Pong),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "unsupported websocket opcode",
        )),
    }
}

pub fn write_text(stream: &mut TcpStream, text: &str) -> io::Result<()> {
    write_frame(stream, 0x1, text.as_bytes())
}

pub fn write_pong(stream: &mut TcpStream, payload: &[u8]) -> io::Result<()> {
    write_frame(stream, 0xa, payload)
}

pub fn write_close(stream: &mut TcpStream) -> io::Result<()> {
    write_frame(stream, 0x8, &[])
}

fn write_frame(stream: &mut TcpStream, opcode: u8, payload: &[u8]) -> io::Result<()> {
    let mut frame = Vec::with_capacity(payload.len() + 10);
    frame.push(0x80 | opcode);

    if payload.len() < 126 {
        frame.push(payload.len() as u8);
    } else if payload.len() <= u16::MAX as usize {
        frame.push(126);
        frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    } else {
        frame.push(127);
        frame.extend_from_slice(&(payload.len() as u64).to_be_bytes());
    }

    frame.extend_from_slice(payload);
    stream.write_all(&frame)
}

fn read_http_request(stream: &mut TcpStream) -> io::Result<String> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 512];

    loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "connection closed during handshake",
            ));
        }

        buffer.extend_from_slice(&chunk[..read]);
        if buffer.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            break;
        }

        if buffer.len() > MAX_HTTP_HEADER_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "http header too large",
            ));
        }
    }

    String::from_utf8(buffer).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
}

fn parse_request(text: &str) -> io::Result<HttpRequest> {
    let mut lines = text.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();

    if method != "GET" {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "websocket handshake must use GET",
        ));
    }

    let (path, query) = split_path_query(target);
    let mut headers = HashMap::new();
    for line in lines {
        if line.is_empty() {
            break;
        }

        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    Ok(HttpRequest {
        path,
        query,
        headers,
    })
}

fn split_path_query(target: &str) -> (String, HashMap<String, String>) {
    let (path, query_text) = target.split_once('?').unwrap_or((target, ""));
    let mut query = HashMap::new();

    for pair in query_text.split('&') {
        if pair.is_empty() {
            continue;
        }

        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        query.insert(key.to_string(), value.to_string());
    }

    (path.to_string(), query)
}

fn write_http_error(stream: &mut TcpStream, code: u16, reason: &str) -> io::Result<()> {
    let body = format!("{code} {reason}");
    let response = format!(
        "HTTP/1.1 {code} {reason}\r\n\
         Connection: close\r\n\
         Content-Type: text/plain; charset=utf-8\r\n\
         Content-Length: {}\r\n\r\n{}",
        body.len(),
        body
    );
    stream.write_all(response.as_bytes())
}

fn websocket_accept_key(key: &str) -> String {
    let mut source = String::with_capacity(key.len() + WEBSOCKET_GUID.len());
    source.push_str(key.trim());
    source.push_str(WEBSOCKET_GUID);
    base64_encode(&sha1(source.as_bytes()))
}

struct HttpRequest {
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    let mut index = 0;

    while index + 3 <= bytes.len() {
        let chunk = &bytes[index..index + 3];
        output.push(TABLE[(chunk[0] >> 2) as usize] as char);
        output.push(TABLE[(((chunk[0] & 0x03) << 4) | (chunk[1] >> 4)) as usize] as char);
        output.push(TABLE[(((chunk[1] & 0x0f) << 2) | (chunk[2] >> 6)) as usize] as char);
        output.push(TABLE[(chunk[2] & 0x3f) as usize] as char);
        index += 3;
    }

    match bytes.len() - index {
        1 => {
            let byte = bytes[index];
            output.push(TABLE[(byte >> 2) as usize] as char);
            output.push(TABLE[((byte & 0x03) << 4) as usize] as char);
            output.push('=');
            output.push('=');
        }
        2 => {
            let first = bytes[index];
            let second = bytes[index + 1];
            output.push(TABLE[(first >> 2) as usize] as char);
            output.push(TABLE[(((first & 0x03) << 4) | (second >> 4)) as usize] as char);
            output.push(TABLE[((second & 0x0f) << 2) as usize] as char);
            output.push('=');
        }
        _ => {}
    }

    output
}

fn sha1(input: &[u8]) -> [u8; 20] {
    let mut h0 = 0x67452301u32;
    let mut h1 = 0xefcdab89u32;
    let mut h2 = 0x98badcfeu32;
    let mut h3 = 0x10325476u32;
    let mut h4 = 0xc3d2e1f0u32;

    let bit_len = (input.len() as u64) * 8;
    let mut message = input.to_vec();
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in message.chunks(64) {
        let mut words = [0u32; 80];
        for index in 0..16 {
            let start = index * 4;
            words[index] = u32::from_be_bytes([
                chunk[start],
                chunk[start + 1],
                chunk[start + 2],
                chunk[start + 3],
            ]);
        }

        for index in 16..80 {
            words[index] =
                (words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16])
                    .rotate_left(1);
        }

        let mut a = h0;
        let mut b = h1;
        let mut c = h2;
        let mut d = h3;
        let mut e = h4;

        for (index, word) in words.iter().enumerate() {
            let (f, k) = match index {
                0..=19 => ((b & c) | ((!b) & d), 0x5a827999),
                20..=39 => (b ^ c ^ d, 0x6ed9eba1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8f1bbcdc),
                _ => (b ^ c ^ d, 0xca62c1d6),
            };

            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }

        h0 = h0.wrapping_add(a);
        h1 = h1.wrapping_add(b);
        h2 = h2.wrapping_add(c);
        h3 = h3.wrapping_add(d);
        h4 = h4.wrapping_add(e);
    }

    let mut output = [0u8; 20];
    output[..4].copy_from_slice(&h0.to_be_bytes());
    output[4..8].copy_from_slice(&h1.to_be_bytes());
    output[8..12].copy_from_slice(&h2.to_be_bytes());
    output[12..16].copy_from_slice(&h3.to_be_bytes());
    output[16..20].copy_from_slice(&h4.to_be_bytes());
    output
}

#[cfg(test)]
mod tests {
    use super::{base64_encode, sha1, websocket_accept_key};

    #[test]
    fn sha1_matches_known_value() {
        let digest = sha1(b"abc");
        let hex = digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        assert_eq!(hex, "a9993e364706816aba3e25717850c26c9cd0d89d");
    }

    #[test]
    fn base64_matches_known_value() {
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
    }

    #[test]
    fn websocket_accept_matches_rfc_example() {
        assert_eq!(
            websocket_accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }
}

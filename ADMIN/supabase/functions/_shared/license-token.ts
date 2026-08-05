function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function utf8Base64Url(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function numericDate(value: string | Date): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

async function signingKey(envName: string, errorCode: string): Promise<CryptoKey> {
  const privateKey = Deno.env.get(envName);
  if (!privateKey) throw new Error(errorCode);

  return crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

export type LicenseTokenPayload = {
  sessionId: string;
  tokenId: string;
  organizationId: string;
  memberId: string;
  deviceId: string;
  role: "admin" | "user";
  email: string;
  issuedAt: string;
  expiresAt: string;
  serverTimeAtIssue: string;
  deviceFingerprintHash?: string;
};

export type AexBridgeTokenPayload = {
  sessionId: string;
  tokenId: string;
  organizationId: string;
  memberId: string;
  deviceId: string;
  issuedAt: string;
  expiresAt: string;
};

async function signJwt(
  key: CryptoKey,
  keyId: string,
  claims: Record<string, unknown>,
): Promise<string> {
  const header = {
    alg: "ES256",
    typ: "JWT",
    kid: keyId,
  };

  const encodedHeader = utf8Base64Url(header);
  const encodedPayload = utf8Base64Url(claims);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

export async function signLicenseToken(payload: LicenseTokenPayload): Promise<string> {
  const keyId = Deno.env.get("LICENSE_TOKEN_KEY_ID") || "v1";
  const now = numericDate(payload.issuedAt);
  const expiresAt = numericDate(payload.expiresAt);

  const claims: Record<string, unknown> = {
    iss: "arizona-app",
    aud: "arizona-license",
    jti: payload.tokenId,
    sub: payload.memberId,
    org: payload.organizationId,
    device: payload.deviceId,
    session: payload.sessionId,
    role: payload.role,
    email: payload.email,
    receiptVersion: 2,
    licensed: true,
    allowedFeatures: ["ae_panel"],
    iat: now,
    nbf: now,
    exp: expiresAt,
    server_time_at_issue: payload.serverTimeAtIssue,
  };

  // Vinculo do recibo com a maquina (aditivo: receiptVersion continua 2 e
  // extensoes ja publicadas ignoram claims desconhecidas).
  if (payload.deviceFingerprintHash) {
    claims.deviceFingerprintHash = payload.deviceFingerprintHash;
  }

  return signJwt(
    await signingKey("LICENSE_TOKEN_PRIVATE_KEY_PKCS8_B64", "missing_license_token_private_key"),
    keyId,
    claims,
  );
}

export async function signAexBridgeToken(payload: AexBridgeTokenPayload): Promise<string> {
  const keyId = Deno.env.get("AEX_BRIDGE_TOKEN_KEY_ID") || "v1";
  const now = numericDate(payload.issuedAt);
  const expiresAt = numericDate(payload.expiresAt);

  const claims = {
    iss: "arizona-app",
    aud: "arizona-aex-bridge",
    jti: payload.tokenId,
    sub: payload.memberId,
    org: payload.organizationId,
    device: payload.deviceId,
    session: payload.sessionId,
    feature: "ae_bridge",
    iat: now,
    nbf: now,
    exp: expiresAt,
  };

  return signJwt(
    await signingKey("AEX_BRIDGE_TOKEN_PRIVATE_KEY_PKCS8_B64", "missing_aex_bridge_token_private_key"),
    keyId,
    claims,
  );
}

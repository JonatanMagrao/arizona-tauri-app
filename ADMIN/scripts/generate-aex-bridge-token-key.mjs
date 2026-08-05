// Gera um novo par de chaves para o bridgeToken (plugin AEX / atalhos globais).
//
// ATENCAO: isto e uma ROTACAO DE CHAVE. Leia docs/LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md
// antes de rodar. O plugin AEX precisa ser recompilado com a chave publica
// nova e reinstalado no After Effects â€” sem isso, os atalhos param.
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  argValue,
  guardPrivateKeyOverwrite,
  hasFlag,
  kidFromPublicKey,
  upsertEnvFile,
} from "./keygen-shared.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const supabaseDir = resolve(scriptDir, "../supabase");

const envFilePath = argValue("--out-env-file");
const force = hasFlag("--force");

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});

const keyId = argValue("--kid") || kidFromPublicKey(publicKey);
const publicFilePath = argValue(
  "--out-public-file",
  resolve(supabaseDir, `aex-bridge-token-public-key.${keyId}.json`),
);

const privateKeyBase64 = privateKey
  .export({ type: "pkcs8", format: "der" })
  .toString("base64");
const publicJwk = publicKey.export({ format: "jwk" });
const publicX = base64UrlToHex(publicJwk.x);
const publicY = base64UrlToHex(publicJwk.y);

if (envFilePath) {
  const resolvedEnvPath = resolve(envFilePath);
  guardPrivateKeyOverwrite(resolvedEnvPath, "AEX_BRIDGE_TOKEN_PRIVATE_KEY_PKCS8_B64", force);

  upsertEnvFile(resolvedEnvPath, {
    AEX_BRIDGE_TOKEN_KEY_ID: keyId,
    AEX_BRIDGE_TOKEN_PRIVATE_KEY_PKCS8_B64: privateKeyBase64,
  });
  console.log(`Secrets do bridge AEX gravados em ${resolvedEnvPath}`);
} else {
  console.log(`AEX_BRIDGE_TOKEN_KEY_ID=${keyId}`);
  console.log(`AEX_BRIDGE_TOKEN_PRIVATE_KEY_PKCS8_B64=${privateKeyBase64}`);
}

if (publicFilePath) {
  const absolutePublicFilePath = resolve(publicFilePath);
  mkdirSync(dirname(absolutePublicFilePath), { recursive: true });
  writeFileSync(
    absolutePublicFilePath,
    `${JSON.stringify({
      kid: keyId,
      alg: "ES256",
      crv: "P-256",
      x: publicX,
      y: publicY,
    }, null, 2)}\n`,
    "utf8",
  );
  console.log(`Chave publica do bridge AEX gravada em ${absolutePublicFilePath}`);
}

console.log("");
console.log("Use estes valores ao compilar o plugin AEX:");
console.log(`ARIZONA_AEX_JWT_KID=${keyId}`);
console.log(`ARIZONA_AEX_JWT_ES256_PUBLIC_X=${publicX}`);
console.log(`ARIZONA_AEX_JWT_ES256_PUBLIC_Y=${publicY}`);
console.log("");
console.log("Proximos passos da rotacao (nesta ordem):");
console.log("1. Recompile o plugin AEX com a chave publica nova e reinstale no After Effects.");
console.log("2. Envie os secrets ao Supabase: npx supabase secrets set --env-file supabase\\functions\\.env.production.local");
console.log("3. Teste os atalhos globais com o After Effects aberto.");

function base64UrlToHex(value) {
  if (typeof value !== "string" || !value) {
    throw new Error("Generated public key is missing a coordinate.");
  }

  return Buffer.from(value, "base64url").toString("hex").toUpperCase();
}

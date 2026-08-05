// Gera um novo par de chaves para o cepLicenseReceipt (extensao CEP).
//
// ATENCAO: isto e uma ROTACAO DE CHAVE. Leia docs/LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md
// antes de rodar. O script:
// - se recusa a sobrescrever a chave privada existente sem --force;
// - com --force, salva backup datado do env anterior;
// - gera um kid unico derivado da chave publica;
// - adiciona a chave nova ao manifesto license-trusted-keys.json SEM remover
//   as antigas (a extensao continua aceitando recibos das duas durante a
//   transicao);
// - grava o PEM publico versionado.
//
// Depois de rodar: envie os secrets ao Supabase, rebuilde/reinstale a
// extensao (o build embute o manifesto) e valide com license:check.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const trustedKeysPath = resolve(supabaseDir, "license-trusted-keys.json");

const envFilePath = argValue("--out-env-file");
const force = hasFlag("--force");

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});

const keyId = argValue("--kid") || kidFromPublicKey(publicKey);
const privateKeyBase64 = privateKey
  .export({ type: "pkcs8", format: "der" })
  .toString("base64");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).trim();
const publicJwk = publicKey.export({ format: "jwk" });
const publicX = Buffer.from(publicJwk.x, "base64url").toString("hex");
const publicY = Buffer.from(publicJwk.y, "base64url").toString("hex");

if (!envFilePath) {
  console.log(`LICENSE_TOKEN_KEY_ID=${keyId}`);
  console.log(`LICENSE_TOKEN_PRIVATE_KEY_PKCS8_B64=${privateKeyBase64}`);
  console.log("");
  console.log("# Chave publica correspondente (nao foi salva; rode com --out-env-file para persistir tudo):");
  console.log(publicKeyPem);
  process.exit(0);
}

const resolvedEnvPath = resolve(envFilePath);
guardPrivateKeyOverwrite(resolvedEnvPath, "LICENSE_TOKEN_PRIVATE_KEY_PKCS8_B64", force);

upsertEnvFile(resolvedEnvPath, {
  LICENSE_TOKEN_KEY_ID: keyId,
  LICENSE_TOKEN_PRIVATE_KEY_PKCS8_B64: privateKeyBase64,
});
console.log(`Secrets da licenca gravados em ${resolvedEnvPath}`);

const pemFileName = `license-token-public-key.${keyId}.pem`;
const pemPath = resolve(supabaseDir, pemFileName);
writeFileSync(pemPath, `${publicKeyPem}\n`, "utf8");
console.log(`Chave publica gravada em ${pemPath}`);

const manifest = existsSync(trustedKeysPath)
  ? JSON.parse(readFileSync(trustedKeysPath, "utf8"))
  : { keys: [] };
const keys = Array.isArray(manifest.keys) ? manifest.keys : [];

if (keys.some((key) => key.kid === keyId)) {
  console.error(`ERRO: kid ${keyId} ja existe no manifesto ${trustedKeysPath}.`);
  process.exit(1);
}

keys.push({
  kid: keyId,
  curve: "P-256",
  x: publicX,
  y: publicY,
  pem: pemFileName,
  createdAt: new Date().toISOString().slice(0, 10),
});
manifest.keys = keys;
writeFileSync(trustedKeysPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Manifesto atualizado: ${trustedKeysPath} agora tem ${keys.length} chave(s).`);

console.log("");
console.log("Proximos passos da rotacao (nesta ordem):");
console.log("1. Rebuilde e reinstale a extensao CEP (ARIZONA-EXTENSION: npm run build) para ela confiar na chave nova E na antiga.");
console.log("2. Envie os secrets ao Supabase: npx supabase secrets set --env-file supabase\\functions\\.env.production.local");
console.log("3. Valide com: npm run license:check (na raiz do arizona-tauri-app).");
console.log("4. So remova a chave antiga do manifesto quando todas as maquinas tiverem a extensao nova.");

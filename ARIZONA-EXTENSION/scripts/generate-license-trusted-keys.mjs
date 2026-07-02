// Gera src/js/main/services/licenseTrustedKeys.generated.ts a partir do
// manifesto versionado ADMIN/supabase/license-trusted-keys.json.
//
// Roda automaticamente via predev/prebuild/prezxp/prezip (package.json).
// Nao edite o arquivo gerado nem este manifesto na mao; a rotacao de chaves
// e feita pelos scripts em admin/scripts/.
import { createPublicKey } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(scriptDir, "../../ADMIN/supabase/license-trusted-keys.json");
const outputPath = resolve(scriptDir, "../src/js/main/services/licenseTrustedKeys.generated.ts");

function fail(message) {
  console.error(`[license-keys] ERRO: ${message}`);
  console.error(`[license-keys] Manifesto esperado em: ${manifestPath}`);
  process.exit(1);
}

if (!existsSync(manifestPath)) {
  fail("manifesto license-trusted-keys.json nao encontrado. A extensao nao pode ser buildada sem as chaves publicas de licenca.");
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail(`manifesto invalido (JSON quebrado): ${error.message}`);
}

const keys = Array.isArray(manifest?.keys) ? manifest.keys : [];
if (keys.length === 0) {
  fail("manifesto sem chaves. Pelo menos uma chave publica confiavel e obrigatoria.");
}

const hex64 = /^[0-9a-f]{64}$/;
const seenKids = new Set();

for (const key of keys) {
  const kid = String(key?.kid || "").trim();
  if (!kid) fail("chave sem kid no manifesto.");
  if (seenKids.has(kid)) fail(`kid duplicado no manifesto: ${kid}`);
  seenKids.add(kid);

  if (key.curve !== "P-256") fail(`chave ${kid}: curve deve ser P-256.`);
  if (!hex64.test(String(key.x || ""))) fail(`chave ${kid}: coordenada x invalida (esperado hex de 64 chars).`);
  if (!hex64.test(String(key.y || ""))) fail(`chave ${kid}: coordenada y invalida (esperado hex de 64 chars).`);

  // Se o PEM correspondente existir, confere que x/y batem com ele.
  if (key.pem) {
    const pemPath = resolve(dirname(manifestPath), key.pem);
    if (existsSync(pemPath)) {
      const publicKey = createPublicKey(readFileSync(pemPath, "utf8"));
      const jwk = publicKey.export({ format: "jwk" });
      const pemX = Buffer.from(jwk.x, "base64url").toString("hex");
      const pemY = Buffer.from(jwk.y, "base64url").toString("hex");
      if (pemX !== key.x || pemY !== key.y) {
        fail(`chave ${kid}: x/y do manifesto nao batem com ${key.pem}. Corrija o manifesto a partir do PEM.`);
      }
    }
  }
}

const entries = keys
  .map((key) => `  {\n    kid: "${key.kid.trim()}",\n    x: "${key.x}",\n    y: "${key.y}",\n  },`)
  .join("\n");

const content = `// GERADO POR scripts/generate-license-trusted-keys.mjs — NAO EDITE NA MAO.
// Fonte: ADMIN/supabase/license-trusted-keys.json
// Para rotacionar chaves, use os scripts em admin/scripts/ e rode o build.

export type LicenseTrustedKey = {
  kid: string;
  x: string;
  y: string;
};

export const LICENSE_TRUSTED_KEYS: LicenseTrustedKey[] = [
${entries}
];
`;

const current = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
if (current === content) {
  console.log(`[license-keys] OK: ${keys.length} chave(s) confiavel(is), modulo ja atualizado.`);
} else {
  writeFileSync(outputPath, content, "utf8");
  console.log(`[license-keys] OK: modulo gerado com ${keys.length} chave(s) confiavel(is).`);
}

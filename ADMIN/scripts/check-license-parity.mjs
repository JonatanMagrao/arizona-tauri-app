// Health check de paridade do licenciamento (CEP + AEX).
//
// Confere se todos os lados usam as mesmas chaves:
// - env local (chave privada) x manifesto de chaves confiaveis
// - manifesto x PEM versionado
// - manifesto x modulo gerado da extensao (fonte)
// - manifesto x extensao INSTALADA no Adobe CEP (bundle compilado)
// - recibo atual em disco (kid conhecido? assinatura confere? expirado?)
// - env local do bridge AEX x JSON publico versionado
//
// O recibo em disco e assinado pelo Supabase remoto, entao ele tambem serve
// de proxy para detectar secrets remotos fora de sincronia.
//
// Uso: npm run license:check (na raiz do arizona-tauri-app)
import { createPrivateKey, createPublicKey, createVerify } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const supabaseDir = resolve(repoRoot, "ADMIN/supabase");
const envPath = resolve(supabaseDir, "functions/.env.production.local");
const trustedKeysPath = resolve(supabaseDir, "license-trusted-keys.json");
const generatedModulePath = resolve(
  repoRoot,
  "ARIZONA-EXTENSION/src/js/main/services/licenseTrustedKeys.generated.ts",
);
const installedExtensionDir = join(
  process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
  "Adobe",
  "CEP",
  "extensions",
  "com.arizona-carrefour.cep",
);
const receiptPath = join(
  process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
  "com.pc.arizona-app",
  "cep-license-receipt.json",
);

let failures = 0;
const pass = (message) => console.log(`  PASS  ${message}`);
const warn = (message) => console.log(`  AVISO ${message}`);
const fail = (message) => {
  failures += 1;
  console.log(`  FALHA ${message}`);
};

const readEnv = (name) => {
  if (!existsSync(envPath)) return "";
  const line = readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : "";
};

const publicXYFromPrivateB64 = (privateB64) => {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  return {
    x: Buffer.from(jwk.x, "base64url").toString("hex"),
    y: Buffer.from(jwk.y, "base64url").toString("hex"),
  };
};

console.log("== 1. Manifesto de chaves confiaveis ==");
let manifestKeys = [];
if (!existsSync(trustedKeysPath)) {
  fail(`manifesto nao encontrado: ${trustedKeysPath}`);
} else {
  manifestKeys = JSON.parse(readFileSync(trustedKeysPath, "utf8")).keys || [];
  if (manifestKeys.length === 0) {
    fail("manifesto sem chaves.");
  } else {
    pass(`manifesto com ${manifestKeys.length} chave(s): ${manifestKeys.map((k) => k.kid).join(", ")}`);
  }

  for (const key of manifestKeys) {
    if (!key.pem) continue;
    const pemPath = resolve(supabaseDir, key.pem);
    if (!existsSync(pemPath)) {
      warn(`chave ${key.kid}: PEM ${key.pem} nao encontrado (manifesto segue valendo).`);
      continue;
    }
    const jwk = createPublicKey(readFileSync(pemPath, "utf8")).export({ format: "jwk" });
    const pemX = Buffer.from(jwk.x, "base64url").toString("hex");
    const pemY = Buffer.from(jwk.y, "base64url").toString("hex");
    if (pemX === key.x && pemY === key.y) {
      pass(`chave ${key.kid}: manifesto bate com ${key.pem}.`);
    } else {
      fail(`chave ${key.kid}: manifesto NAO bate com ${key.pem}.`);
    }
  }
}

console.log("== 2. Env local (chave privada de licenca) ==");
const envKid = readEnv("LICENSE_TOKEN_KEY_ID") || "v1";
const envPrivate = readEnv("LICENSE_TOKEN_PRIVATE_KEY_PKCS8_B64");
let envPublic = null;
if (!envPrivate) {
  warn(`sem LICENSE_TOKEN_PRIVATE_KEY_PKCS8_B64 em ${envPath} (ok se esta maquina nao gerencia secrets).`);
} else {
  envPublic = publicXYFromPrivateB64(envPrivate);
  const match = manifestKeys.find((key) => key.kid === envKid);
  if (!match) {
    fail(`env usa kid "${envKid}" mas o manifesto nao tem essa chave.`);
  } else if (match.x === envPublic.x && match.y === envPublic.y) {
    pass(`env (kid ${envKid}) bate com o manifesto.`);
  } else {
    fail(`env (kid ${envKid}) tem chave DIFERENTE da do manifesto com o mesmo kid.`);
  }
}

console.log("== 3. Modulo gerado da extensao (fonte) ==");
if (!existsSync(generatedModulePath)) {
  fail(`modulo gerado nao existe: ${generatedModulePath}. Rode npm run license:keys em ARIZONA-EXTENSION.`);
} else {
  const moduleText = readFileSync(generatedModulePath, "utf8");
  const moduleKids = [...moduleText.matchAll(/kid: "([^"]+)"/g)].map((m) => m[1]);
  const missing = manifestKeys.filter(
    (key) => !(moduleKids.includes(key.kid) && moduleText.includes(key.x) && moduleText.includes(key.y)),
  );
  const extra = moduleKids.filter((kid) => !manifestKeys.some((key) => key.kid === kid));
  if (missing.length === 0 && extra.length === 0) {
    pass(`fonte da extensao confia em: ${moduleKids.join(", ")}.`);
  } else {
    if (missing.length > 0) fail(`fonte da extensao NAO tem: ${missing.map((k) => k.kid).join(", ")}. Rode o build da extensao.`);
    if (extra.length > 0) warn(`fonte da extensao tem kids fora do manifesto: ${extra.join(", ")}.`);
  }
}

console.log("== 4. Extensao instalada no Adobe CEP ==");
const assetsDir = join(installedExtensionDir, "assets");
if (!existsSync(assetsDir)) {
  warn(`extensao nao instalada em ${installedExtensionDir} (ok em maquina de build).`);
} else {
  const bundles = readdirSync(assetsDir).filter((name) => name.endsWith(".cjs") || name.endsWith(".js"));
  const bundleText = bundles
    .map((name) => readFileSync(join(assetsDir, name), "utf8"))
    .join("\n");
  const missing = manifestKeys.filter(
    (key) => !(bundleText.includes(`"${key.kid}"`) && bundleText.includes(key.x) && bundleText.includes(key.y)),
  );
  if (missing.length === 0) {
    pass("extensao instalada contem todas as chaves do manifesto.");
  } else {
    fail(`extensao instalada NAO contem: ${missing.map((k) => k.kid).join(", ")}. Rebuilde e reinstale (npm run build em ARIZONA-EXTENSION).`);
  }
}

console.log("== 5. Recibo atual em disco (proxy dos secrets remotos) ==");
if (!existsSync(receiptPath)) {
  warn(`sem recibo em ${receiptPath} (abra e valide o Arizona App para gerar).`);
} else {
  try {
    const receiptFile = JSON.parse(readFileSync(receiptPath, "utf8"));
    const [headerB64, payloadB64, signatureB64] = String(receiptFile.receipt || "").split(".");
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString());
    const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    const trusted = manifestKeys.find((key) => key.kid === header.kid);

    if (!trusted) {
      fail(`recibo assinado com kid "${header.kid}" que NAO esta no manifesto — secrets remotos fora de sincronia.`);
    } else {
      const publicKey = createPublicKey({
        key: {
          kty: "EC",
          crv: "P-256",
          x: Buffer.from(trusted.x, "hex").toString("base64url"),
          y: Buffer.from(trusted.y, "hex").toString("base64url"),
        },
        format: "jwk",
      });
      const rawSig = Buffer.from(signatureB64, "base64url");
      const derInt = (buf) => {
        let start = 0;
        while (start < buf.length - 1 && buf[start] === 0) start += 1;
        let bytes = buf.subarray(start);
        if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
        return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes]);
      };
      const r = derInt(rawSig.subarray(0, 32));
      const s = derInt(rawSig.subarray(32));
      const derSig = Buffer.concat([Buffer.from([0x30, r.length + s.length]), r, s]);
      const verifier = createVerify("SHA256");
      verifier.update(`${headerB64}.${payloadB64}`);
      verifier.end();

      if (verifier.verify(publicKey, derSig)) {
        pass(`recibo assinado com kid ${header.kid} e assinatura valida.`);
      } else {
        fail(`recibo com kid ${header.kid} mas assinatura INVALIDA — chave remota diverge do manifesto.`);
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (claims.exp && claims.exp <= nowSeconds) {
        warn(`recibo expirado em ${new Date(claims.exp * 1000).toISOString()} (valide o Arizona App novamente).`);
      } else if (claims.exp) {
        pass(`recibo valido ate ${new Date(claims.exp * 1000).toISOString()}.`);
      }
    }
  } catch (error) {
    fail(`recibo ilegivel: ${error.message}`);
  }
}

console.log("== 6. Bridge AEX ==");
const aexPrivate = readEnv("AEX_BRIDGE_TOKEN_PRIVATE_KEY_PKCS8_B64");
const aexKid = readEnv("AEX_BRIDGE_TOKEN_KEY_ID") || "v1";
if (!aexPrivate) {
  warn("sem chave privada do bridge AEX no env local (ok se esta maquina nao gerencia secrets).");
} else {
  const aexPublic = publicXYFromPrivateB64(aexPrivate);
  const aexJsonFiles = readdirSync(supabaseDir).filter(
    (name) => name.startsWith("aex-bridge-token-public-key.") && name.endsWith(".json"),
  );
  const matched = aexJsonFiles.some((name) => {
    const data = JSON.parse(readFileSync(join(supabaseDir, name), "utf8"));
    return (
      data.kid === aexKid &&
      String(data.x).toLowerCase() === aexPublic.x &&
      String(data.y).toLowerCase() === aexPublic.y
    );
  });
  if (matched) {
    pass(`env do bridge AEX (kid ${aexKid}) bate com o JSON publico versionado.`);
  } else {
    fail(`env do bridge AEX (kid ${aexKid}) NAO bate com nenhum aex-bridge-token-public-key.*.json.`);
  }
}

console.log("== 7. Plugin AEX compilado ==");
// O binario .aex embute a chave publica como string hex (defines de build).
// Uma build sem chave e com o marcador de dev-token so funciona com
// `npm run tauri:dev:bridge`; com token real de producao ela recusa tudo.
const aexBinaries = [
  resolve(repoRoot, "AE-PLUGIN-ARIZONA/plugin/ArizonaBridgeTest.aex"),
  ...(() => {
    const adobeDir = "C:\\Program Files\\Adobe";
    if (!existsSync(adobeDir)) return [];
    return readdirSync(adobeDir)
      .filter((name) => name.startsWith("Adobe After Effects"))
      .map((name) => join(adobeDir, name, "Support Files", "Plug-ins", "Arizona", "ArizonaBridgeTest.aex"))
      .filter((path) => existsSync(path));
  })(),
];
if (aexBinaries.filter(existsSync).length === 0) {
  warn("nenhum ArizonaBridgeTest.aex encontrado (repo ou After Effects).");
}
for (const binaryPath of aexBinaries) {
  if (!existsSync(binaryPath)) continue;
  const binaryText = readFileSync(binaryPath, "latin1");
  const isDevBuild = binaryText.includes("arizona-aex-dev-token");
  const hasEnvKey =
    aexPrivate &&
    (() => {
      const pub = publicXYFromPrivateB64(aexPrivate);
      return (
        binaryText.toLowerCase().includes(pub.x) &&
        binaryText.toLowerCase().includes(pub.y)
      );
    })();

  if (hasEnvKey) {
    pass(`${binaryPath}: chave de producao embutida${isDevBuild ? " (mas aceita dev-token — nao distribua)" : ""}.`);
  } else if (isDevBuild) {
    warn(`${binaryPath}: build de DESENVOLVIMENTO (sem chave embutida; atalhos so funcionam com tauri:dev:bridge).`);
  } else {
    fail(`${binaryPath}: sem chave embutida e sem modo dev — recusa todos os tokens. Recompile com build.ps1 e as chaves do keygen.`);
  }
}

console.log("");
if (failures > 0) {
  console.log(`RESULTADO: ${failures} problema(s) encontrado(s). Veja LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md.`);
  process.exit(1);
}
console.log("RESULTADO: tudo em paridade.");

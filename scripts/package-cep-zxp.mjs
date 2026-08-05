// Empacota a extensao CEP (ARIZONA-EXTENSION) como ZXP distribuivel ASSINADO
// com o certificado ESTAVEL da Arizona.
//
// Por que nao usamos mais o "npm run zxp" do vite-cep-plugin: o plugin apaga e
// REGERA um certificado autoassinado descartavel a cada build
// (node_modules/vite-cep-plugin/lib/lib/zxp.js), ou seja, cada pacote sairia com
// um publicador diferente e nao existiria identidade para o app conferir.
//
// Fluxo:
// 1. Roda o license:check da raiz (falha rapido se as chaves divergirem).
// 2. Builda a arvore da extensao (npm run build -> ARIZONA-EXTENSION/dist/cep).
// 3. Assina essa arvore com o .p12 estavel, chamando o ZXPSignCmd direto.
// 4. Normaliza SignatureValue para que o carimbo emitido pelo ZXPSignCmd seja
//    verificavel contra o XML final (o assinador quebra o base64 depois de
//    pedir o timestamp, alterando o C14N coberto pelo messageImprint).
// 5. Verifica o artefato inteiro: pin do certificado, assinatura Adobe e
//    token RFC3161/cadeia publica do TSA. O build falha fechado.
//
// Uso: npm run cep:zxp (na raiz do arizona-tauri-app)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  argValue,
  assertSignerAvailable,
  defaultTsaUrls,
  extensionDir,
  hasFlag,
  normalizeSignatureValueInZxp,
  readTrustedCertificates,
  repoRoot,
  resolveSigningConfig,
  signerDir,
  signerEnv,
  signerPath,
  trustedCertPath,
  verifyCepZxp,
} from "./cep-signing.mjs";

const outputDir = join(repoRoot, "dist-cep");
const allowSkipTsa = hasFlag("--allow-skip-tsa");
const tsaOverride = argValue("--tsa");
const tsaUrls = tsaOverride ? [tsaOverride] : defaultTsaUrls;

const run = (label, command, args, cwd) => {
  console.log(`== ${label} ==`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`FALHA em "${label}" (exit ${result.status ?? "?"}).`);
    process.exit(result.status || 1);
  }
};

// 0. Sem certificado estavel nao ha o que assinar: falha antes de gastar build.
assertSignerAvailable();
const signing = resolveSigningConfig();
const { certificates } = readTrustedCertificates();
if (certificates.length === 0) {
  console.error(`FALHA: ${trustedCertPath} nao lista nenhum certificado confiavel.`);
  console.error("Gere a identidade da Arizona com: npm run cep:cert");
  process.exit(1);
}
console.log(`Certificado de assinatura: ${signing.p12Path} (origem: ${signing.source})`);

// 1. Paridade de chaves antes de qualquer build (falha rapido em drift).
run("license:check", "npm", ["run", "license:check"], repoRoot);

// 2. Build da arvore da extensao (o prebuild regenera o modulo de chaves confiaveis).
run("build da extensao", "npm", ["run", "build"], extensionDir);

const extensionPackage = JSON.parse(
  readFileSync(join(extensionDir, "package.json"), "utf8"),
);
const version = extensionPackage.version;
if (!extensionPackage.name || !version) {
  console.error("FALHA: name/version ausentes em ARIZONA-EXTENSION/package.json.");
  process.exit(1);
}

const sourceDir = join(extensionDir, "dist", "cep");
if (!existsSync(join(sourceDir, "CSXS", "manifest.xml"))) {
  console.error(`FALHA: arvore da extensao incompleta em ${sourceDir} (CSXS/manifest.xml ausente).`);
  process.exit(1);
}
// O .debug faz parte do manifesto de assinatura: se ele for removido depois de
// assinar, o CEP recusa a extensao. Nao apague nada daqui.
if (!existsSync(join(sourceDir, ".debug"))) {
  console.error(`FALHA: ${join(sourceDir, ".debug")} ausente. Ele e assinado junto com o resto.`);
  process.exit(1);
}
// O ExtendScript e compilado por um rollup paralelo dentro do build do vite.
// Assinar antes dele terminar geraria um pacote sem os scripts do After Effects.
const jsxBinPath = join(sourceDir, "jsx", "index.jsxbin");
if (!existsSync(jsxBinPath) || statSync(jsxBinPath).size === 0) {
  console.error(`FALHA: ${jsxBinPath} ausente ou vazio apos o build da extensao.`);
  console.error("Rode 'npm --prefix ARIZONA-EXTENSION run build' e confira o erro do ExtendScript.");
  process.exit(1);
}

// 3. Assinatura com o certificado estavel.
mkdirSync(outputDir, { recursive: true });
const outputPath = join(outputDir, `arizona-cep-v${version}.zxp`);
rmSync(outputPath, { force: true });

console.log("== assinatura do zxp ==");
const signArgs = ["-sign", sourceDir, outputPath, signing.p12Path, signing.password];
let signed = false;
let tsaFailures = 0;

for (const tsa of tsaUrls) {
  if (!tsa) continue;

  console.log(`Tentando TSA ${tsa}...`);
  const result = spawnSync(signerPath, [...signArgs, "-tsa", tsa], {
    cwd: signerDir,
    env: signerEnv(),
    encoding: "utf8",
  });
  if (result.status === 0) {
    signed = true;
    break;
  }

  tsaFailures += 1;
  console.warn(`AVISO: falha ao assinar com o TSA ${tsa}.`);
  if (result.stdout) console.warn(result.stdout.trim());
  if (result.stderr) console.warn(result.stderr.trim());
  rmSync(outputPath, { force: true });
}

if (!signed) {
  const reason = tsaFailures > 0 ? "todos os TSAs falharam" : "nenhuma URL de TSA configurada";
  if (!allowSkipTsa) {
    console.error(`FALHA: ${reason}.`);
    console.error("Sem carimbo de tempo a assinatura expira junto com o certificado.");
    console.error("Se voce aceita esse risco nesta execucao, rode com: npm run cep:zxp -- --allow-skip-tsa");
    process.exit(1);
  }

  console.warn(`AVISO: ${reason}. Assinando SEM carimbo de tempo (a assinatura vai expirar).`);
  const result = spawnSync(signerPath, signArgs, {
    cwd: signerDir,
    env: signerEnv(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error("FALHA: ZXPSignCmd -sign nao conseguiu assinar o pacote.");
    if (result.stdout) console.error(result.stdout.trim());
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status || 1);
  }
}

if (!existsSync(outputPath)) {
  console.error(`FALHA: o assinador terminou sem produzir ${outputPath}.`);
  process.exit(1);
}

// 4. O ZXPSignCmd 4.1.3 calcula o timestamp sobre SignatureValue sem quebras,
// mas depois grava o base64 com quebras de linha. Isso muda o C14N final e faz
// um verificador RFC3161 correto rejeitar o token. Remover somente esse
// whitespace e seguro: SignatureValue nao faz parte de SignedInfo nem do
// Manifest do pacote. Em seguida, ZXPSignCmd -verify confirma essa invariancia.
try {
  const normalization = normalizeSignatureValueInZxp(outputPath);
  if (normalization.signatureValueChanged) {
    console.log("SignatureValue normalizado para o C14N coberto pelo timestamp.");
  } else {
    console.log("SignatureValue ja estava normalizado.");
  }
  if (normalization.mimetypeReordered) {
    console.log("Entrada mimetype movida para o inicio do pacote UCF.");
  } else if (!normalization.changed) {
    console.log("Layout UCF ja estava canonico.");
  }
} catch (error) {
  console.error(`FALHA: nao foi possivel normalizar ${outputPath}: ${error.message}`);
  rmSync(outputPath, { force: true });
  process.exit(1);
}

// 5. Gates criptograficos do artefato recem-gerado. Nao usamos a mensagem
// "Timestamp: Invalid timestamp" de -certInfo: o ZXPSignCmd 4.1.3 a imprime
// mesmo para o token DigiCert valido. O gate RFC3161 abaixo valida o imprint,
// a assinatura CMS, EKU, genTime e a cadeia do TSA contra as raizes do Node.
console.log("== verificacao criptografica do pacote ==");
let verification;
try {
  verification = await verifyCepZxp(outputPath, {
    trustedCertificates: certificates,
    requireTimestamp: signed,
  });
} catch (error) {
  console.error(`FALHA: o ZXP gerado nao passou nos gates criptograficos: ${error.message}`);
  rmSync(outputPath, { force: true });
  process.exit(1);
}

console.log(`Identidade confirmada (sha256 do certificado DER): ${verification.fingerprint}`);
if (verification.timestamp) {
  console.log(`Carimbo RFC3161 confirmado em ${verification.timestamp.genTime}.`);
  console.log(`TSA: ${verification.timestamp.signer}`);
} else {
  console.warn("AVISO: pacote aceito sem timestamp somente porque --allow-skip-tsa foi informado.");
}
console.log(`OK: ${outputPath}`);

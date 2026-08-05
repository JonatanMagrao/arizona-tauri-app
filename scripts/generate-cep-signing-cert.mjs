// Gera o certificado ESTAVEL de assinatura da extensao CEP (.p12 autoassinado).
//
// ATENCAO: isto cria uma IDENTIDADE DE PUBLICADOR. O .p12 gerado aqui e a
// unica prova de que um .zxp veio da Arizona. Regras (mesmas dos keygens de
// licenca em ADMIN/scripts):
// - o script se recusa a sobrescrever um .p12 existente sem --force;
// - com --force, salva backup datado do .p12 e do json antes de qualquer escrita;
// - a senha e sorteada (nao reutilize a senha de exemplo do vite-cep-plugin);
// - a fingerprint do certificado e APENDADA em INSTALLER/cep-trusted-cert.json,
//   nunca substituindo as entradas antigas (rotacao e aditiva, igual ao
//   ADMIN/supabase/license-trusted-keys.json).
//
// Perder o .p12 = perder a identidade: todo cliente passa a ver um publicador
// diferente e o app rejeita os .zxp novos ate o manifesto ser atualizado.
//
// Uso: npm run cep:cert [-- --force] [--common-name "..."] [--validity-days 7300]
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import {
  argValue,
  assertSignerAvailable,
  certificateDerFromSignatures,
  certsDir,
  describeCertificate,
  fingerprintFromDer,
  hasFlag,
  p12DefaultPath,
  readTrustedCertificates,
  readZipEntry,
  repoRoot,
  signerDir,
  signerEnv,
  signerPath,
  signingConfigPath,
  trustedCertPath,
} from "./cep-signing.mjs";

const force = hasFlag("--force");
const country = argValue("--country", "BR");
const state = argValue("--state", "SP");
const org = argValue("--org", "Arizona");
const commonName = argValue("--common-name", "Arizona Carrefour");
const validityDays = argValue("--validity-days", "7300"); // ~20 anos

assertSignerAvailable();

// 1. Nunca sobrescrever material privado sem intencao explicita.
if (existsSync(p12DefaultPath) && !force) {
  console.error(`ERRO: ${p12DefaultPath} ja existe.`);
  console.error("Gerar um certificado novo troca a IDENTIDADE do publicador: os .zxp novos");
  console.error("passam a ser assinados por outro certificado e o app so aceita depois que a");
  console.error("fingerprint nova estiver em INSTALLER/cep-trusted-cert.json.");
  console.error("Se a rotacao for intencional, rode novamente com --force.");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const previous of [p12DefaultPath, signingConfigPath]) {
  if (!existsSync(previous)) continue;

  const backupPath = `${previous}.bak.${stamp}`;
  copyFileSync(previous, backupPath);
  console.log(`Backup salvo em: ${backupPath}`);
}
if (existsSync(p12DefaultPath)) {
  console.log("Guarde esses backups: sao a unica copia da identidade anterior.");
}

// 2. Gera o .p12 com o assinador oficial da Adobe (bundlado pelo vite-cep-plugin).
mkdirSync(certsDir, { recursive: true });
const password = randomBytes(24).toString("base64url");

const selfSigned = spawnSync(
  signerPath,
  [
    "-selfSignedCert",
    country,
    state,
    org,
    commonName,
    password,
    p12DefaultPath,
    "-validityDays",
    validityDays,
  ],
  { cwd: signerDir, env: signerEnv(), encoding: "utf8" },
);

if (selfSigned.status !== 0) {
  console.error("ERRO: ZXPSignCmd -selfSignedCert falhou.");
  if (selfSigned.stdout) console.error(selfSigned.stdout.trim());
  if (selfSigned.stderr) console.error(selfSigned.stderr.trim());
  process.exit(selfSigned.status || 1);
}
console.log(`Certificado gerado em ${p12DefaultPath}`);

// 3. Config privada consumida pelo empacotador (gitignored junto com o .p12).
const signingConfig = {
  p12Path: relative(repoRoot, p12DefaultPath).split("\\").join("/"),
  password,
  commonName,
  createdAt: new Date().toISOString(),
};
writeFileSync(signingConfigPath, `${JSON.stringify(signingConfig, null, 2)}\n`, "utf8");
console.log(`Config privada gravada em ${signingConfigPath}`);

// 4. Extrai o certificado assinando um pacote descartavel: assim a fingerprint
//    do manifesto vem EXATAMENTE do mesmo caminho de codigo que o empacotador
//    usa para verificar (mesma definicao, sem espaco para divergencia).
const workDir = mkdtempSync(join(tmpdir(), "arizona-cep-cert-"));
let der;
try {
  const probeDir = join(workDir, "probe");
  mkdirSync(join(probeDir, "CSXS"), { recursive: true });
  writeFileSync(
    join(probeDir, "CSXS", "manifest.xml"),
    '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<ExtensionManifest Version="6.0" ExtensionBundleId="com.arizona.certprobe"'
      + ' ExtensionBundleVersion="1.0.0"></ExtensionManifest>\n',
    "utf8",
  );

  const probeZxp = join(workDir, "probe.zxp");
  const probeSign = spawnSync(
    signerPath,
    ["-sign", probeDir, probeZxp, p12DefaultPath, password],
    { cwd: signerDir, env: signerEnv(), encoding: "utf8" },
  );
  if (probeSign.status !== 0) {
    console.error("ERRO: nao foi possivel assinar o pacote de teste para extrair o certificado.");
    if (probeSign.stdout) console.error(probeSign.stdout.trim());
    if (probeSign.stderr) console.error(probeSign.stderr.trim());
    process.exit(probeSign.status || 1);
  }

  const signatures = readZipEntry(probeZxp, "META-INF/signatures.xml");
  if (!signatures) {
    console.error("ERRO: o pacote de teste saiu sem META-INF/signatures.xml.");
    process.exit(1);
  }
  der = certificateDerFromSignatures(signatures.toString("utf8"));
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const fingerprint = fingerprintFromDer(der);
const described = describeCertificate(der);

// 5. Manifesto PUBLICO (versionado): rotacao e aditiva, nada e removido aqui.
const { manifest, certificates } = readTrustedCertificates();
if (certificates.some((entry) => String(entry.sha256 || "").toLowerCase() === fingerprint)) {
  console.error(`ERRO: a fingerprint ${fingerprint} ja existe em ${trustedCertPath}.`);
  process.exit(1);
}

const explicitId = argValue("--id");
const nextId = explicitId || `v${certificates.length + 1}`;
if (certificates.some((entry) => entry.id === nextId)) {
  console.error(`ERRO: o id "${nextId}" ja existe em ${trustedCertPath}. Use --id <outro>.`);
  process.exit(1);
}

certificates.push({
  id: nextId,
  sha256: fingerprint,
  commonName: described.commonName || commonName,
  notAfter: described.notAfter,
  addedAt: new Date().toISOString().slice(0, 10),
});
manifest.schemaVersion = manifest.schemaVersion || 1;
manifest.certificates = certificates;
mkdirSync(dirname(trustedCertPath), { recursive: true });
writeFileSync(trustedCertPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Manifesto atualizado: ${trustedCertPath} agora tem ${certificates.length} certificado(s).`);

console.log("");
console.log("Resumo:");
console.log(`  id no manifesto : ${nextId}`);
console.log(`  common name     : ${described.commonName || commonName}`);
console.log(`  valido ate      : ${described.notAfter || "(nao lido)"}`);
console.log(`  sha256 (DER)    : ${fingerprint}`);
console.log("");
console.log("O QUE FAZER AGORA:");
console.log(`1. FACA BACKUP OFFLINE de ${p12DefaultPath} e de ${signingConfigPath}.`);
console.log("   Eles NAO vao para o git. Sem eles voce nao consegue mais assinar como a Arizona:");
console.log("   seria preciso gerar outra identidade e adicionar a fingerprint nova ao manifesto.");
console.log("2. Commite INSTALLER/cep-trusted-cert.json (ele e publico e PRECISA ser versionado).");
console.log("3. Gere o pacote assinado: npm run cep:zxp");
console.log("");
console.log("Lembrete: a fingerprint acima e uma checagem de IDENTIDADE (o app confere que o .zxp");
console.log("carrega o NOSSO certificado). Quem valida a assinatura em si e o CEP, ao carregar a");
console.log("extensao instalada. As duas juntas e que garantem a origem do conteudo.");

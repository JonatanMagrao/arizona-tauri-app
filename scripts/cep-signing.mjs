// Utilitarios compartilhados da assinatura da extensao CEP.
//
// UMA unica implementacao da "impressao digital" do certificado, usada pelo
// gerador (scripts/generate-cep-signing-cert.mjs), pelo empacotador
// (scripts/package-cep-zxp.mjs) e por qualquer verificador futuro.
//
// DEFINICAO (nao mudar sem atualizar todos os consumidores, inclusive o Rust):
//   fingerprint = SHA-256 em hex minusculo sobre os BYTES DER BRUTOS do
//   certificado X.509 de assinatura, ou seja: base64-decode do UNICO elemento
//   Signature/KeyInfo/X509Data/X509Certificate de META-INF/signatures.xml e
//   hash desses bytes. Material de chave alternativo faz a leitura falhar.
//
// IMPORTANTE: comparar essa fingerprint com o manifesto e uma checagem de
// identidade, nao uma verificacao de assinatura. verifyCepZxp combina esse pin
// com ZXPSignCmd -verify e com a verificacao independente do token RFC3161.
import { spawnSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { rootCertificates } from "node:tls";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import * as asn1js from "asn1js";
import { zipSync, strToU8 } from "fflate";
import {
  Certificate,
  ContentInfo,
  SignedData,
  TSTInfo,
  TimeStampResp,
  id_ContentType_SignedData,
  id_ExtKeyUsage,
  id_eContentType_TSTInfo,
  id_sha256,
} from "pkijs";
import { SaxesParser } from "saxes";

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(scriptDir, "..");
export const extensionDir = resolve(repoRoot, "ARIZONA-EXTENSION");
export const certsDir = resolve(extensionDir, "certs");
export const p12DefaultPath = resolve(certsDir, "arizona-cep-signing.p12");
export const signingConfigPath = resolve(certsDir, "cep-signing.json");
export const trustedCertPath = resolve(repoRoot, "INSTALLER", "cep-trusted-cert.json");

// Binario oficial da Adobe, entregue pelo vite-cep-plugin via npm i
// (node_modules e gitignored, entao ele nao vive no repositorio).
export const signerDir = resolve(
  extensionDir,
  "node_modules",
  "vite-cep-plugin",
  "lib",
  "bin",
);
export const signerPath = resolve(
  signerDir,
  process.platform === "win32" ? "ZXPSignCmd.exe" : "ZXPSignCmd",
);

// Hash conferido byte a byte contra o ZXPSignCmd 4.1.3 publicado pela Adobe.
// O release oficial e Windows; outras plataformas falham fechado ate que o
// binario oficial correspondente seja auditado e seu hash seja adicionado.
export const trustedSignerSha256ByPlatform = Object.freeze({
  win32: "ffc2223167225ce61d024eb463fc5ad1a1be16133f99ef334a646f7311916c98",
});

// Mesmos TSAs do cep.config.ts: o primeiro que responder assina com carimbo de
// tempo (sem TSA a assinatura expira junto com o certificado).
export const defaultTsaUrls = [
  "http://timestamp.digicert.com/",
  "http://timestamp.apple.com/ts01",
];

export function hasFlag(name) {
  return process.argv.includes(name);
}

export function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : fallback;
}

// O sandbox/PowerShell pode deixar NoDefaultCurrentDirectoryInExePath setado, o
// que quebra a resolucao do binario quando ele e chamado pelo nome. Sempre
// invocamos por caminho absoluto e limpamos a variavel por seguranca.
export function signerEnv() {
  const env = { ...process.env };
  delete env.NoDefaultCurrentDirectoryInExePath;
  return env;
}

export function requireTrustedSignerBinary() {
  if (!existsSync(signerPath)) {
    throw new Error(
      `Assinador nao encontrado em ${signerPath}. Rode: npm --prefix ARIZONA-EXTENSION install`,
    );
  }
  const expected = trustedSignerSha256ByPlatform[process.platform];
  if (!expected) {
    throw new Error(
      `ZXPSignCmd ainda nao possui hash oficial fixado para ${process.platform}; o release oficial deve rodar no Windows.`,
    );
  }
  const actual = createHash("sha256").update(readFileSync(signerPath)).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `ZXPSignCmd nao corresponde ao binario Adobe 4.1.3 auditado (esperado ${expected}; recebeu ${actual}).`,
    );
  }
  return actual;
}

export function assertSignerAvailable() {
  try {
    return requireTrustedSignerBinary();
  } catch (error) {
    console.error(`ERRO: ${error.message}`);
    process.exit(1);
  }
}

// --- Configuracao do certificado estavel -----------------------------------

// Precedencia: CEP_SIGNING_P12 / CEP_SIGNING_PASSWORD (CI) > certs/cep-signing.json.
export function resolveSigningConfig({ required = true } = {}) {
  const envP12 = String(process.env.CEP_SIGNING_P12 || "").trim();
  const envPassword = String(process.env.CEP_SIGNING_PASSWORD || "").trim();

  if (envP12 || envPassword) {
    if (!envP12 || !envPassword) {
      console.error("ERRO: CEP_SIGNING_P12 e CEP_SIGNING_PASSWORD precisam ser definidos juntos.");
      process.exit(1);
    }

    const p12Path = isAbsolute(envP12) ? envP12 : resolve(repoRoot, envP12);
    if (!existsSync(p12Path)) {
      console.error(`ERRO: CEP_SIGNING_P12 aponta para ${p12Path}, que nao existe.`);
      process.exit(1);
    }

    return { p12Path, password: envPassword, commonName: "", source: "env" };
  }

  if (!existsSync(signingConfigPath)) {
    if (!required) return null;

    console.error(`ERRO: configuracao de assinatura nao encontrada em ${signingConfigPath}.`);
    console.error("O .p12 estavel da Arizona nao esta nesta maquina (ele NUNCA vai para o git).");
    console.error("Se voce tem o backup, restaure ARIZONA-EXTENSION/certs/ e rode de novo.");
    console.error("Se e a primeira geracao (isso cria uma IDENTIDADE NOVA), rode: npm run cep:cert");
    console.error("Em CI, use as variaveis CEP_SIGNING_P12 e CEP_SIGNING_PASSWORD.");
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(signingConfigPath, "utf8"));
  } catch (error) {
    console.error(`ERRO: ${signingConfigPath} nao e um JSON valido (${error.message}).`);
    process.exit(1);
  }

  const rawP12 = String(parsed.p12Path || "").trim();
  const password = String(parsed.password || "");
  if (!rawP12 || !password) {
    console.error(`ERRO: ${signingConfigPath} precisa conter "p12Path" e "password".`);
    process.exit(1);
  }

  const p12Path = isAbsolute(rawP12) ? rawP12 : resolve(repoRoot, rawP12);
  if (!existsSync(p12Path)) {
    console.error(`ERRO: certificado nao encontrado em ${p12Path} (referenciado por ${signingConfigPath}).`);
    console.error("Restaure o backup do .p12 ou gere uma identidade nova com: npm run cep:cert");
    process.exit(1);
  }

  return {
    p12Path,
    password,
    commonName: String(parsed.commonName || ""),
    source: signingConfigPath,
  };
}

// --- Manifesto publico de certificados confiaveis ---------------------------

export function readTrustedCertificates({ throwOnError = false } = {}) {
  if (!existsSync(trustedCertPath)) {
    return { path: trustedCertPath, manifest: { schemaVersion: 1, certificates: [] }, certificates: [] };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(trustedCertPath, "utf8"));
  } catch (error) {
    if (throwOnError) {
      throw new Error(`${trustedCertPath} nao e um JSON valido (${error.message}).`);
    }
    console.error(`ERRO: ${trustedCertPath} nao e um JSON valido (${error.message}).`);
    process.exit(1);
  }

  const certificates = Array.isArray(manifest.certificates) ? manifest.certificates : [];
  return { path: trustedCertPath, manifest, certificates };
}

export function isTrustedFingerprint(fingerprint, certificates) {
  const wanted = String(fingerprint || "").toLowerCase();
  return certificates.some((entry) => String(entry.sha256 || "").toLowerCase() === wanted);
}

// --- Impressao digital (definicao unica) ------------------------------------

export const xmlDsigNamespace = "http://www.w3.org/2000/09/xmldsig#";
export const canonicalXmlAlgorithm = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";

const xmlnsNamespace = "http://www.w3.org/2000/xmlns/";
const timestampingEku = "1.3.6.1.5.5.7.3.8";
const xmlWhitespacePattern = /[\u0009\u000a\u000d\u0020]+/g;
const strictBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function localNameOf(tag) {
  return tag.local || tag.name.split(":").pop();
}

function parseSignatureXml(xmlText) {
  const xml = String(xmlText);
  const nodes = [];
  const stack = [];
  const errors = [];
  const parser = new SaxesParser({ xmlns: true, position: true });

  parser.on("doctype", () => {
    errors.push(new Error("DOCTYPE nao e permitido em META-INF/signatures.xml."));
  });
  parser.on("error", (error) => {
    errors.push(error);
  });
  parser.on("opentag", (tag) => {
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    const namespaces = parent ? { ...parent.namespaces } : {};
    for (const [prefix, uri] of Object.entries(tag.ns || {})) {
      namespaces[prefix] = uri;
    }

    const node = {
      name: tag.name,
      local: localNameOf(tag),
      prefix: tag.prefix || "",
      uri: tag.uri || "",
      attributes: Object.values(tag.attributes || {}),
      namespaces,
      children: [],
      parent,
      text: "",
      contentStart: parser.position,
      contentEnd: parser.position,
      isSelfClosing: Boolean(tag.isSelfClosing),
    };
    if (parent) parent.children.push(node);
    nodes.push(node);
    stack.push(node);
  });
  const appendText = (value) => {
    if (stack.length > 0) stack[stack.length - 1].text += value;
  };
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("closetag", (tag) => {
    const node = stack.pop();
    if (!node || node.name !== tag.name) {
      errors.push(new Error(`Estrutura XML inconsistente ao fechar ${tag.name}.`));
      return;
    }
    if (!tag.isSelfClosing) {
      const closeStart = xml.lastIndexOf("</", parser.position - 1);
      if (closeStart < node.contentStart) {
        errors.push(new Error(`Nao foi possivel localizar o fechamento de ${tag.name}.`));
      } else {
        node.contentEnd = closeStart;
      }
    }
  });

  try {
    parser.write(xml).close();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new Error(`META-INF/signatures.xml nao e XML valido: ${errors[0].message}`);
  }
  if (stack.length > 0) {
    throw new Error("META-INF/signatures.xml terminou com elementos abertos.");
  }
  return { xml, nodes };
}

function nodesNamed(parsed, localName) {
  return parsed.nodes.filter((node) => node.local === localName);
}

function requireExactly(nodes, count, description) {
  if (nodes.length !== count) {
    throw new Error(`META-INF/signatures.xml precisa conter exatamente ${count} ${description}; encontrou ${nodes.length}.`);
  }
  return nodes[0];
}

function requireDsigElement(node, description) {
  if (node.uri !== xmlDsigNamespace) {
    throw new Error(`${description} precisa usar o namespace XMLDSig (${xmlDsigNamespace}).`);
  }
}

function attributeValue(node, localName, namespace = "") {
  const matches = node.attributes.filter((attribute) =>
    attribute.local === localName && (attribute.uri || "") === namespace,
  );
  if (matches.length > 1) {
    throw new Error(`${node.name} contem mais de um atributo ${localName}.`);
  }
  return matches.length === 1 ? matches[0].value : null;
}

function decodeStrictBase64(text, description) {
  const compact = String(text).replace(xmlWhitespacePattern, "");
  if (!compact) throw new Error(`${description} esta vazio.`);
  if (compact.length % 4 !== 0 || !strictBase64Pattern.test(compact)) {
    throw new Error(`${description} nao e base64 canonico valido.`);
  }
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== compact) {
    throw new Error(`${description} nao e base64 canonico valido.`);
  }
  return { compact, bytes };
}

function inspectCertificateStructure(parsed) {
  const signature = requireExactly(nodesNamed(parsed, "Signature"), 1, "elemento Signature");
  requireDsigElement(signature, "Signature");

  const allKeyInfo = nodesNamed(parsed, "KeyInfo");
  requireExactly(allKeyInfo, 1, "elemento KeyInfo");
  const directKeyInfo = signature.children.filter((child) => child.local === "KeyInfo");
  const keyInfo = requireExactly(directKeyInfo, 1, "KeyInfo filho direto de Signature");
  requireDsigElement(keyInfo, "KeyInfo");

  const allX509Data = nodesNamed(parsed, "X509Data");
  requireExactly(allX509Data, 1, "elemento X509Data");
  if (keyInfo.children.length !== 1 || keyInfo.children[0].local !== "X509Data") {
    throw new Error("KeyInfo precisa conter somente um X509Data e nenhum material de chave alternativo.");
  }
  const x509Data = keyInfo.children[0];
  requireDsigElement(x509Data, "X509Data");

  const allCertificates = nodesNamed(parsed, "X509Certificate");
  const certificate = requireExactly(allCertificates, 1, "elemento X509Certificate");
  if (x509Data.children.length !== 1 || x509Data.children[0] !== certificate) {
    throw new Error("X509Data precisa conter somente um X509Certificate.");
  }
  requireDsigElement(certificate, "X509Certificate");
  if (certificate.children.length !== 0) {
    throw new Error("X509Certificate nao pode conter elementos filhos.");
  }

  const { bytes: der } = decodeStrictBase64(
    certificate.text,
    "X509Certificate de META-INF/signatures.xml",
  );
  return { signature, keyInfo, x509Data, certificate, der };
}

function escapeCanonicalText(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\r/g, "&#xD;");
}

function escapeCanonicalAttribute(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#x9;")
    .replace(/\n/g, "&#xA;")
    .replace(/\r/g, "&#xD;");
}

function canonicalizeTextOnlyElement(node, text) {
  const namespaceAttributes = Object.entries(node.namespaces)
    .filter(([prefix]) => prefix !== "xml")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([prefix, uri]) => {
      const name = prefix ? `xmlns:${prefix}` : "xmlns";
      return `${name}="${escapeCanonicalAttribute(uri)}"`;
    });
  const regularAttributes = node.attributes
    .filter((attribute) => attribute.uri !== xmlnsNamespace)
    .sort((left, right) => {
      const namespaceOrder = (left.uri || "").localeCompare(right.uri || "");
      return namespaceOrder || left.local.localeCompare(right.local);
    })
    .map((attribute) => `${attribute.name}="${escapeCanonicalAttribute(attribute.value)}"`);
  const attributes = [...namespaceAttributes, ...regularAttributes];
  const suffix = attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
  return Buffer.from(
    `<${node.name}${suffix}>${escapeCanonicalText(text)}</${node.name}>`,
    "utf8",
  );
}

function inspectSignatureValue(parsed, signature) {
  const allValues = nodesNamed(parsed, "SignatureValue");
  const signatureValue = requireExactly(allValues, 1, "elemento SignatureValue");
  if (signatureValue.parent !== signature) {
    throw new Error("SignatureValue precisa ser filho direto do unico Signature.");
  }
  requireDsigElement(signatureValue, "SignatureValue");
  if (signatureValue.children.length !== 0 || signatureValue.isSelfClosing) {
    throw new Error("SignatureValue precisa conter apenas o valor base64 da assinatura.");
  }
  const id = attributeValue(signatureValue, "Id");
  if (!id) throw new Error("SignatureValue precisa ter um atributo Id.");
  const { compact } = decodeStrictBase64(signatureValue.text, "SignatureValue");
  const canonical = canonicalizeTextOnlyElement(signatureValue, signatureValue.text);
  const normalizedCanonical = canonicalizeTextOnlyElement(signatureValue, compact);
  return { signatureValue, compact, canonical, normalizedCanonical, id };
}

export function certificateDerFromSignatures(xmlText) {
  const parsed = parseSignatureXml(xmlText);
  return inspectCertificateStructure(parsed).der;
}

export function canonicalSignatureValueFromSignatures(xmlText) {
  const parsed = parseSignatureXml(xmlText);
  const { signature } = inspectCertificateStructure(parsed);
  return inspectSignatureValue(parsed, signature).canonical;
}

export function normalizeSignatureValueInSignatures(xmlText) {
  const parsed = parseSignatureXml(xmlText);
  const { signature } = inspectCertificateStructure(parsed);
  const { signatureValue, compact } = inspectSignatureValue(parsed, signature);
  const normalizedXml =
    parsed.xml.slice(0, signatureValue.contentStart) +
    compact +
    parsed.xml.slice(signatureValue.contentEnd);
  return {
    xml: normalizedXml,
    changed: normalizedXml !== parsed.xml,
    canonical: canonicalSignatureValueFromSignatures(normalizedXml),
  };
}

export function fingerprintFromDer(der) {
  return createHash("sha256").update(der).digest("hex");
}

export function certificateFingerprintFromSignatures(xmlText) {
  return fingerprintFromDer(certificateDerFromSignatures(xmlText));
}

// Metadados so para deixar o manifesto legivel por humanos; a checagem real e
// sempre a fingerprint.
export function describeCertificate(der) {
  try {
    const cert = new X509Certificate(der);
    const commonName = (cert.subject || "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("CN="));
    const notAfter = new Date(cert.validTo);
    return {
      commonName: commonName ? commonName.slice(3) : "",
      notAfter: Number.isNaN(notAfter.getTime()) ? String(cert.validTo) : notAfter.toISOString(),
    };
  } catch {
    return { commonName: "", notAfter: "" };
  }
}

// --- Carimbo RFC3161 ---------------------------------------------------------

function isXadesNamespace(uri) {
  return /^http:\/\/uri\.etsi\.org\/01903\/v[\d.]+#$/.test(uri);
}

function inspectTimestampStructure(parsed, signature, signatureValueId) {
  const signatureTimestamp = requireExactly(
    nodesNamed(parsed, "SignatureTimeStamp"),
    1,
    "elemento SignatureTimeStamp",
  );
  if (!isXadesNamespace(signatureTimestamp.uri)) {
    throw new Error("SignatureTimeStamp precisa usar um namespace XAdES conhecido.");
  }
  let ancestor = signatureTimestamp.parent;
  while (ancestor && ancestor !== signature) ancestor = ancestor.parent;
  if (ancestor !== signature) {
    throw new Error("SignatureTimeStamp precisa pertencer ao unico Signature.");
  }

  const hashDataInfo = signatureTimestamp.children.filter((child) => child.local === "HashDataInfo");
  const encapsulated = signatureTimestamp.children.filter(
    (child) => child.local === "EncapsulatedTimeStamp",
  );
  const hashNode = requireExactly(hashDataInfo, 1, "HashDataInfo em SignatureTimeStamp");
  const timestampNode = requireExactly(
    encapsulated,
    1,
    "EncapsulatedTimeStamp em SignatureTimeStamp",
  );
  if (signatureTimestamp.children.length !== 2) {
    throw new Error("SignatureTimeStamp contem elementos inesperados.");
  }
  if (hashNode.uri !== signatureTimestamp.uri || timestampNode.uri !== signatureTimestamp.uri) {
    throw new Error("Os elementos do carimbo precisam usar o mesmo namespace XAdES.");
  }
  if (timestampNode.children.length !== 0 || timestampNode.isSelfClosing) {
    throw new Error("EncapsulatedTimeStamp precisa conter somente o token base64.");
  }

  const lowerUri = attributeValue(hashNode, "uri");
  const upperUri = attributeValue(hashNode, "URI");
  const regularHashAttributes = hashNode.attributes.filter(
    (attribute) => attribute.uri !== xmlnsNamespace,
  );
  if ((lowerUri === null) === (upperUri === null) || regularHashAttributes.length !== 1) {
    throw new Error("HashDataInfo precisa ter exatamente um atributo uri/URI.");
  }
  const coveredUri = lowerUri ?? upperUri;
  if (coveredUri !== "SignatureValue" && coveredUri !== `#${signatureValueId}`) {
    throw new Error(`HashDataInfo nao aponta para SignatureValue (uri=${coveredUri || "ausente"}).`);
  }
  if (hashNode.children.length !== 1 || hashNode.children[0].local !== "Transforms") {
    throw new Error("HashDataInfo precisa declarar somente o transform XML C14N.");
  }
  const transforms = hashNode.children[0];
  requireDsigElement(transforms, "Transforms do carimbo");
  if (transforms.attributes.some((attribute) => attribute.uri !== xmlnsNamespace)) {
    throw new Error("Transforms do carimbo nao pode conter atributos adicionais.");
  }
  if (transforms.children.length !== 1 || transforms.children[0].local !== "Transform") {
    throw new Error("HashDataInfo precisa declarar exatamente um Transform.");
  }
  const transform = transforms.children[0];
  requireDsigElement(transform, "Transform do carimbo");
  if (
    transform.children.length !== 0 ||
    transform.attributes.filter((attribute) => attribute.uri !== xmlnsNamespace).length !== 1
  ) {
    throw new Error("Transform do carimbo precisa conter somente o atributo Algorithm.");
  }
  if (attributeValue(transform, "Algorithm") !== canonicalXmlAlgorithm) {
    throw new Error("O carimbo nao usa o algoritmo XML C14N esperado.");
  }

  return decodeStrictBase64(timestampNode.text, "EncapsulatedTimeStamp").bytes;
}

function exactArrayBuffer(bytes) {
  const view = Buffer.from(bytes);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

function parseBerExact(bytes, description) {
  const input = exactArrayBuffer(bytes);
  const parsed = asn1js.fromBER(input);
  if (parsed.offset === -1 || parsed.offset !== input.byteLength) {
    throw new Error(`${description} nao e DER/BER valido ou contem bytes excedentes.`);
  }
  return parsed.result;
}

function parseTimestampToken(bytes) {
  let responseError;
  try {
    const response = new TimeStampResp({
      schema: parseBerExact(bytes, "TimeStampResp RFC3161"),
    });
    if (response.status.status !== 0 && response.status.status !== 1) {
      throw new Error(`TSA devolveu status RFC3161 ${response.status.status}.`);
    }
    if (!response.timeStampToken) {
      throw new Error("TimeStampResp nao contem timeStampToken.");
    }
    return { contentInfo: response.timeStampToken, responseStatus: response.status.status };
  } catch (error) {
    responseError = error;
  }

  // XAdES normalmente carrega apenas o CMS TimeStampToken; o ZXPSignCmd 4.1.3
  // carrega a TimeStampResp inteira. Aceitamos as duas formas padrao, mas todo
  // o restante da validacao e identico e falha fechado.
  try {
    const contentInfo = new ContentInfo({
      schema: parseBerExact(bytes, "CMS TimeStampToken"),
    });
    return { contentInfo, responseStatus: null };
  } catch (tokenError) {
    throw new Error(
      `EncapsulatedTimeStamp nao e TimeStampResp nem CMS valido (${responseError.message}; ${tokenError.message}).`,
    );
  }
}

let cachedTimestampRoots = null;

function trustedTimestampRoots() {
  if (cachedTimestampRoots) return cachedTimestampRoots;
  const roots = [];
  for (const pem of rootCertificates) {
    try {
      const base64 = pem
        .replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----/g, "")
        .replace(/\s+/g, "");
      roots.push(Certificate.fromBER(Buffer.from(base64, "base64")));
    } catch {
      // Uma raiz individual invalida nao deve apagar as demais do bundle Node.
    }
  }
  if (roots.length === 0) {
    throw new Error("O Node nao disponibilizou nenhuma raiz publica para validar o TSA.");
  }
  cachedTimestampRoots = roots;
  return roots;
}

function certificateDisplayName(certificate) {
  try {
    return certificate.subject.typesAndValues
      .map((item) => `${item.type}=${item.value.valueBlock.value}`)
      .join(", ");
  } catch {
    return "TSA desconhecido";
  }
}

function requireTimestampingEku(certificate) {
  const ekuExtensions = (certificate.extensions || []).filter(
    (extension) => extension.extnID === id_ExtKeyUsage,
  );
  if (ekuExtensions.length !== 1) {
    throw new Error("O certificado do TSA precisa ter exatamente uma extensao Extended Key Usage.");
  }
  const eku = ekuExtensions[0];
  const purposes = eku.parsedValue?.keyPurposes || [];
  if (!eku.critical || purposes.length !== 1 || purposes[0] !== timestampingEku) {
    throw new Error("O certificado do TSA nao possui EKU critico e exclusivo de timeStamping.");
  }
}

export async function verifyRfc3161TimestampFromSignatures(xmlText, { now = new Date() } = {}) {
  const parsed = parseSignatureXml(xmlText);
  const { signature } = inspectCertificateStructure(parsed);
  const signatureValue = inspectSignatureValue(parsed, signature);
  const timestampBytes = inspectTimestampStructure(parsed, signature, signatureValue.id);
  const { contentInfo, responseStatus } = parseTimestampToken(timestampBytes);
  if (contentInfo.contentType !== id_ContentType_SignedData) {
    throw new Error(`TimeStampToken nao e CMS SignedData (${contentInfo.contentType}).`);
  }

  const signedData = new SignedData({ schema: contentInfo.content });
  if (signedData.signerInfos.length !== 1) {
    throw new Error(`TimeStampToken precisa ter exatamente um signer; encontrou ${signedData.signerInfos.length}.`);
  }
  if (signedData.encapContentInfo.eContentType !== id_eContentType_TSTInfo) {
    throw new Error("TimeStampToken nao encapsula TSTInfo RFC3161.");
  }
  if (!signedData.encapContentInfo.eContent) {
    throw new Error("TimeStampToken nao contem o TSTInfo encapsulado.");
  }
  if (signedData.signerInfos[0].digestAlgorithm.algorithmId !== id_sha256) {
    throw new Error("O signer do TSA precisa usar SHA-256.");
  }

  const tstInfoBytes = signedData.encapContentInfo.eContent.getValue();
  const tstInfo = new TSTInfo({ schema: parseBerExact(tstInfoBytes, "TSTInfo RFC3161") });
  if (tstInfo.version !== 1) throw new Error(`TSTInfo usa versao inesperada: ${tstInfo.version}.`);
  if (tstInfo.messageImprint.hashAlgorithm.algorithmId !== id_sha256) {
    throw new Error("O messageImprint do TSA precisa usar SHA-256.");
  }
  const messageImprint = Buffer.from(
    tstInfo.messageImprint.hashedMessage.valueBlock.valueHexView,
  );
  const expectedImprint = createHash("sha256").update(signatureValue.canonical).digest();
  if (messageImprint.length !== expectedImprint.length || !messageImprint.equals(expectedImprint)) {
    throw new Error(
      `messageImprint RFC3161 nao corresponde ao C14N de SignatureValue (esperado ${expectedImprint.toString("hex")}; recebeu ${messageImprint.toString("hex")}).`,
    );
  }
  if (!(tstInfo.genTime instanceof Date) || Number.isNaN(tstInfo.genTime.getTime())) {
    throw new Error("TSTInfo nao contem um genTime valido.");
  }
  if (tstInfo.genTime.getTime() > now.getTime() + 5 * 60 * 1000) {
    throw new Error(`O genTime do TSA esta no futuro: ${tstInfo.genTime.toISOString()}.`);
  }

  let verification;
  try {
    verification = await signedData.verify({
      signer: 0,
      data: exactArrayBuffer(signatureValue.canonical),
      trustedCerts: trustedTimestampRoots(),
      checkChain: true,
      passedWhenNotRevValues: true,
      extendedMode: true,
    });
  } catch (error) {
    throw new Error(`Falha na verificacao CMS/RFC3161: ${error.message}`);
  }
  if (verification.signatureVerified !== true || verification.signerCertificateVerified !== true) {
    throw new Error("A assinatura CMS ou a cadeia do TSA nao foi validada.");
  }
  const signerCertificate = verification.signerCertificate;
  if (!signerCertificate) throw new Error("Nao foi possivel identificar o certificado do TSA.");
  requireTimestampingEku(signerCertificate);
  if (
    tstInfo.genTime < signerCertificate.notBefore.value ||
    tstInfo.genTime > signerCertificate.notAfter.value
  ) {
    throw new Error("O genTime esta fora da validade do certificado do TSA.");
  }

  return {
    genTime: tstInfo.genTime.toISOString(),
    messageImprintSha256: messageImprint.toString("hex"),
    responseStatus,
    signer: certificateDisplayName(signerCertificate),
    chainLength: verification.certificatePath.length,
  };
}

// --- Leitura ZIP estrita -----------------------------------------------------

// Mesmos limites usados pelo preflight PowerShell. O CLI criptografico precisa
// ser seguro quando executado sozinho, sem depender de outro gate para rejeitar
// ZIP bombs, nomes ambiguos ou entradas especiais.
export const cepZipLimits = Object.freeze({
  archiveBytes: 256 * 1024 * 1024,
  entries: 4096,
  entryBytes: 128 * 1024 * 1024,
  expandedBytes: 512 * 1024 * 1024,
  metadataBytes: 2 * 1024 * 1024,
});

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const UTF8_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ENCRYPTED_FLAG = 0x0001;
const WINDOWS_DIRECTORY_ATTRIBUTE = 0x0010;
const WINDOWS_REPARSE_ATTRIBUTE = 0x0400;
const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_REGULAR_FILE = 0x8000;
const UNIX_DIRECTORY = 0x4000;
const UNIX_SYMLINK = 0xa000;

let crc32Table = null;

function crc32(bytes) {
  if (!crc32Table) {
    crc32Table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crc32Table[index] = value >>> 0;
    }
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = crc32Table[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function decodeZipName(bytes, flags) {
  if ((flags & UTF8_FLAG) === 0 && bytes.some((byte) => byte > 0x7f)) {
    throw new Error("O ZXP contem nome nao ASCII sem o flag UTF-8.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`O ZXP contem nome de entrada UTF-8 invalido: ${error.message}`);
  }
}

function normalizeZipEntryName(name) {
  const original = String(name);
  if (!original || /[\u0000-\u001f\u007f]/.test(original)) {
    throw new Error(`O ZXP contem nome de entrada vazio ou com controles: ${JSON.stringify(original)}.`);
  }
  const slashName = original.replace(/\\/g, "/");
  if (slashName.startsWith("/") || slashName.includes(":")) {
    throw new Error(`O ZXP contem caminho absoluto ou com drive: ${original}.`);
  }

  const components = [];
  for (const rawComponent of slashName.split("/")) {
    if (!rawComponent || rawComponent === ".") continue;
    if (rawComponent === "..") {
      throw new Error(`O ZXP contem parent traversal: ${original}.`);
    }
    const component = rawComponent.normalize("NFC");
    if (/[<>:"|?*]/.test(component) || /[. ]$/.test(component)) {
      throw new Error(`O ZXP contem componente de caminho inseguro: ${original}.`);
    }
    const windowsStem = component.split(".", 1)[0].toUpperCase();
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(windowsStem)) {
      throw new Error(`O ZXP contem nome reservado do Windows: ${original}.`);
    }
    components.push(component);
  }
  if (components.length === 0) {
    throw new Error(`O ZXP contem entrada sem caminho relativo util: ${original}.`);
  }
  return components.join("/");
}

function inspectExtraFields(extra, entryName) {
  let cursor = 0;
  while (cursor < extra.length) {
    if (cursor + 4 > extra.length) {
      throw new Error(`Campo extra ZIP truncado em ${entryName}.`);
    }
    const id = extra.readUInt16LE(cursor);
    const length = extra.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + length > extra.length) {
      throw new Error(`Campo extra ZIP excede o cabecalho em ${entryName}.`);
    }
    // ZIP64 e Unicode Path criam duas representacoes possiveis de tamanho ou
    // nome. Nossos limites nao precisam de ZIP64 e o nome canonico ja e UTF-8.
    if (id === 0x0001 || id === 0x7075) {
      throw new Error(`Campo extra ZIP ambiguo 0x${id.toString(16)} em ${entryName}.`);
    }
    cursor += length;
  }
}

function locateEocd(buffer) {
  if (buffer.length < 22) throw new Error("O arquivo e pequeno demais para ser um ZIP.");
  const lowest = Math.max(0, buffer.length - (0xffff + 22));
  for (let cursor = buffer.length - 22; cursor >= lowest; cursor -= 1) {
    if (buffer.readUInt32LE(cursor) !== EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(cursor + 20);
    if (cursor + 22 + commentLength === buffer.length) return cursor;
  }
  throw new Error("Fim do diretorio central ZIP nao encontrado.");
}

function regularityOfEntry(name, externalAttributes) {
  const directoryByName = name.endsWith("/") || name.endsWith("\\");
  const unixType = (externalAttributes >>> 16) & UNIX_FILE_TYPE_MASK;
  const windowsAttributes = externalAttributes & 0xffff;
  if (unixType === UNIX_SYMLINK || (windowsAttributes & WINDOWS_REPARSE_ATTRIBUTE) !== 0) {
    throw new Error(`O ZXP contem link simbolico ou reparse point: ${name}.`);
  }
  if (directoryByName) {
    if (unixType !== 0 && unixType !== UNIX_DIRECTORY) {
      throw new Error(`Entrada de diretorio possui tipo de arquivo inconsistente: ${name}.`);
    }
  } else if (
    (windowsAttributes & WINDOWS_DIRECTORY_ATTRIBUTE) !== 0 ||
    (unixType !== 0 && unixType !== UNIX_REGULAR_FILE)
  ) {
    throw new Error(`O ZXP contem entrada que nao e arquivo regular: ${name}.`);
  }
  return { isDirectory: directoryByName, unixType, windowsAttributes };
}

export function inspectZxpArchive(zipPath, limitOverrides = {}) {
  const limits = { ...cepZipLimits, ...limitOverrides };
  const buffer = readFileSync(zipPath);
  if (buffer.length === 0 || buffer.length > limits.archiveBytes) {
    throw new Error(`Tamanho do ZXP fora do limite de ${limits.archiveBytes} bytes: ${zipPath}.`);
  }

  const eocd = locateEocd(buffer);
  const disk = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const diskEntries = buffer.readUInt16LE(eocd + 8);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) {
    throw new Error("ZIP multidisco nao e permitido no ZXP.");
  }
  if (entryCount === 0 || entryCount > limits.entries) {
    throw new Error(`Quantidade de entradas fora do limite de ${limits.entries}: ${entryCount}.`);
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 nao e permitido no ZXP.");
  }
  if (centralOffset + centralSize !== eocd || centralOffset > buffer.length) {
    throw new Error("Diretorio central ZIP possui limites inconsistentes.");
  }

  const entries = [];
  const normalizedNames = new Set();
  let expandedBytes = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > eocd || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error(`Diretorio central ZIP corrompido na entrada ${index}.`);
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const startDisk = buffer.readUInt16LE(cursor + 34);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const recordEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > eocd) throw new Error("Registro do diretorio central excede seus limites.");
    if (startDisk !== 0 || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error("Entrada ZIP64 ou multidisco nao e permitida no ZXP.");
    }
    if ((flags & ENCRYPTED_FLAG) !== 0 || (flags & DATA_DESCRIPTOR_FLAG) !== 0) {
      throw new Error("Entradas criptografadas ou com data descriptor nao sao permitidas no ZXP.");
    }
    if (method !== 0 && method !== 8) {
      throw new Error(`Metodo de compressao ${method} nao suportado no ZXP.`);
    }
    if (uncompressedSize > limits.entryBytes) {
      throw new Error(`Entrada ZIP excede ${limits.entryBytes} bytes.`);
    }
    expandedBytes += uncompressedSize;
    if (expandedBytes > limits.expandedBytes) {
      throw new Error(`Conteudo expandido do ZXP excede ${limits.expandedBytes} bytes.`);
    }

    const rawName = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decodeZipName(rawName, flags);
    const normalizedName = normalizeZipEntryName(name);
    const regularity = regularityOfEntry(name, externalAttributes);
    if (
      regularity.isDirectory &&
      (method !== 0 || compressedSize !== 0 || uncompressedSize !== 0 || checksum !== 0)
    ) {
      throw new Error(`Entrada de diretorio precisa estar vazia e sem compressao: ${name}.`);
    }
    if (!regularity.isDirectory && method === 0 && compressedSize !== uncompressedSize) {
      throw new Error(`Entrada armazenada possui tamanhos divergentes: ${name}.`);
    }
    const canonicalName = regularity.isDirectory ? `${normalizedName}/` : normalizedName;
    if (name !== canonicalName) {
      throw new Error(`O ZXP contem nome nao canonico (${name}); esperado ${canonicalName}.`);
    }
    const normalizedKey = normalizedName.toLocaleLowerCase("en-US");
    if (normalizedNames.has(normalizedKey)) {
      throw new Error(`O ZXP contem entrada duplicada apos normalizacao: ${name}.`);
    }
    normalizedNames.add(normalizedKey);
    inspectExtraFields(
      buffer.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength),
      name,
    );

    if (localOffset + 30 > centralOffset || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`Cabecalho local invalido para ${name}.`);
    }
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localChecksum = buffer.readUInt32LE(localOffset + 14);
    const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
    const localUncompressedSize = buffer.readUInt32LE(localOffset + 22);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) throw new Error(`Dados comprimidos excedem os limites em ${name}.`);
    const localName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength);
    if (!localName.equals(rawName)) {
      throw new Error(`Nome local e central divergem para ${name}.`);
    }
    if (
      localFlags !== flags ||
      localMethod !== method ||
      localChecksum !== checksum ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize
    ) {
      throw new Error(`Cabecalhos local e central divergem para ${name}.`);
    }
    inspectExtraFields(
      buffer.subarray(localOffset + 30 + localNameLength, dataStart),
      name,
    );

    entries.push({
      name,
      normalizedName,
      flags,
      method,
      checksum,
      compressedSize,
      uncompressedSize,
      externalAttributes,
      dataStart,
      dataEnd,
      localOffset,
      ...regularity,
    });
    cursor = recordEnd;
  }
  if (cursor !== eocd) throw new Error("Diretorio central ZIP contem bytes nao contabilizados.");

  const ranges = entries
    .map((entry) => ({ start: entry.localOffset, end: entry.dataEnd, name: entry.name }))
    .sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) {
      throw new Error(`Entradas ZIP sobrepostas: ${ranges[index - 1].name} e ${ranges[index].name}.`);
    }
  }
  return { path: resolve(zipPath), buffer, entries, limits };
}

function readInspectedZipEntry(archive, entry, maxBytes) {
  if (!entry) return null;
  if (entry.isDirectory) throw new Error(`${entry.name} precisa ser arquivo regular.`);
  if (entry.uncompressedSize > maxBytes) {
    throw new Error(`${entry.name} excede o limite de leitura de ${maxBytes} bytes.`);
  }
  const compressed = archive.buffer.subarray(entry.dataStart, entry.dataEnd);
  let bytes;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new Error(`Entrada armazenada possui tamanhos divergentes: ${entry.name}.`);
    }
    bytes = Buffer.from(compressed);
  } else {
    try {
      bytes = inflateRawSync(compressed, {
        maxOutputLength: Math.max(1, entry.uncompressedSize),
      });
    } catch (error) {
      throw new Error(`Falha ao expandir ${entry.name}: ${error.message}`);
    }
  }
  if (bytes.length !== entry.uncompressedSize) {
    throw new Error(`Tamanho expandido diverge do cabecalho em ${entry.name}.`);
  }
  if (crc32(bytes) !== entry.checksum) {
    throw new Error(`CRC-32 invalido em ${entry.name}.`);
  }
  return bytes;
}

function parseCepManifestXml(xmlText) {
  const errors = [];
  let depth = 0;
  let root = null;
  const parser = new SaxesParser({ xmlns: true, position: true });
  parser.on("doctype", () => errors.push(new Error("DOCTYPE nao e permitido em CSXS/manifest.xml.")));
  parser.on("error", (error) => errors.push(error));
  parser.on("opentag", (tag) => {
    if (depth === 0) {
      if (root) errors.push(new Error("CSXS/manifest.xml contem mais de um elemento raiz."));
      root = tag;
    }
    depth += 1;
  });
  parser.on("closetag", () => {
    depth -= 1;
  });
  parser.on("text", (text) => {
    if (depth === 0 && text.trim()) {
      errors.push(new Error("CSXS/manifest.xml contem texto fora do elemento raiz."));
    }
  });
  try {
    parser.write(String(xmlText)).close();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0 || !root || depth !== 0) {
    throw new Error(
      `CSXS/manifest.xml nao e XML seguro e valido: ${errors[0]?.message || "raiz ausente"}.`,
    );
  }
  if (localNameOf(root) !== "ExtensionManifest" || (root.uri || "") !== "") {
    throw new Error("A raiz de CSXS/manifest.xml precisa ser ExtensionManifest sem namespace.");
  }
  const attributes = Object.values(root.attributes || {});
  const requiredAttribute = (name) => {
    const matches = attributes.filter(
      (attribute) => attribute.local === name && (attribute.uri || "") === "",
    );
    if (matches.length !== 1 || !String(matches[0].value).trim()) {
      throw new Error(`CSXS/manifest.xml precisa de ${name} nao vazio.`);
    }
    return String(matches[0].value).trim();
  };
  const bundleId = requiredAttribute("ExtensionBundleId");
  const bundleVersion = requiredAttribute("ExtensionBundleVersion");
  if (bundleId !== "com.arizona-carrefour.cep") {
    throw new Error(`ExtensionBundleId inesperado em CSXS/manifest.xml: ${bundleId}.`);
  }
  if (bundleVersion.length > 128 || /[\u0000-\u001f\u007f]/.test(bundleVersion)) {
    throw new Error("ExtensionBundleVersion invalida em CSXS/manifest.xml.");
  }
  return { bundleId, bundleVersion };
}

export function assertCepZxpArchiveShape(zipPath, { requireMimetypeFirst = true } = {}) {
  const archive = inspectZxpArchive(zipPath);
  const required = ["META-INF/signatures.xml", "CSXS/manifest.xml", ".debug", "mimetype"];
  for (const name of required) {
    const entry = archive.entries.find((candidate) => candidate.name === name);
    if (!entry || entry.isDirectory || entry.uncompressedSize === 0) {
      throw new Error(`O ZXP precisa conter ${name} como arquivo regular nao vazio.`);
    }
  }
  const mimetypeEntry = archive.entries.find((entry) => entry.name === "mimetype");
  if (mimetypeEntry.method !== 0) throw new Error("A entrada mimetype precisa estar sem compressao.");
  if (
    requireMimetypeFirst &&
    (archive.entries[0] !== mimetypeEntry || mimetypeEntry.localOffset !== 0)
  ) {
    throw new Error("A entrada mimetype precisa ser a primeira do ZXP e ter localOffset 0.");
  }
  const mimetype = readInspectedZipEntry(archive, mimetypeEntry, 256).toString("utf8");
  if (mimetype !== "application/vnd.adobe.air-ucf-package+zip") {
    throw new Error("A entrada mimetype nao identifica um Adobe extension archive.");
  }
  // Faz CRC/DEFLATE de todas as entradas antes de entregar bytes a parsers
  // externos. Assim tamanhos mentirosos nao transformam o CLI em ZIP bomb.
  for (const entry of archive.entries) {
    if (!entry.isDirectory) {
      readInspectedZipEntry(archive, entry, archive.limits.entryBytes);
    }
  }
  const manifestEntry = archive.entries.find((entry) => entry.name === "CSXS/manifest.xml");
  const cepManifest = parseCepManifestXml(
    readInspectedZipEntry(archive, manifestEntry, archive.limits.metadataBytes).toString("utf8"),
  );
  return { ...archive, cepManifest };
}

export function readZipEntry(zipPath, entryName, { maxBytes = cepZipLimits.metadataBytes } = {}) {
  const archive = inspectZxpArchive(zipPath);
  const wanted = normalizeZipEntryName(entryName);
  const entry = archive.entries.find(
    (candidate) => candidate.normalizedName.toLocaleLowerCase("en-US") === wanted.toLocaleLowerCase("en-US"),
  );
  return readInspectedZipEntry(archive, entry, maxBytes);
}

export function normalizeSignatureValueInZxp(zxpPath) {
  // O ZXPSignCmd 4.1.3 escreve mimetype depois dos arquivos da extensao. A
  // regravacao abaixo tambem corrige isso para o perfil UCF: mimetype vira a
  // primeira entrada armazenada, com localOffset 0.
  const inspected = assertCepZxpArchiveShape(zxpPath, { requireMimetypeFirst: false });
  const entryName = "META-INF/signatures.xml";
  const signatureEntry = inspected.entries.find((entry) => entry.name === entryName);
  const signatures = readInspectedZipEntry(inspected, signatureEntry, cepZipLimits.metadataBytes);
  if (!signatures) {
    throw new Error(`${zxpPath} nao contem ${entryName} (nao esta assinado).`);
  }

  const normalized = normalizeSignatureValueInSignatures(Buffer.from(signatures).toString("utf8"));
  const mimetypeEntry = inspected.entries.find((entry) => entry.name === "mimetype");
  const mimetypeNeedsReorder = inspected.entries[0] !== mimetypeEntry || mimetypeEntry.localOffset !== 0;
  if (!normalized.changed && !mimetypeNeedsReorder) {
    return { changed: false, entryCount: inspected.entries.length };
  }

  // Reempacotar nao muda nenhum conteudo coberto pelo Manifest da assinatura.
  // O mimetype continua armazenado (sem DEFLATE), como o ZXPSignCmd o gerou.
  const outputEntries = {};
  const orderedEntries = [
    mimetypeEntry,
    ...inspected.entries.filter((entry) => entry !== mimetypeEntry),
  ];
  for (const entry of orderedEntries) {
    const bytes = entry.isDirectory
      ? new Uint8Array()
      : entry.name === entryName
        ? strToU8(normalized.xml)
        : readInspectedZipEntry(inspected, entry, cepZipLimits.entryBytes);
    const level = entry.name === "mimetype" || entry.isDirectory ? 0 : 6;
    const name = entry.name;
    outputEntries[name] = [bytes, { level }];
  }
  writeFileSync(zxpPath, zipSync(outputEntries));
  return {
    changed: true,
    signatureValueChanged: normalized.changed,
    mimetypeReordered: mimetypeNeedsReorder,
    entryCount: inspected.entries.length,
  };
}

export async function verifyRfc3161TimestampOfZxp(zxpPath, options = {}) {
  const signatures = readZipEntry(zxpPath, "META-INF/signatures.xml");
  if (!signatures) {
    throw new Error(`${zxpPath} nao contem META-INF/signatures.xml (nao esta assinado).`);
  }
  return verifyRfc3161TimestampFromSignatures(signatures.toString("utf8"), options);
}

// Le a fingerprint (P2) direto de um .zxp ja assinado.
export function fingerprintOfZxp(zxpPath) {
  const signatures = readZipEntry(zxpPath, "META-INF/signatures.xml");
  if (!signatures) {
    throw new Error(`${zxpPath} nao contem META-INF/signatures.xml (nao esta assinado).`);
  }

  const der = certificateDerFromSignatures(signatures.toString("utf8"));
  return { fingerprint: fingerprintFromDer(der), der };
}

export function assertTimeWithinCertificateValidity(
  at,
  notBefore,
  notAfter,
  label = "certificado de assinatura CEP",
) {
  const instant = new Date(at);
  const starts = new Date(notBefore);
  const ends = new Date(notAfter);
  if (
    Number.isNaN(instant.getTime()) ||
    Number.isNaN(starts.getTime()) ||
    Number.isNaN(ends.getTime())
  ) {
    throw new Error(`Nao foi possivel validar o periodo de validade do ${label}.`);
  }
  if (instant < starts || instant > ends) {
    throw new Error(
      `O ${label} nao era valido em ${instant.toISOString()} ` +
        `(validade: ${starts.toISOString()} a ${ends.toISOString()}).`,
    );
  }
  return {
    checkedAt: instant.toISOString(),
    notBefore: starts.toISOString(),
    notAfter: ends.toISOString(),
  };
}

export function assertSigningCertificateValidityAt(der, at) {
  const certificate = new X509Certificate(der);
  return assertTimeWithinCertificateValidity(
    at,
    certificate.validFrom,
    certificate.validTo,
  );
}

export function verifyZxpContentSignature(zxpPath) {
  requireTrustedSignerBinary();
  const result = spawnSync(signerPath, ["-verify", resolve(zxpPath)], {
    cwd: signerDir,
    env: signerEnv(),
    encoding: "utf8",
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (result.error) {
    throw new Error(`ZXPSignCmd -verify nao iniciou: ${result.error.message}`);
  }
  if (result.status !== 0 || !output.includes("Signature verified successfully")) {
    throw new Error(
      `ZXPSignCmd -verify rejeitou o pacote (exit ${result.status ?? "?"})${output ? `: ${output}` : "."}`,
    );
  }
  return output;
}

export async function verifyCepZxp(
  zxpPath,
  { trustedCertificates = null, requireTimestamp = true, now = new Date() } = {},
) {
  const resolvedPath = resolve(zxpPath);
  if (!existsSync(resolvedPath)) throw new Error(`ZXP nao encontrado: ${resolvedPath}`);
  const archive = assertCepZxpArchiveShape(resolvedPath);
  const pinned = trustedCertificates || readTrustedCertificates({ throwOnError: true }).certificates;
  if (!Array.isArray(pinned) || pinned.length === 0) {
    throw new Error(`${trustedCertPath} nao lista nenhum certificado confiavel.`);
  }

  const { fingerprint, der } = fingerprintOfZxp(resolvedPath);
  if (!isTrustedFingerprint(fingerprint, pinned)) {
    throw new Error(`O ZXP usa certificado nao confiavel (${fingerprint}).`);
  }
  verifyZxpContentSignature(resolvedPath);
  const timestamp = requireTimestamp
    ? await verifyRfc3161TimestampOfZxp(resolvedPath, { now })
    : null;
  // A timestamp only preserves a signature that was made while the publisher
  // certificate itself was valid. Checking the TSA certificate alone would
  // accept a token issued before/after the Arizona signing identity's window.
  const signingCertificateValidity = assertSigningCertificateValidityAt(
    der,
    timestamp?.genTime || now,
  );
  return {
    path: resolvedPath,
    fingerprint,
    timestamp,
    signingCertificateValidity,
    bundleId: archive.cepManifest.bundleId,
    bundleVersion: archive.cepManifest.bundleVersion,
    adobeVerifierSha256: trustedSignerSha256ByPlatform[process.platform],
  };
}

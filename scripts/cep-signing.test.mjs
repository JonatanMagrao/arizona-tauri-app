import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  assertCepZxpArchiveShape,
  assertTimeWithinCertificateValidity,
  canonicalSignatureValueFromSignatures,
  certificateDerFromSignatures,
  certificateFingerprintFromSignatures,
  inspectZxpArchive,
  normalizeSignatureValueInSignatures,
  normalizeSignatureValueInZxp,
  readZipEntry,
} from "./cep-signing.mjs";

const fixturePath = new URL("./fixtures/cep-signature-cases.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

test("fixture de assinatura CEP tem o schema esperado", () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.ok(fixture.cases.length >= 15);
  assert.equal(new Set(fixture.cases.map((entry) => entry.id)).size, fixture.cases.length);
});

test("validade do certificado inclui os limites e rejeita instantes externos", () => {
  const notBefore = "2026-08-03T00:00:00.000Z";
  const notAfter = "2046-07-29T00:00:00.000Z";
  assert.equal(
    assertTimeWithinCertificateValidity(notBefore, notBefore, notAfter).checkedAt,
    notBefore,
  );
  assert.equal(
    assertTimeWithinCertificateValidity(notAfter, notBefore, notAfter).checkedAt,
    notAfter,
  );
  assert.throws(
    () => assertTimeWithinCertificateValidity("2026-08-02T23:59:59.999Z", notBefore, notAfter),
    /nao era valido/,
  );
  assert.throws(
    () => assertTimeWithinCertificateValidity("2046-07-29T00:00:00.001Z", notBefore, notAfter),
    /nao era valido/,
  );
});

for (const entry of fixture.cases) {
  test(`certificateDerFromSignatures: ${entry.id}`, () => {
    if (!entry.shouldPass) {
      assert.throws(() => certificateDerFromSignatures(entry.xml));
      assert.equal(entry.expectedSha256, null);
      return;
    }

    const der = certificateDerFromSignatures(entry.xml);
    assert.equal(der.toString("base64"), fixture.certificateBase64);
    assert.equal(certificateFingerprintFromSignatures(entry.xml), entry.expectedSha256);
  });
}

const timestampableXml = [
  "<signatures>",
  '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">',
  '<SignatureValue Id="PackageSignatureValue">BQYH\r\nCA==</SignatureValue>',
  "<KeyInfo><X509Data><X509Certificate>AQIDBA==</X509Certificate></X509Data></KeyInfo>",
  "</Signature>",
  "</signatures>",
].join("\r\n");

const expectedCanonicalSignatureValue =
  '<SignatureValue xmlns="http://www.w3.org/2000/09/xmldsig#" Id="PackageSignatureValue">BQYHCA==</SignatureValue>';
const validCepManifest =
  '<ExtensionManifest ExtensionBundleId="com.arizona-carrefour.cep" ExtensionBundleVersion="0.1.0" />';

test("normaliza somente o whitespace interno de SignatureValue e produz C14N estavel", () => {
  const normalized = normalizeSignatureValueInSignatures(timestampableXml);
  assert.equal(normalized.changed, true);
  assert.match(
    normalized.xml,
    /<SignatureValue Id="PackageSignatureValue">BQYHCA==<\/SignatureValue>/,
  );
  assert.equal(normalized.canonical.toString("utf8"), expectedCanonicalSignatureValue);
  assert.equal(
    canonicalSignatureValueFromSignatures(normalized.xml).toString("utf8"),
    expectedCanonicalSignatureValue,
  );

  const secondPass = normalizeSignatureValueInSignatures(normalized.xml);
  assert.equal(secondPass.changed, false);
  assert.equal(secondPass.xml, normalized.xml);
});

test("normaliza SignatureValue no ZXP sem alterar as outras entradas", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "arizona-cep-signing-test-"));
  const zxpPath = join(tempRoot, "fixture.zxp");
  try {
    const original = {
      ".debug": strToU8("debug"),
      "CSXS/": [new Uint8Array(), { level: 0 }],
      "CSXS/manifest.xml": strToU8(validCepManifest),
      "META-INF/": [new Uint8Array(), { level: 0 }],
      "META-INF/signatures.xml": strToU8(timestampableXml),
      "mimetype": [strToU8("application/vnd.adobe.air-ucf-package+zip"), { level: 0 }],
      "payload.txt": strToU8("signed payload"),
    };
    writeFileSync(zxpPath, zipSync(original));
    const before = unzipSync(new Uint8Array(readFileSync(zxpPath)));

    const result = normalizeSignatureValueInZxp(zxpPath);
    assert.equal(result.changed, true);
    assert.equal(result.entryCount, Object.keys(before).length);

    const after = unzipSync(new Uint8Array(readFileSync(zxpPath)));
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
    assert.equal(Object.keys(after)[0], "mimetype");
    for (const name of Object.keys(before)) {
      if (name === "META-INF/signatures.xml") continue;
      assert.deepEqual(after[name], before[name], `entrada alterada: ${name}`);
    }
    const normalizedXml = Buffer.from(after["META-INF/signatures.xml"]).toString("utf8");
    assert.equal(normalizeSignatureValueInSignatures(normalizedXml).changed, false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("reordena mimetype mesmo quando SignatureValue ja esta compacto", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "arizona-cep-mimetype-order-test-"));
  const zxpPath = join(tempRoot, "mimetype-order.zxp");
  try {
    const compactXml = normalizeSignatureValueInSignatures(timestampableXml).xml;
    writeFileSync(zxpPath, zipSync({
      ".debug": strToU8("debug"),
      "CSXS/manifest.xml": strToU8(validCepManifest),
      "META-INF/signatures.xml": strToU8(compactXml),
      mimetype: [strToU8("application/vnd.adobe.air-ucf-package+zip"), { level: 0 }],
    }));

    const firstPass = normalizeSignatureValueInZxp(zxpPath);
    assert.equal(firstPass.changed, true);
    assert.equal(firstPass.signatureValueChanged, false);
    assert.equal(firstPass.mimetypeReordered, true);
    const archive = inspectZxpArchive(zxpPath);
    assert.equal(archive.entries[0].name, "mimetype");
    assert.equal(archive.entries[0].localOffset, 0);

    const secondPass = normalizeSignatureValueInZxp(zxpPath);
    assert.equal(secondPass.changed, false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("leitor ZIP rejeita duplicatas normalizadas, traversal e limites", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "arizona-cep-zip-safety-test-"));
  try {
    const duplicatePath = join(tempRoot, "duplicate.zxp");
    writeFileSync(duplicatePath, zipSync({
      "META-INF/signatures.xml": strToU8("one"),
      "meta-inf/SIGNATURES.XML": strToU8("two"),
    }));
    assert.throws(
      () => inspectZxpArchive(duplicatePath),
      /duplicada apos normalizacao/,
    );

    const traversalPath = join(tempRoot, "traversal.zxp");
    writeFileSync(traversalPath, zipSync({ "../escape.txt": strToU8("escape") }));
    assert.throws(() => inspectZxpArchive(traversalPath), /parent traversal/);

    const limitsPath = join(tempRoot, "limits.zxp");
    writeFileSync(limitsPath, zipSync({
      "one.txt": strToU8("12345"),
      "two.txt": strToU8("67890"),
    }));
    assert.throws(() => inspectZxpArchive(limitsPath, { entries: 1 }), /Quantidade de entradas/);
    assert.throws(() => inspectZxpArchive(limitsPath, { entryBytes: 4 }), /Entrada ZIP excede/);
    assert.throws(
      () => inspectZxpArchive(limitsPath, { expandedBytes: 8 }),
      /Conteudo expandido/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("leitor ZIP valida shape CEP, CRC e arquivos regulares obrigatorios", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "arizona-cep-zip-shape-test-"));
    const zxpPath = join(tempRoot, "shape.zxp");
  try {
    writeFileSync(zxpPath, zipSync({
      mimetype: [strToU8("application/vnd.adobe.air-ucf-package+zip"), { level: 0 }],
      ".debug": strToU8("debug"),
      "CSXS/manifest.xml": strToU8(validCepManifest),
      "META-INF/signatures.xml": strToU8("<signatures />"),
    }));
    const archive = assertCepZxpArchiveShape(zxpPath);
    assert.deepEqual(archive.cepManifest, {
      bundleId: "com.arizona-carrefour.cep",
      bundleVersion: "0.1.0",
    });
    const debugEntry = archive.entries.find((entry) => entry.name === ".debug");
    assert.ok(debugEntry);
    assert.equal(readZipEntry(zxpPath, ".debug").toString("utf8"), "debug");

    const tampered = Buffer.from(readFileSync(zxpPath));
    tampered[debugEntry.dataStart] ^= 0x01;
    writeFileSync(zxpPath, tampered);
    assert.throws(() => readZipEntry(zxpPath, ".debug"), /CRC-32 invalido|Falha ao expandir/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

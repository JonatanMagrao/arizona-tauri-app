// Utilitarios compartilhados pelos keygens de licenca e do bridge AEX.
//
// Regras de seguranca (ver LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md):
// - Nunca sobrescrever uma chave privada existente sem --force.
// - Com --force, o arquivo de env anterior e salvo em backup datado antes
//   de qualquer escrita, para a chave antiga nunca se perder.
// - O kid e derivado da chave publica (unico por chave), nunca um valor
//   fixo que colide entre geracoes.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function hasFlag(name) {
  return process.argv.includes(name);
}

export function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : fallback;
}

export function kidFromPublicKey(publicKey) {
  const spki = publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(spki).digest("hex").slice(0, 16);
}

export function readEnvValue(envPath, name) {
  if (!existsSync(envPath)) return "";
  const line = readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : "";
}

// Bloqueia sobrescrita acidental de chave privada. Retorna sem erro quando
// nao ha chave anterior; com chave anterior + --force, faz backup datado.
export function guardPrivateKeyOverwrite(envPath, privateKeyEnvName, force) {
  const existing = readEnvValue(envPath, privateKeyEnvName);
  if (!existing) return;

  if (!force) {
    console.error(`ERRO: ${envPath} ja contem ${privateKeyEnvName}.`);
    console.error("Gerar uma chave nova sem rotacao planejada BLOQUEIA todos os usuarios validos.");
    console.error("Leia LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md. Se a rotacao for intencional, rode novamente com --force.");
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${envPath}.bak.${stamp}`;
  copyFileSync(envPath, backupPath);
  console.log(`Backup do env anterior salvo em: ${backupPath}`);
  console.log("Guarde esse backup: e a unica copia da chave privada antiga.");
}

export function upsertEnvFile(path, values) {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  const pending = new Map(Object.entries(values));
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !pending.has(match[1])) return line;

    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return `${match[1]}=${value}`;
  });

  for (const [name, value] of pending) {
    nextLines.push(`${name}=${value}`);
  }

  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
    nextLines.pop();
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${nextLines.join("\n")}\n`, "utf8");
}

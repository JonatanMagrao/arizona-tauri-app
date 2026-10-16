import { decodeMechanicsSchemaUtf8, parseMechanicsSchemaJson } from "./schemaJson";
import type { MechanicsSchema } from "./schemaValidation";
import { withTemplateIdentities } from "../../template/templateIdentities";

let configuredPath = "";
let scopeDepth = 0;
let scopedSchema: MechanicsSchema | null = null;
let scopeFailed = false;
let scopedFailure: unknown = null;
// Only parsed JSON lives across operations. Consumers treat it as read-only;
// native AE objects and operation results must never be stored here.
let cachedBinary: string | null = null;
let cachedSchema: MechanicsSchema | null = null;

const clearCache = (): void => {
  cachedBinary = null;
  cachedSchema = null;
};

const clearScope = (): void => {
  scopedSchema = null;
  scopeFailed = false;
  scopedFailure = null;
};

export const configureMechanicsSchemaPath = (path: string): void => {
  if (scopeDepth > 0) {
    throw new Error("Não é possível mudar o caminho do schema durante uma operação.");
  }
  configuredPath = "";
  clearScope();
  clearCache();
  if (typeof path !== "string") throw new Error("O caminho do schema de mecânicas deve ser um texto.");
  if (path.replace(/^\s+|\s+$/g, "") === "") return;
  const first = path.charAt(0);
  const second = path.charAt(1);
  const third = path.charAt(2);
  const driveLetter = (first >= "A" && first <= "Z") || (first >= "a" && first <= "z");
  const drivePath = driveLetter && second === ":" && (third === "/" || third === "\\");
  const uncPath = first === "\\" && second === "\\";
  if (!drivePath && !uncPath && first !== "/") {
    throw new Error("O caminho do schema de mecânicas deve ser absoluto.");
  }
  configuredPath = path;
};

const readBinaryFile = (path: string): string => {
  const file = new File(path);
  if (!file.exists) throw new Error("Arquivo schema.json não encontrado.");
  let opened = false;
  let readCompleted = false;
  try {
    file.error = "";
    if (!file.open("r")) throw new Error("Não foi possível abrir schema.json: " + file.error);
    opened = true;
    // File.open may auto-detect a BOM and advance the cursor. Reset both after
    // opening, so the strict decoder receives every original byte.
    file.encoding = "BINARY";
    if (!file.seek(0)) throw new Error("Não foi possível iniciar a leitura de schema.json: " + file.error);
    const expectedLength = file.length;
    const binary = file.read();
    if (file.error !== "") throw new Error("Erro ao ler schema.json: " + file.error);
    if (typeof binary !== "string" || binary.length !== expectedLength) {
      throw new Error("Leitura incompleta de schema.json. O arquivo pode ter mudado durante a leitura.");
    }
    readCompleted = true;
    return binary;
  } finally {
    if (opened) {
      try {
        if (!file.close() && readCompleted) throw new Error("Não foi possível fechar schema.json após a leitura.");
      } catch (error) {
        // Preserve a previous read failure, while still trying to close the file.
        if (readCompleted) throw error;
      }
    }
  }
};

const loadSchema = (): MechanicsSchema => {
  if (configuredPath === "") {
    throw new Error("Caminho do schema de mecânicas não configurado. Recarregue a extensão.");
  }
  try {
    // Read and close the complete file before consulting the cache. File dates
    // and sizes alone cannot detect every edit (including same-size edits).
    const binary = readBinaryFile(configuredPath);
    if (cachedSchema !== null && cachedBinary === binary) return cachedSchema;
    const schema = parseMechanicsSchemaJson(decodeMechanicsSchemaUtf8(binary));
    cachedBinary = binary;
    cachedSchema = schema;
    return schema;
  } catch (error) {
    clearCache();
    throw new Error("Configuração das mecânicas inválida em " + configuredPath + ": " + String(error));
  }
};

export const getMechanicsSchema = (): MechanicsSchema => {
  if (scopeDepth === 0) return loadSchema();
  if (scopeFailed) throw scopedFailure;
  if (scopedSchema !== null) return scopedSchema;
  try {
    scopedSchema = loadSchema();
    return scopedSchema;
  } catch (error) {
    scopeFailed = true;
    scopedFailure = error;
    throw error;
  }
};

// Scope the read lazily: operations that never access a mechanic do not depend
// on this file. The first access pins a validated result (or failure) until the
// outer operation finishes. The next operation always reads the file again,
// reusing parsing/validation only if all bytes still match the valid cache.
export const withMechanicsSchema = <T>(callback: () => T): T => withTemplateIdentities(() => {
  const outermost = scopeDepth === 0;
  if (outermost) clearScope();
  scopeDepth += 1;
  try {
    return callback();
  } finally {
    scopeDepth -= 1;
    if (outermost) clearScope();
  }
});

import { decodeMechanicsSchemaUtf8, readStrictSchemaJson } from "../ofertas/mechanics/schemaJson";
import { validateTemplateIdentities, type TemplateIdentities } from "./templateIdentitiesValidation";
export { normalizeTemplateIdentity, expandTemplatePattern, expandTemplateIdentity, matchTemplatePattern } from "./templateIdentityPatterns";
export type { TemplateIdentity } from "./templateIdentityPatterns";
export type { TemplateIdentities, OfferLayerIdentity, MechanicTemplateIdentity } from "./templateIdentitiesValidation";

let configuredPath = "";
let depth = 0;
let pinned: TemplateIdentities | null = null;
let failed = false;
let failure: unknown = null;

const clear = (): void => { pinned = null; failed = false; failure = null; };

export const configureTemplateIdentitiesPath = (path: string): void => {
  if (depth > 0) throw new Error("Nao e possivel mudar o mapa de identidades durante uma operacao.");
  configuredPath = "";
  clear();
  if (typeof path !== "string") throw new Error("O caminho do mapa de identidades deve ser um texto.");
  if (path.replace(/^\s+|\s+$/g, "") === "") return;
  // ExtendScript's regex lexer does not reliably accept a slash inside a
  // backslash character class. Keep the same explicit path check as the schema.
  const first = path.charAt(0);
  const second = path.charAt(1);
  const third = path.charAt(2);
  const driveLetter = (first >= "A" && first <= "Z") || (first >= "a" && first <= "z");
  const drivePath = driveLetter && second === ":" && (third === "/" || third === "\\");
  const uncPath = first === "\\" && second === "\\";
  if (!drivePath && !uncPath && first !== "/") throw new Error("O caminho do mapa de identidades deve ser absoluto.");
  configuredPath = path;
};

export const parseTemplateIdentitiesJson = (text: string): TemplateIdentities => {
  if (typeof text !== "string") throw new Error("JSON de identidades deve ser um texto.");
  const source = text.charCodeAt(0) === 0xfeff ? text.substring(1) : text;
  return validateTemplateIdentities(readStrictSchemaJson(source, "identidades"));
};
export const decodeTemplateIdentitiesUtf8 = (binary: string): string => decodeMechanicsSchemaUtf8(binary, "mapa de identidades");

const readBinaryFile = (path: string): string => {
  const file = new File(path);
  if (!file.exists) throw new Error("Arquivo template-identities.json nao encontrado.");
  let opened = false;
  let complete = false;
  try {
    file.error = "";
    if (!file.open("r")) throw new Error("Nao foi possivel abrir template-identities.json: " + file.error);
    opened = true;
    file.encoding = "BINARY";
    if (!file.seek(0)) throw new Error("Nao foi possivel iniciar a leitura de template-identities.json: " + file.error);
    const length = file.length;
    const bytes = file.read();
    if (file.error !== "") throw new Error("Erro ao ler template-identities.json: " + file.error);
    if (typeof bytes !== "string" || bytes.length !== length) throw new Error("Leitura incompleta de template-identities.json.");
    complete = true;
    return bytes;
  } finally {
    if (opened) {
      try {
        if (!file.close() && complete) throw new Error("Nao foi possivel fechar template-identities.json.");
      } catch (error) { if (complete) throw error; }
    }
  }
};

const load = (): TemplateIdentities => {
  if (configuredPath === "") throw new Error("Caminho de template-identities.json nao configurado. Recarregue a extensao.");
  try {
    return parseTemplateIdentitiesJson(decodeTemplateIdentitiesUtf8(readBinaryFile(configuredPath)));
  } catch (error) {
    throw new Error("Mapa de identidades invalido em " + configuredPath + ": " + String(error));
  }
};

export const getTemplateIdentities = (): TemplateIdentities => {
  if (depth === 0) return load();
  if (failed) throw failure;
  if (pinned !== null) return pinned;
  try { pinned = load(); return pinned; }
  catch (error) { failed = true; failure = error; throw error; }
};

// Pin one validated map (including failures) for each complete operation.
// The next operation reads again, so editing the source asset needs no rebuild.
export const withTemplateIdentities = <T>(callback: () => T): T => {
  const outermost = depth === 0;
  if (outermost) clear();
  depth += 1;
  try { return callback(); }
  finally { depth -= 1; if (outermost) clear(); }
};

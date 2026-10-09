import { type MechanicsSchema, validateMechanicsSchema } from "./schemaValidation";

// Shared by the CLI and ExtendScript. Parse strict JSON here rather than using
// JSON2's eval-based parser, so duplicate decoded keys and trailing commas fail.
function readStrictSchemaJson(source: string): unknown {
  let position = 0;


  function fail(reason: string): never {
    throw new Error(
      "JSON de mecânicas inválido no caractere " + (position + 1) + ": " + reason
    );
  }

  function skipWhitespace(): void {
    while (position < source.length) {
      const code = source.charCodeAt(position);
      if (code !== 32 && code !== 9 && code !== 10 && code !== 13) return;
      position += 1;
    }
  }

  function isDigit(character: string): boolean {
    return character >= "0" && character <= "9" && character !== "";
  }

  function readString(): string {
    if (source.charAt(position) !== '"') return fail("esperado um texto entre aspas.");
    position += 1;
    const result: string[] = [];

    while (position < source.length) {
      const character = source.charAt(position);
      position += 1;
      if (character === '"') return result.join("");
      if (character !== "\\") {
        if (character.charCodeAt(0) < 32) fail("caractere de controle sem escape em um texto.");
        result.push(character);
        continue;
      }

      const escape = source.charAt(position);
      position += 1;
      if (escape === '"' || escape === "\\" || escape === "/") result.push(escape);
      else if (escape === "b") result.push("\b");
      else if (escape === "f") result.push("\f");
      else if (escape === "n") result.push("\n");
      else if (escape === "r") result.push("\r");
      else if (escape === "t") result.push("\t");
      else if (escape === "u") {
        let value = 0;
        for (let index = 0; index < 4; index += 1) {
          const hex = source.charAt(position);
          position += 1;
          let digit = -1;
          if (hex >= "0" && hex <= "9" && hex !== "") digit = hex.charCodeAt(0) - 48;
          else if (hex >= "a" && hex <= "f") digit = hex.charCodeAt(0) - 87;
          else if (hex >= "A" && hex <= "F") digit = hex.charCodeAt(0) - 55;
          if (digit < 0) fail("escape Unicode inválido.");
          value = value * 16 + digit;
        }
        result.push(String.fromCharCode(value));
      } else fail("escape inválido em um texto.");
    }

    return fail("texto sem aspas de fechamento.");
  }

  function readNumber(): number {
    const start = position;
    if (source.charAt(position) === "-") position += 1;
    const first = source.charAt(position);
    if (first === "0") position += 1;
    else if (first >= "1" && first <= "9") {
      while (isDigit(source.charAt(position))) position += 1;
    } else fail("número inválido.");

    if (source.charAt(position) === ".") {
      position += 1;
      if (!isDigit(source.charAt(position))) fail("fração inválida.");
      while (isDigit(source.charAt(position))) position += 1;
    }

    const exponent = source.charAt(position);
    if (exponent === "e" || exponent === "E") {
      position += 1;
      const sign = source.charAt(position);
      if (sign === "+" || sign === "-") position += 1;
      if (!isDigit(source.charAt(position))) fail("expoente inválido.");
      while (isDigit(source.charAt(position))) position += 1;
    }

    return Number(source.substring(start, position));
  }

  function readObject(depth: number): { [key: string]: unknown } {
    const result: { [key: string]: unknown } = {};
    const keys: { [key: string]: boolean } = {};
    position += 1;
    skipWhitespace();
    if (source.charAt(position) === "}") {
      position += 1;
      return result;
    }

    while (position < source.length) {
      const key = readString();
      const identity = "$" + key;
      if (Object.prototype.hasOwnProperty.call(keys, identity)) {
        fail('chave duplicada "' + key + '".');
      }
      keys[identity] = true;
      // No schema contract accepts this key. Reject it before assigning to a
      // plain object, where some JS engines treat it as a prototype setter.
      if (key === "__proto__") fail('atributo inesperado "__proto__".');
      skipWhitespace();
      if (source.charAt(position) !== ":") fail("esperado ':' depois do atributo.");
      position += 1;
      result[key] = readValue(depth + 1);
      skipWhitespace();
      const delimiter = source.charAt(position);
      position += 1;
      if (delimiter === "}") return result;
      if (delimiter !== ",") fail("esperado ',' ou '}' depois do valor.");
      skipWhitespace();
      // readString rejects trailing commas and unquoted property names.
    }

    return fail("objeto sem fechamento.");
  }

  function readArray(depth: number): unknown[] {
    const result: unknown[] = [];
    position += 1;
    skipWhitespace();
    if (source.charAt(position) === "]") {
      position += 1;
      return result;
    }

    while (position < source.length) {
      result.push(readValue(depth + 1));
      skipWhitespace();
      const delimiter = source.charAt(position);
      position += 1;
      if (delimiter === "]") return result;
      if (delimiter !== ",") fail("esperado ',' ou ']' depois do valor.");
      skipWhitespace();
    }

    return fail("lista sem fechamento.");
  }

  function readValue(depth: number): unknown {
    if (depth > 100) return fail("estrutura excessivamente profunda.");
    skipWhitespace();
    const first = source.charAt(position);
    if (first === '"') return readString();
    if (first === "{") return readObject(depth);
    if (first === "[") return readArray(depth);
    if (first === "-" || isDigit(first)) return readNumber();
    if (source.substring(position, position + 4) === "true") {
      position += 4;
      return true;
    }
    if (source.substring(position, position + 5) === "false") {
      position += 5;
      return false;
    }
    if (source.substring(position, position + 4) === "null") {
      position += 4;
      return null;
    }
    return fail("valor JSON inválido.");
  }

  function read(): unknown {
    const result = readValue(0);
    skipWhitespace();
    if (position !== source.length) fail("conteúdo depois do valor JSON.");
    return result;
  }
  return read();
}

export const parseMechanicsSchemaJson = (text: string): MechanicsSchema => {
  if (typeof text !== "string") throw new Error("JSON de mecânicas deve ser um texto.");
  // A UTF-8 BOM is accepted only at the start, matching the build decoder.
  const source = text.charCodeAt(0) === 0xfeff ? text.substring(1) : text;
  return validateMechanicsSchema(readStrictSchemaJson(source));
};

export const decodeMechanicsSchemaUtf8 = (binary: string): string => {
  if (typeof binary !== "string") throw new Error("A leitura do schema não retornou bytes UTF-8.");
  const result: string[] = [];
  let position = 0;
  const fail = (offset: number): never => {
    throw new Error("UTF-8 inválido no byte " + (offset + 1) + " do schema de mecânicas.");
  };

  while (position < binary.length) {
    const start = position;
    const first = binary.charCodeAt(position);
    position += 1;
    if (first <= 0x7f) {
      result.push(String.fromCharCode(first));
      continue;
    }

    let code = 0;
    let continuationCount = 0;
    let minimum = 0;
    if (first >= 0xc2 && first <= 0xdf) {
      code = first & 0x1f;
      continuationCount = 1;
      minimum = 0x80;
    } else if (first >= 0xe0 && first <= 0xef) {
      code = first & 0x0f;
      continuationCount = 2;
      minimum = 0x800;
    } else if (first >= 0xf0 && first <= 0xf4) {
      code = first & 0x07;
      continuationCount = 3;
      minimum = 0x10000;
    } else fail(start);

    for (let index = 0; index < continuationCount; index += 1) {
      if (position >= binary.length) fail(position);
      const next = binary.charCodeAt(position);
      if (next < 0x80 || next > 0xbf) fail(position);
      code = code * 64 + (next & 0x3f);
      position += 1;
    }
    if (code < minimum || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) fail(start);
    if (code <= 0xffff) result.push(String.fromCharCode(code));
    else {
      const scalar = code - 0x10000;
      result.push(
        String.fromCharCode(0xd800 + Math.floor(scalar / 1024)) +
        String.fromCharCode(0xdc00 + scalar % 1024)
      );
    }
  }

  // Preserve the decoded BOM here. The strict JSON parser consumes at most one
  // initial BOM, so a second one cannot disappear across the two stages.
  return result.join("");
};

import { fs, zlib } from "../../../../lib/cep/node";

const EOCD_SIG = 0x06054b50;
const CENTRAL_DIR_SIG = 0x02014b50;
const DEFLATED = 8;
const STORED = 0;

const findEocdOffset = (buf: Buffer): number => {
  const minOffset = Math.max(0, buf.length - 65558);
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
};

const extractZipEntry = (buf: Buffer, targetName: string): Buffer | null => {
  const eocd = findEocdOffset(buf);
  if (eocd === -1) return null;

  const numEntries = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < numEntries; i++) {
    if (buf.readUInt32LE(pos) !== CENTRAL_DIR_SIG) break;

    const compression = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const localOffset = buf.readUInt32LE(pos + 42);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const name = buf.slice(pos + 46, pos + 46 + nameLen).toString("utf8");

    if (name === targetName) {
      const localNameLen = buf.readUInt16LE(localOffset + 26);
      const localExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const compressed = buf.slice(dataStart, dataStart + compressedSize);

      if (compression === STORED) return compressed;
      if (compression === DEFLATED) return zlib.inflateRawSync(compressed) as Buffer;
      return null;
    }

    pos += 46 + nameLen + extraLen + commentLen;
  }

  return null;
};

const XML_ENTITIES: { [key: string]: string } = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const decodeEntities = (text: string): string =>
  text.replace(/&([a-z]+);/gi, (match, name: string) => {
    const decoded = XML_ENTITIES[name.toLowerCase()];
    return decoded !== undefined ? decoded : match;
  });

const extractTextFromXml = (xml: string): string => {
  const paragraphs: string[] = [];
  let pos = 0;
  let paraText = "";

  while (pos < xml.length) {
    const tagStart = xml.indexOf("<", pos);
    if (tagStart === -1) break;

    const tagEnd = xml.indexOf(">", tagStart);
    if (tagEnd === -1) break;

    const raw = xml.slice(tagStart + 1, tagEnd);
    const firstToken = raw.startsWith("/")
      ? "/" + raw.slice(1).split(/[\s/]/)[0]
      : raw.split(/[\s/]/)[0];

    if (firstToken === "w:t") {
      const closeIdx = xml.indexOf("</w:t>", tagEnd + 1);
      if (closeIdx !== -1) {
        paraText += decodeEntities(xml.slice(tagEnd + 1, closeIdx));
        pos = closeIdx + 6;
        continue;
      }
    } else if (firstToken === "/w:p") {
      paragraphs.push(paraText);
      paraText = "";
    } else if (firstToken === "w:br" || firstToken === "w:br/") {
      paraText += "\n";
    } else if (firstToken === "w:tab") {
      paraText += "\t";
    }

    pos = tagEnd + 1;
  }

  if (paraText) paragraphs.push(paraText);

  return paragraphs.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

export const readDocxText = (filePath: string): string => {
  const buf = fs.readFileSync(filePath) as unknown as Buffer;
  const xmlBuf = extractZipEntry(buf, "word/document.xml");

  if (!xmlBuf) {
    throw new Error("Nao foi possivel ler o conteudo do documento.");
  }

  return extractTextFromXml(xmlBuf.toString("utf8"));
};

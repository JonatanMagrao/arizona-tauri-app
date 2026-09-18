import { fs, path } from "../../../../lib/cep/node";
import { readDocxText } from "../utils/docxReader";

const MAX_CACHED_TEXT_LENGTH = 2_000_000;

type DocumentFingerprint = {
  filePath: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};

type CachedDocument = {
  fingerprint: DocumentFingerprint;
  content: string;
};

export type RoteiroDocumentCache = {
  read: (filePath: string, forceRead?: boolean) => {
    content: string;
    cacheHit: boolean;
  };
  clear: () => void;
};

const getFingerprint = (filePath: string): DocumentFingerprint | null => {
  const stat = fs.statSync(filePath);
  const values = [stat.size, stat.mtimeMs, stat.ctimeMs];
  if (
    !stat.isFile() ||
    values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)
  ) {
    return null;
  }
  return { filePath, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
};

const fingerprintsMatch = (
  first: DocumentFingerprint,
  second: DocumentFingerprint
): boolean =>
  first.filePath === second.filePath &&
  first.size === second.size &&
  first.mtimeMs === second.mtimeMs &&
  first.ctimeMs === second.ctimeMs;

// The owner scopes this instance to one opened project. Only extracted text is retained.
export const createRoteiroDocumentCache = (): RoteiroDocumentCache => {
  let cached: CachedDocument | null = null;

  return {
    clear: () => {
      cached = null;
    },
    read: (filePath, forceRead = false) => {
      const previous = cached;
      // Failed metadata checks and reads must never leave an older entry available.
      cached = null;
      if (typeof fs.statSync !== "function" || typeof path.resolve !== "function") {
        throw new Error("Leitura do roteiro indisponivel fora do After Effects.");
      }

      const resolvedPath = path.resolve(filePath);
      const before = getFingerprint(resolvedPath);
      if (!forceRead && before && previous && fingerprintsMatch(before, previous.fingerprint)) {
        cached = previous;
        return { content: previous.content, cacheHit: true };
      }

      const content = readDocxText(resolvedPath);
      const after = getFingerprint(resolvedPath);
      if (
        before &&
        after &&
        fingerprintsMatch(before, after) &&
        content.length <= MAX_CACHED_TEXT_LENGTH
      ) {
        cached = { fingerprint: after, content };
      }
      return { content, cacheHit: false };
    },
  };
};

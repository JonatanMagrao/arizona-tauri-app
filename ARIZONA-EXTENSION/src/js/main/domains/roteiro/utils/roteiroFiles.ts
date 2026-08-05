import { fs, path as nodePath } from "../../../../lib/cep/node";
import type { RoteiroFile } from "../types";
import { getRoteiroMatchTokenKey } from "./regionMatching";

const DOCX_EXTENSION = ".docx";

export const isNodeAvailable = () =>
  typeof window.cep !== "undefined" && typeof fs.readdirSync === "function";

const parseNameTokens = (name: string): string[] =>
  nodePath
    .basename(name, nodePath.extname(name))
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);

export const parseRegions = (fileName: string): string[] =>
  parseNameTokens(fileName);

export const parseProjectTokens = (projectName: string): string[] =>
  parseNameTokens(projectName);

const isFileMatchingProject = (
  fileRegions: string[],
  projectTokens: string[]
): boolean => {
  const projectTokenSet = new Set(projectTokens.map(getRoteiroMatchTokenKey));
  return fileRegions.some((region) =>
    projectTokenSet.has(getRoteiroMatchTokenKey(region))
  );
};

const buildRoteiroFile = (
  name: string,
  fullPath: string,
  projectTokens: string[]
): RoteiroFile => {
  const regions = parseRegions(name);

  return {
    name,
    fullPath,
    regions,
    matched: isFileMatchingProject(regions, projectTokens),
  };
};

export const getRoteiroFile = (
  fullPath: string,
  projectName: string
): RoteiroFile | null => {
  try {
    if (
      nodePath.extname(fullPath).toLowerCase() !== DOCX_EXTENSION ||
      !fs.statSync(fullPath).isFile()
    ) {
      return null;
    }

    return buildRoteiroFile(
      nodePath.basename(fullPath),
      fullPath,
      parseProjectTokens(projectName)
    );
  } catch {
    return null;
  }
};

export const scanRoteiroDirectory = (
  directory: string,
  projectName: string
): RoteiroFile[] => {
  const projectTokens = parseProjectTokens(projectName);

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        nodePath.extname(entry.name).toLowerCase() === DOCX_EXTENSION
    )
    .map((entry) => {
      const fullPath = nodePath.join(directory, entry.name);
      return buildRoteiroFile(entry.name, fullPath, projectTokens);
    })
    .sort((a, b) => {
      if (a.matched && !b.matched) return -1;
      if (!a.matched && b.matched) return 1;
      return a.name.localeCompare(b.name, "pt-BR");
    });
};

import { fs, path as nodePath } from "../../../../lib/cep/node";
import type { RoteiroFile } from "../types";

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
  const projectTokenSet = new Set(projectTokens);
  return fileRegions.some((region) => projectTokenSet.has(region));
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
      const regions = parseRegions(entry.name);
      const matched = isFileMatchingProject(regions, projectTokens);
      return { name: entry.name, fullPath, regions, matched };
    })
    .sort((a, b) => {
      if (a.matched && !b.matched) return -1;
      if (!a.matched && b.matched) return 1;
      return a.name.localeCompare(b.name, "pt-BR");
    });
};

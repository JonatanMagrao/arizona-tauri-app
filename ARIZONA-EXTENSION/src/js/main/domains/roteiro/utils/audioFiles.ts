import { fs, path as nodePath } from "../../../../lib/cep/node";
import { parseProjectTokens, parseRegions } from "./roteiroFiles";
import { getRoteiroMatchTokenKey } from "./regionMatching";

export interface AudioFile {
  name: string;
  fullPath: string;
  matched: boolean;
}

interface ScoredAudioFile extends AudioFile {
  matchOrder: number;
  matchScore: number;
}

const hasLetter = (token: string): boolean => /[A-Z]/.test(token);

const normalizeMatchTokens = (tokens: string[]): string[] =>
  tokens.map((token) => token.toUpperCase()).filter(hasLetter);

const getTokenOrder = (tokens: string[]): Map<string, number> => {
  const order = new Map<string, number>();
  tokens.forEach((token, index) => {
    const matchKey = getRoteiroMatchTokenKey(token);
    if (!order.has(matchKey)) order.set(matchKey, index);
  });
  return order;
};

const getAudioMatchInfo = (
  audioTokens: string[],
  primaryTokens: string[],
  secondaryTokens: string[]
): { matchOrder: number; matchScore: number } => {
  const primaryOrder = getTokenOrder(primaryTokens);
  const secondaryOrder = getTokenOrder(secondaryTokens);

  for (const token of audioTokens) {
    const order = primaryOrder.get(getRoteiroMatchTokenKey(token));
    if (order !== undefined) {
      return { matchOrder: order, matchScore: 2 };
    }
  }

  for (const token of audioTokens) {
    const order = secondaryOrder.get(getRoteiroMatchTokenKey(token));
    if (order !== undefined) {
      return { matchOrder: order, matchScore: 1 };
    }
  }

  return { matchOrder: Number.MAX_SAFE_INTEGER, matchScore: 0 };
};

export const scanAudioDirectory = (
  directory: string,
  projectName: string,
  matchTokens: string[] = []
): AudioFile[] => {
  const projectTokens = normalizeMatchTokens(parseProjectTokens(projectName));
  const roteiroTokens = normalizeMatchTokens(matchTokens);
  const projectTokenSet = new Set(projectTokens.map(getRoteiroMatchTokenKey));
  const exactRoteiroTokens = roteiroTokens.filter((token) =>
    projectTokenSet.has(getRoteiroMatchTokenKey(token))
  );
  const primaryTokens =
    exactRoteiroTokens.length > 0
      ? exactRoteiroTokens
      : roteiroTokens.length > 0
        ? roteiroTokens
        : projectTokens;
  const secondaryTokens =
    exactRoteiroTokens.length > 0
      ? roteiroTokens.filter(
          (token) => !projectTokenSet.has(getRoteiroMatchTokenKey(token))
        )
      : [];

  return (fs.readdirSync(directory, { withFileTypes: true }) as unknown as Array<{ name: string; isFile(): boolean }>)
    .filter(
      (entry) =>
        entry.isFile() &&
        nodePath.extname(entry.name).toLowerCase() === ".wav"
    )
    .map((entry) => {
      const fullPath = nodePath.join(directory, entry.name);
      const tokens = normalizeMatchTokens(parseRegions(entry.name));
      const { matchOrder, matchScore } = getAudioMatchInfo(
        tokens,
        primaryTokens,
        secondaryTokens
      );
      return {
        name: entry.name,
        fullPath,
        matched: matchScore > 0,
        matchOrder,
        matchScore,
      };
    })
    .sort((a, b) => {
      if (a.matchScore !== b.matchScore) return b.matchScore - a.matchScore;
      if (a.matchOrder !== b.matchOrder) return a.matchOrder - b.matchOrder;
      if (a.matched && !b.matched) return -1;
      if (!a.matched && b.matched) return 1;
      return a.name.localeCompare(b.name, "pt-BR");
    })
    .map(({ matchOrder, matchScore, ...file }: ScoredAudioFile) => file);
};

export const getRoteiroMatchTokenKey = (token: string): string => {
  const normalized = token.toUpperCase();
  return normalized === "SP2" ? "SP" : normalized;
};

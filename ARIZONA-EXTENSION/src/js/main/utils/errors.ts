export const getMessage = (caught: unknown) => {
  if (caught instanceof Error) return caught.message;
  if (typeof caught === "string") return caught;
  if (
    caught &&
    typeof caught === "object" &&
    "message" in caught &&
    typeof caught.message === "string"
  ) {
    return caught.message;
  }

  return "Erro inesperado.";
};

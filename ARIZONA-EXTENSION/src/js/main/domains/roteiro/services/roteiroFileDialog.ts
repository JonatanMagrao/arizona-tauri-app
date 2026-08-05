interface OpenDialogResult {
  data?: string[];
  err: number;
}

export type RoteiroFileDialogResult =
  | { status: "selected"; filePath: string }
  | { status: "cancelled" }
  | { status: "error" };

const decodeDialogPath = (value: string): string => {
  const withoutScheme = value.replace(/^file:\/\//i, "");
  const platformPath = /^\/[A-Za-z]:[\\/]/.test(withoutScheme)
    ? withoutScheme.slice(1)
    : withoutScheme;

  try {
    return decodeURIComponent(platformPath);
  } catch {
    return platformPath;
  }
};

export const chooseRoteiroFile = (
  roteiroDirectory: string
): RoteiroFileDialogResult => {
  const dialog =
    window.cep?.fs?.showOpenDialogEx || window.cep?.fs?.showOpenDialog;

  if (!dialog) {
    return { status: "error" };
  }

  let result: OpenDialogResult;
  try {
    result = dialog(
      false,
      false,
      "Escolha o arquivo do roteiro",
      roteiroDirectory,
      ["docx"],
      "Documentos do Word (*.docx)",
      "Abrir"
    ) as OpenDialogResult;
  } catch {
    return { status: "error" };
  }

  if (!result || typeof result.err !== "number") {
    return { status: "error" };
  }

  if (result.err !== window.cep.fs.NO_ERROR) {
    return { status: "error" };
  }

  if (!result.data?.length) {
    return { status: "cancelled" };
  }

  if (!Array.isArray(result.data) || typeof result.data[0] !== "string") {
    return { status: "error" };
  }

  if (!result.data[0].trim()) {
    return { status: "cancelled" };
  }

  return {
    status: "selected",
    filePath: decodeDialogPath(result.data[0]),
  };
};

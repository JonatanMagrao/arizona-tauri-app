const WAV_EXT = ".wav";

const isWavFile = (name: string): boolean => {
  const lower = String(name).toLowerCase();
  return lower.slice(lower.length - WAV_EXT.length) === WAV_EXT;
};

const alertAudioUpdated = (fileName: string): void => {
  alert("\u00c1udio atualizado: " + fileName);
};

const findFirstWavFootageItem = (): FootageItem | null => {
  const project = app.project;
  if (project === null) return null;

  for (let i = 1; i <= project.numItems; i += 1) {
    const item = project.items[i] as Item;
    if (item instanceof FootageItem) {
      const footage = item as FootageItem;
      if (footage.file !== null && isWavFile(String(footage.file.name))) {
        return footage;
      }
    }
  }

  return null;
};

export const getProjectWavFootageInfo = (): {
  count: number;
  name: string;
  path: string;
} => {
  const project = app.project;
  if (project === null) return { count: 0, name: "", path: "" };

  let count = 0;
  let firstName = "";
  let firstPath = "";

  for (let i = 1; i <= project.numItems; i += 1) {
    const item = project.items[i] as Item;
    if (item instanceof FootageItem) {
      const footage = item as FootageItem;
      if (footage.file !== null && isWavFile(String(footage.file.name))) {
        count += 1;
        if (count === 1) {
          firstName = String(footage.file.name);
          firstPath = footage.file.fsName;
        }
      }
    }
  }

  return { count, name: firstName, path: firstPath };
};

export const replaceWavFootage = (
  newFilePath: string
): { ok: boolean; fileName: string } => {
  const footage = findFirstWavFootageItem();
  if (footage === null) return { ok: false, fileName: "" };

  const newFile = new File(newFilePath);
  if (!newFile.exists) return { ok: false, fileName: "" };

  footage.replace(newFile);
  const fileName = String(newFile.displayName);
  alertAudioUpdated(fileName);
  return { ok: true, fileName };
};

export const openAudioDialogAndReplace = (
  folderPath: string
): { ok: boolean; replaced: boolean; fileName: string } => {
  const footage = findFirstWavFootageItem();
  if (footage === null) return { ok: false, replaced: false, fileName: "" };

  const folder = new Folder(folderPath);
  const selected = (
    folder.exists
      ? folder.openDlg("Selecione o arquivo de audio")
      : File.openDialog("Selecione o arquivo de audio")
  ) as unknown as File | null;

  if (!selected) return { ok: true, replaced: false, fileName: "" };

  footage.replace(selected);
  const fileName = String(selected.displayName);
  alertAudioUpdated(fileName);
  return { ok: true, replaced: true, fileName };
};

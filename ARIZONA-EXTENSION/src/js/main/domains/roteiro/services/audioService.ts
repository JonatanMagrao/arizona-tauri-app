import { evalTS } from "../../../../lib/utils/bolt";

export const loadProjectWavFootageInfo = () => {
  if (!window.cep) return Promise.resolve({ count: 0, name: "", path: "" });
  return evalTS("getProjectWavFootageInfo") as Promise<{
    count: number;
    name: string;
    path: string;
  }>;
};

export const replaceProjectWavFootage = (newFilePath: string) => {
  if (!window.cep) return Promise.resolve({ ok: false, fileName: "" });
  return evalTS("replaceWavFootage", newFilePath) as Promise<{
    ok: boolean;
    fileName: string;
  }>;
};

export const openProjectAudioDialogAndReplace = (folderPath: string) => {
  if (!window.cep) return Promise.resolve({ ok: false, replaced: false, fileName: "" });
  return evalTS("openAudioDialogAndReplace", folderPath) as Promise<{
    ok: boolean;
    replaced: boolean;
    fileName: string;
  }>;
};

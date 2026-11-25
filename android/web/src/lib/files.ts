import { api, isTauri } from "./api";

export { isTauri };

export const defaultBackupName = (): string => {
  const stamp = new Date().toISOString().slice(0, 10);
  return `reciprocal-backup-${stamp}.json`;
};

export const pickExportPath = async (defaultName: string): Promise<string | null> => {
  if (!isTauri) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const picked = await save({
    title: "匯出 Reciprocal 備份",
    defaultPath: defaultName,
    filters: [{ name: "JSON 備份", extensions: ["json"] }],
  });
  return picked ?? null;
};

export const pickImportPath = async (): Promise<string | null> => {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    title: "選擇 Reciprocal 備份檔",
    multiple: false,
    directory: false,
    filters: [{ name: "JSON 備份", extensions: ["json"] }],
  });
  return typeof picked === "string" ? picked : null;
};

export const downloadJSON = (filename: string, text: string): void => {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const exportInBrowser = async (): Promise<void> => {
  const data = await api.loadApp();
  downloadJSON(defaultBackupName(), JSON.stringify(data, null, 2));
};

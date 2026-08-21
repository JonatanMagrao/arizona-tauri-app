const MAX_PROJECT_REGION_LENGTH = 32;

export const getProjectRegionFromAfterFileName = (
  projectName: string
): string => {
  const fileName = String(projectName || "");
  const extensionIndex = fileName.lastIndexOf(".");
  const stem = extensionIndex > 0 ? fileName.substring(0, extensionIndex) : fileName;
  const region = (stem.split("_")[1] || "").trim().toUpperCase();

  if (
    region === "" ||
    Array.from(region).length > MAX_PROJECT_REGION_LENGTH ||
    !/^[\p{L}\p{N}-]+$/u.test(region)
  ) {
    return "";
  }

  return region;
};

export const isRnAfterProject = (projectName: string): boolean =>
  getProjectRegionFromAfterFileName(projectName) === "RN";

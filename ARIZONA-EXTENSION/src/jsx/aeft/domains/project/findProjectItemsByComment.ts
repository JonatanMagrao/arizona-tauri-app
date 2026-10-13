export type ProjectItemType = "comp" | "footage" | "folder";

const normalizeComment = (value: string): string =>
  String(value || "").replace(/^\s+|\s+$/g, "").toUpperCase();

const matchesItemType = (item: Item, itemType?: ProjectItemType): boolean => {
  if (typeof itemType === "undefined") return true;
  if (itemType === "comp") return item instanceof CompItem;
  if (itemType === "footage") return item instanceof FootageItem;
  if (itemType === "folder") return item instanceof FolderItem;
  return false;
};

// Host-only: returns native project items, never timeline layers or front DTOs.
// Empty comments are not identities. Duplicate matches remain explicit for callers.
export const findProjectItemsByComment = (
  comment: string,
  itemType?: ProjectItemType
): Item[] => {
  const matches: Item[] = [];
  const expectedComment = normalizeComment(comment);
  const project = app.project;
  if (project === null || expectedComment === "") return matches;

  // The project collection already includes items inside folders.
  for (let index = 1; index <= project.numItems; index += 1) {
    try {
      const item = project.item(index);
      if (
        item !== null &&
        matchesItemType(item, itemType) &&
        normalizeComment(item.comment) === expectedComment
      ) {
        matches.push(item);
      }
    } catch (error) {
      // An unavailable item must not hide other matches in the project.
    }
  }

  return matches;
};

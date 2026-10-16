export interface ProjectCompReference {
  compId: number;
  layerIndex: number;
  sourceId: number;
}

export interface ProjectReferenceIndex {
  references: ProjectCompReference[];
  bySource: { [id: string]: ProjectCompReference[] };
}

// This is a planning snapshot, never a cache across operations. Read it before
// the first mutation and discard it afterwards; rollback must read live state.
// IDs and layer indices identify the same native objects even when AE returns
// different JavaScript wrappers. No layer order changes during these plans.
export const readProjectReferenceIndex = (): ProjectReferenceIndex => {
  const project = app.project;
  if (project === null) throw new Error("Nenhum projeto esta aberto.");
  const result: ProjectReferenceIndex = { references: [], bySource: {} };
  const itemCount = project.numItems;
  for (let index = 1; index <= itemCount; index += 1) {
    const item = project.item(index);
    if (!(item instanceof CompItem)) continue;
    const compId = item.id;
    const layerCount = item.numLayers;
    for (let li = 1; li <= layerCount; li += 1) {
      const layer = item.layer(li);
      if (!(layer instanceof AVLayer)) continue;
      const source = layer.source;
      if (!(source instanceof CompItem)) continue;
      const reference = { compId, layerIndex: li, sourceId: source.id };
      result.references.push(reference);
      const key = "$" + reference.sourceId;
      if (!result.bySource[key]) result.bySource[key] = [];
      result.bySource[key].push(reference);
    }
  }
  return result;
};

export const layerReferenceKey = (layer: AVLayer): string =>
  "$" + layer.containingComp.id + ":" + layer.index;

export const compReferenceKey = (reference: ProjectCompReference): string =>
  "$" + reference.compId + ":" + reference.layerIndex;

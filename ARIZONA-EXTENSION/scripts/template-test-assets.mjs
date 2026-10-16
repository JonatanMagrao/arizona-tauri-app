import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const templateIdentitiesFilePath = "C:/extension/js/assets/template-identities.json";
export const approvedTemplateIdentities = () => JSON.parse(readFileSync(
  new URL("../src/js/assets/template-identities.json", import.meta.url), "utf8"
));

// Simulate only AE's File API. Each suite still executes the production JSON
// decoder, validator and operation-scoped template runtime.
export function createTemplateTestAssets(fallback = {}) {
  const map = approvedTemplateIdentities();
  Object.assign(map.fallback, fallback);
  const state = { reads: 0, opens: 0, closes: 0, exists: true, readable: true };
  const binary = () => Buffer.from(JSON.stringify(map), "utf8").toString("latin1");
  const wrapFile = (OtherFile) => class File {
    constructor(filePath) {
      if (filePath !== templateIdentitiesFilePath && OtherFile) return new OtherFile(filePath);
      this.fsName = filePath;
      this.encoding = "";
      this.error = "";
      this.opened = false;
    }
    get exists() { return this.fsName === templateIdentitiesFilePath && state.exists; }
    get length() { return binary().length; }
    open(mode) {
      assert.equal(mode, "r");
      state.opens += 1;
      this.opened = this.exists && state.readable;
      return this.opened;
    }
    seek(offset) { return this.opened && offset === 0; }
    read() {
      assert.equal(this.opened, true);
      assert.equal(this.encoding, "BINARY");
      state.reads += 1;
      return binary();
    }
    close() { state.closes += 1; this.opened = false; return true; }
  };
  return { map, state, wrapFile, filePath: templateIdentitiesFilePath };
}

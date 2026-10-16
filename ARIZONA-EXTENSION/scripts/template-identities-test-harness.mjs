import { readFileSync } from "node:fs";

// Exercise the real runtime/validator while keeping all After Effects I/O fake.
export function createTemplateIdentitiesHarness(fallback = {}) {
  const config = JSON.parse(readFileSync(new URL("../src/js/assets/template-identities.json", import.meta.url), "utf8"));
  Object.assign(config.fallback, fallback);
  const state = { config, reads: 0, missing: false, malformed: false, afterRead: null };
  class File {
    constructor() { this.error = ""; this.encoding = "BINARY"; }
    get exists() { return !state.missing; }
    open() {
      this.binary = state.malformed ? "{bad json" : Buffer.from(JSON.stringify(config), "utf8").toString("latin1");
      return true;
    }
    seek() { return true; }
    get length() { return this.binary.length; }
    read() {
      state.reads += 1;
      if (state.afterRead) state.afterRead();
      return this.binary;
    }
    close() { return true; }
  }
  return { File, ...state, state, config };
}

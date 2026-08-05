#!/usr/bin/env node
import { resolve } from "node:path";
import { verifyCepZxp } from "./cep-signing.mjs";

const args = process.argv.slice(2);

if (args.length !== 1) {
  console.error("Usage: node scripts/verify-cep-zxp.mjs <zxp>");
  process.exitCode = 2;
} else {
  const zxpPath = resolve(args[0]);
  try {
    const result = await verifyCepZxp(zxpPath);
    console.log(`CEP ZXP verification passed: ${result.path}`);
    console.log(`CEP bundle: ${result.bundleId} v${result.bundleVersion}`);
    console.log(`Certificate SHA-256: ${result.fingerprint}`);
    console.log(`Adobe verifier SHA-256: ${result.adobeVerifierSha256}`);
    console.log(`RFC3161 genTime: ${result.timestamp.genTime}`);
  } catch (error) {
    console.error(`CEP ZXP verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

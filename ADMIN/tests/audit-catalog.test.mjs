import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  AUDIT_ACTION_DEFINITIONS,
  AUDIT_SOURCE_LABELS,
  auditActionInfo,
  auditSourceLabel,
} from "../src/auditCatalog.js";

const functionsDirectory = fileURLToPath(new URL("../supabase/functions", import.meta.url));

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function auditEventRegions(source) {
  if (!source.includes('.from("audit_log")') || !source.includes(".insert(")) return [];
  return [...source.matchAll(/\baction:\s*([\s\S]*?)\btarget_table:/g)].map((match) => ({
    actionExpression: match[1],
    sourceWindow: source.slice(match.index, match.index + 1500),
  }));
}

function producedAuditContract() {
  const actions = new Set();
  const sources = new Set();
  for (const path of sourceFiles(functionsDirectory)) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(
      /\bconst\s+[A-Z][A-Z0-9_]*_AUDIT_ACTION\s*=\s*"([a-z][a-z0-9_]*\.[a-z0-9_.]+)"/g,
    )) {
      actions.add(match[1]);
    }
    for (const region of auditEventRegions(source)) {
      const actionExpression = region.actionExpression;
      for (const match of actionExpression.matchAll(/"([a-z][a-z0-9_]*\.[a-z0-9_.]+)"/g)) {
        actions.add(match[1]);
      }
      for (const match of region.sourceWindow.matchAll(/source:\s*"([a-z0-9_]+)"/g)) {
        sources.add(match[1]);
      }
    }
  }

  const tauriSource = readFileSync(
    fileURLToPath(new URL("../../src-tauri/src/lib.rs", import.meta.url)),
    "utf8",
  );
  const uninstallSource = readFileSync(
    fileURLToPath(new URL("../../src-tauri/src/uninstall.rs", import.meta.url)),
    "utf8",
  );
  const selfReleaseSource = readFileSync(
    fileURLToPath(new URL("../supabase/functions/app-release-device/index.ts", import.meta.url)),
    "utf8",
  );
  for (const source of [tauriSource, uninstallSource]) {
    for (const match of source.matchAll(/"source"\s*:\s*"([a-z0-9_]+)"/g)) {
      sources.add(match[1]);
    }
  }
  const defaultSource = selfReleaseSource.match(/\|\|\s*"(app_self_release)"/u)?.[1];
  if (defaultSource) sources.add(defaultSource);

  return {
    actions: [...actions].sort(),
    sources: [...sources].sort(),
  };
}

test("every produced audit action and source has a visual catalog entry", () => {
  const produced = producedAuditContract();
  assert.deepEqual(
    produced.actions,
    [
      "access.clock_suspicious",
      "activation_code.generated",
      "device.activated",
      "device.fingerprint_mismatch",
      "device.released",
      "device.self_release_rejected",
      "device.self_released",
      "license.created",
      "license.seats_changed",
      "license.updated",
      "member.activation_code_consumed",
      "member.added",
      "member.rate_limits_reset",
      "member.recovery_code_consumed",
      "member.restored",
      "member.revoked",
      "member.updated",
      "organization.status_changed",
    ],
  );
  assert.deepEqual(
    produced.actions.filter((action) => !AUDIT_ACTION_DEFINITIONS[action]),
    [],
  );
  assert.deepEqual(
    produced.sources,
    [
      "admin_web_panel",
      "app_self_release",
      "master_license_panel",
      "nsis_uninstall",
      "tauri_admin_panel",
      "tauri_device_activation",
      "tauri_passwordless_activation",
      "tauri_passwordless_login",
      "tauri_settings",
    ],
  );
  assert.deepEqual(
    produced.sources.filter((source) => !AUDIT_SOURCE_LABELS[source]),
    [],
  );
});

test("security audit events keep concrete labels without exposing identifiers", () => {
  const mismatch = auditActionInfo("device.fingerprint_mismatch");
  assert.equal(mismatch.label, "Identidade do computador recusada");
  assert.match(
    mismatch.description({ context: { outcome: "mismatch" } }),
    /não corresponde ao vínculo registrado/u,
  );
  assert.equal(
    auditSourceLabel(null, "device.fingerprint_mismatch"),
    "Validação no Arizona App",
  );
  assert.equal(auditSourceLabel(null, "device.activated"), "Processo do Arizona");
  assert.equal(auditSourceLabel(null, "future.unknown"), "Sistema");
  assert.equal(
    auditSourceLabel("tauri_device_activation", "device.fingerprint_mismatch"),
    "Ativação no Arizona App",
  );

  const rejected = auditActionInfo("device.self_release_rejected");
  assert.equal(rejected.label, "Liberação de computador recusada");
  assert.match(
    rejected.description({ context: { reason: "install_id_mismatch" } }),
    /Outra instalação/u,
  );

  const organizationStatus = auditActionInfo("organization.status_changed");
  assert.equal(organizationStatus.label, "Status da organização alterado");
  assert.equal(
    organizationStatus.description({
      context: { previousStatus: "active", status: "paused" },
    }),
    "Status alterado de Ativa para Pausada.",
  );

  assert.deepEqual(
    Object.fromEntries([
      "tauri_device_activation",
      "tauri_settings",
      "nsis_uninstall",
      "app_self_release",
    ].map((source) => [source, AUDIT_SOURCE_LABELS[source]])),
    {
      tauri_device_activation: "Ativação no Arizona App",
      tauri_settings: "Configurações do Arizona App",
      nsis_uninstall: "Desinstalador do Arizona",
      app_self_release: "Arizona App",
    },
  );
});

test("suspicious clock access events explain the refusal without exposing raw timestamps", () => {
  const clockSuspicious = auditActionInfo("access.clock_suspicious");
  assert.equal(clockSuspicious.category, "access");
  assert.equal(clockSuspicious.tone, "danger");
  assert.equal(clockSuspicious.icon, "shield");
  assert.equal(clockSuspicious.label, "Acesso recusado por relógio incorreto");
  assert.equal(
    auditSourceLabel(null, "access.clock_suspicious"),
    "Validação no Arizona App",
  );

  assert.equal(
    clockSuspicious.description({ context: {} }),
    "O acesso foi recusado porque o relógio deste computador estava fora de sincronia.",
  );
  assert.match(
    clockSuspicious.description({ context: { clockSkewSeconds: 7384 } }),
    /2h 03min adiantado em relação ao servidor/u,
  );
  assert.match(
    clockSuspicious.description({ context: { clockSkewSeconds: -125 } }),
    /2min 05s atrasado em relação ao servidor/u,
  );

  const sanitizedDescription = clockSuspicious.description({
    context: {
      clockSkewSeconds: "<script>alert(1)</script>",
      clientLocalTime: "2099-01-02T03:04:05.000Z",
      serverTime: "2026-08-24T12:34:56.000Z",
      deviceId: "device-secret-id",
    },
  });
  assert.equal(
    sanitizedDescription,
    "O acesso foi recusado porque o relógio deste computador estava fora de sincronia.",
  );
  assert.doesNotMatch(
    sanitizedDescription,
    /script|2099|2026|device-secret-id/u,
  );
});

test("unknown audit actions expose only a sanitized bounded code", () => {
  const unknown = auditActionInfo("future.action<script>alert(1)</script>");
  assert.equal(unknown.label, "Ação não catalogada");
  const description = unknown.description({ context: {} });
  assert.match(description, /^Código: future\.action_script_alert_1_script_\.$/u);
  assert.doesNotMatch(description, /[<>]/u);
  assert.ok(description.length <= 140);
  assert.equal(auditSourceLabel(null, "future.action"), "Sistema");
  assert.equal(auditActionInfo("constructor").label, "Ação não catalogada");
  assert.equal(auditSourceLabel("toString", "future.action"), "Sistema");
});

test("audit list exposes only allowlisted status metadata", () => {
  const source = readFileSync(
    fileURLToPath(
      new URL("../supabase/functions/master-list-audit-log/index.ts", import.meta.url),
    ),
    "utf8",
  );
  const start = source.indexOf("function auditContext(");
  const end = source.indexOf("function knownError(", start);
  const contextSource = source.slice(start, end);
  assert.match(
    source,
    /SAFE_FINGERPRINT_OUTCOMES\s*=\s*new Set\(\["empty", "unbound", "missing", "mismatch"\]\)/u,
  );
  assert.match(
    source,
    /SAFE_ORGANIZATION_STATUSES\s*=\s*new Set\(\["active", "paused", "blocked", "deleted"\]\)/u,
  );
  assert.match(
    contextSource,
    /outcome:\s*optionalAllowedString\(metadata\.outcome, SAFE_FINGERPRINT_OUTCOMES\)/u,
  );
  assert.match(
    contextSource,
    /previousStatus:\s*optionalAllowedString\(metadata\.previousStatus, SAFE_ORGANIZATION_STATUSES\)/u,
  );
  assert.match(
    contextSource,
    /status:\s*optionalAllowedString\(metadata\.status, SAFE_ORGANIZATION_STATUSES\)/u,
  );
  assert.doesNotMatch(contextSource, /installId|fingerprint|Prefix/u);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  cepDowngradeRequiresFullInstaller,
  cepInstallationScopeLabel,
  cepInstallActionLabel,
  cepInstallCommandArgs,
  cepVersionRelation,
  normalizeCepExtensionStatus,
} from "./cepExtensionStatus.js";

test("normalizes the legacy CEP status without requiring the new installation fields", () => {
  assert.deepEqual(
    normalizeCepExtensionStatus({
      installed: true,
      version: " 2.2.0 ",
      path: " C:\\Adobe\\CEP ",
      isDevLink: false,
    }),
    {
      installed: true,
      version: "2.2.0",
      path: "C:\\Adobe\\CEP",
      isDevLink: false,
      scope: null,
      installations: [],
      hasMultipleInstallations: false,
    },
  );
});

test("keeps the effective CEP candidate and sanitizes installation details", () => {
  const status = normalizeCepExtensionStatus({
    installed: true,
    version: "2.2.0",
    path: "C:\\Program Files\\Common Files\\Adobe\\CEP\\extensions\\com.arizona-carrefour.cep",
    isDevLink: false,
    scope: "perMachine",
    hasMultipleInstallations: false,
    installations: [
      {
        scope: "perUser",
        installed: true,
        version: "2.1.0",
        path: "C:\\Users\\Arizona\\AppData\\Roaming\\Adobe\\CEP\\extensions\\com.arizona-carrefour.cep",
        isDevLink: true,
        manifestValid: true,
      },
      {
        scope: "perMachine",
        installed: true,
        version: "2.2.0",
        path: "C:\\Program Files\\Common Files\\Adobe\\CEP\\extensions\\com.arizona-carrefour.cep",
        isDevLink: false,
        manifestValid: true,
      },
      null,
    ],
  });

  assert.equal(status.scope, "perMachine");
  assert.equal(status.installations.length, 2);
  assert.equal(status.installations[0].scope, "perUser");
  assert.equal(status.installations[0].isDevLink, true);
  assert.equal(status.installations[1].manifestValid, true);
  assert.equal(status.hasMultipleInstallations, true);
  assert.equal(cepInstallationScopeLabel("perUser"), "Somente este usuário");
  assert.equal(
    cepInstallationScopeLabel("perMachine"),
    "Todos os usuários (instalador Full)",
  );
  assert.equal(cepInstallationScopeLabel("unexpected"), "");
});

test("classifies upgrades, reinstalls and downgrades with SemVer precedence", () => {
  assert.equal(cepVersionRelation("2.3.0", "2.2.0"), "upgrade");
  assert.equal(cepVersionRelation("2.2.0", "2.2.0+build.7"), "same");
  assert.equal(cepVersionRelation("2.2.0-rc.2", "2.2.0-rc.1"), "upgrade");
  assert.equal(cepVersionRelation("2.2.0-rc.1", "2.2.0"), "downgrade");
  assert.equal(cepVersionRelation("2.1.9", "2.2.0"), "downgrade");
  assert.equal(cepVersionRelation("2.2", "2.1.0"), "unknown");
  assert.equal(cepVersionRelation("2.2.0", ""), "install");

  assert.equal(cepInstallActionLabel("upgrade"), "Atualizar");
  assert.equal(cepInstallActionLabel("same"), "Reinstalar");
  assert.equal(cepInstallActionLabel("downgrade"), "Instalar versão anterior");
  assert.equal(cepInstallActionLabel("unknown"), "Instalar");
});

test("sends downgrade authorization only after explicit confirmation", () => {
  const base = {
    path: "C:\\Downloads\\arizona-cep-v2.1.0.zxp",
    expectedVersion: " 2.1.0 ",
    replaceDevLink: true,
    relation: "downgrade",
  };

  assert.deepEqual(cepInstallCommandArgs(base), {
    path: base.path,
    expectedVersion: "2.1.0",
    replaceDevLink: true,
    allowDowngrade: false,
  });
  assert.deepEqual(cepInstallCommandArgs({ ...base, downgradeConfirmed: true }), {
    path: base.path,
    expectedVersion: "2.1.0",
    replaceDevLink: true,
    allowDowngrade: true,
  });
  assert.equal(
    cepInstallCommandArgs({ ...base, relation: "upgrade", downgradeConfirmed: true })
      .allowDowngrade,
    false,
  );
});

test("requires a Full installer when any valid per-machine installation is newer", () => {
  const status = normalizeCepExtensionStatus({
    installed: true,
    version: "2.3.0",
    scope: "perUser",
    installations: [
      {
        scope: "perUser",
        installed: true,
        version: "2.3.0",
        manifestValid: true,
      },
      {
        scope: "perMachine",
        installed: true,
        version: "2.2.0",
        manifestValid: true,
      },
    ],
  });

  assert.equal(cepDowngradeRequiresFullInstaller("2.1.0", status), true);
  assert.equal(cepDowngradeRequiresFullInstaller("2.2.0", status), false);
  assert.equal(cepDowngradeRequiresFullInstaller("2.2.1", status), false);

  const invalidMachineStatus = normalizeCepExtensionStatus({
    installed: true,
    version: "2.3.0",
    scope: "perUser",
    installations: [
      {
        scope: "perMachine",
        installed: true,
        version: "9.0.0",
        manifestValid: false,
      },
    ],
  });
  assert.equal(cepDowngradeRequiresFullInstaller("2.1.0", invalidMachineStatus), false);
});

test("falls back to the effective scope when the backend has no installation inventory", () => {
  assert.equal(
    cepDowngradeRequiresFullInstaller("2.1.0", normalizeCepExtensionStatus({
      installed: true,
      version: "2.2.0",
      scope: "perMachine",
    })),
    true,
  );
  assert.equal(
    cepDowngradeRequiresFullInstaller("2.1.0", normalizeCepExtensionStatus({
      installed: true,
      version: "2.2.0",
      scope: "perUser",
    })),
    false,
  );
});

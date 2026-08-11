import assert from "node:assert/strict";
import test from "node:test";
import { adminPublicErrorMessage } from "../src/publicErrors.js";

test("admin errors never expose infrastructure names", () => {
  assert.equal(
    adminPublicErrorMessage(new Error("Resposta inválida do Supabase Auth (500).")),
    "Não foi possível concluir esta ação. Tente novamente.",
  );
  assert.equal(
    adminPublicErrorMessage({ code: "function_permission_error" }),
    "O serviço de licenças não conseguiu salvar a alteração. Contate o suporte.",
  );
});

test("admin errors translate capacity and computer terms", () => {
  assert.equal(
    adminPublicErrorMessage({ code: "seat_limit_exceeded" }),
    "Não há vagas disponíveis nesta licença.",
  );
  assert.equal(
    adminPublicErrorMessage({ code: "device_not_active" }),
    "Este computador não está autorizado. Libere-o ou cadastre um novo computador.",
  );
});

test("admin errors translate authentication and connection failures", () => {
  assert.equal(
    adminPublicErrorMessage(new Error("Invalid login credentials")),
    "E-mail ou senha inválidos.",
  );
  assert.equal(
    adminPublicErrorMessage(new TypeError("Failed to fetch")),
    "Não foi possível acessar o serviço. Verifique sua conexão com a internet e tente novamente.",
  );
});

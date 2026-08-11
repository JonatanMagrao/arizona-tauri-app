import assert from "node:assert/strict";
import test from "node:test";
import {
  isHumanFriendlyPublicMessage,
  publicErrorCode,
  publicErrorMessage,
} from "./publicErrors.js";

test("maps infrastructure failures to a human message", () => {
  const message = publicErrorMessage(
    "network_error: Não foi possível conectar ao Supabase.",
    "Não foi possível confirmar o acesso.",
  );

  assert.equal(
    message,
    "Não foi possível acessar o serviço agora. Verifique sua conexão com a internet e tente novamente.",
  );
  assert.equal(publicErrorCode("network_error: falha"), "network_error");
});

test("does not expose technical messages or local paths", () => {
  const fallback = "Não foi possível carregar as configurações.";

  assert.equal(publicErrorMessage("HTTP 500: Edge Function failed", fallback), fallback);
  assert.equal(publicErrorMessage("Falha em C:\\Users\\Pessoa\\settings.json", fallback), fallback);
  assert.equal(publicErrorMessage("Unknown command: diagnostics_status", fallback), fallback);
  assert.equal(isHumanFriendlyPublicMessage("Backend indisponível"), false);
});

test("keeps concise messages that help the user act", () => {
  assert.equal(
    publicErrorMessage("A pasta selecionada não está disponível.", "Falha genérica."),
    "A pasta selecionada não está disponível.",
  );
});

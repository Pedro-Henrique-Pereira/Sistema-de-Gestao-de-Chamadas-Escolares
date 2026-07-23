import test from "node:test";
import assert from "node:assert/strict";

import { apiUrlSeguraEmProducao } from "../utils/apiUrlSecurity.js";

test("API de producao exige HTTPS fora do loopback", () => {
  assert.equal(apiUrlSeguraEmProducao("https://api.escola.test"), true);
  assert.equal(apiUrlSeguraEmProducao("http://api.escola.test"), false);
  assert.equal(apiUrlSeguraEmProducao("http://127.0.0.1:3101"), true);
  assert.equal(apiUrlSeguraEmProducao("http://localhost:3101"), true);
  assert.equal(apiUrlSeguraEmProducao("/api"), true);
  assert.equal(apiUrlSeguraEmProducao("//externo.example/api"), false);
  assert.equal(apiUrlSeguraEmProducao("nao-e-url"), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { senhaAtendeRequisitos } from "../utils/passwordValidation.js";

test("frontend espelha o contrato atual de senha do backend", () => {
  assert.equal(senhaAtendeRequisitos("12345"), false);
  assert.equal(senhaAtendeRequisitos("123456"), true);
  assert.equal(senhaAtendeRequisitos("x".repeat(128)), true);
  assert.equal(senhaAtendeRequisitos("x".repeat(129)), false);
  assert.equal(senhaAtendeRequisitos(" 12345 "), false);
});

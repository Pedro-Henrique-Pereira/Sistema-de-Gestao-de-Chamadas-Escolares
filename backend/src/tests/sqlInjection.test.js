const axios = require("axios");

const API = process.env.TEST_API_LOGIN_URL || "http://localhost:3001/api/auth/login";

async function testarSqlInjection() {
  const payloads = [
    "' OR '1'='1",
    "admin@email.com' --",
    "' OR 1=1 --",
    "'; DROP TABLE usuarios; --"
  ];

  for (const payload of payloads) {
    try {
      const resposta = await axios.post(API, {
        email: payload,
        senha: payload
      });

      console.log("Payload:", payload);
      console.log("Status:", resposta.status);
      if (resposta.data?.token || resposta.data?.usuario) {
        console.log("⚠️ POSSÍVEL VULNERABILIDADE");
      } else {
        console.log("✅ Bloqueado");
      }
    } catch (error) {
      console.log("Payload:", payload);
      console.log("✅ Rejeitado:", error.response?.status);
    }

    console.log("---------------------");
  }
}

testarSqlInjection();

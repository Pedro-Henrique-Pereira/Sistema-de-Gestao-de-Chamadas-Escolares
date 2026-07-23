function ambienteProducao() {
  return process.env.NODE_ENV === "production";
}

function sameSiteConfigurado() {
  const valor = String(process.env.COOKIE_SAME_SITE || "").trim().toLowerCase();
  if (["lax", "strict", "none"].includes(valor)) return valor;
  return ambienteProducao() ? "lax" : "strict";
}

function cookieSecure() {
  return ambienteProducao() || process.env.COOKIE_SECURE === "true";
}

function tokenCookieOptions() {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: sameSiteConfigurado(),
    path: "/",
    priority: "high",
  };
}

function csrfCookieOptions() {
  return {
    httpOnly: false,
    secure: cookieSecure(),
    sameSite: sameSiteConfigurado(),
    path: "/",
    priority: "high",
  };
}

function limparCookiesAutenticacao(res) {
  res.clearCookie("token", tokenCookieOptions());
  res.clearCookie("csrfToken", csrfCookieOptions());
}

module.exports = {
  tokenCookieOptions,
  csrfCookieOptions,
  limparCookiesAutenticacao,
};

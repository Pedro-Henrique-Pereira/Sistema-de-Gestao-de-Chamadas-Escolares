function ambienteProducao() {
  return process.env.NODE_ENV === "production";
}

function tokenCookieOptions() {
  const isProduction = ambienteProducao();

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "strict",
    path: "/",
    priority: "high",
  };
}

function csrfCookieOptions() {
  const isProduction = ambienteProducao();

  return {
    httpOnly: false,
    secure: isProduction,
    sameSite: isProduction ? "none" : "strict",
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

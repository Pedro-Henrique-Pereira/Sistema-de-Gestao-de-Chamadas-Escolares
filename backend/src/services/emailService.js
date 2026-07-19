const nodemailer = require("nodemailer");

let transporter;
let transporterFingerprint;

function escapeHtml(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function booleanoEnv(nome, padrao = false) {
  const valor = process.env[nome];
  if (valor === undefined || valor === "") return padrao;
  return String(valor).toLowerCase() === "true";
}

function obterConfiguracaoEmail() {
  const porta = Number(process.env.SMTP_PORT || 587);
  const secure = booleanoEnv("SMTP_SECURE", porta === 465);
  const frontendUrl = String(
    process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || ""
  ).replace(/\/+$/, "");
  const config = {
    host: String(process.env.SMTP_HOST || "").trim(),
    port: porta,
    secure,
    user: String(process.env.SMTP_USER || "").trim(),
    pass: String(process.env.SMTP_PASS || ""),
    fromEmail: String(process.env.SMTP_FROM_EMAIL || "").trim(),
    fromName: String(process.env.SMTP_FROM_NAME || "Sistema Lysímaco Digital").trim(),
    frontendUrl,
  };

  if (!config.host || !Number.isInteger(config.port) || !config.fromEmail || !frontendUrl) {
    const error = new Error("Configuração SMTP incompleta.");
    error.code = "SMTP_CONFIG_INCOMPLETE";
    throw error;
  }

  if (Boolean(config.user) !== Boolean(config.pass)) {
    const error = new Error("Autenticação SMTP incompleta.");
    error.code = "SMTP_AUTH_INCOMPLETE";
    throw error;
  }

  if (
    process.env.NODE_ENV === "production"
    && !frontendUrl.toLowerCase().startsWith("https://")
  ) {
    const error = new Error("URL pública de recuperação deve usar HTTPS.");
    error.code = "PASSWORD_RESET_HTTPS_REQUIRED";
    throw error;
  }

  return config;
}

function obterTransporter(config) {
  const fingerprint = JSON.stringify([
    config.host,
    config.port,
    config.secure,
    config.user,
    Boolean(config.pass),
  ]);

  if (!transporter || transporterFingerprint !== fingerprint) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user
        ? { user: config.user, pass: config.pass }
        : undefined,
      requireTLS: booleanoEnv("SMTP_REQUIRE_TLS", !config.secure),
      connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10000),
      greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10000),
      socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 15000),
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    transporterFingerprint = fingerprint;
  }

  return transporter;
}

function criarMensagemRedefinicao({
  destinatario,
  token,
  expiraMinutos,
  config = obterConfiguracaoEmail(),
}) {
  const link = `${config.frontendUrl}/redefinir-senha?token=${encodeURIComponent(token)}`;
  const nomeSistema = escapeHtml(config.fromName);
  const linkSeguro = escapeHtml(link);
  const minutos = Number(expiraMinutos);

  return {
    from: {
      name: config.fromName,
      address: config.fromEmail,
    },
    to: destinatario,
    subject: "Redefinição de senha — Sistema Lysímaco Digital",
    text: [
      "Recebemos uma solicitação para redefinir a senha da sua conta.",
      "",
      `Acesse o link abaixo em até ${minutos} minutos:`,
      link,
      "",
      "Se você não fez esta solicitação, ignore esta mensagem. Sua senha não será alterada.",
    ].join("\n"),
    html: `
      <!doctype html>
      <html lang="pt-BR">
        <body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f1f5f9">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dbe3ef;border-radius:20px">
                  <tr>
                    <td style="padding:32px">
                      <div style="font-size:13px;font-weight:700;color:#2563eb">${nomeSistema}</div>
                      <h1 style="margin:12px 0 10px;font-size:24px;line-height:1.25">Redefinição de senha</h1>
                      <p style="margin:0 0 22px;color:#475569;line-height:1.6">
                        Recebemos uma solicitação para redefinir a senha da sua conta.
                      </p>
                      <a href="${linkSeguro}" style="display:inline-block;padding:14px 20px;border-radius:12px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700">
                        Redefinir minha senha
                      </a>
                      <p style="margin:22px 0 8px;color:#475569;line-height:1.6">
                        Este link expira em ${minutos} minutos e pode ser utilizado uma única vez.
                      </p>
                      <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6">
                        Se você não fez esta solicitação, ignore esta mensagem. Sua senha não será alterada.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
  };
}

async function enviarRedefinicaoSenha(dados) {
  const config = obterConfiguracaoEmail();
  const mensagem = criarMensagemRedefinicao({ ...dados, config });
  await obterTransporter(config).sendMail(mensagem);
}

module.exports = {
  criarMensagemRedefinicao,
  enviarRedefinicaoSenha,
  obterConfiguracaoEmail,
};

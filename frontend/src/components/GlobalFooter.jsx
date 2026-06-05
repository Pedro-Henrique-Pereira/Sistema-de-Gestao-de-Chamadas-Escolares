import { useEffect, useId, useState } from "react";
import { Mail, ShieldCheck, X } from "lucide-react";
import "../styles/GlobalFooter.css";

const politicaPrivacidade = [
  {
    titulo: "Apresentação",
    texto:
      "O Sistema Lysímaco Digital é uma plataforma desenvolvida para auxiliar os processos administrativos e pedagógicos do Colégio Estadual Lysímaco Ferreira da Costa, sendo utilizada exclusivamente por profissionais autorizados da instituição. Esta Política de Privacidade tem como objetivo informar quais dados são utilizados pelo sistema, suas finalidades e as responsabilidades relacionadas à sua utilização.",
  },
  {
    titulo: "Dados coletados e utilizados",
    itens: [
      "Dados de alunos: nome completo, turma e informações de frequência escolar.",
      "Dados de responsáveis: nome completo e telefone para contato.",
      "Dados de funcionários: nome completo, endereço de e-mail institucional ou informado para autenticação e acesso ao sistema, e perfil de acesso.",
      "O sistema não realiza coleta de dados biométricos, dados financeiros, geolocalização, documentos pessoais, dados bancários ou quaisquer categorias especiais de dados pessoais.",
    ],
  },
  {
    titulo: "Finalidade do tratamento dos dados",
    itens: [
      "Identificação de alunos, responsáveis e funcionários.",
      "Registro de frequência escolar.",
      "Comunicação institucional com responsáveis.",
      "Gestão administrativa e pedagógica da escola.",
      "Controle de acesso ao sistema.",
      "Emissão de relatórios e acompanhamento escolar.",
    ],
  },
  {
    titulo: "Acesso às informações",
    texto:
      "O acesso às informações é restrito aos profissionais autorizados pelo Colégio Estadual Lysímaco Ferreira da Costa. Os usuários possuem níveis de acesso distintos de acordo com suas atribuições funcionais, sendo proibido o acesso, compartilhamento ou utilização dos dados para finalidades não relacionadas às atividades institucionais da escola.",
  },
  {
    titulo: "Segurança das informações",
    itens: [
      "Controle de autenticação por usuário e senha.",
      "Controle de permissões por perfil de acesso.",
      "Comunicação protegida por conexão segura (HTTPS).",
      "Registro de atividades administrativas quando aplicável.",
      "Mecanismos de proteção contra acessos não autorizados.",
      "Apesar da adoção de medidas de segurança, nenhum sistema computacional pode garantir proteção absoluta contra todos os riscos existentes na internet.",
    ],
  },
  {
    titulo: "Compartilhamento de dados",
    texto:
      "Os dados tratados pelo sistema não são comercializados nem compartilhados com terceiros para fins comerciais. O compartilhamento poderá ocorrer apenas quando necessário para o cumprimento de obrigação legal, determinado por autoridade competente ou necessário para a execução das atividades institucionais da escola.",
  },
  {
    titulo: "Responsabilidades dos usuários",
    texto:
      "Os usuários autorizados comprometem-se a manter suas credenciais de acesso em sigilo, não compartilhar usuários ou senhas, utilizar o sistema exclusivamente para fins institucionais e não realizar consultas, alterações ou extrações de dados sem autorização. O uso inadequado do sistema, o compartilhamento indevido de credenciais, a inserção incorreta de informações, o tratamento inadequado de dados pessoais ou qualquer utilização em desacordo com a legislação vigente são de responsabilidade do usuário que praticou a ação e da instituição responsável pela operação do sistema.",
  },
  {
    titulo: "Controlador dos dados",
    texto:
      "Colégio Estadual Lysímaco Ferreira da Costa. Endereço: Rua Cambuy, Paranapoema - PR. Telefone: (44) 3342-1298. E-mail: ppxlcosta@seed.pr.gov.br. A instituição é responsável pela definição das finalidades de uso do sistema, autorização de usuários, manutenção dos cadastros e observância da legislação aplicável à proteção de dados.",
  },
  {
    titulo: "Responsabilidade do desenvolvedor",
    texto:
      "O desenvolvedor do Sistema Lysímaco Digital é responsável pela implementação e manutenção dos recursos tecnológicos do software dentro dos limites contratados e tecnicamente possíveis. Não são de responsabilidade do desenvolvedor: uso inadequado do sistema pelos usuários, compartilhamento de credenciais, cadastro incorreto de informações pela instituição, descumprimento de normas internas da escola, utilização do sistema para finalidades não previstas, atos praticados por usuários autorizados dentro de suas credenciais de acesso e decisões administrativas ou pedagógicas tomadas com base nas informações registradas no sistema.",
  },
  {
    titulo: "Alterações desta política e contato",
    texto:
      "Esta Política de Privacidade poderá ser atualizada sempre que necessário para adequação legal, operacional ou de segurança, sendo a versão mais recente disponibilizada aos usuários do sistema. Dúvidas relacionadas à utilização dos dados pessoais tratados pelo sistema deverão ser encaminhadas diretamente ao Colégio Estadual Lysímaco Ferreira da Costa por meio dos canais oficiais informados nesta política.",
  },
];

export default function GlobalFooter() {
  const [politicaAberta, setPoliticaAberta] = useState(false);
  const tituloModalId = useId();

  useEffect(() => {
    if (!politicaAberta) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setPoliticaAberta(false);
      }
    };

    document.body.classList.add("privacy-modal-open");
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.classList.remove("privacy-modal-open");
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [politicaAberta]);

  return (
    <>
      <footer className="global-footer" aria-label="Informações do sistema">
        <div className="global-footer__content">
          <span className="global-footer__copyright">
            Pedro-Henrique-pereira(PHtw) © 2026
          </span>

          <nav className="global-footer__links" aria-label="Links de contato e privacidade">
            <button
              className="global-footer__link global-footer__button"
              type="button"
              onClick={() => setPoliticaAberta(true)}
              aria-haspopup="dialog"
            >
              <ShieldCheck size={15} strokeWidth={2} aria-hidden="true" />
              <span>Termos de Privacidade</span>
            </button>

            <a
              className="global-footer__link"
              href="mailto:phtw999@gmail.com"
              aria-label="Enviar e-mail para Pedro-Henrique-pereira"
            >
              <Mail size={15} strokeWidth={2} aria-hidden="true" />
              <span>phtw999@gmail.com</span>
            </a>

            <a
              className="global-footer__link"
              href="https://github.com/Pedro-Henrique-Pereira"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Abrir GitHub de Pedro-Henrique-pereira em uma nova aba"
            >
              <svg
                className="global-footer__github-icon"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  fill="currentColor"
                  d="M12 2C6.48 2 2 6.58 2 12.26c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.93.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.99c.85 0 1.7.12 2.5.34 1.9-1.33 2.74-1.05 2.74-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.38-.01 2.49-.01 2.83 0 .27.18.6.69.49A10.16 10.16 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z"
                />
              </svg>
              <span>GitHub</span>
            </a>
          </nav>
        </div>
      </footer>

      {politicaAberta && (
        <div
          className="privacy-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setPoliticaAberta(false);
            }
          }}
        >
          <section
            className="privacy-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={tituloModalId}
          >
            <header className="privacy-modal__header">
              <div>
                <p className="privacy-modal__eyebrow">Sistema Lysímaco Digital</p>
                <h2 id={tituloModalId}>Política de Privacidade e Uso do Sistema</h2>
                <p className="privacy-modal__updated">Última atualização: 04/06/2024</p>
              </div>

              <button
                className="privacy-modal__close"
                type="button"
                onClick={() => setPoliticaAberta(false)}
                aria-label="Fechar termos de privacidade"
              >
                <X size={18} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </header>

            <div className="privacy-modal__body">
              {politicaPrivacidade.map((secao) => (
                <article className="privacy-modal__section" key={secao.titulo}>
                  <h3>{secao.titulo}</h3>
                  {secao.texto && <p>{secao.texto}</p>}
                  {secao.itens && (
                    <ul>
                      {secao.itens.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>

            <footer className="privacy-modal__footer">
              <button
                className="privacy-modal__confirm"
                type="button"
                onClick={() => setPoliticaAberta(false)}
              >
                Entendi
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

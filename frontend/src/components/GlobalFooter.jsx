import { Mail } from "lucide-react";
import "../styles/GlobalFooter.css";

export default function GlobalFooter() {
  return (
    <footer className="global-footer" aria-label="Informações do sistema">
      <div className="global-footer__content">
        <span className="global-footer__copyright">
          Pedro-Henrique-pereira(PHtw) © 2026
        </span>

        <nav className="global-footer__links" aria-label="Links de contato">
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
  );
}

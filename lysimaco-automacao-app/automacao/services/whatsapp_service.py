from __future__ import annotations

import logging
import hashlib
import random
import time
from pathlib import Path
from urllib.parse import quote
import re
from typing import Callable

from selenium import webdriver
from selenium.webdriver import ChromeOptions, FirefoxOptions
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.firefox.service import Service as FirefoxService
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    TimeoutException,
    WebDriverException,
    SessionNotCreatedException,
    NoSuchWindowException,
    InvalidSessionIdException,
)
from webdriver_manager.chrome import ChromeDriverManager
from webdriver_manager.firefox import GeckoDriverManager
from webdriver_manager.core.os_manager import ChromeType

from automacao.config.settings import settings, BASE_DIR

logger = logging.getLogger(__name__)

WHATSAPP_WEB_URL = "https://web.whatsapp.com/"


class WhatsAppReadinessTimeout(TimeoutException):
    """Timeout seguro da inicialização, sem expor conteúdo da sessão."""

    def __init__(self, *, qr_detectado: bool = False) -> None:
        self.qr_detectado = bool(qr_detectado)
        super().__init__(
            "WhatsApp desconectado; leia o QR Code."
            if self.qr_detectado
            else "Tempo limite de carregamento do WhatsApp excedido."
        )


def _identificador_tecnico(valor: str | None) -> str:
    return hashlib.sha256(str(valor or "").encode("utf-8")).hexdigest()[:10]


def _mascarar_telefone(valor: str | None) -> str:
    digits = re.sub(r"\D", "", str(valor or ""))
    return f"{digits[:2]}*******{digits[-2:]}" if len(digits) >= 4 else "***"


class WhatsAppService:
    def __init__(self, status_callback: Callable[[str], None] | None = None) -> None:
        self.status_callback = status_callback
        self.driver = self._build_driver()
        self.driver.set_page_load_timeout(settings.page_load_timeout_seconds)
        self.wait = WebDriverWait(self.driver, settings.page_load_timeout_seconds)
        try:
            self.driver.implicitly_wait(0)
        except WebDriverException:
            pass
        self._minimizar_janela_controlada()


    def _notificar_status(self, estado: str) -> None:
        if self.status_callback is None:
            return
        try:
            self.status_callback(estado)
        except Exception:
            logger.warning("Nao foi possivel atualizar o estado visual do WhatsApp.")

    def driver_esta_vivo(self) -> bool:
        """Verifica se a sessão atual do Selenium ainda pode ser usada."""
        try:
            return self.driver is not None and bool(getattr(self.driver, "session_id", None)) and bool(self.driver.current_url is not None)
        except (InvalidSessionIdException, NoSuchWindowException, WebDriverException, AttributeError):
            return False

    def garantir_driver(self) -> None:
        """Recria o navegador quando o Chrome foi fechado ou a sessão morreu."""
        if self.driver_esta_vivo():
            return

        logger.warning("Sessão do Selenium perdida/fechada. Recriando navegador automaticamente...")
        try:
            if self.driver is not None:
                self.driver.quit()
        except Exception:
            pass

        self.driver = self._build_driver()
        self.driver.set_page_load_timeout(settings.page_load_timeout_seconds)
        self.wait = WebDriverWait(self.driver, settings.page_load_timeout_seconds)
        try:
            self.driver.implicitly_wait(0)
        except WebDriverException:
            pass
        self._minimizar_janela_controlada()

    def _minimizar_janela_controlada(self) -> None:
        """Mantém somente o navegador da automação fora da frente do usuário."""
        if settings.headless:
            return
        try:
            self.driver.minimize_window()
        except (WebDriverException, NoSuchWindowException):
            logger.warning("Nao foi possivel minimizar a janela controlada da automacao.")

    def _build_driver(self):
        browser = settings.browser
        profile_dir = settings.resolved_user_data_dir
        profile_dir.mkdir(parents=True, exist_ok=True)

        logger.info("Iniciando driver do navegador: %s", browser)
        logger.info("Perfil persistente local do WhatsApp configurado.")

        if browser in {"chrome", "brave"}:
            options = ChromeOptions()
            # Evita o Selenium ficar preso no carregamento completo do WhatsApp Web.
            options.page_load_strategy = "none"
            options.add_argument(f"--user-data-dir={profile_dir}")
            options.add_argument("--profile-directory=Default")
            options.add_argument("--no-first-run")
            options.add_argument("--no-default-browser-check")
            options.add_argument("--disable-notifications")
            options.add_argument("--disable-popup-blocking")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--disable-gpu")
            options.add_argument("--no-sandbox")
            options.add_argument("--remote-debugging-port=0")
            options.add_argument("--start-minimized")
            options.add_experimental_option("excludeSwitches", ["enable-automation"])
            options.add_experimental_option("useAutomationExtension", False)

            if settings.headless:
                options.add_argument("--headless=new")

            if browser == "brave":
                brave_path = self._find_brave_binary()
                if brave_path:
                    options.binary_location = brave_path
                service = ChromeService(ChromeDriverManager(chrome_type=ChromeType.BRAVE).install())
            else:
                service = ChromeService(ChromeDriverManager().install())

            try:
                return webdriver.Chrome(service=service, options=options)
            except SessionNotCreatedException:
                logger.exception(
                    "Falha ao criar sessão do Chrome. Use USER_DATA_DIR=./whatsapp-profile e feche navegadores antigos abertos por Selenium."
                )
                raise

        if browser == "firefox":
            options = FirefoxOptions()
            if settings.headless:
                options.add_argument("--headless")
            options.add_argument("-profile")
            options.add_argument(str(profile_dir))
            service = FirefoxService(GeckoDriverManager().install())
            return webdriver.Firefox(service=service, options=options)

        raise ValueError("BROWSER deve ser: chrome, brave ou firefox")

    @staticmethod
    def _find_brave_binary() -> str | None:
        candidates = [
            "/usr/bin/brave-browser",
            "/usr/bin/brave",
            "/snap/bin/brave",
            "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
            "C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        ]
        for candidate in candidates:
            if Path(candidate).exists():
                return candidate
        return None

    def _delay(self, minimo: float, maximo: float, motivo: str) -> None:
        minimo = max(0.0, float(minimo))
        maximo = max(minimo, float(maximo))
        pausa = random.uniform(minimo, maximo)
        logger.info("Aguardando %.1fs antes da próxima %s...", pausa, motivo)
        time.sleep(pausa)

    def delay_acao(self, motivo: str = "ação") -> None:
        self._delay(settings.action_min_delay_seconds, settings.action_max_delay_seconds, motivo)

    def aguardar_login(self) -> None:
        """Compatibilidade com versões antigas do main.py."""
        self.abrir_whatsapp()

    def abrir_whatsapp(self) -> None:
        self._notificar_status("Abrindo WhatsApp.")
        self.garantir_driver()
        aba_existente = self._selecionar_aba_whatsapp_existente()
        if aba_existente:
            logger.info("Reutilizando a aba do WhatsApp Web controlada pela automacao.")
        else:
            logger.info("Abrindo WhatsApp Web na janela controlada pela automacao...")
            try:
                self.driver.get(WHATSAPP_WEB_URL)
                self._minimizar_janela_controlada()
            except WebDriverException:
                self._notificar_status("Falha ao abrir o WhatsApp.")
                raise

        self._notificar_status("Aguardando carregamento.")
        self._aguardar_whatsapp_pronto()

    def _selecionar_aba_whatsapp_existente(self) -> bool:
        """Reutiliza uma aba ja controlada sem criar, fechar ou recarregar abas."""
        try:
            if "web.whatsapp.com" in str(self.driver.current_url or "").lower():
                return True
        except (WebDriverException, NoSuchWindowException):
            pass

        try:
            handles = list(self.driver.window_handles)
            handle_inicial = self.driver.current_window_handle
        except (WebDriverException, NoSuchWindowException):
            return False

        for handle in handles:
            try:
                self.driver.switch_to.window(handle)
                if "web.whatsapp.com" in str(self.driver.current_url or "").lower():
                    self._minimizar_janela_controlada()
                    return True
            except (WebDriverException, NoSuchWindowException):
                continue

        try:
            if handle_inicial in handles:
                self.driver.switch_to.window(handle_inicial)
        except (WebDriverException, NoSuchWindowException):
            pass
        return False

    def _existe(self, by: By, selector: str) -> bool:
        try:
            return len(self.driver.find_elements(by, selector)) > 0
        except (WebDriverException, NoSuchWindowException):
            return False

    def _existe_visivel(self, by: By, selector: str) -> bool:
        try:
            return any(elemento.is_displayed() for elemento in self.driver.find_elements(by, selector))
        except (WebDriverException, NoSuchWindowException):
            return False

    def _whatsapp_logado(self) -> bool:
        if self._qr_visivel():
            return False

        # O painel lateral sozinho pode surgir antes da hidratacao terminar. Exigimos
        # tambem um controle operacional real da lista/busca de conversas.
        if not self._existe_visivel(By.CSS_SELECTOR, "div#side"):
            return False

        seletores_operacionais = [
            "div#side div[aria-label='Caixa de texto de pesquisa'][contenteditable='true']",
            "div#side div[aria-label='Search input textbox'][contenteditable='true']",
            "div#side div[role='textbox'][contenteditable='true']",
            "div#pane-side",
            "div#side [data-testid='chat-list']",
        ]
        return any(
            self._existe_visivel(By.CSS_SELECTOR, selector)
            for selector in seletores_operacionais
        )

    def _qr_visivel(self) -> bool:
        seletores = [
            "div[data-testid='qrcode']",
            "div[data-ref] canvas",
            "canvas[aria-label*='QR']",
            "canvas[aria-label*='qr']",
        ]
        return any(self._existe_visivel(By.CSS_SELECTOR, seletor) for seletor in seletores)

    def _aguardar_whatsapp_pronto(self) -> None:
        logger.info("Aguardando carregamento e verificando a sessao do WhatsApp Web...")
        inicio = time.monotonic()
        ultimo_log = 0.0
        qr_avisado = False

        while time.monotonic() - inicio < settings.wait_login_seconds:
            if not qr_avisado:
                self._notificar_status("Verificando sessão.")
            if self._whatsapp_logado():
                self._notificar_status("WhatsApp conectado e pronto.")
                logger.info("WhatsApp conectado e pronto para envio.")
                return

            decorrido = int(time.monotonic() - inicio)

            if self._qr_visivel() and not qr_avisado:
                self._notificar_status("WhatsApp desconectado — leia o QR Code.")
                logger.warning("WhatsApp desconectado. Leia o QR Code; a fila permanece pausada.")
                qr_avisado = True

            if time.monotonic() - ultimo_log >= 5:
                logger.info(
                    "Ainda aguardando login/carregamento do WhatsApp Web... %ss/%ss",
                    decorrido,
                    settings.wait_login_seconds,
                )
                ultimo_log = time.monotonic()

            time.sleep(1)

        if qr_avisado:
            self._notificar_status("WhatsApp desconectado — leia o QR Code.")
        else:
            self._notificar_status("Tempo limite de carregamento excedido.")
        raise WhatsAppReadinessTimeout(qr_detectado=qr_avisado)
    def _elemento_no_escopo(self, elemento, seletor_ancestral: str) -> bool:
        try:
            return bool(
                self.driver.execute_script(
                    "return Boolean(arguments[0].closest(arguments[1]));",
                    elemento,
                    seletor_ancestral,
                )
            )
        except WebDriverException:
            return False

    def _eh_campo_pesquisa(self, elemento) -> bool:
        try:
            return (
                elemento.is_displayed()
                and elemento.is_enabled()
                and self._elemento_no_escopo(elemento, "#side")
                and not self._elemento_no_escopo(elemento, "footer")
            )
        except WebDriverException:
            return False

    def _eh_campo_composicao(self, elemento) -> bool:
        try:
            return (
                elemento.is_displayed()
                and elemento.is_enabled()
                and self._elemento_no_escopo(elemento, "#main footer")
                and not self._elemento_no_escopo(elemento, "#side")
            )
        except WebDriverException:
            return False

    def _texto_editavel(self, elemento) -> str:
        try:
            return str(
                self.driver.execute_script(
                    "return (arguments[0].innerText || arguments[0].textContent || '');",
                    elemento,
                )
                or ""
            ).strip()
        except WebDriverException:
            return str(getattr(elemento, "text", "") or "").strip()

    def _limpar_editavel(self, elemento, descricao: str) -> None:
        elemento.click()
        elemento.send_keys(Keys.CONTROL, "a")
        elemento.send_keys(Keys.BACKSPACE)
        try:
            WebDriverWait(self.driver, 2, poll_frequency=0.2).until(
                lambda _driver: not self._texto_editavel(elemento)
            )
        except TimeoutException:
            self.driver.execute_script(
                """
                const el = arguments[0];
                el.focus();
                el.textContent = '';
                el.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'deleteContentBackward'}));
                """,
                elemento,
            )
            WebDriverWait(self.driver, 2, poll_frequency=0.2).until(
                lambda _driver: not self._texto_editavel(elemento),
                f"{descricao} nao ficou vazio apos a limpeza.",
            )

    def _aguardar_conversa_pronta(self):
        logger.info("Aguardando conversa abrir e campo de mensagem ficar disponível...")
        seletores_caixa = [
            "footer div[contenteditable='true'][role='textbox']",
            "div[aria-label='Digite uma mensagem'][contenteditable='true']",
            "div[aria-label='Type a message'][contenteditable='true']",
        ]

        def encontrar_caixa(driver):
            dialogs = driver.find_elements(By.CSS_SELECTOR, "div[role='dialog'], div[data-animate-modal-popup='true']")
            for dialog in dialogs:
                texto = (dialog.text or "").lower()
                if any(palavra in texto for palavra in ["número", "numero", "phone number", "inválido", "invalid"]):
                    raise TimeoutException(f"WhatsApp informou erro na conversa: {dialog.text}")

            for seletor in seletores_caixa:
                for elemento in driver.find_elements(By.CSS_SELECTOR, seletor):
                    if self._eh_campo_composicao(elemento):
                        return elemento
            return False

        return WebDriverWait(
            self.driver,
            settings.conversation_wait_seconds,
            poll_frequency=0.5,
            ignored_exceptions=(WebDriverException,),
        ).until(encontrar_caixa, "Caixa de mensagem da conversa não ficou disponível.")

    def _clicar_botao_enviar(self) -> bool:
        seletores = [
            "button[aria-label='Enviar']",
            "button[aria-label='Send']",
            "button span[data-icon='send']",
            "span[data-icon='send']",
        ]

        def encontrar_botao(driver):
            for seletor in seletores:
                for elemento in driver.find_elements(By.CSS_SELECTOR, seletor):
                    alvo = elemento
                    if elemento.tag_name.lower() == "span":
                        try:
                            alvo = elemento.find_element(By.XPATH, "./ancestor::button[1]")
                        except WebDriverException:
                            alvo = elemento
                    if alvo.is_displayed() and alvo.is_enabled():
                        return alvo
            return False

        try:
            botao = WebDriverWait(
                self.driver,
                float(getattr(settings, "quick_send_button_wait_seconds", 3)),
                poll_frequency=0.2,
                ignored_exceptions=(WebDriverException,),
            ).until(encontrar_botao)
            botao.click()
            return True
        except TimeoutException:
            return False

    def _preencher_caixa(self, caixa, mensagem: str) -> None:
        caixa.click()
        try:
            WebDriverWait(self.driver, 2, poll_frequency=0.2).until(lambda _: caixa.is_displayed() and caixa.is_enabled())
        except TimeoutException:
            pass
        try:
            caixa.send_keys(Keys.CONTROL, "a")
            caixa.send_keys(Keys.BACKSPACE)
        except WebDriverException:
            pass

        # Digitação via clipboard tende a ser mais confiável para acentos e mensagens longas.
        try:
            self.driver.execute_script(
                """
                const el = arguments[0];
                const text = arguments[1];
                el.focus();
                document.execCommand('insertText', false, text);
                """,
                caixa,
                mensagem,
            )
        except WebDriverException:
            caixa.send_keys(mensagem)



    @staticmethod
    def _normalizar_nome_grupo_para_busca(valor: str | None) -> str:
        """Remove espaços e símbolos ordinais usados de forma diferente no cadastro/WhatsApp."""
        texto = str(valor or "").strip()
        texto = texto.replace("º", "").replace("°", "")
        texto = re.sub(r"\s+", "", texto)
        return texto

    @classmethod
    def _normalizar_nome_grupo_para_comparacao(cls, valor: str | None) -> str:
        """Normalização leve para comparar títulos encontrados no WhatsApp."""
        texto = re.sub(r"\s+", " ", str(valor or "")).strip()
        return texto.casefold()

    def _variantes_nome_grupo(self, nome_grupo: str, nome_grupo_busca: str | None = None) -> list[str]:
        variantes: list[str] = []
        for valor in [
            nome_grupo_busca,
            self._normalizar_nome_grupo_para_busca(nome_grupo),
            nome_grupo,
            str(nome_grupo or "").strip().replace("º", "").replace("°", ""),
        ]:
            valor = str(valor or "").strip()
            if valor and valor not in variantes:
                variantes.append(valor)
        return variantes[:2]


    def _clicar_possivel_botao_pesquisa(self) -> bool:
        seletores = [
            "div#side button[aria-label*='Pesquisar']",
            "div#side button[aria-label*='Search']",
            "div#side button[title*='Pesquisar']",
            "div#side button[title*='Search']",
            "div#side div[role='button'][aria-label*='Pesquisar']",
            "div#side div[role='button'][aria-label*='Search']",
            "div#side span[data-icon='search']",
        ]
        for seletor in seletores:
            try:
                for botao in self.driver.find_elements(By.CSS_SELECTOR, seletor):
                    alvo = botao
                    if botao.tag_name.lower() == "span":
                        try:
                            alvo = botao.find_element(By.XPATH, "./ancestor::*[@role='button' or self::button][1]")
                        except WebDriverException:
                            alvo = botao
                    if alvo.is_displayed() and alvo.is_enabled():
                        alvo.click()
                        return True
            except WebDriverException:
                continue
        return False

    def _localizar_compositor_visivel(self):
        seletores = [
            "div#main footer div[contenteditable='true'][role='textbox']",
            "div#main footer div[aria-label='Digite uma mensagem'][contenteditable='true']",
            "div#main footer div[aria-label='Type a message'][contenteditable='true']",
        ]
        for seletor in seletores:
            try:
                for elemento in self.driver.find_elements(By.CSS_SELECTOR, seletor):
                    if self._eh_campo_composicao(elemento):
                        return elemento
            except WebDriverException:
                continue
        return None

    def _fechar_sobreposicoes(self) -> None:
        seletor = "div[role='dialog'], div[data-animate-modal-popup='true'], div[role='menu']"
        for _tentativa in range(3):
            try:
                abertos = [
                    elemento
                    for elemento in self.driver.find_elements(By.CSS_SELECTOR, seletor)
                    if elemento.is_displayed()
                ]
            except WebDriverException:
                return
            if not abertos:
                return
            try:
                ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()
            except WebDriverException:
                return
            time.sleep(0.1)

    def resetar_estado_whatsapp(self) -> None:
        logger.info("Restaurando estado conhecido do WhatsApp antes do proximo grupo.")
        self._fechar_sobreposicoes()

        compositor = self._localizar_compositor_visivel()
        if compositor is not None:
            self.clear_message_composer(compositor)

        pesquisa = self._localizar_campo_pesquisa_aberto()
        if pesquisa is not None:
            self.clear_conversation_search(pesquisa)
            try:
                ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()
            except WebDriverException:
                pass

        self._fechar_sobreposicoes()
        logger.info("Estado do WhatsApp restaurado.")

    def _localizar_campo_pesquisa_aberto(self):
        seletores = [
            "div#side div[aria-label='Search input textbox'][contenteditable='true']",
            "div#side div[aria-label='Caixa de texto de pesquisa'][contenteditable='true']",
            "div#side div[aria-label*='Pesquisar'][contenteditable='true']",
            "div#side div[aria-label*='Search'][contenteditable='true']",
            "div#side div[aria-placeholder*='Pesquisar'][contenteditable='true']",
            "div#side div[aria-placeholder*='Search'][contenteditable='true']",
            "div#side div[role='textbox'][contenteditable='true']",
        ]
        for seletor in seletores:
            try:
                for elemento in self.driver.find_elements(By.CSS_SELECTOR, seletor):
                    if self._eh_campo_pesquisa(elemento):
                        return elemento
            except WebDriverException:
                continue
        return None

    def _abrir_pesquisa_conversas(self):
        tempo_maximo = max(
            5.0,
            float(getattr(settings, "group_search_wait_seconds", 5.0)),
        )
        fim = time.monotonic() + tempo_maximo
        clicou_botao = False
        acionou_atalho = False

        while time.monotonic() < fim:
            campo = self._localizar_campo_pesquisa_aberto()
            if campo is not None:
                logger.info("Pesquisa de conversas disponivel.")
                return campo

            if not clicou_botao:
                clicou_botao = True
                self._clicar_possivel_botao_pesquisa()
                continue

            if not acionou_atalho:
                acionou_atalho = True
                try:
                    ActionChains(self.driver).key_down(Keys.CONTROL).send_keys("k").key_up(Keys.CONTROL).perform()
                except WebDriverException:
                    pass

            time.sleep(0.2)

        raise TimeoutException(
            "Campo de pesquisa de conversas do WhatsApp nao foi encontrado no painel lateral."
        )

    def clear_conversation_search(self, campo_pesquisa=None) -> None:
        campo = campo_pesquisa or self._localizar_campo_pesquisa_aberto()
        if campo is None:
            return
        if not self._eh_campo_pesquisa(campo):
            raise TimeoutException("Elemento selecionado nao e a pesquisa de conversas.")
        self._limpar_editavel(campo, "Pesquisa de conversas")
        logger.info("Pesquisa anterior limpa.")

    def clear_message_composer(self, caixa=None) -> None:
        campo = caixa or self._localizar_compositor_visivel()
        if campo is None:
            return
        if not self._eh_campo_composicao(campo):
            raise TimeoutException("Elemento selecionado nao e o campo de mensagem.")
        tinha_rascunho = bool(self._texto_editavel(campo))
        self._limpar_editavel(campo, "Campo de mensagem")
        if tinha_rascunho:
            logger.warning("Rascunho nao enviado removido com seguranca do campo de mensagem.")
        logger.info("Campo de mensagem limpo e validado.")

    def _limpar_e_digitar_pesquisa(self, campo_pesquisa, termo: str) -> None:
        if not self._eh_campo_pesquisa(campo_pesquisa):
            raise TimeoutException("Elemento selecionado nao e a pesquisa de conversas.")
        self.clear_conversation_search(campo_pesquisa)
        campo_pesquisa.click()
        campo_pesquisa.send_keys(termo)
        esperado = self._normalizar_nome_grupo_para_comparacao(termo)
        WebDriverWait(
            self.driver,
            3,
            poll_frequency=0.2,
            ignored_exceptions=(WebDriverException,),
        ).until(
            lambda _driver: self._normalizar_nome_grupo_para_comparacao(
                self._texto_editavel(campo_pesquisa)
            ) == esperado,
            "O termo nao foi inserido na pesquisa de conversas.",
        )

    def _clicar_resultado_grupo_por_variantes(self, variantes: list[str]) -> bool:
        alvos = {
            self._normalizar_nome_grupo_para_comparacao(valor)
            for valor in variantes
            if valor
        }
        if not alvos:
            return False

        try:
            spans = self.driver.find_elements(
                By.XPATH,
                "//div[@id='side']//span[@title]",
            )
            for span in spans:
                titulo = (span.get_attribute("title") or "").strip()
                if self._normalizar_nome_grupo_para_comparacao(titulo) not in alvos:
                    continue
                try:
                    linha = span.find_element(
                        By.XPATH,
                        "./ancestor::div[@role='row' or @role='listitem' or @tabindex='0'][1]",
                    )
                except WebDriverException:
                    linha = span
                if linha.is_displayed() and linha.is_enabled():
                    linha.click()
                    logger.info("Resultado exato selecionado. ref=%s", _identificador_tecnico(titulo))
                    return True
        except WebDriverException:
            return False
        return False

    def _abrir_grupo_pelo_nome(self, nome_grupo: str, nome_grupo_busca: str | None = None) -> None:
        variantes = self._variantes_nome_grupo(nome_grupo, nome_grupo_busca)
        logger.info("Pesquisa de grupo iniciada. ref=%s", _identificador_tecnico(nome_grupo))
        ultimo_erro: BaseException | None = None

        for tentativa, termo in enumerate(variantes, start=1):
            logger.info(
                "Tentativa de pesquisa %s/%s. ref=%s",
                tentativa,
                len(variantes),
                _identificador_tecnico(nome_grupo),
            )
            try:
                self.resetar_estado_whatsapp()
                campo_pesquisa = self._abrir_pesquisa_conversas()
                self._limpar_e_digitar_pesquisa(campo_pesquisa, termo)
                WebDriverWait(
                    self.driver,
                    max(5.0, float(getattr(settings, "group_search_wait_seconds", 5.0))),
                    poll_frequency=0.25,
                    ignored_exceptions=(WebDriverException,),
                ).until(
                    lambda _driver: self._clicar_resultado_grupo_por_variantes([nome_grupo]),
                    "Resultado exato do grupo nao apareceu.",
                )
                self.validate_opened_group(nome_grupo)
                pesquisa_aberta = self._localizar_campo_pesquisa_aberto()
                if pesquisa_aberta is not None:
                    self.clear_conversation_search(pesquisa_aberta)
                logger.info("Grupo encontrado na pesquisa. ref=%s", _identificador_tecnico(nome_grupo))
                return
            except (TimeoutException, WebDriverException) as exc:
                ultimo_erro = exc
                logger.warning("Falha na tentativa de pesquisa %s. ref=%s", tentativa, _identificador_tecnico(nome_grupo))

        self.resetar_estado_whatsapp()
        raise TimeoutException(
            "Grupo do WhatsApp nao encontrado com correspondencia exata."
        ) from ultimo_erro

    def _conversa_aberta_com_titulo(self, nome_grupo: str, nome_grupo_busca: str | None = None) -> bool:
        alvos = {
            self._normalizar_nome_grupo_para_comparacao(valor)
            for valor in [nome_grupo]
            if valor
        }
        try:
            titulos = self.driver.find_elements(By.XPATH, "//div[@id='main']//header//span[@title]")
            return any(
                elemento.is_displayed()
                and self._normalizar_nome_grupo_para_comparacao(elemento.get_attribute("title") or "") in alvos
                for elemento in titulos
            )
        except WebDriverException:
            return False

    def validate_opened_group(self, nome_grupo: str) -> None:
        try:
            WebDriverWait(
                self.driver,
                settings.conversation_wait_seconds,
                poll_frequency=0.3,
                ignored_exceptions=(WebDriverException,),
            ).until(
                lambda _driver: self._conversa_aberta_com_titulo(nome_grupo),
                "O cabecalho da conversa nao corresponde ao grupo solicitado.",
            )
        except TimeoutException as exc:
            raise TimeoutException(
                "Grupo do WhatsApp nao encontrado ou cabecalho divergente."
            ) from exc
        logger.info("Grupo aberto e cabecalho validado. ref=%s", _identificador_tecnico(nome_grupo))

    def _contar_mensagens_enviadas_iguais(self, mensagem: str) -> int:
        try:
            return int(
                self.driver.execute_script(
                    """
                    const expected = String(arguments[0] || '').replace(/\r\n/g, '\n').trim();
                    const bubbles = Array.from(document.querySelectorAll('#main div.message-out'));
                    return bubbles.filter((bubble) => {
                        const content = bubble.querySelector(
                            "span.selectable-text, [data-testid='selectable-text']"
                        );
                        const text = String(
                            content ? (content.innerText || content.textContent || '') : ''
                        ).replace(/\r\n/g, '\n').trim();
                        return text === expected;
                    }).length;
                    """,
                    mensagem,
                )
                or 0
            )
        except (TypeError, ValueError, WebDriverException):
            return 0

    def _aguardar_confirmacao_envio(self, caixa, mensagem: str, quantidade_anterior: int) -> bool:
        tempo_maximo = max(5.0, float(settings.after_send_wait_seconds))
        try:
            WebDriverWait(
                self.driver,
                tempo_maximo,
                poll_frequency=0.25,
                ignored_exceptions=(WebDriverException,),
            ).until(
                lambda _driver: (
                    not self._texto_editavel(caixa)
                    and self._contar_mensagens_enviadas_iguais(mensagem) > quantidade_anterior
                ),
                "A mensagem enviada nao apareceu na conversa.",
            )
            return True
        except TimeoutException:
            return False

    def _disparar_envio(self, caixa) -> None:
        if self._clicar_botao_enviar():
            return
        logger.info("Botao enviar indisponivel; usando ENTER no compositor validado.")
        if not self._eh_campo_composicao(caixa):
            raise TimeoutException("O compositor validado deixou de estar disponivel.")
        caixa.click()
        ActionChains(self.driver).send_keys(Keys.ENTER).perform()

    def enviar_mensagem_grupo(
        self,
        nome_grupo: str,
        mensagem: str,
        nome_grupo_busca: str | None = None,
        on_send_dispatched: Callable[[], None] | None = None,
    ) -> bool:
        self.garantir_driver()
        nome_grupo = str(nome_grupo or "").strip()
        mensagem = str(mensagem or "").strip()
        nome_grupo_busca = str(nome_grupo_busca or "").strip() or self._normalizar_nome_grupo_para_busca(nome_grupo)
        if not nome_grupo or not mensagem:
            raise ValueError("Nome do grupo e mensagem são obrigatórios para envio em grupo.")

        self._abrir_grupo_pelo_nome(nome_grupo, nome_grupo_busca)
        caixa = self._aguardar_conversa_pronta()
        self.clear_message_composer(caixa)
        quantidade_anterior = self._contar_mensagens_enviadas_iguais(mensagem)
        self._preencher_caixa(caixa, mensagem)
        WebDriverWait(self.driver, 3, poll_frequency=0.2).until(
            lambda _driver: self._texto_editavel(caixa) == mensagem,
            "A mensagem nao foi inserida integralmente no compositor.",
        )
        logger.info("Mensagem digitada no compositor validado. ref=%s", _identificador_tecnico(nome_grupo))

        logger.info("Enviando mensagem para grupo. ref=%s", _identificador_tecnico(nome_grupo))
        self._disparar_envio(caixa)
        if on_send_dispatched is not None:
            on_send_dispatched()
        confirmado = self._aguardar_confirmacao_envio(caixa, mensagem, quantidade_anterior)
        if confirmado:
            logger.info("Mensagem enviada e confirmada na conversa. ref=%s", _identificador_tecnico(nome_grupo))
        else:
            logger.warning(
                "Envio disparado sem confirmacao visual; checkpoint mantido para impedir duplicidade. ref=%s",
                _identificador_tecnico(nome_grupo),
            )
        try:
            self.resetar_estado_whatsapp()
        except (TimeoutException, WebDriverException):
            logger.warning("Envio concluido, mas o reset final da interface falhou.")
        return confirmado

    def enviar_mensagem(self, telefone: str, mensagem: str) -> None:
        self.garantir_driver()
        if not telefone or not mensagem:
            raise ValueError("Telefone e mensagem são obrigatórios para envio.")

        logger.info("Abrindo conversa do telefone %s...", _mascarar_telefone(telefone))

        # Primeiro tenta URL com texto. Se o WhatsApp não preencher, o código digita manualmente.
        url = f"https://web.whatsapp.com/send?phone={telefone}&text={quote(mensagem)}&app_absent=0"
        self.driver.get(url)
        self._minimizar_janela_controlada()

        caixa = self._aguardar_conversa_pronta()

        texto_atual = (caixa.text or "").strip()
        if mensagem[:20] not in texto_atual:
            logger.info("Preenchendo mensagem manualmente no campo do WhatsApp...")
            self._preencher_caixa(caixa, mensagem)

        logger.info("Enviando mensagem...")
        if not self._clicar_botao_enviar():
            logger.info("Botão enviar não encontrado. Tentando enviar com ENTER...")
            caixa.click()
            ActionChains(self.driver).send_keys(Keys.ENTER).perform()

        time.sleep(settings.after_send_wait_seconds)
        logger.info("Mensagem enviada para %s.", _mascarar_telefone(telefone))

    def delay_entre_envios(self) -> None:
        self._delay(settings.send_min_delay_seconds, settings.send_max_delay_seconds, "envio")

    def fechar(self) -> None:
        try:
            if self.driver is not None:
                self.driver.quit()
        except WebDriverException:
            pass
        finally:
            self.driver = None

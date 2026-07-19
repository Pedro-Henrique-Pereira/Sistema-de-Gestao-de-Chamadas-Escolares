from __future__ import annotations

import logging
import hashlib
import random
import time
from pathlib import Path
from urllib.parse import quote
import re

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


def _identificador_tecnico(valor: str | None) -> str:
    return hashlib.sha256(str(valor or "").encode("utf-8")).hexdigest()[:10]


def _mascarar_telefone(valor: str | None) -> str:
    digits = re.sub(r"\D", "", str(valor or ""))
    return f"{digits[:2]}*******{digits[-2:]}" if len(digits) >= 4 else "***"


class WhatsAppService:
    def __init__(self) -> None:
        self.driver = self._build_driver()
        self.driver.set_page_load_timeout(settings.page_load_timeout_seconds)
        self.wait = WebDriverWait(self.driver, settings.page_load_timeout_seconds)
        try:
            self.driver.implicitly_wait(0)
        except WebDriverException:
            pass

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

    def _build_driver(self):
        browser = settings.browser
        profile_dir = settings.resolved_user_data_dir
        profile_dir.mkdir(parents=True, exist_ok=True)

        logger.info("Iniciando driver do navegador: %s", browser)
        logger.info("Perfil persistente do WhatsApp: %s", profile_dir)

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
            options.add_argument("--start-maximized")
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
            options.add_argument("--start-maximized")
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
        self.garantir_driver()
        logger.info("Abrindo WhatsApp Web...")
        self.driver.get(WHATSAPP_WEB_URL)
        self._aguardar_whatsapp_pronto()

    def _existe(self, by: By, selector: str) -> bool:
        try:
            return len(self.driver.find_elements(by, selector)) > 0
        except (WebDriverException, NoSuchWindowException):
            return False

    def _whatsapp_logado(self) -> bool:
        # div#side é o painel lateral de conversas. É um dos sinais mais estáveis de login concluído.
        if self._existe(By.CSS_SELECTOR, "div#side"):
            return True

        # Fallback: caixa de busca/lista do WhatsApp ou campo de conversa.
        seletores = [
            "div[aria-label='Caixa de texto de pesquisa'][contenteditable='true']",
            "div[aria-label='Search input textbox'][contenteditable='true']",
            "footer div[contenteditable='true'][role='textbox']",
            "div[aria-label='Digite uma mensagem'][contenteditable='true']",
            "div[aria-label='Type a message'][contenteditable='true']",
        ]
        return any(self._existe(By.CSS_SELECTOR, selector) for selector in seletores)

    def _qr_visivel(self) -> bool:
        # Em pt-BR/inglês o QR costuma aparecer como canvas. A checagem é usada apenas para log.
        return self._existe(By.CSS_SELECTOR, "canvas") or self._existe(By.CSS_SELECTOR, "div[data-testid='qrcode']")

    def _aguardar_whatsapp_pronto(self) -> None:
        logger.info("Aguardando WhatsApp Web carregar/login...")
        inicio = time.monotonic()
        ultimo_log = 0.0
        qr_avisado = False

        while time.monotonic() - inicio < settings.wait_login_seconds:
            if self._whatsapp_logado():
                logger.info("WhatsApp Web pronto para envio.")
                return

            decorrido = int(time.monotonic() - inicio)

            if self._qr_visivel() and not qr_avisado:
                logger.info("QR Code detectado. Escaneie com o celular e aguarde; o robô continuará sozinho após o login.")
                qr_avisado = True

            if time.monotonic() - ultimo_log >= 5:
                logger.info(
                    "Ainda aguardando login/carregamento do WhatsApp Web... %ss/%ss",
                    decorrido,
                    settings.wait_login_seconds,
                )
                ultimo_log = time.monotonic()

            time.sleep(1)

        screenshot = BASE_DIR / "logs" / "whatsapp_timeout.png"
        try:
            screenshot.parent.mkdir(exist_ok=True)
            self.driver.save_screenshot(str(screenshot))
            logger.error("Screenshot do timeout salvo em: %s", screenshot)
        except WebDriverException:
            pass

        raise TimeoutException(
            "WhatsApp Web não ficou pronto. Verifique se o QR Code foi escaneado, se há internet e se a janela não foi fechada."
        )

    def _aguardar_conversa_pronta(self):
        logger.info("Aguardando conversa abrir e campo de mensagem ficar disponível...")
        seletores_caixa = [
            "footer div[contenteditable='true'][role='textbox']",
            "div[aria-label='Digite uma mensagem'][contenteditable='true']",
            "div[aria-label='Type a message'][contenteditable='true']",
            "div[contenteditable='true'][role='textbox']",
        ]

        def encontrar_caixa(driver):
            dialogs = driver.find_elements(By.CSS_SELECTOR, "div[role='dialog'], div[data-animate-modal-popup='true']")
            for dialog in dialogs:
                texto = (dialog.text or "").lower()
                if any(palavra in texto for palavra in ["número", "numero", "phone number", "inválido", "invalid"]):
                    raise TimeoutException(f"WhatsApp informou erro na conversa: {dialog.text}")

            for seletor in seletores_caixa:
                for elemento in driver.find_elements(By.CSS_SELECTOR, seletor):
                    if elemento.is_displayed() and elemento.is_enabled():
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
    def _xpath_literal(texto: str) -> str:
        if "'" not in texto:
            return f"'{texto}'"
        if '"' not in texto:
            return f'"{texto}"'
        partes = texto.split("'")
        return "concat(" + ', "\'", '.join(f"'{parte}'" for parte in partes) + ")"

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
        return cls._normalizar_nome_grupo_para_busca(valor).casefold()

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


    def _elemento_focado_editavel(self):
        """Retorna o elemento focado se ele for uma caixa editável do WhatsApp."""
        try:
            elemento = self.driver.switch_to.active_element
            if not elemento:
                return None
            tag = (elemento.tag_name or "").lower()
            contenteditable = (elemento.get_attribute("contenteditable") or "").lower()
            role = (elemento.get_attribute("role") or "").lower()
            if contenteditable == "true" or role == "textbox" or tag in {"input", "textarea"}:
                return elemento
        except WebDriverException:
            return None
        return None

    def _buscar_editaveis_visiveis_por_js(self):
        """Busca caixas editáveis visíveis sem depender de data-tab/aria-label fixo."""
        try:
            return self.driver.execute_script(
                """
                const nodes = Array.from(document.querySelectorAll(
                    "div[contenteditable='true'], [role='textbox'], textarea, input[type='text']"
                ));

                function visible(el) {
                    const r = el.getBoundingClientRect();
                    const st = window.getComputedStyle(el);
                    return r.width > 20 && r.height > 10 &&
                           st.display !== 'none' && st.visibility !== 'hidden' &&
                           el.offsetParent !== null;
                }

                return nodes.filter(visible).sort((a, b) => {
                    const ar = a.getBoundingClientRect();
                    const br = b.getBoundingClientRect();

                    const aSide = !!a.closest('#side');
                    const bSide = !!b.closest('#side');
                    if (aSide !== bSide) return aSide ? -1 : 1;

                    const aSearch = ((a.getAttribute('aria-label') || '') + ' ' +
                                     (a.getAttribute('aria-placeholder') || '') + ' ' +
                                     (a.getAttribute('placeholder') || '')).toLowerCase();
                    const bSearch = ((b.getAttribute('aria-label') || '') + ' ' +
                                     (b.getAttribute('aria-placeholder') || '') + ' ' +
                                     (b.getAttribute('placeholder') || '')).toLowerCase();

                    const ak = /pesquis|search|buscar|start new chat|começar/.test(aSearch) ? 0 : 1;
                    const bk = /pesquis|search|buscar|start new chat|começar/.test(bSearch) ? 0 : 1;
                    if (ak !== bk) return ak - bk;

                    return ar.top - br.top;
                });
                """
            ) or []
        except WebDriverException:
            return []

    def _clicar_possivel_botao_pesquisa(self) -> bool:
        seletores = [
            "button[aria-label*='Pesquisar']",
            "button[aria-label*='Search']",
            "button[title*='Pesquisar']",
            "button[title*='Search']",
            "div[role='button'][aria-label*='Pesquisar']",
            "div[role='button'][aria-label*='Search']",
            "span[data-icon='search']",
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

    def _acionar_atalho_pesquisa(self) -> None:
        """Abre a busca do WhatsApp por atalhos. Isso evita depender do botão/placeholder."""
        tentativas = [
            lambda: ActionChains(self.driver).key_down(Keys.CONTROL).key_down(Keys.ALT).send_keys("/").key_up(Keys.ALT).key_up(Keys.CONTROL).perform(),
            lambda: ActionChains(self.driver).key_down(Keys.CONTROL).send_keys("k").key_up(Keys.CONTROL).perform(),
            lambda: ActionChains(self.driver).send_keys("/").perform(),
        ]
        for tentativa in tentativas:
            try:
                tentativa()
                focado = self._elemento_focado_editavel()
                if focado:
                    return
            except WebDriverException:
                continue

    def _encontrar_campo_pesquisa(self):
        """Localiza a busca lateral do WhatsApp Web com fallback por atalhos e JS.

        O erro anterior ocorria porque o WhatsApp mudou data-tab/aria-label.
        Esta versão não depende de um único seletor: tenta abrir a busca por atalho,
        clica no botão de pesquisa quando existir e, por último, varre todos os
        textboxes/contenteditable visíveis por JavaScript.
        """
        try:
            if "web.whatsapp.com" not in (self.driver.current_url or ""):
                self.driver.get(WHATSAPP_WEB_URL)
        except WebDriverException:
            self.driver.get(WHATSAPP_WEB_URL)

        seletores_css = [
            "div[aria-label='Search input textbox'][contenteditable='true']",
            "div[aria-label='Caixa de texto de pesquisa'][contenteditable='true']",
            "div[aria-label*='Pesquisar'][contenteditable='true']",
            "div[aria-label*='Search'][contenteditable='true']",
            "div[aria-placeholder*='Pesquisar'][contenteditable='true']",
            "div[aria-placeholder*='Search'][contenteditable='true']",
            "div#side div[role='textbox'][contenteditable='true']",
            "div#side div[contenteditable='true']",
            "div[role='textbox'][contenteditable='true']",
        ]
        xpaths = [
            "//div[@id='side']//div[@contenteditable='true' and @role='textbox']",
            "//div[@id='side']//div[@contenteditable='true']",
            "//div[@contenteditable='true' and contains(translate(@aria-label, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'search')]",
            "//div[@contenteditable='true' and contains(translate(@aria-label, 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÂÊÔÃÕÇ', 'abcdefghijklmnopqrstuvwxyzáéíóúâêôãõç'), 'pesquis')]",
        ]

        fim = time.monotonic() + float(getattr(settings, "group_search_wait_seconds", 1.5))
        acionou_atalho = False
        clicou_pesquisa = False

        while time.monotonic() < fim:
            for seletor in seletores_css:
                try:
                    for elemento in self.driver.find_elements(By.CSS_SELECTOR, seletor):
                        if elemento.is_displayed() and elemento.is_enabled():
                            return elemento
                except WebDriverException:
                    continue

            for xpath in xpaths:
                try:
                    for elemento in self.driver.find_elements(By.XPATH, xpath):
                        if elemento.is_displayed() and elemento.is_enabled():
                            return elemento
                except WebDriverException:
                    continue

            focado = self._elemento_focado_editavel()
            if focado:
                return focado

            editaveis = self._buscar_editaveis_visiveis_por_js()
            for elemento in editaveis:
                try:
                    if elemento.is_displayed() and elemento.is_enabled():
                        return elemento
                except WebDriverException:
                    continue

            if not clicou_pesquisa:
                clicou_pesquisa = True
                self._clicar_possivel_botao_pesquisa()

            if not acionou_atalho:
                acionou_atalho = True
                self._acionar_atalho_pesquisa()

            time.sleep(0.5)

        try:
            self.driver.save_screenshot(str(BASE_DIR / "erro_campo_pesquisa_whatsapp.png"))
            logger.error("Screenshot salvo em erro_campo_pesquisa_whatsapp.png")
        except WebDriverException:
            pass

        raise TimeoutException(
            "Campo de pesquisa do WhatsApp não foi encontrado. "
            "Confirme se o WhatsApp Web está logado, se não há tela de atualização/QR Code "
            "e se a lista de conversas aparece no painel esquerdo."
        )

    def _limpar_e_digitar_pesquisa(self, campo_pesquisa, termo: str) -> None:
        campo_pesquisa.click()
        try:
            WebDriverWait(self.driver, 2, poll_frequency=0.2).until(lambda _: campo_pesquisa.is_displayed() and campo_pesquisa.is_enabled())
        except TimeoutException:
            pass
        try:
            campo_pesquisa.send_keys(Keys.CONTROL, "a")
            campo_pesquisa.send_keys(Keys.BACKSPACE)
        except WebDriverException:
            pass

        try:
            self.driver.execute_script(
                """
                const el = arguments[0];
                const text = arguments[1];
                el.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('delete', false, null);
                document.execCommand('insertText', false, text);
                el.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: text}));
                """,
                campo_pesquisa,
                termo,
            )
        except WebDriverException:
            campo_pesquisa.send_keys(termo)

    def _clicar_resultado_grupo_por_variantes(self, variantes: list[str]) -> bool:
        alvos = {self._normalizar_nome_grupo_para_comparacao(valor) for valor in variantes if valor}
        if not alvos:
            return False

        try:
            spans = self.driver.find_elements(By.XPATH, "//span[@title]")
            primeiro_resultado = None

            for span in spans:
                titulo = (span.get_attribute("title") or "").strip()
                if not titulo:
                    continue

                try:
                    linha = span.find_element(
                        By.XPATH,
                        "./ancestor::div[@role='row' or @tabindex='0' or contains(@class, 'x10l6tqk')][1]",
                    )
                except WebDriverException:
                    linha = span

                if linha.is_displayed() and primeiro_resultado is None:
                    primeiro_resultado = (linha, titulo)

                titulo_normalizado = self._normalizar_nome_grupo_para_comparacao(titulo)
                if titulo_normalizado in alvos and linha.is_displayed():
                    linha.click()
                    time.sleep(0.15)
                    logger.info("Grupo encontrado e aberto. ref=%s", _identificador_tecnico(titulo))
                    return True

            # Otimização: se a busca já filtrou resultados, abre o primeiro visível em vez de esperar vários fallbacks.
            if primeiro_resultado is not None:
                linha, titulo = primeiro_resultado
                linha.click()
                time.sleep(0.15)
                logger.info("Primeiro resultado visível aberto após busca. ref=%s", _identificador_tecnico(titulo))
                return True
        except WebDriverException:
            return False

        return False

    def _abrir_grupo_pelo_nome(self, nome_grupo: str, nome_grupo_busca: str | None = None) -> None:
        variantes = self._variantes_nome_grupo(nome_grupo, nome_grupo_busca)
        logger.info("Pesquisando grupo do WhatsApp. ref=%s", _identificador_tecnico(nome_grupo))

        campo_pesquisa = self._encontrar_campo_pesquisa()

        for termo in variantes:
            logger.info("Tentando localizar grupo. ref=%s", _identificador_tecnico(termo))
            self._limpar_e_digitar_pesquisa(campo_pesquisa, termo)
            time.sleep(0.25)

            if self._clicar_resultado_grupo_por_variantes(variantes):
                return

            nome_xpath = self._xpath_literal(termo)
            candidatos_xpath = [
                f"//span[@title={nome_xpath}]/ancestor::div[@role='row' or @tabindex='0'][1]",
                f"//span[@title={nome_xpath}]",
            ]

            fim = time.monotonic() + float(getattr(settings, "group_search_wait_seconds", 1.5))
            while time.monotonic() < fim:
                for xpath in candidatos_xpath:
                    try:
                        elementos = self.driver.find_elements(By.XPATH, xpath)
                        for elemento in elementos:
                            if elemento.is_displayed():
                                elemento.click()
                                time.sleep(0.15)
                                logger.info("Grupo encontrado e aberto. ref=%s", _identificador_tecnico(termo))
                                return
                    except WebDriverException:
                        continue

                try:
                    if self._conversa_aberta_com_titulo(nome_grupo, nome_grupo_busca):
                        logger.info("Grupo já estava aberto. ref=%s", _identificador_tecnico(nome_grupo))
                        return
                except WebDriverException:
                    pass

                time.sleep(0.3)

            # Se a busca encontrou apenas um resultado, ENTER costuma abrir a conversa.
            try:
                ActionChains(self.driver).send_keys(Keys.ENTER).perform()
                time.sleep(0.15)
                if self._conversa_aberta_com_titulo(nome_grupo, nome_grupo_busca):
                    logger.info("Grupo aberto pela tecla ENTER. ref=%s", _identificador_tecnico(termo))
                    return
            except WebDriverException:
                pass

        raise TimeoutException(
            "Grupo do WhatsApp não encontrado. "
            f"Referência técnica: {_identificador_tecnico(nome_grupo)}. "
            "Confira se o grupo aparece na lista do WhatsApp Web desta conta."
        )

    def _conversa_aberta_com_titulo(self, nome_grupo: str, nome_grupo_busca: str | None = None) -> bool:
        alvos = {
            self._normalizar_nome_grupo_para_comparacao(valor)
            for valor in self._variantes_nome_grupo(nome_grupo, nome_grupo_busca)
            if valor
        }
        try:
            titulos = self.driver.find_elements(By.XPATH, "//header//span[@title]")
            return any(
                self._normalizar_nome_grupo_para_comparacao(elemento.get_attribute("title") or "") in alvos
                for elemento in titulos
            )
        except WebDriverException:
            return False

    def enviar_mensagem_grupo(self, nome_grupo: str, mensagem: str, nome_grupo_busca: str | None = None) -> None:
        self.garantir_driver()
        nome_grupo = str(nome_grupo or "").strip()
        mensagem = str(mensagem or "").strip()
        nome_grupo_busca = str(nome_grupo_busca or "").strip() or self._normalizar_nome_grupo_para_busca(nome_grupo)
        if not nome_grupo or not mensagem:
            raise ValueError("Nome do grupo e mensagem são obrigatórios para envio em grupo.")

        self._abrir_grupo_pelo_nome(nome_grupo, nome_grupo_busca)
        caixa = self._aguardar_conversa_pronta()
        self._preencher_caixa(caixa, mensagem)

        logger.info("Enviando mensagem para grupo. ref=%s", _identificador_tecnico(nome_grupo))
        if not self._clicar_botao_enviar():
            logger.info("Botão enviar não encontrado. Tentando enviar com ENTER...")
            caixa.click()
            ActionChains(self.driver).send_keys(Keys.ENTER).perform()

        time.sleep(settings.after_send_wait_seconds)
        logger.info("Mensagem enviada para o grupo. ref=%s", _identificador_tecnico(nome_grupo))

    def enviar_mensagem(self, telefone: str, mensagem: str) -> None:
        self.garantir_driver()
        if not telefone or not mensagem:
            raise ValueError("Telefone e mensagem são obrigatórios para envio.")

        logger.info("Abrindo conversa do telefone %s...", _mascarar_telefone(telefone))

        # Primeiro tenta URL com texto. Se o WhatsApp não preencher, o código digita manualmente.
        url = f"https://web.whatsapp.com/send?phone={telefone}&text={quote(mensagem)}&app_absent=0"
        self.driver.get(url)

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

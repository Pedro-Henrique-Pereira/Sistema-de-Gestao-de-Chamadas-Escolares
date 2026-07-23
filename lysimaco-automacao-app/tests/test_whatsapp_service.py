import unittest
from types import SimpleNamespace
from unittest.mock import patch

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

from automacao.main_automacao import processar_solicitacao
from automacao.services.api_service import EntregaAutomacao, TarefaAutomacao
from automacao.services.whatsapp_service import WhatsAppService


class FakeElement:
    def __init__(self, *, title="", text="", scopes=()):
        self.title = title
        self.text = text
        self.scopes = set(scopes)
        self.clicked = False
        self.enabled = True
        self.displayed = True
        self._selected_all = False

    def is_displayed(self):
        return self.displayed

    def is_enabled(self):
        return self.enabled

    def click(self):
        self.clicked = True

    def get_attribute(self, name):
        if name == "title":
            return self.title
        if name == "contenteditable":
            return "true"
        if name == "role":
            return "textbox"
        return None

    def find_element(self, _by, _selector):
        return self

    def send_keys(self, *keys):
        if keys == (Keys.CONTROL, "a"):
            self._selected_all = True
            return
        if keys == (Keys.BACKSPACE,):
            if self._selected_all:
                self.text = ""
            self._selected_all = False
            return
        self.text += "".join(str(value) for value in keys)


class FakeDriver:
    def __init__(self):
        self.search_fields = []
        self.composers = []
        self.result_titles = []
        self.header_titles = []

    def execute_script(self, script, *args):
        if "closest(arguments[1])" in script:
            element, selector = args
            return selector in element.scopes
        if "innerText || arguments[0].textContent" in script:
            return args[0].text
        if "el.textContent = ''" in script:
            args[0].text = ""
            return None
        return 0

    def find_elements(self, by, selector):
        if by == By.XPATH and selector == "//div[@id='side']//span[@title]":
            return self.result_titles
        if by == By.XPATH and selector == "//div[@id='main']//header//span[@title]":
            return self.header_titles
        if by == By.CSS_SELECTOR and "div#side" in selector:
            return self.search_fields
        if by == By.CSS_SELECTOR and "div#main footer" in selector:
            return self.composers
        if by == By.CSS_SELECTOR and "role='dialog'" in selector:
            return []
        return []


def service_with_driver(driver):
    service = WhatsAppService.__new__(WhatsAppService)
    service.driver = driver
    return service


class WhatsAppSelectorsTest(unittest.TestCase):
    def test_search_and_composer_are_mutually_exclusive(self):
        driver = FakeDriver()
        service = service_with_driver(driver)
        search = FakeElement(scopes={"#side"})
        composer = FakeElement(scopes={"#main footer", "footer"})

        self.assertTrue(service._eh_campo_pesquisa(search))
        self.assertFalse(service._eh_campo_pesquisa(composer))
        self.assertTrue(service._eh_campo_composicao(composer))
        self.assertFalse(service._eh_campo_composicao(search))

    def test_search_locator_rejects_composer_even_if_returned_by_driver(self):
        driver = FakeDriver()
        composer = FakeElement(scopes={"#main footer", "footer"})
        driver.search_fields = [composer]
        service = service_with_driver(driver)

        self.assertIsNone(service._localizar_campo_pesquisa_aberto())

    def test_only_exact_group_result_is_clicked(self):
        driver = FakeDriver()
        similar = FakeElement(title="Grupo 1 A", scopes={"#side"})
        exact = FakeElement(title="  gRuPo   1  ", scopes={"#side"})
        driver.result_titles = [similar, exact]
        service = service_with_driver(driver)

        self.assertTrue(service._clicar_resultado_grupo_por_variantes(["Grupo 1"]))
        self.assertFalse(similar.clicked)
        self.assertTrue(exact.clicked)

    def test_header_validation_rejects_partial_name(self):
        driver = FakeDriver()
        driver.header_titles = [FakeElement(title="Grupo 1 A", scopes={"#main"})]
        service = service_with_driver(driver)
        self.assertFalse(service._conversa_aberta_com_titulo("Grupo 1"))

        driver.header_titles = [FakeElement(title="  GRUPO   1 ", scopes={"#main"})]
        self.assertTrue(service._conversa_aberta_com_titulo("Grupo 1"))

    def test_composer_cleanup_removes_only_unsent_text(self):
        driver = FakeDriver()
        composer = FakeElement(text="old draft", scopes={"#main footer", "footer"})
        service = service_with_driver(driver)

        service.clear_message_composer(composer)

        self.assertEqual(composer.text, "")


class FlowService(WhatsAppService):
    def __init__(self):
        self.driver = object()
        self.composer = FakeElement(text="legacy draft", scopes={"#main footer", "footer"})
        self.events = []
        self.sent_count = 0

    def garantir_driver(self):
        self.events.append("driver")

    def _abrir_grupo_pelo_nome(self, nome_grupo, _nome_grupo_busca=None):
        self.resetar_estado_whatsapp()
        self.events.append(f"open:{nome_grupo}")

    def _aguardar_conversa_pronta(self):
        return self.composer

    def clear_message_composer(self, _caixa=None):
        self.composer.text = ""
        self.events.append("clear-composer")

    def _contar_mensagens_enviadas_iguais(self, _mensagem):
        return self.sent_count

    def _preencher_caixa(self, _caixa, mensagem):
        self.composer.text = mensagem
        self.events.append("typed")

    def _texto_editavel(self, _elemento):
        return self.composer.text

    def _disparar_envio(self, _caixa):
        self.events.append("dispatch")
        self.composer.text = ""
        self.sent_count += 1

    def _aguardar_confirmacao_envio(self, _caixa, _mensagem, quantidade_anterior):
        self.events.append("confirmed")
        return self.sent_count > quantidade_anterior and not self.composer.text

    def resetar_estado_whatsapp(self):
        self.composer.text = ""
        self.events.append("reset")


class WhatsAppMultiGroupFlowTest(unittest.TestCase):
    def test_two_groups_do_not_accumulate_drafts_and_checkpoint_once_each(self):
        service = FlowService()
        checkpoints = []

        first = service.enviar_mensagem_grupo(
            "Grupo 1",
            "Mensagem oficial",
            on_send_dispatched=lambda: checkpoints.append(1),
        )
        service.composer.text = "stale second draft"
        second = service.enviar_mensagem_grupo(
            "Grupo 2",
            "Mensagem oficial",
            on_send_dispatched=lambda: checkpoints.append(2),
        )

        self.assertTrue(first)
        self.assertTrue(second)
        self.assertEqual(checkpoints, [1, 2])
        self.assertEqual(service.composer.text, "")
        self.assertEqual(service.events.count("dispatch"), 2)
        self.assertEqual(service.events.count("confirmed"), 2)

class FakeApiClient:
    def __init__(self):
        self.results = []

    def heartbeat(self, _state, current_task_id=None):
        return {"task": current_task_id}

    def registrar_resultado(
        self,
        entrega_id,
        status,
        erro_codigo=None,
        external_id=None,
    ):
        self.results.append((entrega_id, status, erro_codigo, external_id))
        return {"ok": True}


class FakeReceiptJournal:
    def __init__(self):
        self.pending = []

    def record(self, entrega_id, status):
        if not any(item[0] == entrega_id for item in self.pending):
            self.pending.append((entrega_id, status))

    def flush(self, api_client):
        pending = list(self.pending)
        self.pending.clear()
        for entrega_id, status in pending:
            api_client.registrar_resultado(
                entrega_id,
                status,
                external_id=f"local-{entrega_id}",
            )
        return len(pending)


class PartiallyFailingWhatsApp:
    def __init__(self):
        self.processed = []
        self.reset_count = 0

    def enviar_mensagem_grupo(
        self,
        nome_grupo,
        _mensagem,
        nome_grupo_busca=None,
        on_send_dispatched=None,
    ):
        self.processed.append(nome_grupo)
        if nome_grupo == "Grupo ausente":
            raise TimeoutException("Grupo do WhatsApp nao encontrado.")
        if on_send_dispatched is not None:
            on_send_dispatched()
        return True

    def resetar_estado_whatsapp(self):
        self.reset_count += 1

    def delay_entre_envios(self):
        return None


class GroupFailureIsolationTest(unittest.TestCase):
    def test_failure_in_one_group_does_not_stop_the_next_group(self):
        task = TarefaAutomacao(
            id=900,
            api_version=2,
            tipo="mensagem_grupo",
            status="executando",
            entregas=(
                EntregaAutomacao(1, "grupo", "Mensagem", 1, nome_grupo="Grupo ausente"),
                EntregaAutomacao(2, "grupo", "Mensagem", 1, nome_grupo="Grupo correto"),
            ),
            resumo={"total": 2},
        )
        api_client = FakeApiClient()
        journal = FakeReceiptJournal()
        whatsapp = PartiallyFailingWhatsApp()

        with patch("automacao.main_automacao.settings", SimpleNamespace(dry_run=False)):
            completed_without_failures = processar_solicitacao(
                task,
                api_client,
                journal,
                whatsapp=whatsapp,
            )

        self.assertFalse(completed_without_failures)
        self.assertEqual(whatsapp.processed, ["Grupo ausente", "Grupo correto"])
        self.assertGreaterEqual(whatsapp.reset_count, 1)
        self.assertEqual(api_client.results[0][0:3], (1, "erro", "GROUP_NOT_FOUND"))
        self.assertEqual(api_client.results[1][0:2], (2, "enviado"))


if __name__ == "__main__":
    unittest.main()

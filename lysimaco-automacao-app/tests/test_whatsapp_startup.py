import unittest
from types import SimpleNamespace
from unittest.mock import patch

from selenium.common.exceptions import WebDriverException

from automacao.main_automacao import capturar_tarefa_com_whatsapp_pronto
from automacao.services.whatsapp_service import (
    WhatsAppReadinessTimeout,
    WhatsAppService,
)


class FakeSwitchTo:
    def __init__(self, driver):
        self.driver = driver
        self.calls = []

    def window(self, handle):
        self.calls.append(handle)
        self.driver.current_window_handle = handle


class FakeTabDriver:
    def __init__(self, urls, current="main", fail_get=False):
        self.session_id = "fake-session"
        self.urls = dict(urls)
        self.window_handles = list(urls)
        self.current_window_handle = current
        self.switch_to = FakeSwitchTo(self)
        self.fail_get = fail_get
        self.get_calls = 0
        self.minimize_calls = 0
        self.page_load_timeout = None
        self.implicit_wait_seconds = None

    @property
    def current_url(self):
        return self.urls[self.current_window_handle]

    def get(self, url):
        self.get_calls += 1
        if self.fail_get:
            raise WebDriverException("open failed")
        self.urls[self.current_window_handle] = url
    def minimize_window(self):
        self.minimize_calls += 1

    def set_page_load_timeout(self, seconds):
        self.page_load_timeout = seconds

    def implicitly_wait(self, seconds):
        self.implicit_wait_seconds = seconds


class FakeWhatsapp:
    def __init__(self, events, *, ready=True):
        self.events = events
        self.ready = ready
        self.closed = False

    def driver_esta_vivo(self):
        return True

    def abrir_whatsapp(self):
        self.events.append("whatsapp-ready-check")
        if not self.ready:
            raise WhatsAppReadinessTimeout(qr_detectado=True)

    def fechar(self):
        self.closed = True


class FakeApi:
    def __init__(self, machine_id, events):
        self.machine_id = machine_id
        self.events = events
        self.pending = [f"task-machine-{machine_id}"]
        self.claim_count = 0

    def heartbeat(self, state):
        self.events.append(f"heartbeat:{self.machine_id}:{state}")
        return {"state": state}

    def capturar_tarefa(self):
        self.events.append(f"claim:{self.machine_id}")
        self.claim_count += 1
        return self.pending.pop(0) if self.pending else None


class WhatsAppWindowStartupTest(unittest.TestCase):
    def _service(self, driver, states):
        service = WhatsAppService.__new__(WhatsAppService)
        service.driver = driver
        service.status_callback = states.append
        service._aguardar_whatsapp_pronto = lambda: service._notificar_status(
            "WhatsApp conectado e pronto."
        )
        return service

    def test_closed_whatsapp_opens_once_and_waits_until_ready(self):
        states = []
        driver = FakeTabDriver({"main": "about:blank"})
        service = self._service(driver, states)

        service.abrir_whatsapp()

        self.assertEqual(driver.get_calls, 1)
        self.assertEqual(driver.minimize_calls, 1)
        self.assertEqual(driver.current_url, "https://web.whatsapp.com/")
        self.assertEqual(
            states,
            [
                "Abrindo WhatsApp.",
                "Aguardando carregamento.",
                "WhatsApp conectado e pronto.",
            ],
        )

    def test_existing_whatsapp_tab_is_reused_without_reload_or_new_tab(self):
        states = []
        driver = FakeTabDriver(
            {"main": "about:blank", "whatsapp": "https://web.whatsapp.com/"}
        )
        initial_handles = tuple(driver.window_handles)
        service = self._service(driver, states)

        service.abrir_whatsapp()

        self.assertEqual(driver.get_calls, 0)
        self.assertEqual(driver.minimize_calls, 1)
        self.assertEqual(tuple(driver.window_handles), initial_handles)
        self.assertEqual(driver.current_window_handle, "whatsapp")
        self.assertEqual(states[-1], "WhatsApp conectado e pronto.")

    def test_current_whatsapp_tab_is_checked_without_switching_or_restoring_window(self):
        states = []
        driver = FakeTabDriver(
            {"main": "about:blank", "whatsapp": "https://web.whatsapp.com/"},
            current="whatsapp",
        )
        service = self._service(driver, states)

        service.abrir_whatsapp()

        self.assertEqual(driver.switch_to.calls, [])
        self.assertEqual(driver.get_calls, 0)
        self.assertEqual(driver.minimize_calls, 0)

    def test_new_driver_is_minimized_immediately(self):
        driver = FakeTabDriver({"main": "about:blank"})

        with patch.object(WhatsAppService, "_build_driver", return_value=driver), patch(
            "automacao.services.whatsapp_service.settings",
            SimpleNamespace(page_load_timeout_seconds=20, headless=False),
        ):
            service = WhatsAppService()

        self.assertIs(service.driver, driver)
        self.assertEqual(driver.minimize_calls, 1)
        self.assertEqual(driver.page_load_timeout, 20)
    def test_open_failure_reports_clear_state(self):
        states = []
        driver = FakeTabDriver({"main": "about:blank"}, fail_get=True)
        service = self._service(driver, states)

        with self.assertRaises(WebDriverException):
            service.abrir_whatsapp()

        self.assertEqual(states[-1], "Falha ao abrir o WhatsApp.")


class VisibleElement:
    def is_displayed(self):
        return True


class FakeDomDriver:
    def __init__(self, visible_selectors):
        self.visible_selectors = set(visible_selectors)

    def find_elements(self, _by, selector):
        return [VisibleElement()] if selector in self.visible_selectors else []


class WhatsAppOperationalElementsTest(unittest.TestCase):
    def test_side_panel_alone_is_not_enough_to_release_queue(self):
        service = WhatsAppService.__new__(WhatsAppService)
        service.driver = FakeDomDriver({"div#side"})
        self.assertFalse(service._whatsapp_logado())

        service.driver = FakeDomDriver(
            {"div#side", "div#pane-side", "div[data-testid='qrcode']"}
        )
        self.assertFalse(service._whatsapp_logado())

        service.driver = FakeDomDriver({"div#side", "div#pane-side"})
        self.assertTrue(service._whatsapp_logado())

    def test_qr_detection_uses_scoped_real_interface_elements(self):
        service = WhatsAppService.__new__(WhatsAppService)
        service.driver = FakeDomDriver({"div[data-testid='qrcode']"})
        self.assertTrue(service._qr_visivel())

class WhatsAppReadinessStateTest(unittest.TestCase):
    def _service(self, states, *, logged_in, qr_visible):
        service = WhatsAppService.__new__(WhatsAppService)
        service.status_callback = states.append
        service._whatsapp_logado = lambda: logged_in
        service._qr_visivel = lambda: qr_visible
        return service

    @staticmethod
    def _clock():
        ticks = iter((0.0, 0.0, 0.0, 0.0, 2.0))
        return lambda: next(ticks, 2.0)

    def test_qr_code_pauses_and_reports_disconnected(self):
        states = []
        service = self._service(states, logged_in=False, qr_visible=True)

        with patch(
            "automacao.services.whatsapp_service.settings",
            SimpleNamespace(wait_login_seconds=1),
        ), patch(
            "automacao.services.whatsapp_service.time.monotonic",
            side_effect=self._clock(),
        ), patch("automacao.services.whatsapp_service.time.sleep"):
            with self.assertRaises(WhatsAppReadinessTimeout) as raised:
                service._aguardar_whatsapp_pronto()

        self.assertTrue(raised.exception.qr_detectado)
        self.assertIn("WhatsApp desconectado — leia o QR Code.", states)

    def test_loading_failure_ends_with_safe_timeout(self):
        states = []
        service = self._service(states, logged_in=False, qr_visible=False)

        with patch(
            "automacao.services.whatsapp_service.settings",
            SimpleNamespace(wait_login_seconds=1),
        ), patch(
            "automacao.services.whatsapp_service.time.monotonic",
            side_effect=self._clock(),
        ), patch("automacao.services.whatsapp_service.time.sleep"):
            with self.assertRaises(WhatsAppReadinessTimeout) as raised:
                service._aguardar_whatsapp_pronto()

        self.assertFalse(raised.exception.qr_detectado)
        self.assertEqual(states[-1], "Tempo limite de carregamento excedido.")


class QueueReadinessGateTest(unittest.TestCase):
    def test_unavailable_whatsapp_does_not_claim_or_remove_queue_item(self):
        events = []
        api = FakeApi(1, events)
        whatsapp = FakeWhatsapp(events, ready=False)

        with patch(
            "automacao.main_automacao.settings",
            SimpleNamespace(dry_run=False),
        ):
            with self.assertRaises(WhatsAppReadinessTimeout):
                capturar_tarefa_com_whatsapp_pronto(api, whatsapp)

        self.assertEqual(api.claim_count, 0)
        self.assertEqual(api.pending, ["task-machine-1"])
        self.assertEqual(events, ["whatsapp-ready-check"])

    def test_claim_starts_normally_after_session_becomes_ready(self):
        events = []
        api = FakeApi(1, events)
        whatsapp = FakeWhatsapp(events, ready=False)

        with patch(
            "automacao.main_automacao.settings",
            SimpleNamespace(dry_run=False),
        ):
            with self.assertRaises(WhatsAppReadinessTimeout):
                capturar_tarefa_com_whatsapp_pronto(api, whatsapp)
            whatsapp.ready = True
            reused, task = capturar_tarefa_com_whatsapp_pronto(api, whatsapp)

        self.assertIs(reused, whatsapp)
        self.assertEqual(task, "task-machine-1")
        self.assertEqual(api.claim_count, 1)
        self.assertEqual(
            events[-3:],
            [
                "whatsapp-ready-check",
                "heartbeat:1:online_available",
                "claim:1",
            ],
        )

    def test_same_gate_is_applied_to_machine_1_and_machine_2(self):
        for machine_id in (1, 2):
            with self.subTest(machine_id=machine_id):
                events = []
                api = FakeApi(machine_id, events)
                whatsapp = FakeWhatsapp(events, ready=True)

                with patch(
                    "automacao.main_automacao.settings",
                    SimpleNamespace(dry_run=False),
                ):
                    _reused, task = capturar_tarefa_com_whatsapp_pronto(
                        api,
                        whatsapp,
                    )

                self.assertEqual(task, f"task-machine-{machine_id}")
                self.assertEqual(
                    events,
                    [
                        "whatsapp-ready-check",
                        f"heartbeat:{machine_id}:online_available",
                        f"claim:{machine_id}",
                    ],
                )


if __name__ == "__main__":
    unittest.main()

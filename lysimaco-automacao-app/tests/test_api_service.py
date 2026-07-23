import tempfile
import unittest
from pathlib import Path

from automacao.services.api_service import (
    AutomationApiClient,
    AutomationApiError,
    ReceiptJournal,
    codigo_erro_seguro,
    mascarar_telefone,
)


class ApiServiceTests(unittest.TestCase):
    def test_selected_machine_is_sent_in_api_headers(self):
        client = AutomationApiClient(
            base_url="https://api.example.test",
            token="x" * 32,
            worker_id="worker-test",
            machine_id=4,
        )
        headers = client._headers()
        self.assertEqual(headers["X-Automation-Machine"], "4")
        self.assertEqual(headers["Authorization"], f"Bearer {'x' * 32}")

    def test_claim_maps_minimal_contract(self):
        def transport(method, path, payload):
            self.assertEqual(method, "POST")
            self.assertEqual(path, "/api/automation-worker/tasks/claim")
            self.assertEqual(payload, {"worker_id": "worker-test"})
            return 200, {
                "tarefa": {
                    "id": 12,
                    "api_version": 2,
                    "tipo": "faltas",
                    "status": "executando",
                    "entregas": [{
                        "id": 91,
                        "canal": "responsavel",
                        "telefone": "5544999999999",
                        "mensagem": "Mensagem",
                        "tentativa": 1,
                    }],
                    "resumo": {"total": 1},
                }
            }

        client = AutomationApiClient(
            base_url="https://api.example.test",
            token="x" * 32,
            worker_id="worker-test",
            transport=transport,
        )
        task = client.capturar_tarefa()
        self.assertEqual(task.id, 12)
        self.assertEqual(task.api_version, 2)
        self.assertEqual(task.entregas[0].id, 91)
        self.assertEqual(task.entregas[0].telefone, "5544999999999")

    def test_heartbeat_sends_version_state_and_current_task(self):
        calls = []

        def transport(method, path, payload):
            calls.append((method, path, payload))
            return 200, {"machine": {"state": "online_busy"}}

        client = AutomationApiClient(
            base_url="https://api.example.test",
            token="x" * 32,
            worker_id="worker-test",
            machine_id=2,
            transport=transport,
        )
        response = client.heartbeat("online_busy", current_task_id=44)
        self.assertEqual(response["machine"]["state"], "online_busy")
        self.assertEqual(calls[0][1], "/api/automation-worker/heartbeat")
        self.assertEqual(calls[0][2]["current_task_id"], 44)
        self.assertRegex(calls[0][2]["app_version"], r"^\d+\.\d+\.\d+")

    def test_newer_task_contract_is_rejected(self):
        client = AutomationApiClient(
            base_url="https://api.example.test",
            token="x" * 32,
            worker_id="worker-test",
            transport=lambda *_args: (200, {
                "tarefa": {
                    "id": 12,
                    "api_version": 99,
                    "tipo": "faltas",
                    "status": "executando",
                    "entregas": [],
                }
            }),
        )
        with self.assertRaises(AutomationApiError) as context:
            client.capturar_tarefa()
        self.assertFalse(context.exception.retryable)

    def test_http_failures_have_bounded_retry_classification(self):
        for status, retryable in [(401, False), (403, False), (404, False), (429, True), (500, True)]:
            client = AutomationApiClient(
                base_url="https://api.example.test",
                token="x" * 32,
                worker_id="worker-test",
                transport=lambda *_args, status=status: (status, {"erro": "falha"}),
            )
            with self.assertRaises(AutomationApiError) as context:
                client.capturar_tarefa()
            self.assertEqual(context.exception.status, status)
            self.assertEqual(context.exception.retryable, retryable)

    def test_receipt_journal_survives_restart_and_is_idempotent(self):
        calls = []

        def transport(method, path, payload):
            calls.append((method, path, payload))
            return 200, {"resultado": {"entregaStatus": "enviado"}}

        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "receipts.json"
            ReceiptJournal(path).record(77, "enviado")
            restarted = ReceiptJournal(path)
            self.assertEqual(restarted.pending_count(), 1)

            client = AutomationApiClient(
                base_url="https://api.example.test",
                token="x" * 32,
                worker_id="worker-test",
                transport=transport,
            )
            self.assertEqual(restarted.flush(client), 1)
            self.assertEqual(restarted.pending_count(), 0)
            self.assertEqual(calls[0][1], "/api/automation-worker/deliveries/77/result")
            self.assertTrue(calls[0][2]["external_id"].startswith("local-"))

    def test_journal_keeps_checkpoint_when_api_is_temporarily_unavailable(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            journal = ReceiptJournal(Path(temp_dir) / "receipts.json")
            journal.record(88, "enviado")
            client = AutomationApiClient(
                base_url="https://api.example.test",
                token="x" * 32,
                worker_id="worker-test",
                transport=lambda *_args: (500, {"erro": "temporário"}),
            )
            self.assertEqual(journal.flush(client), 0)
            self.assertEqual(journal.pending_count(), 1)

    def test_journal_surfaces_invalid_credential_without_losing_checkpoint(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            journal = ReceiptJournal(Path(temp_dir) / "receipts.json")
            journal.record(89, "enviado")
            client = AutomationApiClient(
                base_url="https://api.example.test",
                token="x" * 32,
                worker_id="worker-test",
                transport=lambda *_args: (401, {"erro": "credencial inválida"}),
            )
            with self.assertRaises(AutomationApiError) as context:
                journal.flush(client)
            self.assertFalse(context.exception.retryable)
            self.assertEqual(journal.pending_count(), 1)

    def test_logs_mask_phone(self):
        self.assertEqual(mascarar_telefone("5544999135827"), "55*******27")
        self.assertNotIn("999135827", mascarar_telefone("5544999135827"))

    def test_group_header_mismatch_has_specific_safe_code(self):
        error = RuntimeError("Grupo aberto com cabecalho divergente.")
        self.assertEqual(codigo_erro_seguro(error), "GROUP_VALIDATION_FAILED")


if __name__ == "__main__":
    unittest.main()

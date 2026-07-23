import json
import os
import platform
import queue
import shlex
import sys
import threading
import time
import traceback
from pathlib import Path
from datetime import datetime
import tkinter as tk
from tkinter import messagebox

import customtkinter as ctk

from automacao.main_automacao import run_from_gui
from automacao.config.settings import settings


BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = BASE_DIR / "config"
CONFIG_FILE = CONFIG_DIR / "config.local.json"
CONFIG_EXAMPLE_FILE = CONFIG_DIR / "config.example.json"
LOG_DIR = BASE_DIR / "logs"
LOG_FILE = LOG_DIR / "app.log"
ICON_PATH = BASE_DIR / "assets" / "icon.png"

PERFIL_MAQUINAS = {
    "pedagoga": ["1", "2"],
    "administracao": ["3", "4", "5"],
}

PERFIL_LABELS = {
    "pedagoga": "Pedagoga",
    "administracao": "Administrador",
}

def maquinas_configuradas_por_perfil(tipo):
    permitidas = PERFIL_MAQUINAS.get(tipo, PERFIL_MAQUINAS["pedagoga"])
    try:
        configuradas = {str(machine_id) for machine_id in settings.available_machine_ids}
    except RuntimeError:
        return permitidas
    filtradas = [machine_id for machine_id in permitidas if machine_id in configuradas]
    return filtradas or permitidas

DELAY_MINIMO_SEGURO = 5

DEFAULT_CONFIG = {
    "maquina_id": 1,
    "tipo_maquina": "pedagoga",
    "intervalo_verificacao": 15,
    "modo_economico": True,
    "iniciar_com_sistema": False,
    "tempo_limite_inatividade": "01:30",
    "horario_inicio": "07:00",
    "horario_fim": "18:00",
    "delays": {
        "pausa_inicial": 3,
        "pausa_entre_envios": 5,
        "pausa_pos_envio": 1,
    },
    "whatsapp": {
        "tempo_espera_conversa": 35,
    },
}


class LysimacoAutomacaoApp(ctk.CTk):
    def __init__(self, autostart_requested: bool = False):
        super().__init__()

        ctk.set_appearance_mode("light")
        ctk.set_default_color_theme("blue")

        self.title("Lysímaco Digital - Automação")
        self.configure_app_identity()
        self.configure_responsive_window()

        self.running = False
        self.worker_thread = None
        self.stop_event = threading.Event()
        self.watchdog_thread = None
        self.watchdog_stop_event = threading.Event()
        self.last_activity_lock = threading.Lock()
        self.last_activity_time = time.time()
        self.inactivity_shutdown_requested = False
        self.delay_warning_popup_shown = False
        self.log_queue = queue.Queue()
        self.max_log_lines = 1000
        self.current_log_lines = 0
        self.autostart_requested = bool(autostart_requested)

        self.config_data = self.load_config()

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=0)
        self.grid_rowconfigure(1, weight=1)
        self.grid_rowconfigure(2, weight=0)

        self.build_header()
        self.build_main_area()
        self.build_footer()

        self.refresh_fields_from_config()
        self.update_action_button()
        self.after(100, self.drain_log_queue)
        self.write_status("[INFO] Interface iniciada. Automação desligada.")
        if self.autostart_requested:
            self.after(700, self.start_from_autostart_if_enabled)


    def configure_app_identity(self):
        """Configura identidade visual da janela no Linux/Windows sem interromper o app se o ícone falhar."""
        try:
            # Ajuda o GNOME/Zorin a associar a janela ao arquivo .desktop.
            self.wm_class("LysimacoAutomacao", "LysimacoAutomacao")
        except Exception:
            pass

        try:
            if ICON_PATH.exists():
                self._app_icon_image = tk.PhotoImage(file=str(ICON_PATH))
                self.iconphoto(True, self._app_icon_image)
        except Exception as exc:
            # Não deve impedir a abertura do robô caso o ícone esteja ausente/corrompido.
            try:
                self.log_queue.put_nowait({
                    "type": "log",
                    "payload": f"[AVISO] Não foi possível carregar o ícone da janela: {exc}",
                })
            except Exception:
                pass


    def configure_responsive_window(self):
        """Define uma janela proporcional ao monitor atual, sem dimensões rígidas que cortem a interface."""
        try:
            self.update_idletasks()
            screen_w = max(int(self.winfo_screenwidth()), 1024)
            screen_h = max(int(self.winfo_screenheight()), 768)

            window_w = int(screen_w * 0.82)
            window_h = int(screen_h * 0.86)

            window_w = max(1024, min(window_w, screen_w - 40))
            window_h = max(700, min(window_h, screen_h - 70))

            pos_x = max(0, (screen_w - window_w) // 2)
            pos_y = max(0, (screen_h - window_h) // 2)

            self.geometry(f"{window_w}x{window_h}+{pos_x}+{pos_y}")
            self.minsize(900, 640)
        except Exception:
            self.geometry("1024x700")
            self.minsize(900, 640)

    # ------------------------------------------------------------------
    # Construção da interface
    # ------------------------------------------------------------------
    def build_header(self):
        header = ctk.CTkFrame(self, corner_radius=0, fg_color="#eaf2ff")
        header.grid(row=0, column=0, sticky="ew")
        header.grid_columnconfigure(0, weight=1)

        title = ctk.CTkLabel(
            header,
            text="Lysímaco Digital - Automação WhatsApp",
            font=ctk.CTkFont(size=23, weight="bold"),
            text_color="#0f172a",
        )
        title.grid(row=0, column=0, padx=24, pady=(18, 4), sticky="w")

        subtitle = ctk.CTkLabel(
            header,
            text="Painel local para configurar a máquina, controlar o robô e acompanhar os logs em tempo real.",
            font=ctk.CTkFont(size=13),
            text_color="#475569",
        )
        subtitle.grid(row=1, column=0, padx=24, pady=(0, 16), sticky="w")

    def build_main_area(self):
        container = ctk.CTkFrame(self, fg_color="transparent")
        container.grid(row=1, column=0, padx=22, pady=(20, 10), sticky="nsew")
        container.grid_columnconfigure(0, weight=1, uniform="main")
        container.grid_columnconfigure(1, weight=1, uniform="main")
        container.grid_rowconfigure(0, weight=1)

        self.build_config_card(container)
        self.build_monitor_card(container)

    def build_config_card(self, parent):
        card = ctk.CTkScrollableFrame(parent, corner_radius=14)
        card.grid(row=0, column=0, padx=(0, 10), pady=0, sticky="nsew")
        card.grid_columnconfigure((0, 1), weight=1)

        ctk.CTkLabel(
            card,
            text="Configurações da Máquina",
            font=ctk.CTkFont(size=17, weight="bold"),
            text_color="#0f172a",
        ).grid(row=0, column=0, columnspan=2, padx=18, pady=(18, 14), sticky="w")

        ctk.CTkLabel(card, text="Tipo de perfil", font=ctk.CTkFont(weight="bold")).grid(
            row=1, column=0, padx=18, pady=(0, 5), sticky="w"
        )
        self.tipo_var = ctk.StringVar(value="pedagoga")
        self.tipo_select = ctk.CTkOptionMenu(
            card,
            values=["pedagoga", "administracao"],
            variable=self.tipo_var,
            command=self.on_tipo_changed,
        )
        self.tipo_select.grid(row=2, column=0, padx=18, pady=(0, 8), sticky="ew")
        ctk.CTkLabel(
            card,
            text="Pedagogas usam máquinas 1 e 2. Administradores usam 3, 4 e 5.",
            font=ctk.CTkFont(size=11),
            text_color="#64748b",
            wraplength=210,
            justify="left",
        ).grid(row=3, column=0, padx=18, pady=(0, 14), sticky="nw")

        ctk.CTkLabel(card, text="Número da máquina", font=ctk.CTkFont(weight="bold")).grid(
            row=1, column=1, padx=18, pady=(0, 5), sticky="w"
        )
        self.maquina_var = ctk.StringVar(value="1")
        self.maquina_select = ctk.CTkOptionMenu(
            card,
            values=maquinas_configuradas_por_perfil("pedagoga"),
            variable=self.maquina_var,
            command=self.on_machine_changed,
        )
        self.maquina_select.grid(row=2, column=1, padx=18, pady=(0, 8), sticky="ew")
        ctk.CTkLabel(
            card,
            text="O campo se ajusta automaticamente conforme o perfil escolhido.",
            font=ctk.CTkFont(size=11),
            text_color="#64748b",
            wraplength=210,
            justify="left",
        ).grid(row=3, column=1, padx=18, pady=(0, 14), sticky="nw")

        ctk.CTkLabel(card, text="Intervalo da fila", font=ctk.CTkFont(weight="bold")).grid(
            row=4, column=0, padx=18, pady=(0, 5), sticky="w"
        )
        self.intervalo_var = ctk.StringVar(value="15")
        self.intervalo_select = ctk.CTkOptionMenu(
            card,
            values=["5", "10", "15", "30", "60"],
            variable=self.intervalo_var,
        )
        self.intervalo_select.grid(row=5, column=0, padx=18, pady=(0, 8), sticky="ew")
        ctk.CTkLabel(
            card,
            text="Tempo entre consultas na API, em segundos.",
            font=ctk.CTkFont(size=11),
            text_color="#64748b",
        ).grid(row=6, column=0, padx=18, pady=(0, 14), sticky="w")

        flags_frame = ctk.CTkFrame(card, fg_color="transparent")
        flags_frame.grid(row=5, column=1, rowspan=2, padx=18, pady=(0, 14), sticky="nsew")
        flags_frame.grid_columnconfigure(0, weight=1)

        self.autostart_var = ctk.BooleanVar(value=False)
        self.autostart_check = ctk.CTkCheckBox(
            flags_frame,
            text="Iniciar com o computador",
            variable=self.autostart_var,
        )
        self.autostart_check.grid(row=0, column=0, pady=(0, 8), sticky="w")

        self.economico_var = ctk.BooleanVar(value=True)
        self.economico_check = ctk.CTkCheckBox(
            flags_frame,
            text="Modo econômico",
            variable=self.economico_var,
        )
        self.economico_check.grid(row=1, column=0, sticky="w")

        ctk.CTkLabel(card, text="Tempo Limite de Inatividade", font=ctk.CTkFont(weight="bold")).grid(
            row=7, column=0, padx=18, pady=(4, 5), sticky="w"
        )
        self.tempo_inatividade_var = ctk.StringVar(value="01:30")
        self.tempo_inatividade_entry = ctk.CTkEntry(
            card,
            textvariable=self.tempo_inatividade_var,
            placeholder_text="HH:MM ou minutos. Ex: 01:30",
        )
        self.tempo_inatividade_entry.grid(row=8, column=0, padx=18, pady=(0, 5), sticky="ew")
        ctk.CTkLabel(
            card,
            text="Desliga automaticamente se o robô ficar sem capturar tarefa ou enviar mensagens por esse período.",
            font=ctk.CTkFont(size=11),
            text_color="#64748b",
            wraplength=220,
            justify="left",
        ).grid(row=9, column=0, padx=18, pady=(0, 14), sticky="nw")

        ctk.CTkLabel(
            card,
            text="Pausas de envio do Selenium",
            font=ctk.CTkFont(size=15, weight="bold"),
            text_color="#0f172a",
        ).grid(row=10, column=0, columnspan=2, padx=18, pady=(4, 12), sticky="w")

        self.pausa_inicial_var = ctk.StringVar(value="3")
        self.pausa_entre_envios_var = ctk.StringVar(value="5")
        self.pausa_pos_envio_var = ctk.StringVar(value="1")

        self.add_delay_field(
            card,
            row=11,
            column=0,
            label="Pausa inicial (s)",
            variable=self.pausa_inicial_var,
            help_text="Tempo para o WhatsApp Web carregar o chat antes do primeiro envio.",
        )
        self.add_delay_field(
            card,
            row=11,
            column=1,
            label="Pausa entre envios (s)",
            variable=self.pausa_entre_envios_var,
            help_text="Espera entre mensagens para simular comportamento humano.",
        )
        self.add_delay_field(
            card,
            row=14,
            column=0,
            label="Pausa pós-envio (s)",
            variable=self.pausa_pos_envio_var,
            help_text="Tempo de segurança após enviar antes de seguir para a próxima ação.",
        )

        ctk.CTkLabel(
            card,
            text="Configurações do WhatsApp",
            font=ctk.CTkFont(size=15, weight="bold"),
            text_color="#0f172a",
        ).grid(row=17, column=0, columnspan=2, padx=18, pady=(4, 12), sticky="w")

        self.tempo_espera_conversa_var = ctk.StringVar(value="35")

        self.add_delay_field(
            card,
            row=18,
            column=0,
            label="Espera da conversa (s)",
            variable=self.tempo_espera_conversa_var,
            help_text="Tempo máximo para o WhatsApp abrir a conversa e liberar a caixa de mensagem. Mínimo seguro: 35s.",
        )
        ctk.CTkLabel(
            card,
            text="As retentativas são limitadas e controladas pela API do sistema.",
            font=ctk.CTkFont(size=11),
            text_color="#64748b",
            wraplength=220,
            justify="left",
        ).grid(row=18, column=1, padx=18, pady=(24, 5), sticky="nw")

        self.save_feedback = ctk.CTkLabel(
            card,
            text="",
            text_color="#16a34a",
            font=ctk.CTkFont(size=12, weight="bold"),
        )
        self.save_feedback.grid(row=21, column=1, padx=18, pady=(0, 4), sticky="w")

        self.save_button = ctk.CTkButton(
            card,
            text="💾 Salvar Configurações",
            height=38,
            command=self.save_config_from_fields,
        )
        self.save_button.grid(row=22, column=0, columnspan=2, padx=18, pady=(8, 18), sticky="ew")

    def build_monitor_card(self, parent):
        card = ctk.CTkFrame(parent, corner_radius=14)
        card.grid(row=0, column=1, padx=(10, 0), pady=0, sticky="nsew")
        card.grid_columnconfigure(0, weight=1)
        card.grid_columnconfigure(1, weight=1)
        card.grid_rowconfigure(8, weight=1)

        ctk.CTkLabel(
            card,
            text="Controle e Monitoramento",
            font=ctk.CTkFont(size=17, weight="bold"),
            text_color="#0f172a",
        ).grid(row=0, column=0, columnspan=2, padx=18, pady=(18, 14), sticky="w")

        self.status_automacao = self.add_status_line(card, 1, "Automação", "Desligada")
        self.status_maquina = self.add_status_line(card, 2, "Máquina", "1")
        self.status_banco = self.add_status_line(card, 3, "API", "Não testada")
        self.status_whatsapp = self.add_status_line(card, 4, "WhatsApp", "Aguardando")
        self.status_ultima_acao = self.add_status_line(card, 5, "Última ação", "Nenhuma")

        self.action_button = ctk.CTkButton(
            card,
            text="Ligar Automação",
            height=52,
            font=ctk.CTkFont(size=15, weight="bold"),
            command=self.toggle_worker,
        )
        self.action_button.grid(row=6, column=0, columnspan=2, padx=18, pady=(22, 10), sticky="ew")

        ctk.CTkLabel(
            card,
            text="O desligamento solicita parada segura. A tarefa atual não será interrompida de forma brusca.",
            font=ctk.CTkFont(size=11),
            text_color="#64748b",
            wraplength=420,
            justify="center",
        ).grid(row=7, column=0, columnspan=2, padx=18, pady=(0, 10), sticky="ew")

        ctk.CTkLabel(
            card,
            text="Console de Logs em Tempo Real",
            font=ctk.CTkFont(size=15, weight="bold"),
            text_color="#0f172a",
        ).grid(row=8, column=0, columnspan=2, padx=18, pady=(4, 8), sticky="w")

        self.log_box = ctk.CTkTextbox(
            card,
            height=260,
            font=ctk.CTkFont(family="monospace", size=12),
            wrap="word",
        )
        self.log_box.grid(row=9, column=0, columnspan=2, padx=18, pady=(0, 18), sticky="nsew")
        self.log_box.configure(state="disabled")

    def build_logs_panel(self):
        return

    def build_footer(self):
        footer_frame = ctk.CTkFrame(self, fg_color="transparent")
        footer_frame.grid(row=2, column=0, padx=22, pady=(0, 12), sticky="ew")
        footer_frame.grid_columnconfigure(0, weight=1)

        footer_text = (
            "Pedro-Henrique-pereira(PHtw) © 2026  •  "
            "Email: phtw999@gmail.com  •  "
            "GitHub: https://github.com/Pedro-Henrique-Pereira  •  "
            "Versão 1.0.0-beta"
        )
        footer = ctk.CTkLabel(
            footer_frame,
            text=footer_text,
            text_color="#64748b",
            font=ctk.CTkFont(size=11),
            anchor="center",
        )
        footer.grid(row=0, column=0, sticky="ew")

    def add_delay_field(self, parent, row, column, label, variable, help_text):
        ctk.CTkLabel(parent, text=label, font=ctk.CTkFont(weight="bold")).grid(
            row=row, column=column, padx=18, pady=(0, 5), sticky="w"
        )
        entry = ctk.CTkEntry(parent, textvariable=variable, placeholder_text="Ex: 10")
        entry.grid(row=row + 1, column=column, padx=18, pady=(0, 5), sticky="ew")
        ctk.CTkLabel(
            parent,
            text=help_text,
            font=ctk.CTkFont(size=11),
            text_color="#64748b",
            wraplength=220,
            justify="left",
        ).grid(row=row + 2, column=column, padx=18, pady=(0, 14), sticky="nw")
        return entry

    def add_status_line(self, parent, row, label, value):
        wrapper = ctk.CTkFrame(parent, fg_color="#f8fafc", corner_radius=10)
        wrapper.grid(row=row, column=0, columnspan=2, padx=18, pady=5, sticky="ew")
        wrapper.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            wrapper,
            text=f"{label}:",
            font=ctk.CTkFont(weight="bold"),
            text_color="#334155",
        ).grid(row=0, column=0, padx=12, pady=9, sticky="w")

        value_label = ctk.CTkLabel(wrapper, text=value, anchor="e", text_color="#0f172a")
        value_label.grid(row=0, column=1, padx=12, pady=9, sticky="ew")
        return value_label

    # ------------------------------------------------------------------
    # Eventos da interface
    # ------------------------------------------------------------------
    def on_tipo_changed(self, value):
        tipo = value if value in PERFIL_MAQUINAS else "pedagoga"
        opcoes_validas = maquinas_configuradas_por_perfil(tipo)
        self.maquina_select.configure(values=opcoes_validas)

        if self.maquina_var.get() not in opcoes_validas:
            self.maquina_var.set(opcoes_validas[0])

        self.status_maquina.configure(text=self.maquina_var.get())
        self.write_status(
            f"[INFO] Perfil alterado para {PERFIL_LABELS[tipo]}. Máquinas disponíveis: {', '.join(opcoes_validas)}."
        )

    def on_machine_changed(self, value):
        maquina = str(value)
        tipo_atual = self.tipo_var.get()
        maquinas_validas = maquinas_configuradas_por_perfil(tipo_atual)

        if maquina not in maquinas_validas:
            self.maquina_var.set(maquinas_validas[0])
            self.write_status("[AVISO] Máquina inválida para o perfil selecionado. Ajuste automático aplicado.")
            return

        self.status_maquina.configure(text=maquina)
        self.write_status(f"[INFO] Máquina selecionada: {maquina}.")

    def toggle_worker(self):
        if self.running:
            self.stop_worker()
        else:
            self.start_worker()

    def update_action_button(self):
        if self.running:
            self.action_button.configure(
                text="Desligar Automação",
                fg_color="#dc2626",
                hover_color="#b91c1c",
            )
        else:
            self.action_button.configure(
                text="Ligar Automação",
                fg_color="#16a34a",
                hover_color="#15803d",
            )

    # ------------------------------------------------------------------
    # Configuração e validação
    # ------------------------------------------------------------------
    def load_config(self):
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        LOG_DIR.mkdir(parents=True, exist_ok=True)

        if not CONFIG_EXAMPLE_FILE.exists():
            CONFIG_EXAMPLE_FILE.write_text(json.dumps(DEFAULT_CONFIG, indent=2, ensure_ascii=False), encoding="utf-8")

        if not CONFIG_FILE.exists():
            CONFIG_FILE.write_text(json.dumps(DEFAULT_CONFIG, indent=2, ensure_ascii=False), encoding="utf-8")
            return json.loads(json.dumps(DEFAULT_CONFIG))

        try:
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            merged = {**DEFAULT_CONFIG, **data}
            merged["delays"] = {**DEFAULT_CONFIG["delays"], **data.get("delays", {})}
            merged["whatsapp"] = {**DEFAULT_CONFIG["whatsapp"], **data.get("whatsapp", {})}
            return merged
        except Exception:
            return json.loads(json.dumps(DEFAULT_CONFIG))

    def refresh_fields_from_config(self):
        tipo = self.config_data.get("tipo_maquina", "pedagoga")
        if tipo not in PERFIL_MAQUINAS:
            tipo = "pedagoga"

        maquina = str(self.config_data.get("maquina_id", 1))
        maquinas_validas = maquinas_configuradas_por_perfil(tipo)
        if maquina not in maquinas_validas:
            maquina = maquinas_validas[0]

        self.tipo_var.set(tipo)
        self.maquina_select.configure(values=maquinas_validas)
        self.maquina_var.set(maquina)
        self.intervalo_var.set(str(self.config_data.get("intervalo_verificacao", 15)))
        autostart_ativo = bool(self.config_data.get("iniciar_com_sistema", False)) and self.is_autostart_registered()
        self.autostart_var.set(autostart_ativo)
        self.config_data["iniciar_com_sistema"] = autostart_ativo
        self.tempo_inatividade_var.set(str(self.config_data.get("tempo_limite_inatividade", "01:30")))
        self.economico_var.set(bool(self.config_data.get("modo_economico", True)))

        delays = self.config_data.get("delays", DEFAULT_CONFIG["delays"])
        self.pausa_inicial_var.set(str(delays.get("pausa_inicial", 3)))
        self.pausa_entre_envios_var.set(str(delays.get("pausa_entre_envios", 5)))
        self.pausa_pos_envio_var.set(str(delays.get("pausa_pos_envio", 1)))

        whatsapp_cfg = self.config_data.get("whatsapp", DEFAULT_CONFIG["whatsapp"])
        self.tempo_espera_conversa_var.set(str(whatsapp_cfg.get("tempo_espera_conversa", 35)))

        self.status_maquina.configure(text=maquina)

    def parse_delay_value(self, value, field_name):
        try:
            parsed = float(str(value).replace(",", ".").strip())
        except ValueError as exc:
            raise ValueError(f"{field_name} deve ser um número válido.") from exc

        if parsed < 0:
            raise ValueError(f"{field_name} não pode ser negativo.")

        return parsed

    def get_delay_values(self):
        return {
            "pausa_inicial": self.parse_delay_value(self.pausa_inicial_var.get(), "Pausa inicial"),
            "pausa_entre_envios": self.parse_delay_value(self.pausa_entre_envios_var.get(), "Pausa entre envios"),
            "pausa_pos_envio": self.parse_delay_value(self.pausa_pos_envio_var.get(), "Pausa pós-envio"),
        }

    def parse_int_range(self, value, field_name, minimum, maximum, default):
        texto = str(value or "").strip()
        if not texto:
            return int(default)
        try:
            parsed = int(float(texto.replace(",", ".")))
        except ValueError as exc:
            raise ValueError(f"{field_name} deve ser um número inteiro válido.") from exc
        if parsed < minimum:
            raise ValueError(f"{field_name} deve ser no mínimo {minimum}.")
        if parsed > maximum:
            raise ValueError(f"{field_name} deve ser no máximo {maximum}.")
        return parsed

    def get_whatsapp_values(self):
        return {
            "tempo_espera_conversa": self.parse_int_range(
                self.tempo_espera_conversa_var.get(),
                "Espera da conversa WhatsApp",
                35,
                180,
                35,
            ),
        }

    def warn_if_dangerous_delays(self, delays):
        if float(delays.get("pausa_entre_envios", DELAY_MINIMO_SEGURO)) < DELAY_MINIMO_SEGURO:
            messagebox.showwarning(
                "Alerta de Segurança",
                "⚠️ Alerta de Segurança: Configurar um tempo de envio muito baixo pode causar o banimento imediato do chip da escola pelo WhatsApp. Recomendamos valores entre 5 e 12 segundos.",
                parent=self,
            )
            self.write_status("[AVISO] Delays abaixo de 5 segundos detectados. Risco alto de bloqueio pelo WhatsApp.")
            return True
        return False

    def validate_machine_profile(self):
        tipo = self.tipo_var.get()
        if tipo not in PERFIL_MAQUINAS:
            tipo = "pedagoga"
            self.tipo_var.set(tipo)

        maquina = self.maquina_var.get()
        maquinas_validas = maquinas_configuradas_por_perfil(tipo)
        if maquina not in maquinas_validas:
            maquina = maquinas_validas[0]
            self.maquina_var.set(maquina)
            self.maquina_select.configure(values=maquinas_validas)

        return tipo, int(maquina)


    # ------------------------------------------------------------------
    # Auto-start do sistema operacional
    # ------------------------------------------------------------------
    def get_app_launch_command_parts(self):
        """Monta o comando usado pelo auto-start sem depender de banco de dados."""
        if getattr(sys, "frozen", False):
            return [str(Path(sys.executable).resolve()), "--autostart"]

        main_script = BASE_DIR / "main.py"
        return [str(Path(sys.executable).resolve()), str(main_script.resolve()), "--autostart"]

    def get_app_launch_command_string(self):
        parts = self.get_app_launch_command_parts()
        if platform.system().lower().startswith("win"):
            return " ".join(f'"{part}"' if " " in part else part for part in parts)
        return " ".join(shlex.quote(part) for part in parts)

    def get_autostart_desktop_path(self):
        return Path.home() / ".config" / "autostart" / "lysimaco-automacao.desktop"

    def is_autostart_registered(self):
        sistema = platform.system().lower()
        expected_command = self.get_app_launch_command_string()

        try:
            if sistema.startswith("win"):
                import winreg

                with winreg.OpenKey(
                    winreg.HKEY_CURRENT_USER,
                    r"Software\Microsoft\Windows\CurrentVersion\Run",
                    0,
                    winreg.KEY_READ,
                ) as key:
                    registered_command, _ = winreg.QueryValueEx(key, "LysimacoAutomacao")
                return str(registered_command).strip() == expected_command.strip()

            if sistema == "linux":
                desktop_path = self.get_autostart_desktop_path()
                if not desktop_path.exists():
                    return False

                try:
                    content = desktop_path.read_text(encoding="utf-8")
                except OSError:
                    return False

                for line in content.splitlines():
                    line = line.strip()
                    if line.startswith("Exec="):
                        current_exec = line.split("=", 1)[1].strip()
                        return current_exec == expected_command.strip()
                return False

            return False
        except FileNotFoundError:
            return False
        except Exception:
            return False

    def register_autostart(self):
        sistema = platform.system().lower()
        comando = self.get_app_launch_command_string()

        if sistema.startswith("win"):
            import winreg

            try:
                with winreg.CreateKeyEx(
                    winreg.HKEY_CURRENT_USER,
                    r"Software\Microsoft\Windows\CurrentVersion\Run",
                    0,
                    winreg.KEY_SET_VALUE,
                ) as key:
                    winreg.SetValueEx(key, "LysimacoAutomacao", 0, winreg.REG_SZ, comando)
                return True
            except OSError as exc:
                self.write_status(f"[ERRO] Falha ao registrar auto-start no Windows: {exc}")
                return False

        if sistema == "linux":
            desktop_path = self.get_autostart_desktop_path()
            desktop_path.parent.mkdir(parents=True, exist_ok=True)
            desktop_path.write_text(
                "\n".join(
                    [
                        "[Desktop Entry]",
                        "Type=Application",
                        "Version=1.0",
                        "Name=Lysimaco Automação",
                        "Comment=Inicialização automática da automação local",
                        f"Exec={comando}",
                        "Terminal=false",
                        "Hidden=false",
                        "NoDisplay=false",
                        "X-GNOME-Autostart-enabled=true",
                        "StartupNotify=false",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            desktop_path.chmod(0o755)
            return desktop_path.exists()

        self.write_status("[AVISO] Auto-start não suportado neste sistema operacional.")
        return False

    def unregister_autostart(self):
        sistema = platform.system().lower()
        try:
            if sistema.startswith("win"):
                import winreg

                with winreg.OpenKey(
                    winreg.HKEY_CURRENT_USER,
                    r"Software\Microsoft\Windows\CurrentVersion\Run",
                    0,
                    winreg.KEY_SET_VALUE,
                ) as key:
                    try:
                        winreg.DeleteValue(key, "LysimacoAutomacao")
                    except FileNotFoundError:
                        pass
                return True

            if sistema == "linux":
                desktop_path = self.get_autostart_desktop_path()
                if desktop_path.exists():
                    desktop_path.unlink()
                return True

            return False
        except Exception as exc:
            self.write_status(f"[ERRO] Não foi possível remover o auto-start: {exc}")
            return False

    def sync_autostart_setting(self, enabled: bool) -> bool:
        """Aplica fisicamente a opção no SO. Se falhar, a opção não fica salva como ativa."""
        if enabled:
            ok = self.register_autostart()
            if ok:
                self.write_status("[SUCESSO] Auto-start ativado no sistema operacional.")
            else:
                self.write_status("[ERRO] Auto-start não foi ativado.")
            return ok

        ok = self.unregister_autostart()
        if ok:
            self.write_status("[INFO] Auto-start desativado/removido do sistema operacional.")
        return ok

    def start_from_autostart_if_enabled(self):
        """Só liga automaticamente se o --autostart veio do SO e a opção estiver realmente ativa."""
        config_ativo = bool(self.config_data.get("iniciar_com_sistema", False))
        registro_ativo = self.is_autostart_registered()

        if config_ativo and registro_ativo:
            self.autostart_var.set(True)
            self.write_status("[INFO] Inicialização automática detectada e autorizada. Ligando automação.")
            self.start_worker()
            return

        self.autostart_var.set(False)
        self.config_data["iniciar_com_sistema"] = False
        self.write_status("[AVISO] --autostart recebido, mas a opção 'Iniciar com o computador' não está ativa. Automação permanecerá desligada.")

    # ------------------------------------------------------------------
    # Watchdog de inatividade
    # ------------------------------------------------------------------
    def parse_inactivity_limit_seconds(self, value):
        texto = str(value or "").strip().lower().replace("h", ":").replace(" ", "")
        if not texto:
            texto = "01:30"

        try:
            if ":" in texto:
                partes = [p for p in texto.split(":") if p != ""]
                if len(partes) == 2:
                    horas = int(partes[0])
                    minutos = int(partes[1])
                    segundos = 0
                elif len(partes) == 3:
                    horas = int(partes[0])
                    minutos = int(partes[1])
                    segundos = int(partes[2])
                else:
                    raise ValueError
                total = horas * 3600 + minutos * 60 + segundos
            else:
                total = int(float(texto.replace(",", ".")) * 60)
        except ValueError as exc:
            raise ValueError("Tempo Limite de Inatividade deve usar HH:MM, HH:MM:SS ou minutos. Ex: 01:30.") from exc

        if total < 60:
            raise ValueError("Tempo Limite de Inatividade deve ser de pelo menos 1 minuto.")

        return total

    def mark_activity(self, reason="atividade real"):
        self.enqueue_gui_event("activity", str(reason or "atividade real"))

    def apply_activity_from_main_thread(self, reason: str):
        with self.last_activity_lock:
            self.last_activity_time = time.time()

        safe_reason = str(reason or "atividade real")[:42]
        self.status_ultima_acao.configure(text=safe_reason)

    def start_watchdog(self):
        """Inicia/reinicia o monitor de ociosidade sempre que a automação é ligada, inclusive via boot."""
        self.watchdog_stop_event.set()
        self.watchdog_stop_event = threading.Event()
        self.inactivity_shutdown_requested = False
        self.mark_activity("Inicialização")
        self.watchdog_thread = threading.Thread(target=self.watchdog_loop, daemon=True)
        self.watchdog_thread.start()
        self.write_status("[INFO] Watchdog de inatividade iniciado.")

    def watchdog_loop(self):
        while not self.watchdog_stop_event.wait(10):
            if not self.running or self.stop_event.is_set():
                continue

            try:
                limit_seconds = self.parse_inactivity_limit_seconds(
                    self.config_data.get("tempo_limite_inatividade", "01:30")
                )
            except ValueError:
                limit_seconds = 90 * 60

            with self.last_activity_lock:
                idle_seconds = time.time() - self.last_activity_time

            if idle_seconds >= limit_seconds and not self.inactivity_shutdown_requested:
                self.inactivity_shutdown_requested = True
                self.enqueue_gui_event("stop_by_inactivity", None)
                return

    def stop_worker_by_inactivity(self):
        if not self.running:
            return
        self.write_status("[AVISO] Automação desligada automaticamente por inatividade prolongada.")
        self.stop_worker()

    def save_config_from_fields(self):
        try:
            tipo, maquina = self.validate_machine_profile()
            delays = self.get_delay_values()
            whatsapp_cfg = self.get_whatsapp_values()
            intervalo = int(self.intervalo_var.get())
            tempo_limite_inatividade = self.tempo_inatividade_var.get().strip() or "01:30"
            self.parse_inactivity_limit_seconds(tempo_limite_inatividade)
        except ValueError as exc:
            self.write_status(f"[ERRO] Erro ao salvar configuração: {exc}")
            messagebox.showerror("Configuração inválida", str(exc), parent=self)
            return False

        self.warn_if_dangerous_delays(delays)

        autostart_desejado = bool(self.autostart_var.get())
        autostart_ok = self.sync_autostart_setting(autostart_desejado)
        autostart_final = autostart_desejado and autostart_ok
        self.autostart_var.set(autostart_final)

        self.config_data = {
            **self.config_data,
            "maquina_id": maquina,
            "tipo_maquina": tipo,
            "intervalo_verificacao": intervalo,
            "iniciar_com_sistema": autostart_final,
            "tempo_limite_inatividade": tempo_limite_inatividade,
            "modo_economico": bool(self.economico_var.get()),
            "delays": delays,
            "whatsapp": whatsapp_cfg,
        }
        CONFIG_FILE.write_text(json.dumps(self.config_data, indent=2, ensure_ascii=False), encoding="utf-8")
        self.status_maquina.configure(text=str(self.config_data["maquina_id"]))
        self.save_feedback.configure(text="Configurações salvas com sucesso.")
        self.after(3000, lambda: self.save_feedback.configure(text=""))
        self.write_status("[SUCESSO] Configurações salvas.")
        return True

    # ------------------------------------------------------------------
    # Controle da automação
    # ------------------------------------------------------------------
    def start_worker(self):
        if self.running:
            return

        if not self.save_config_from_fields():
            return

        self.running = True
        self.stop_event.clear()
        self.watchdog_stop_event.clear()
        self.update_action_button()

        self.status_automacao.configure(text="Ligada")
        self.status_banco.configure(text="Aguardando conexão")
        self.status_whatsapp.configure(text="Aguardando automação")
        self.status_ultima_acao.configure(text="Inicialização")
        self.write_status("[INFO] Automação ligada.")
        self.start_watchdog()

        runtime_config = json.loads(json.dumps(self.config_data))
        self.worker_thread = threading.Thread(
            target=self.worker_loop,
            args=(runtime_config,),
            daemon=True,
        )
        self.worker_thread.start()

    def stop_worker(self):
        if not self.running:
            return

        self.stop_event.set()
        self.watchdog_stop_event.set()
        self.status_automacao.configure(text="Desligando")
        self.status_ultima_acao.configure(text="Parada solicitada")
        self.write_status("[INFO] Solicitação de desligamento seguro enviada.")
        self.update_action_button()

    def worker_loop(self, runtime_config):
        """Executa a automação real em background sem congelar a interface."""
        try:
            self.log_from_thread("[INFO] Worker iniciado em thread separada.")
            self.enqueue_gui_event("status", {"target": "banco", "text": "Conectando/monitorando"})
            self.enqueue_gui_event("status", {"target": "whatsapp", "text": "Controlado pelo Selenium"})
            self.enqueue_gui_event("activity", "Monitorando fila")

            codigo_saida = run_from_gui(
                runtime_config=runtime_config,
                stop_event=self.stop_event,
                log_callback=self.log_from_thread,
                activity_callback=self.mark_activity,
                status_callback=lambda text: self.enqueue_gui_event(
                    "status",
                    {"target": "whatsapp", "text": text},
                ),
            )

            if codigo_saida == 0:
                self.log_from_thread("[INFO] Worker encerrado com segurança.")
            else:
                self.log_from_thread(f"[ERRO] Worker encerrado com código {codigo_saida}.")
                self.enqueue_gui_event("error_popup", {
                    "title": "Erro na Automação",
                    "message": (
                        "A automação encerrou com erro e precisa de atenção.\n\n"
                        f"Código de saída: {codigo_saida}\n\n"
                        "Tire uma foto desta tela e envie para o suporte técnico."
                    ),
                })
        except Exception as exc:
            erro_curto = f"{type(exc).__name__}: {exc}"
            self.log_from_thread(f"[ERRO] Falha inesperada no worker da interface: {erro_curto}")
            self.log_from_thread(traceback.format_exc())
            self.enqueue_gui_event("error_popup", {
                "title": "Erro na Automação",
                "message": (
                    "A automação encontrou uma falha e precisa de atenção.\n\n"
                    f"Detalhe técnico: {erro_curto}\n\n"
                    "Tire uma foto desta tela e envie para o suporte técnico."
                ),
            })
        finally:
            self.enqueue_gui_event("finish_stop", None)

    def finish_stop(self):
        self.watchdog_stop_event.set()
        self.running = False
        self.status_automacao.configure(text="Desligada")
        self.status_banco.configure(text="Não testada")
        self.status_whatsapp.configure(text="Aguardando")
        self.status_ultima_acao.configure(text="Nenhuma")
        self.update_action_button()
        self.write_status("[INFO] Automação desligada.")

    # ------------------------------------------------------------------
    # Logs
    # ------------------------------------------------------------------
    def enqueue_gui_event(self, event_type: str, payload=None):
        """Entrada única e thread-safe para eventos vindos de threads."""
        try:
            self.log_queue.put_nowait({"type": event_type, "payload": payload})
        except Exception:
            pass

    def log_from_thread(self, message):
        """Recebe logs de qualquer thread sem tocar diretamente no widget."""
        self.enqueue_gui_event("log", str(message))

    def drain_log_queue(self):
        """Único ponto que consome eventos de thread e toca na GUI."""
        try:
            while True:
                item = self.log_queue.get_nowait()

                if isinstance(item, dict):
                    event_type = item.get("type")
                    payload = item.get("payload")

                    if event_type == "log":
                        self.write_status(str(payload))
                    elif event_type == "activity":
                        self.apply_activity_from_main_thread(str(payload))
                    elif event_type == "status":
                        self.apply_status_from_main_thread(payload or {})
                    elif event_type == "error_popup":
                        payload = payload or {}
                        self.show_error_popup(
                            payload.get("title", "Erro"),
                            payload.get("message", "Erro inesperado na automação."),
                        )
                    elif event_type == "finish_stop":
                        self.finish_stop()
                    elif event_type == "stop_by_inactivity":
                        self.stop_worker_by_inactivity()
                    continue

                self.write_status(str(item))
        except queue.Empty:
            pass
        finally:
            self.after(80, self.drain_log_queue)

    def apply_status_from_main_thread(self, payload):
        target = str(payload.get("target", "")).strip().lower()
        text = str(payload.get("text", ""))

        status_targets = {
            "automacao": self.status_automacao,
            "maquina": self.status_maquina,
            "banco": self.status_banco,
            "whatsapp": self.status_whatsapp,
            "ultima_acao": self.status_ultima_acao,
        }

        widget = status_targets.get(target)
        if widget is not None:
            widget.configure(text=text)

    def show_error_popup(self, title: str, message: str):
        """Modal oficial de erro executado somente na Main Thread."""
        try:
            popup = ctk.CTkToplevel(self)
            popup.title(title)
            popup.geometry("520x260")
            popup.resizable(False, False)
            popup.transient(self)
            popup.grab_set()
            popup.focus_force()

            popup.grid_columnconfigure(0, weight=1)
            popup.grid_rowconfigure(1, weight=1)

            ctk.CTkLabel(
                popup,
                text="⚠️ Erro na Automação",
                font=ctk.CTkFont(size=20, weight="bold"),
                text_color="#dc2626",
            ).grid(row=0, column=0, padx=24, pady=(22, 8), sticky="w")

            ctk.CTkLabel(
                popup,
                text=str(message),
                wraplength=460,
                justify="left",
                text_color="#0f172a",
            ).grid(row=1, column=0, padx=24, pady=8, sticky="nsew")

            ctk.CTkButton(
                popup,
                text="Entendi",
                fg_color="#dc2626",
                hover_color="#b91c1c",
                command=popup.destroy,
            ).grid(row=2, column=0, padx=24, pady=(8, 22), sticky="ew")
        except Exception:
            messagebox.showerror(title, message, parent=self)

    def write_status(self, message):
        timestamp = datetime.now().strftime("%H:%M:%S")
        line = f"[{timestamp}] {message}\n"

        try:
            self.log_box.configure(state="normal")
            self.log_box.insert("end", line)
            self.current_log_lines += 1

            excesso = self.current_log_lines - self.max_log_lines
            if excesso > 0:
                self.log_box.delete("1.0", f"{excesso + 1}.0")
                self.current_log_lines = self.max_log_lines

            self.log_box.see("end")
            self.log_box.configure(state="disabled")
        except Exception:
            pass

        try:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            with LOG_FILE.open("a", encoding="utf-8") as f:
                f.write(line)
        except Exception:
            pass

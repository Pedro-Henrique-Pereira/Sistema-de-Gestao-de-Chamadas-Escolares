from __future__ import annotations

import logging
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import textwrap
import traceback
from pathlib import Path

logger = logging.getLogger(__name__)


def _normalizar_texto(texto: str) -> str:
    return textwrap.dedent(texto).strip() + "\n"


def _criar_script_terminal(titulo: str, mensagem: str) -> Path:
    """Cria um script temporário que imprime o erro e mantém o terminal aberto."""
    temp_dir = Path(tempfile.gettempdir()) / "whatsapp_rpa_erros"
    temp_dir.mkdir(parents=True, exist_ok=True)

    script_path = temp_dir / "mostrar_erro_automacao.py"
    conteudo = f"""
import os
import sys

try:
    os.system('clear' if os.name != 'nt' else 'cls')
except Exception:
    pass

print({titulo!r})
print('=' * 90)
print({mensagem!r})
print('=' * 90)
print('')
input('Pressione ENTER para fechar esta janela...')
"""
    script_path.write_text(conteudo, encoding="utf-8")
    return script_path


def _abrir_terminal_linux(script_path: Path) -> bool:
    python_exec = sys.executable
    comando = f'"{python_exec}" "{script_path}"; exec bash'

    terminais = [
        ("gnome-terminal", ["gnome-terminal", "--", "bash", "-lc", comando]),
        ("kgx", ["kgx", "--", "bash", "-lc", comando]),
        ("konsole", ["konsole", "-e", "bash", "-lc", comando]),
        ("xfce4-terminal", ["xfce4-terminal", "--command", f"bash -lc {comando!r}"]),
        ("mate-terminal", ["mate-terminal", "--", "bash", "-lc", comando]),
        ("lxterminal", ["lxterminal", "-e", f"bash -lc {comando!r}"]),
        ("xterm", ["xterm", "-e", f"bash -lc {comando!r}"]),
    ]

    for nome, cmd in terminais:
        if shutil.which(nome):
            subprocess.Popen(cmd, start_new_session=True)
            return True

    return False


def _abrir_terminal_windows(script_path: Path) -> bool:
    python_exec = sys.executable
    cmd = f'title Erro Automacao WhatsApp && "{python_exec}" "{script_path}"'
    subprocess.Popen(["cmd.exe", "/c", "start", "cmd.exe", "/k", cmd], shell=True)
    return True


def _abrir_terminal_macos(script_path: Path) -> bool:
    python_exec = sys.executable
    comando = f'tell application "Terminal" to do script "{python_exec} {script_path}"'
    subprocess.Popen(["osascript", "-e", comando], start_new_session=True)
    return True


def abrir_janela_terminal(titulo: str, mensagem: str) -> None:
    """Abre uma janela de terminal separada mostrando o erro."""
    mensagem = _normalizar_texto(mensagem)
    script_path = _criar_script_terminal(titulo, mensagem)

    try:
        sistema = platform.system().lower()
        abriu = False

        if "windows" in sistema:
            abriu = _abrir_terminal_windows(script_path)
        elif "darwin" in sistema:
            abriu = _abrir_terminal_macos(script_path)
        else:
            abriu = _abrir_terminal_linux(script_path)

        if abriu:
            return

        logger.error("Nenhum emulador de terminal gráfico encontrado. Exibindo erro no terminal atual.")
        print("\n" + "=" * 90)
        print(titulo)
        print("=" * 90)
        print(mensagem)
        print("=" * 90 + "\n")

    except Exception:
        logger.exception("Não foi possível abrir janela de terminal para erro.")
        logger.error("%s\n%s", titulo, mensagem)


def mostrar_erro_simples(exc: BaseException) -> None:
    mensagem = f"""
⚠️ Ocorreu uma oscilação temporária na automação.

Possíveis causas:
- Wi-Fi/internet oscilando;
- WhatsApp Web demorou para responder;
- Chrome/Firefox travou momentaneamente;
- o computador ficou lento durante a execução.

COMO RESOLVER:
1. Volte para a página web do Sistema de Chamadas.
2. Clique novamente em "Executar Automação".
3. Se o problema persistir, reinicie o computador e tente novamente.

Detalhe técnico:
{type(exc).__name__}: {exc}
"""
    abrir_janela_terminal("⚠️ ERRO TEMPORÁRIO NA AUTOMAÇÃO WHATSAPP", mensagem)


def mostrar_erro_critico(exc: BaseException) -> None:
    erro_bruto = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    mensagem = f"""
❌ ERRO CRÍTICO NO SISTEMA.

COMO RESOLVER:
Por favor, tire uma FOTO desta tela inteira agora mesmo e envie imediatamente para a Administração/Suporte Técnico.
O desenvolvedor precisa ver o erro técnico completo abaixo para corrigir o problema.

========== ERRO TÉCNICO ==========
{erro_bruto}
"""
    abrir_janela_terminal("❌ ERRO CRÍTICO NA AUTOMAÇÃO WHATSAPP", mensagem)

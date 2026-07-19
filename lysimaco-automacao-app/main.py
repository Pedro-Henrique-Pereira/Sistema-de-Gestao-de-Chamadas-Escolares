import sys

from app.ui import LysimacoAutomacaoApp


if __name__ == "__main__":
    app = LysimacoAutomacaoApp(autostart_requested="--autostart" in sys.argv)
    app.mainloop()

# ui_log.py — versão PySide6
import os
import sys
import threading
import time
from pathlib import Path

# (Opcional) Bootstrap do runtime Qt empacotado:
# Ajuste se você levar Qt junto (ex.: resources/Qt/bin e resources/Qt/plugins)
try:
    base_dir = Path(sys.executable).parent
    qt_bin = base_dir / "Qt" / "bin"
    qt_plugins = base_dir / "Qt" / "plugins"
    if qt_bin.exists():
        os.add_dll_directory(str(qt_bin))  # Windows 10+ / Py3.8+
    if qt_plugins.exists():
        os.environ.setdefault("QT_PLUGIN_PATH", str(qt_plugins))
except Exception:
    pass

try:
    from PySide6.QtCore import Qt, QObject, Signal, Slot
    from PySide6.QtGui import QFont
    from PySide6.QtWidgets import (
        QApplication, QMainWindow, QWidget, QLabel, QScrollArea,
        QVBoxLayout, QHBoxLayout, QFrame, QSizePolicy, QSpacerItem
    )
    QT_OK = True
except Exception as e:
    QT_OK = False
    QT_ERR = e

# ===== Estado global =====
_app = None
_ui_thread = None
_bridge = None
_window = None

# Paleta
BG = "#1f2329"
TEXT = "#ffffff"
TEXT_MUTED = "#cbd5e1"
BORDER = "#2e3440"


class Bridge(QObject):
    update_payload = Signal(dict)
    show_and_raise = Signal()


class ProductLogWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Product Log")
        self.resize(860, 600)
        self._setup_style()
        self._build_ui()

    def _setup_style(self):
        # Estilo dark minimal
        self.setStyleSheet(f"""
            QWidget {{ background: {BG}; color: {TEXT}; font-family: 'Segoe UI', Arial, sans-serif; }}
            QLabel[muted="true"] {{ color: {TEXT_MUTED}; }}
            QFrame#line {{ background: {BORDER}; min-height: 1px; max-height: 1px; }}
            QScrollArea {{ border: none; }}
        """)

    def _build_ui(self):
        central = QWidget()
        outer = QVBoxLayout(central)
        outer.setContentsMargins(12, 12, 12, 12)
        outer.setSpacing(0)

        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)

        self.content = QWidget()
        self.vbox = QVBoxLayout(self.content)
        self.vbox.setContentsMargins(0, 0, 0, 0)
        self.vbox.setSpacing(8)

        self.scroll.setWidget(self.content)
        outer.addWidget(self.scroll)
        self.setCentralWidget(central)

    def closeEvent(self, event):
        # Esconde ao fechar (igual ao Tk)
        event.ignore()
        self.hide()

    @Slot(dict)
    def render(self, payload: dict):
        # Limpa
        while self.vbox.count():
            item = self.vbox.takeAt(0)
            w = item.widget()
            if w:
                w.deleteLater()

        imported = payload.get("imported_files") or []
        not_found = payload.get("not_found_files") or []
        total = payload.get("total_files") or 0

        self._add_label("📦 Product Log", size=16, bold=True, pady=6)
        self._add_label(
            f"Total solicitado: {total} · ✅ encontrados: {len(imported)} · ❌ não encontrados: {len(not_found)}",
            muted=True, pady=10
        )

        # ❌ Não encontrados (em cima)
        if not_found:
            self._add_label("--- Não encontrados ---", size=12, bold=True, pady=6)
            for i, code in enumerate(not_found):
                self._add_row("❌", code)
                if i < len(not_found) - 1:
                    self._add_divider()
            self._add_divider(pady=10)

        # ☑️ Importados (embaixo)
        if imported:
            self._add_label("--- Importados ---", size=12, bold=True, pady=6)
            for i, name in enumerate(imported):
                self._add_row("✅", name)
                if i < len(imported) - 1:
                    self._add_divider()

    def _add_label(self, text, size=10, bold=False, muted=False, pady=0):
        lbl = QLabel(text)
        f = QFont()
        f.setPointSize(size)
        f.setBold(bold)
        lbl.setFont(f)
        lbl.setWordWrap(True)
        if muted:
            lbl.setProperty("muted", True)
        self.vbox.addWidget(lbl)
        if pady:
            self.vbox.addItem(QSpacerItem(0, pady, QSizePolicy.Minimum, QSizePolicy.Fixed))
        return lbl

    def _add_divider(self, pady=6):
        line = QFrame()
        line.setObjectName("line")
        self.vbox.addWidget(line)
        if pady:
            self.vbox.addItem(QSpacerItem(0, pady, QSizePolicy.Minimum, QSizePolicy.Fixed))

    def _add_row(self, emoji, text):
        row = QWidget()
        h = QHBoxLayout(row)
        h.setContentsMargins(0, 0, 0, 0)
        h.setSpacing(10)

        em = QLabel(emoji)
        ef = QFont("Segoe UI Emoji", 12)
        em.setFont(ef)
        em.setFixedWidth(24)

        tx = QLabel(text)
        tx.setWordWrap(True)

        h.addWidget(em, 0, Qt.AlignTop)
        h.addWidget(tx, 1)

        self.vbox.addWidget(row)


def _ui_loop():
    global _app, _window, _bridge
    _app = QApplication.instance() or QApplication(sys.argv)
    _app.setQuitOnLastWindowClosed(False)

    _bridge = Bridge()
    _window = ProductLogWindow()

    _bridge.update_payload.connect(_window.render, Qt.QueuedConnection)
    _bridge.show_and_raise.connect(lambda: (_window.show(), _window.raise_(), _window.activateWindow()),
                                   Qt.QueuedConnection)

    _window.show()
    _app.exec()


def _ensure_ui_thread():
    global _ui_thread
    if _ui_thread and _ui_thread.is_alive():
        return
    _ui_thread = threading.Thread(target=_ui_loop, daemon=True)
    _ui_thread.start()


def show_product_log(payload: dict):
    """Abre/atualiza a janela com o payload do log (dark, linhas simples, não encontrados primeiro)."""
    if not QT_OK:
        return {"ok": False, "message": f"PySide6 indisponível: {QT_ERR}"}

    _ensure_ui_thread()

    # Espera ponte ficar pronta
    for _ in range(200):
        if _bridge and _window:
            break
        time.sleep(0.01)

    if not (_bridge and _window):
        return {"ok": False, "message": "Falha ao iniciar UI Qt."}

    # Atualiza e traz à frente
    try:
        _bridge.update_payload.emit(payload or {})
        _bridge.show_and_raise.emit()
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "message": f"Erro ao atualizar UI: {e}"}

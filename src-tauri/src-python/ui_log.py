# ui_log.py
import threading
import sys

try:
    import tkinter as tk
    TK_OK = True
except Exception as e:
    TK_OK = False
    TK_ERR = e

_root = None
_ui_thread = None
_container = None
_canvas = None

# === Paleta (dark minimal) ===
BG = "#1f2329"          # fundo geral
TEXT = "#ffffff"        # texto principal
TEXT_MUTED = "#cbd5e1"  # texto secundário
BORDER = "#2e3440"      # divisor sutil

def _start_ui_loop():
    """Sobe o mainloop do Tk em uma thread daemon (uma vez)."""
    global _ui_thread
    if _ui_thread and _ui_thread.is_alive():
        return

    def _loop():
        global _root, _container, _canvas

        _root = tk.Tk()
        _root.title("Product Log")
        _root.geometry("860x600")
        _root.configure(bg=BG)
        _root.protocol("WM_DELETE_WINDOW", _root.withdraw)  # esconder ao fechar

        # ===== Canvas + Scrollbar =====
        wrapper = tk.Frame(_root, bg=BG)
        wrapper.pack(fill="both", expand=True)

        _canvas = tk.Canvas(wrapper, bg=BG, highlightthickness=0, bd=0)
        vscroll = tk.Scrollbar(wrapper, orient="vertical", command=_canvas.yview)
        _canvas.configure(yscrollcommand=vscroll.set)

        _canvas.pack(side="left", fill="both", expand=True)
        vscroll.pack(side="right", fill="y")

        # Frame interno rolável
        _container = tk.Frame(_canvas, bg=BG)
        _canvas_window = _canvas.create_window((0, 0), window=_container, anchor="nw")

        def _on_frame_configure(event=None):
            _canvas.configure(scrollregion=_canvas.bbox("all"))
        _container.bind("<Configure>", _on_frame_configure)

        def _on_canvas_configure(event):
            _canvas.itemconfig(_canvas_window, width=event.width)
        _canvas.bind("<Configure>", _on_canvas_configure)

        # ===== Scroll do mouse =====
        def _on_mousewheel(event):
            if sys.platform == "darwin":
                _canvas.yview_scroll(int(-1 * (event.delta)), "units")
            else:
                _canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
        _canvas.bind_all("<MouseWheel>", _on_mousewheel)
        _canvas.bind_all("<Button-4>", lambda e: _canvas.yview_scroll(-1, "units"))  # Linux up
        _canvas.bind_all("<Button-5>", lambda e: _canvas.yview_scroll( 1, "units"))  # Linux down

        _root.mainloop()

    _ui_thread = threading.Thread(target=_loop, daemon=True)
    _ui_thread.start()


def _label(parent, text, size=10, bold=False, fg=TEXT, bg=BG, pady=0):
    font = ("Segoe UI", size, "bold" if bold else "normal")
    lbl = tk.Label(parent, text=text, fg=fg, bg=bg, font=font, justify="left", anchor="w")
    if pady:
        lbl.pack(anchor="w", pady=pady)
    else:
        lbl.pack(anchor="w")
    return lbl

def _divider(parent, pad_y=6):
    # linha divisória sutil
    tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=pad_y)

def _row(parent, emoji, text):
    # linha simples: emoji + texto, sem cores adicionais
    row = tk.Frame(parent, bg=BG)
    row.pack(fill="x", pady=2)
    tk.Label(row, text=emoji, fg=TEXT, bg=BG, font=("Segoe UI Emoji", 12)).pack(side="left", padx=(0, 10))
    tk.Label(row, text=text, fg=TEXT, bg=BG, wraplength=780, justify="left", anchor="w")\
        .pack(side="left", fill="x", expand=True)

def _render(payload: dict):
    global _root, _container
    if not _root or not _container:
        return

    # limpa
    for w in list(_container.winfo_children()):
        w.destroy()

    imported = payload.get("imported_files", []) or []
    not_found = payload.get("not_found_files", []) or []
    total = payload.get("total_files", 0)

    # Header
    _label(_container, "📦 Product Log", size=16, bold=True, pady=6)
    _label(
        _container,
        f"Total solicitado: {total} · ☑️ encontrados: {len(imported)} · ❌ não encontrados: {len(not_found)}",
        fg=TEXT_MUTED,
        pady=10
    )

    # ===== ❌ Não encontrados (EM CIMA) =====
    if not_found:
        _label(_container, "❌ Não encontrados", size=12, bold=True, pady=6)
        for i, code in enumerate(not_found):
            _row(_container, "❌", code)
            if i < len(not_found) - 1:
                _divider(_container, pad_y=4)
        _divider(_container, pad_y=10)

    # ===== ☑️ Importados (EMBAIXO) =====
    if imported:
        _label(_container, "☑️ Importados", size=12, bold=True, pady=6)
        for i, name in enumerate(imported):
            _row(_container, "☑️", name)
            if i < len(imported) - 1:
                _divider(_container, pad_y=4)

    # sem botão de fechar — usa o X da própria janela


def show_product_log(payload: dict):
    """Abre/atualiza a janela com o payload do log (dark, linhas simples, não encontrados primeiro)."""
    if not TK_OK:
        return {"ok": False, "message": f"Tkinter indisponível: {TK_ERR}"}

    _start_ui_loop()

    def _update():
        try:
            if _root.state() == "withdrawn":
                _root.deiconify()
            _root.lift()
            _root.focus_force()
            _render(payload or {})
        except Exception as e:
            print("Erro ao renderizar Product Log:", e)

    # aguarda o Tk iniciar e agenda a atualização
    import time
    for _ in range(50):
        if _root:
            try:
                _root.after(0, _update)
                break
            except:
                pass
        time.sleep(0.02)

    return {"ok": True}

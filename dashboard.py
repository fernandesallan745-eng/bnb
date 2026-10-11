import tkinter as tk
import json
import os
import subprocess
import sys


# ============================================================
# ARKAI — DASHBOARD
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROFILE_PATH = os.path.join(BASE_DIR, "calibration_profile.json")

BG = "#f6f5f0"
CARD = "#ffffff"
CARD_2 = "#ffffff"
TEXT = "#1a1917"
MUTED = "#5c5c58"
ACCENT = "#699890"
SUCCESS = "#2d6759"
WARNING = "#9a6b2f"
LINE = "#e3e1da"
FONT = "Helvetica"


root = tk.Tk()
root.title("ARKAI")
root.geometry("980x640")
root.minsize(860, 560)
root.configure(bg=BG)

gesture_var = tk.StringVar(value="READY")
confidence_var = tk.StringVar(value="0%")
action_var = tk.StringVar(value="SYSTEM READY")
calibration_var = tk.StringVar(value="Checking...")


def create_card(parent):
    return tk.Frame(
        parent,
        bg=CARD,
        highlightthickness=1,
        highlightbackground=LINE,
    )


def section_label(parent, text):
    return tk.Label(
        parent,
        text=text,
        fg=MUTED,
        bg=CARD,
        font=(FONT, 10, "bold"),
    )


def launch_accessai():
    try:
        subprocess.Popen(
            [sys.executable, os.path.join(BASE_DIR, "accessai.py")]
        )
        action_var.set("ARKAI STARTED")
    except Exception as e:
        action_var.set(f"ERROR: {e}")


def recalibrate():
    try:
        subprocess.Popen(
            [sys.executable, os.path.join(BASE_DIR, "calibration.py")]
        )
        action_var.set("CALIBRATION STARTED")
    except Exception as e:
        action_var.set(f"ERROR: {e}")


def close_dashboard():
    root.destroy()


def make_button(parent, text, command, primary=False):
    bg = ACCENT if primary else CARD_2
    fg = "white" if primary else TEXT
    pressed = "#5c827b" if primary else "#eef4f2"

    # A label keeps the fill color. macOS draws tk.Button with the system gray.
    control = tk.Label(
        parent,
        text=text,
        bg=bg,
        fg=fg,
        font=(FONT, 11, "bold"),
        padx=18,
        pady=10,
        cursor="hand2",
        highlightthickness=1,
        highlightbackground=ACCENT if primary else LINE,
    )

    def on_press(_event):
        control.configure(bg=pressed)

    def on_release(_event):
        control.configure(bg=bg)
        command()

    control.bind("<ButtonPress-1>", on_press)
    control.bind("<ButtonRelease-1>", on_release)
    return control


# ============================================================
# HEADER — title on the left, actions on the right
# ============================================================

header = tk.Frame(root, bg=BG)
header.pack(fill="x", padx=28, pady=(22, 8))

title_block = tk.Frame(header, bg=BG)
title_block.pack(side="left", anchor="w")

tk.Label(
    title_block,
    text="ARKAI",
    fg=TEXT,
    bg=BG,
    font=(FONT, 26, "bold"),
).pack(anchor="w")

tk.Label(
    title_block,
    text="ARKA   ·   HANDS-FREE COMPUTER ACCESS",
    fg=ACCENT,
    bg=BG,
    font=(FONT, 10, "bold"),
).pack(anchor="w", pady=(2, 0))

actions = tk.Frame(header, bg=BG)
actions.pack(side="right", anchor="e")

make_button(actions, "EXIT", close_dashboard).pack(side="right")
make_button(actions, "RECALIBRATE", recalibrate).pack(side="right", padx=(0, 8))
make_button(actions, "START ARKAI", launch_accessai, primary=True).pack(
    side="right", padx=(0, 8)
)


# ============================================================
# STATUS STRIP — three equal cards
# ============================================================

status_row = tk.Frame(root, bg=BG)
status_row.pack(fill="x", padx=28, pady=(12, 8))
for column in range(3):
    status_row.columnconfigure(column, weight=1, uniform="status")


def status_card(column, title, variable, value_size=18, value_color=TEXT):
    card = create_card(status_row)
    card.grid(row=0, column=column, sticky="nsew", padx=(0 if column == 0 else 8, 0))
    section_label(card, title).pack(anchor="w", padx=18, pady=(14, 4))
    tk.Label(
        card,
        textvariable=variable,
        fg=value_color,
        bg=CARD,
        font=(FONT, value_size, "bold"),
        wraplength=240,
        justify="left",
    ).pack(anchor="w", padx=18, pady=(0, 16))
    return card


gesture_card = status_card(0, "CURRENT GESTURE", gesture_var, 20)
tk.Label(
    gesture_card,
    textvariable=confidence_var,
    fg=SUCCESS,
    bg=CARD,
    font=(FONT, 13, "bold"),
).pack(anchor="w", padx=18, pady=(0, 14))
status_card(1, "LAST ACTION", action_var, 14)
status_card(2, "CALIBRATION", calibration_var, 13, SUCCESS)


# ============================================================
# MAIN — how to control, then the modules that are on
# ============================================================

main = tk.Frame(root, bg=BG)
main.pack(fill="both", expand=True, padx=28, pady=(8, 24))
main.columnconfigure(0, weight=3)
main.columnconfigure(1, weight=2)
main.rowconfigure(0, weight=1)

guide = create_card(main)
guide.grid(row=0, column=0, sticky="nsew", padx=(0, 8))

section_label(guide, "HOW TO CONTROL").pack(anchor="w", padx=22, pady=(18, 12))

steps = [
    ("1", "Look around", "Head movement moves the pointer."),
    ("2", "Blink or tilt", "A long blink clicks. Resting the pointer also clicks. A tilt scrolls."),
    ("3", "Point, then speak", "Look at a link or button, then say click, open this, right click, or scroll."),
]

for number, heading, detail in steps:
    row = tk.Frame(guide, bg=CARD)
    row.pack(fill="x", padx=22, pady=8)

    badge = tk.Label(
        row,
        text=number,
        fg="white",
        bg=ACCENT,
        font=(FONT, 12, "bold"),
        width=2,
        padx=6,
        pady=4,
    )
    badge.pack(side="left", anchor="n", padx=(0, 14))

    text = tk.Frame(row, bg=CARD)
    text.pack(side="left", fill="x", expand=True)
    tk.Label(
        text,
        text=heading,
        fg=TEXT,
        bg=CARD,
        font=(FONT, 15, "bold"),
        anchor="w",
    ).pack(anchor="w")
    tk.Label(
        text,
        text=detail,
        fg=MUTED,
        bg=CARD,
        font=(FONT, 12),
        anchor="w",
        justify="left",
        wraplength=420,
    ).pack(anchor="w", pady=(2, 0))


modules = create_card(main)
modules.grid(row=0, column=1, sticky="nsew")

section_label(modules, "CONTROL MODULES").pack(anchor="w", padx=22, pady=(18, 8))

for name in (
    "Face cursor",
    "Blink click",
    "Head-tilt scroll",
    "Voice commands",
    "Point and speak",
):
    row = tk.Frame(modules, bg=CARD)
    row.pack(fill="x", padx=22, pady=7)
    tk.Label(
        row,
        text="●",
        fg=SUCCESS,
        bg=CARD,
        font=(FONT, 13),
    ).pack(side="left", padx=(0, 10))
    tk.Label(
        row,
        text=name,
        fg=TEXT,
        bg=CARD,
        font=(FONT, 13),
    ).pack(side="left")


# ============================================================
# CALIBRATION STATUS
# ============================================================

def check_calibration():
    if not os.path.exists(PROFILE_PATH):
        calibration_var.set("Not calibrated")
        return

    try:
        with open(PROFILE_PATH, "r", encoding="utf-8") as file:
            profile = json.load(file)
        if "calibration" in profile or "center_x" in profile or "CENTER_X" in profile:
            calibration_var.set("Calibration loaded")
        else:
            calibration_var.set("Profile incomplete")
    except Exception:
        calibration_var.set("Profile error")


check_calibration()


def demo_status():
    states = [
        ("READY", "0%", "SYSTEM READY"),
        ("HEAD TRACKING", "94%", "CURSOR CONTROL"),
        ("BLINK", "98%", "CLICK"),
        ("TILT DOWN", "96%", "SCROLL DOWN"),
        ("POINT + VOICE", "92%", "POINT + CLICK"),
    ]
    gesture, confidence, action = states[demo_status.counter % len(states)]
    gesture_var.set(gesture)
    confidence_var.set(confidence)
    action_var.set(action)
    demo_status.counter += 1
    root.after(3500, demo_status)


demo_status.counter = 0
demo_status()

root.mainloop()

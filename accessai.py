import os
import sys
import json
import math
import time
import threading
import subprocess
import wave
import tempfile
import difflib
import re
import ctypes

try:
    import soundcard as sc
    import numpy as np
    SOUNDCARD_AVAILABLE = True
except ImportError:
    sc = None
    np = None
    SOUNDCARD_AVAILABLE = False

import cv2
import mediapipe as mp
import pyautogui

# SpeechRecognition is optional at import time so the facial system can
# still start if the voice package is unavailable.
try:
    import speech_recognition as sr
    SPEECH_AVAILABLE = True
except ImportError:
    sr = None
    SPEECH_AVAILABLE = False

try:
    from faster_whisper import WhisperModel
    WHISPER_AVAILABLE = True
except ImportError:
    WhisperModel = None
    WHISPER_AVAILABLE = False


def _load_env_file():
    """Load KEY=VALUE pairs from .env without overriding the real environment."""
    env_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        ".env",
    )
    if not os.path.exists(env_path):
        return

    with open(env_path, encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            name = name.strip()
            value = value.strip().strip('"').strip("'")
            if name and name not in os.environ:
                os.environ[name] = value


_load_env_file()


# ============================================================
# ACCESSAI NEXUS
# Hands-Free Computer Accessibility
#
# FACE
#   Head movement -> cursor
#   Blink         -> left click
#   Head tilt     -> scroll
#
# VOICE
#   Open Chrome
#   Open Calculator
#   Open Documents
#   Go back / forward
#   Refresh
#   Scroll up / down
#   Click
#   Enter / Space
#   Stop AccessAI
#
# IMPORTANT FIX
# Voice recognition runs in ONE background thread and has a
# strict SpeechRecognition operation timeout. It never runs
# inside the camera loop, so a Google/network delay cannot
# freeze the camera window.
# ============================================================


# ============================================================
# PATHS
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "models", "face_landmarker.task")
CALIBRATION_PATH = os.path.join(BASE_DIR, "calibration_profile.json")


# ============================================================
# CAMERA / PERFORMANCE
# ============================================================

CAMERA_INDEX = 0
CAMERA_WIDTH = 640
CAMERA_HEIGHT = 480
PROCESS_EVERY_N_FRAMES = 1

# Keep OpenCV camera buffer small to reduce latency.
CAMERA_BUFFER_SIZE = 1


# ============================================================
# SCREEN
# ============================================================

SCREEN_WIDTH, SCREEN_HEIGHT = pyautogui.size()

current_x = SCREEN_WIDTH / 2
current_y = SCREEN_HEIGHT / 2

# Most of the remaining distance is applied every frame, so a head
# turn reaches the target in a few frames instead of crawling there.
CURSOR_SMOOTHING = 0.72
MAX_CURSOR_STEP = 420
CURSOR_DEADZONE = 0.004


# ============================================================
# VISUAL CONTROL BOX
# ============================================================

BOX_LEFT = 0.20
BOX_RIGHT = 0.80
BOX_TOP = 0.12
BOX_BOTTOM = 0.88


# ============================================================
# CENTER LOCK
# ============================================================

CENTER_LOCK_ENTER_X = 0.012
CENTER_LOCK_ENTER_Y = 0.012

CENTER_LOCK_EXIT_X = 0.022
CENTER_LOCK_EXIT_Y = 0.020

center_locked = False


# ============================================================
# FALLBACK CALIBRATION
# These are the user's latest calibration values.
# calibration_profile.json is preferred when available.
# ============================================================

CALIBRATION = {
    "center_x": 0.4088,
    "center_y": 0.5114,
    "left_x": 0.2157,
    "right_x": 0.5380,
    "up_y": 0.2805,
    "down_y": 0.7689,
}


def load_calibration():
    data = dict(CALIBRATION)

    if not os.path.exists(CALIBRATION_PATH):
        print("⚠ calibration_profile.json not found.")
        print("  Using the latest saved calibration values.")
        return data

    try:
        with open(CALIBRATION_PATH, "r", encoding="utf-8") as f:
            loaded = json.load(f)

        # Accept either the current naming convention or the
        # common uppercase convention used by earlier versions.
        aliases = {
            "center_x": ["center_x", "CENTER_X", "CENTER", "center"],
            "center_y": ["center_y", "CENTER_Y"],
            "left_x": ["left_x", "LEFT_X", "left"],
            "right_x": ["right_x", "RIGHT_X", "right"],
            "up_y": ["up_y", "UP_Y", "up"],
            "down_y": ["down_y", "DOWN_Y", "down"],
        }

        for key, possible in aliases.items():
            for name in possible:
                if name in loaded:
                    value = loaded[name]

                    # Some calibration files may store CENTER as
                    # [x, y].
                    if key == "center_x" and isinstance(value, (list, tuple)):
                        value = value[0]
                    elif key == "center_y" and isinstance(value, (list, tuple)):
                        value = value[1]

                    data[key] = float(value)
                    break

        print("✓ Calibration loaded")
        print(
            f"  CENTER: ({data['center_x']:.4f}, "
            f"{data['center_y']:.4f})"
        )
        print(
            f"  LEFT:   {data['left_x']:.4f}   "
            f"RIGHT: {data['right_x']:.4f}"
        )
        print(
            f"  UP:     {data['up_y']:.4f}   "
            f"DOWN: {data['down_y']:.4f}"
        )

    except Exception as e:
        print(f"⚠ Calibration file could not be read: {e}")
        print("  Using the latest saved calibration values.")

    return data


CAL = load_calibration()

CENTER_X = CAL["center_x"]
CENTER_Y = CAL["center_y"]
LEFT_X = CAL["left_x"]
RIGHT_X = CAL["right_x"]
UP_Y = CAL["up_y"]
DOWN_Y = CAL["down_y"]

# Use the larger side of the calibration span so the mapping is
# symmetric around the user's real center.
HORIZONTAL_SPAN = max(
    abs(CENTER_X - LEFT_X),
    abs(RIGHT_X - CENTER_X),
)

VERTICAL_SPAN = max(
    abs(CENTER_Y - UP_Y),
    abs(DOWN_Y - CENTER_Y),
)

if HORIZONTAL_SPAN < 0.03:
    HORIZONTAL_SPAN = 0.20

if VERTICAL_SPAN < 0.03:
    VERTICAL_SPAN = 0.20


# ============================================================
# BLINK
# ============================================================

BLINK_THRESHOLD = 0.20
# Eyes count as closed below this share of the user's own open-eye value,
# because a fixed 0.20 misses people whose open EAR is low or high.
BLINK_CLOSED_RATIO = 0.72
# The landmark model flickers "open" for a frame during a held blink.
BLINK_OPEN_FRAMES = 3
# A normal blink is shorter than this. Only a held blink counts as a click.
MIN_BLINK_DURATION = 0.35
MAX_BLINK_DURATION = 2.00
BLINK_COOLDOWN = 1.15

# Holding the pointer still on one spot is the other way to click.
DWELL_SECONDS = 1.35
DWELL_RADIUS = 32
INTENT_COOLDOWN = 1.15

blink_start = None
last_blink = 0.0
blink_open_frames = 0
blink_anchor = None
ear_baseline = None


# ============================================================
# SCROLL
# ============================================================

TILT_THRESHOLD = 0.10
SCROLL_STEP = 5

SCROLL_INTERVAL = 0.08

TILT_CONFIRM_FRAMES = 4
TILT_RELEASE_FRAMES = 3

tilt_state = 0
tilt_candidate = 0
tilt_candidate_frames = 0
tilt_release_frames = 0

last_scroll_time = 0.0


# ============================================================
# VOICE
# ============================================================

VOICE_ENABLED = True

# Device 8 is the pTron BT headset input that produced the strongest
# real microphone signal in the latest hardware test.
# AccessAI now uses the Windows default microphone through SoundCard/WASAPI.
# This avoids the corrupted PyAudio/PortAudio input endpoints encountered
# during testing.
VOICE_SAMPLE_RATE = 16000
VOICE_CHANNELS = 1
VOICE_RECORD_SECONDS = 2.2

# Shorter pause/cooldown makes commands feel more immediate.
VOICE_COOLDOWN = 0.20
VOICE_IDLE_PAUSE = 0.25

# IMPORTANT:
# SpeechRecognition applies this timeout to operations such as
# the Google request. This prevents an indefinitely blocked
# recognition call.
VOICE_OPERATION_TIMEOUT = 2.5

# Local fallback when Google misses a short command. base.en stays on CPU.
VOICE_MODEL_SIZE = "base.en"
VOICE_COMPUTE_TYPE = "int8"
VOICE_INITIAL_PROMPT = (
    "ARKAI commands: click, left click, right click, double click, "
    "open this, select, scroll up, scroll down, refresh, go back, stop ARKAI."
)
voice_model = None

# Google often returns a fragment of a point-and-speak command.
# These map that fragment onto the action for the locked pointer.
_POINT_ALIASES = {
    "click": "click",
    "left click": "click",
    "lick": "click",
    "lock": "click",
    "clip": "click",
    "quick": "click",
    "flick": "click",
    "clerk": "click",
    "klick": "click",
    "right": "right click",
    "right click": "right click",
    "write": "right click",
    "write click": "right click",
    "double": "double click",
    "double click": "double click",
    "scroll up": "scroll up",
    "scroll upward": "scroll up",
    "scroll down": "scroll down",
    "scroll downward": "scroll down",
    "open this": "open this",
    "select": "select",
    "select this": "select this",
    "yes": "click",
    "confirm": "click",
    "confirm click": "click",
}

voice_stop_event = threading.Event()
voice_thread = None

last_voice_text = ""
last_voice_time = 0.0

# Prevent multiple voice workers from ever being started.
voice_started = False


# ============================================================
# APPLICATION STATE
# ============================================================

running = True
frame_counter = 0

status_text = "READY"
status_until = 0.0

face_detected = False
voice_status = "VOICE READY"

# Screen point locked when the user starts speaking, so the voice command
# acts on the element they were pointing at rather than where the cursor
# drifts while the phrase is recognized.
pointed_target = None
point_hold_until = 0.0
voice_busy = False

dwell_anchor = None
dwell_started = None
dwell_progress = 0.0
last_intentional_click = 0.0

# While on, ordinary speech is typed into the focused text field.
typing_mode = False


def set_status(message, seconds=1.5):
    global status_text, status_until
    status_text = message
    status_until = time.time() + seconds
    print(message)


def note_intentional_activation():
    """Start the cooldown that blocks a second accidental click."""
    global last_intentional_click, dwell_anchor, dwell_started, dwell_progress
    last_intentional_click = time.time()
    dwell_anchor = None
    dwell_started = None
    dwell_progress = 0.0


def intentional_click(label):
    """Click only after a dwell or a deliberate long blink."""
    global last_blink
    now = time.time()
    if now - last_intentional_click < INTENT_COOLDOWN:
        return False
    pyautogui.click()
    last_blink = now
    note_intentional_activation()
    set_status(label, 0.9)
    return True


def update_dwell():
    """Click when the pointer rests on one element. Movement cancels it."""
    global dwell_anchor, dwell_started, dwell_progress

    now = time.time()
    if (
        voice_busy
        or typing_mode
        or center_locked
        or now < point_hold_until
        or now - last_intentional_click < INTENT_COOLDOWN
    ):
        dwell_anchor = None
        dwell_started = None
        dwell_progress = 0.0
        return

    x, y = int(current_x), int(current_y)
    if (
        dwell_anchor is None
        or math.hypot(x - dwell_anchor[0], y - dwell_anchor[1]) > DWELL_RADIUS
    ):
        dwell_anchor = (x, y)
        dwell_started = now
        dwell_progress = 0.0
        return

    dwell_progress = min(1.0, (now - dwell_started) / DWELL_SECONDS)
    if dwell_progress >= 1.0:
        intentional_click("DWELL → CLICK")


# ============================================================
# FACE HELPERS
# ============================================================

def distance(p1, p2):
    return math.sqrt(
        (p1.x - p2.x) ** 2 +
        (p1.y - p2.y) ** 2
    )


def eye_aspect_ratio(landmarks, eye):
    p1 = landmarks[eye[0]]
    p2 = landmarks[eye[1]]
    p3 = landmarks[eye[2]]
    p4 = landmarks[eye[3]]
    p5 = landmarks[eye[4]]
    p6 = landmarks[eye[5]]

    vertical_1 = distance(p2, p6)
    vertical_2 = distance(p3, p5)
    horizontal = distance(p1, p4)

    if horizontal == 0:
        return 0.0

    return (
        vertical_1 + vertical_2
    ) / (2 * horizontal)


LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]


# ============================================================
# CURSOR MAPPING
# ============================================================

def clamp(value, low, high):
    return max(low, min(high, value))


def map_cursor(face_x, face_y):
    """
    Map the calibrated face center to the exact screen center.

    This deliberately does NOT use LEFT_X -> 0 and RIGHT_X -> 1
    directly because the user's calibration center is not exactly
    halfway between those measured points.
    """

    global center_locked

    dx = face_x - CENTER_X
    dy = face_y - CENTER_Y

    # Center deadzone.
    if (
        abs(dx) <= CENTER_LOCK_ENTER_X
        and abs(dy) <= CENTER_LOCK_ENTER_Y
    ):
        center_locked = True

    elif (
        abs(dx) > CENTER_LOCK_EXIT_X
        or abs(dy) > CENTER_LOCK_EXIT_Y
    ):
        center_locked = False

    if center_locked:
        return SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2

    normalized_x = 0.5 + (
        dx / (2.0 * HORIZONTAL_SPAN)
    )

    normalized_y = 0.5 + (
        dy / (2.0 * VERTICAL_SPAN)
    )

    normalized_x = clamp(normalized_x, 0.0, 1.0)
    normalized_y = clamp(normalized_y, 0.0, 1.0)

    return (
        normalized_x * (SCREEN_WIDTH - 1),
        normalized_y * (SCREEN_HEIGHT - 1),
    )


def move_cursor(target_x, target_y):
    global current_x, current_y

    # Hold the pointer still while a point-and-speak command is applied.
    if time.time() < point_hold_until:
        return

    # When the face is close to the calibrated center, smoothly anchor the
    # cursor instead of repeatedly jumping between the locked center and a
    # mapped position. The narrower enter zone + wider exit zone above gives
    # hysteresis and prevents center jitter.
    if center_locked:
        target_x = SCREEN_WIDTH / 2
        target_y = SCREEN_HEIGHT / 2

    dx = target_x - current_x
    dy = target_y - current_y

    if abs(dx) < SCREEN_WIDTH * CURSOR_DEADZONE:
        dx = 0

    if abs(dy) < SCREEN_HEIGHT * CURSOR_DEADZONE:
        dy = 0

    distance_to_target = math.hypot(dx, dy)

    if distance_to_target > MAX_CURSOR_STEP:
        scale = MAX_CURSOR_STEP / distance_to_target
        dx *= scale
        dy *= scale

    current_x += dx * CURSOR_SMOOTHING
    current_y += dy * CURSOR_SMOOTHING

    current_x = clamp(current_x, 0, SCREEN_WIDTH - 1)
    current_y = clamp(current_y, 0, SCREEN_HEIGHT - 1)

    try:
        pyautogui.moveTo(
            int(current_x),
            int(current_y),
            duration=0
        )
    except Exception as e:
        print(f"   ⚠ Cursor move failed: {type(e).__name__}: {e}")


# ============================================================
# VOICE ACTIONS
# ============================================================

def focus_window_under_cursor():
    """Bring the top-level window under the current cursor to the foreground.

    This is more reliable than searching for a Chrome window because the user
    may have multiple Chrome windows/tabs, and Windows can reject a background
    SetForegroundWindow call. The click should go to whatever the face cursor
    is actually pointing at.
    """
    if os.name != "nt":
        return False

    try:
        user32 = ctypes.windll.user32

        class POINT(ctypes.Structure):
            _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

        point = POINT()
        user32.GetCursorPos(ctypes.byref(point))

        hwnd = user32.WindowFromPoint(point)
        if not hwnd:
            return False

        # GA_ROOT = 2
        root = user32.GetAncestor(hwnd, 2)
        if root:
            hwnd = root

        user32.ShowWindow(hwnd, 9)  # SW_RESTORE

        # Attach the current thread to the target window's thread so Windows
        # is more willing to allow the foreground change.
        foreground = user32.GetForegroundWindow()
        current_thread = user32.GetWindowThreadProcessId(
            user32.GetForegroundWindow(), None
        )
        target_thread = user32.GetWindowThreadProcessId(
            hwnd, None
        )

        attached = False
        if current_thread and target_thread and current_thread != target_thread:
            attached = bool(
                user32.AttachThreadInput(
                    current_thread, target_thread, True
                )
            )

        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)

        if attached:
            user32.AttachThreadInput(
                current_thread, target_thread, False
            )

        return True

    except Exception as e:
        print(f"   ⚠ Could not focus window under cursor: {e}")
        return False


def _running_browser():
    """Return a browser that is already open, preferring Chrome."""
    browsers = (
        "Google Chrome",
        "Safari",
        "Arc",
        "Firefox",
        "Microsoft Edge",
        "Brave Browser",
        "Chromium",
    )
    if sys.platform != "darwin":
        return None
    for app_name in browsers:
        found = subprocess.run(
            ["pgrep", "-x", app_name],
            capture_output=True,
        )
        if found.returncode == 0:
            return app_name
    return None


def activate_browser():
    """Bring the open browser forward so shortcuts do not hit the camera window."""
    if sys.platform != "darwin":
        focus_window_under_cursor()
        return False

    app_name = _running_browser()
    if not app_name:
        return False

    subprocess.run(["open", "-a", app_name], check=False)
    time.sleep(0.25)
    return True


def browser_hotkey(*keys):
    activate_browser()
    pyautogui.hotkey(*keys)


def chrome_do(script):
    """Ask Chrome directly. Keystrokes miss when the camera window is in front."""
    if sys.platform != "darwin":
        return False
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"   ⚠ Chrome action failed: {result.stderr.strip()}")
        return False
    return True


def reload_browser_page():
    """Reload the page in the open browser.

    Windows browsers refresh with F5. macOS browsers refresh with Command-R,
    and the camera window is usually in front, so the shortcut has
    to be delivered to the browser.
    """
    if sys.platform != "darwin":
        pyautogui.press("f5")
        return

    if not chrome_do(
        'tell application "Google Chrome" to reload active tab of front window'
    ):
        browser_hotkey("command", "r")


def open_chrome():
    try:
        if sys.platform == "darwin":
            subprocess.Popen(
                ["open", "-a", "Google Chrome", "https://www.google.com"]
            )
        else:
            subprocess.Popen(
                ["cmd", "/c", "start", "", "chrome"],
                shell=False
            )

        time.sleep(0.45)
        focus_window_under_cursor()
        set_status("VOICE → OPEN CHROME")

    except Exception as e:
        print(f"✗ Could not open Chrome: {e}")


def open_calculator():
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", "-a", "Calculator"])
        else:
            subprocess.Popen(["calc.exe"])
        set_status("VOICE → OPEN CALCULATOR")
    except Exception as e:
        print(f"✗ Could not open Calculator: {e}")


def open_documents():
    try:
        documents = os.path.expanduser("~/Documents")
        if sys.platform == "darwin":
            subprocess.Popen(["open", documents])
        else:
            os.startfile(documents)
        set_status("VOICE → OPEN DOCUMENTS")
    except Exception as e:
        print(f"✗ Could not open Documents: {e}")


def _normalize_voice_command(text):
    """Normalize common speech-recognition spacing/punctuation variations."""
    command = text.lower().strip()
    command = command.replace(".", " ")
    command = command.replace(",", " ")
    command = command.replace("?", " ")
    command = command.replace("!", " ")
    command = command.replace("ark ai", "arkai")
    command = command.replace("ark-ai", "arkai")
    command = command.replace("access ai", "arkai")
    command = command.replace("access-ai", "arkai")
    command = command.replace("accessai", "arkai")
    command = command.replace("access i", "arkai")
    command = command.replace("access eye", "arkai")
    command = " ".join(command.split())
    return command


def _looks_like_stop_command(command):
    """Accept common short recognition variants for the emergency stop command."""
    if command in {
        "stop",
        "stop arkai",
        "stop ark ai",
        "stop access",
        "stop accessai",
        "stop assistant",
        "exit arkai",
        "quit arkai",
    }:
        return True

    # A short command such as just "stop" is intentionally sufficient.
    # Google often drops the second half of "stop accessai"; requiring the
    # full phrase makes the emergency stop unnecessarily unreliable.
    if command.startswith("stop") and len(command) <= 24:
        remainder = command[4:].strip()
        allowed_words = {
            "", "arkai", "ark ai", "access", "accessai",
            "now", "it", "please", "assistant", "the assistant"
        }
        if remainder in allowed_words:
            return True

    # Google occasionally produces a small transcription variation.
    # Only compare against stop phrases when the command begins with
    # "stop", so ordinary commands are not accidentally stopped.
    if command.startswith("stop "):
        target = command.replace(" ", "")
        candidates = [
            "stoparkai",
            "stopaccessai",
            "stopaccess",
            "stopassistant",
        ]
        return any(
            difflib.SequenceMatcher(None, target, candidate).ratio() >= 0.78
            for candidate in candidates
        )

    return False


# ============================================================
# VOICE TYPING
# ============================================================

MOD_KEY = "command" if sys.platform == "darwin" else "ctrl"

TYPING_KEYS = {
    "enter": "enter", "press enter": "enter", "hit enter": "enter",
    "return": "enter", "new line": "enter", "next line": "enter",
    "backspace": "backspace", "press backspace": "backspace",
    "back space": "backspace",
    "space": "space", "press space": "space", "space bar": "space",
    "tab": "tab", "press tab": "tab",
    "escape": "esc", "press escape": "esc", "esc": "esc",
    "delete": "delete", "press delete": "delete",
}
TYPING_HOTKEYS = {
    "select all": "a", "select everything": "a",
    "copy": "c", "copy that": "c", "copy this": "c",
    "paste": "v", "paste that": "v", "paste here": "v",
    "cut": "x", "cut that": "x",
    "undo": "z", "undo that": "z",
}
TYPING_ON_PHRASES = (
    "typing mode", "start typing", "start typing mode",
    "enter typing mode", "enable typing", "begin typing",
)
TYPING_OFF_PHRASES = (
    "exit typing", "exit typing mode", "stop typing", "stop typing mode",
    "end typing", "leave typing mode", "quit typing", "command mode",
    "close typing mode", "turn off typing",
)
TYPING_COMMAND_WORDS = [
    "typing mode", "start typing", "exit typing mode", "stop typing",
    "command mode", "select all", "backspace", "escape", "stop ARKAI",
]


def _typing_phrase(command):
    return re.sub(r"[^a-z0-9 ]", "", command.lower()).strip()


def _close_to(command, phrases, threshold):
    return any(
        command == phrase
        or difflib.SequenceMatcher(None, command, phrase).ratio() >= threshold
        for phrase in phrases
    )


def _clean_typed_text(text):
    """Drop fillers and the full stop recognizers add after every sentence."""
    text = (text or "").strip()
    text = re.sub(r"(?i)\b(?:uh+|um+|hmm+|erm|ah)\b[,.]?", "", text)
    text = re.sub(r"\s+([,.!?])", r"\1", text)
    text = re.sub(r"^[,.\s]+", "", text)
    text = re.sub(r"[,\s]*[.!?]+$", "", text)
    text = re.sub(r"[,\s]+$", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _type_text(text):
    """Type into the focused window. Non-ASCII text goes through the clipboard."""
    if not text:
        return
    if text.isascii():
        pyautogui.write(text, interval=0.0)
        return
    if sys.platform == "darwin":
        previous = subprocess.run(
            ["pbpaste"], capture_output=True, text=True
        ).stdout
        subprocess.run(["pbcopy"], input=text, text=True)
        pyautogui.hotkey("command", "v")
        time.sleep(0.15)
        subprocess.run(["pbcopy"], input=previous, text=True)
    else:
        pyautogui.write(text.encode("ascii", "ignore").decode(), interval=0.0)


def handle_typing_speech(text):
    """Run typing-mode speech. Returns True when the phrase was used."""
    global typing_mode, running

    raw = (text or "").strip()
    command = _typing_phrase(_normalize_voice_command(raw))
    if not command:
        return False

    # Stop ARKAI still works while typing, but plain "stop" is dictation.
    if "arkai" in command and _looks_like_stop_command(command):
        typing_mode = False
        set_status("VOICE → STOP ARKAI", 2)
        running = False
        voice_stop_event.set()
        return True

    words = command.split()

    if not typing_mode:
        if len(words) <= 4 and _close_to(command, TYPING_ON_PHRASES, 0.80):
            typing_mode = True
            set_status("TYPING MODE ON", 2)
            print("⌨ TYPING MODE ON — pointer paused, say \"exit typing\" to stop")
            return True

        one_shot = re.match(
            r"^\s*(?:type|write|dictate)\s+(.+)$", raw, flags=re.I
        )
        if one_shot:
            typed = _clean_typed_text(one_shot.group(1))
            _type_text(typed)
            set_status("VOICE → TYPE", 1)
            print(f"⌨ Typed: {typed}")
            return True
        return False

    # "typing mode" scores 0.81 against "exit typing mode", so repeating
    # it must keep typing on rather than switch it off.
    if command in TYPING_ON_PHRASES:
        set_status("TYPING MODE ON", 1.5)
        return True

    if len(words) <= 4 and (
        _close_to(command, TYPING_OFF_PHRASES, 0.80)
        or ("typing" in words and words[0] in {
            "exit", "exiting", "stop", "end", "quit", "leave", "close",
        })
    ):
        typing_mode = False
        set_status("COMMAND MODE", 2)
        print("⌨ COMMAND MODE — typing stopped")
        return True

    if command in TYPING_KEYS:
        pyautogui.press(TYPING_KEYS[command])
        set_status(f"KEY → {TYPING_KEYS[command].upper()}", 1)
        return True

    if command in TYPING_HOTKEYS:
        pyautogui.hotkey(MOD_KEY, TYPING_HOTKEYS[command])
        set_status(f"KEY → {command.upper()}", 1)
        return True

    typed = _clean_typed_text(raw)
    if typed:
        _type_text(typed + " ")
        set_status("VOICE → TYPING", 0.8)
        print(f"⌨ Typed: {typed}")
    return True


def _pause_cursor_controls():
    """Drop any blink, dwell, or tilt that was in progress."""
    global blink_start, blink_open_frames, blink_anchor
    global dwell_anchor, dwell_started, dwell_progress
    global tilt_state, tilt_candidate, tilt_candidate_frames
    global tilt_release_frames

    blink_start = None
    blink_open_frames = 0
    blink_anchor = None
    dwell_anchor = None
    dwell_started = None
    dwell_progress = 0.0
    tilt_state = 0
    tilt_candidate = 0
    tilt_candidate_frames = 0
    tilt_release_frames = 0


def capture_pointed_target():
    """Remember the element under the cursor at the moment speech starts."""
    global pointed_target, voice_status, voice_busy
    if typing_mode:
        return
    pointed_target = (int(current_x), int(current_y))
    voice_busy = True
    voice_status = "POINT LOCKED"
    print(
        f"   ✓ Point locked at {pointed_target[0]}, {pointed_target[1]}"
    )


def act_at_pointed_element(action):
    """Run a pointer action on the element the user was looking at."""
    global point_hold_until, current_x, current_y

    if typing_mode:
        return
    if pointed_target:
        x, y = pointed_target
    else:
        x, y = int(current_x), int(current_y)

    point_hold_until = time.time() + 0.7
    time.sleep(0.05)
    current_x = x
    current_y = y
    pyautogui.moveTo(x, y, duration=0)
    time.sleep(0.05)
    action()


def _canonicalize_command(command):
    """Map a short, misheard phrase onto a point-and-speak command."""
    if command in _POINT_ALIASES:
        return _POINT_ALIASES[command]

    if len(command.split()) > 3:
        return command

    best_command = command
    best_score = 0.0
    for alias, canonical in _POINT_ALIASES.items():
        score = difflib.SequenceMatcher(None, command, alias).ratio()
        if score > best_score:
            best_score = score
            best_command = canonical

    if best_score >= 0.78:
        return best_command

    return command


def _command_is_known(command):
    command = _canonicalize_command(_normalize_voice_command(command))
    if not command:
        return False
    if command in _POINT_ALIASES.values():
        return True
    keywords = (
        "stop", "chrome", "calculator", "calc", "document",
        "back", "forward", "refresh", "reload", "tab",
        "scroll", "click", "select", "enter", "space", "home",
        "yes", "confirm",
        "open this", "right click", "double click",
    )
    return any(word in command for word in keywords)


WISPR_API_URL = "https://platform-api.wisprflow.ai/api/v1/dash/api"
ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
WISPR_COMMAND_WORDS = [
    "new tab", "close tab", "next tab", "previous tab",
    "refresh", "reload", "scroll up", "scroll down",
    "open chrome", "open calculator", "open documents",
    "go back", "go forward", "click", "right click",
    "double click", "stop ARKAI",
]


_elevenlabs_http = None


def _elevenlabs_api_key():
    """Read the ElevenLabs key from .env under any common spelling."""
    accepted = {
        "elevenlabs_api_key",
        "eleven_labs_api_key",
        "xi_api_key",
    }
    for name, value in os.environ.items():
        if name.lower() in accepted and value.strip():
            return value.strip()
    return ""


def _elevenlabs_client():
    """Reuse one HTTPS connection so each command skips a new handshake."""
    global _elevenlabs_http
    key = _elevenlabs_api_key()
    if not key:
        return None
    if _elevenlabs_http is None:
        import httpx
        _elevenlabs_http = httpx.Client(
            headers={"xi-api-key": key},
            timeout=6.0,
        )
    return _elevenlabs_http


def _warm_elevenlabs():
    client = _elevenlabs_client()
    if client is None:
        return
    try:
        client.get("https://api.elevenlabs.io/")
    except Exception:
        pass


def _transcribe_elevenlabs(wav_path):
    """Transcribe a short command clip with ElevenLabs Scribe."""
    client = _elevenlabs_client()
    if client is None or not wav_path or not os.path.exists(wav_path):
        return ""

    try:
        with wave.open(wav_path, "rb") as wav_file:
            pcm = wav_file.readframes(wav_file.getnframes())

        # Raw 16 kHz PCM skips their audio decoder. Keyterms stop "tab"
        # turning into "time" and cost no measurable latency.
        parts = [
            ("model_id", (None, "scribe_v2")),
            ("language_code", (None, "en")),
            ("tag_audio_events", (None, "false")),
            ("file_format", (None, "pcm_s16le_16")),
            ("file", ("command.pcm", pcm, "application/octet-stream")),
        ]
        terms = (
            TYPING_COMMAND_WORDS
            if typing_mode
            else WISPR_COMMAND_WORDS + ["typing mode", "start typing"]
        )
        for term in terms:
            parts.append(("keyterms", (None, term)))

        response = client.post(ELEVENLABS_STT_URL, files=parts)

        if response.status_code != 200:
            detail = ""
            try:
                body = response.json()
                detail = body.get("detail") or body.get("message") or ""
            except Exception:
                detail = ""
            if isinstance(detail, list):
                detail = "; ".join(
                    str(item.get("msg", item)) if isinstance(item, dict) else str(item)
                    for item in detail
                )
            print(f"   ⚠ ElevenLabs returned {response.status_code} {detail}".rstrip())
            return ""

        return str(response.json().get("text", "")).strip()
    except Exception as e:
        print(f"   ⚠ ElevenLabs failed: {type(e).__name__}: {e}")
        return ""


def _transcribe_wispr(wav_path):
    """Transcribe with Wispr Flow when WISPR_API_KEY is set."""
    key = os.environ.get("WISPR_API_KEY", "").strip()
    if not key or not wav_path or not os.path.exists(wav_path):
        return ""

    try:
        import base64
        import httpx

        with open(wav_path, "rb") as audio_file:
            audio_b64 = base64.b64encode(audio_file.read()).decode("ascii")

        response = httpx.post(
            WISPR_API_URL,
            headers={"Authorization": f"Bearer {key}"},
            json={
                "audio": audio_b64,
                "language": ["en"],
                "context": {
                    "app": {"type": "other"},
                    "dictionary_context": WISPR_COMMAND_WORDS,
                },
            },
            timeout=8.0,
        )
        if response.status_code != 200:
            print(f"   ⚠ Wispr Flow returned {response.status_code}")
            return ""
        return str(response.json().get("text", "")).strip()
    except Exception as e:
        print(f"   ⚠ Wispr Flow failed: {type(e).__name__}: {e}")
        return ""


def _transcribe_locally(wav_path):
    """Read the same recording with local Whisper when Google misses it."""
    global voice_model

    if not WHISPER_AVAILABLE:
        return ""

    try:
        if voice_model is None:
            print("   Loading local speech model...")
            voice_model = WhisperModel(
                VOICE_MODEL_SIZE,
                device="cpu",
                compute_type=VOICE_COMPUTE_TYPE,
            )
            print("   ✓ Local speech model ready")

        if not wav_path or not os.path.exists(wav_path):
            return ""

        segments, _info = voice_model.transcribe(
            wav_path,
            language="en",
            beam_size=1,
            best_of=1,
            temperature=0.0,
            condition_on_previous_text=False,
            vad_filter=True,
            without_timestamps=True,
            initial_prompt=VOICE_INITIAL_PROMPT,
        )
        return " ".join(
            segment.text.strip() for segment in segments
        ).strip()
    except Exception as e:
        print(f"   ⚠ Local speech recognition failed: {type(e).__name__}: {e}")
        return ""


def _match_spoken_command(text):
    """Pull one command out of a short or slightly misheard phrase."""
    command = _normalize_voice_command(text)
    if not command:
        return ""

    token_fixes = {
        "deck": "tab",
        "tap": "tab",
        "dab": "tab",
        "town": "tab",
        "tech": "tab",
        "tub": "tab",
        "step": "stop",
        "fresh": "refresh",
        "refreshed": "refresh",
    }
    words = [token_fixes.get(word, word) for word in command.split()]
    command = " ".join(words)
    direct = _expand_short_command(_canonicalize_command(command))
    if len(words) <= 5 and _command_is_known(direct):
        return direct

    catalog = (
        "new tab", "close tab", "close this tab", "next tab", "previous tab",
        "refresh", "reload", "go back", "back", "go forward", "forward",
        "scroll up", "scroll down", "open chrome", "open calculator",
        "open documents", "click", "right click", "double click",
        "stop", "enter", "space", "home", "yes", "confirm",
    )
    best = ""
    best_score = 0.0
    for size in (1, 2, 3, 4):
        if len(words) < size:
            continue
        for start in range(len(words) - size + 1):
            chunk = " ".join(words[start:start + size])
            for target in catalog:
                score = difflib.SequenceMatcher(None, chunk, target).ratio()
                if score > best_score:
                    best = target
                    best_score = score

    if best_score >= 0.76:
        return _expand_short_command(best)
    return ""


def _expand_short_command(command):
    """Map the fragments Google often returns onto a full command."""
    shorts = {
        "new": "new tab",
        "tab": "new tab",
        "next": "next tab",
        "previous": "previous tab",
        "close": "close tab",
        "chrome": "open chrome",
        "calculator": "open calculator",
        "calc": "open calculator",
        "documents": "open documents",
        "document": "open documents",
        "stop now": "stop",
        "stop it": "stop",
        "stop please": "stop",
    }
    return shorts.get(command, command)


def execute_voice_command(text):
    global running

    command = _canonicalize_command(_normalize_voice_command(text))
    command = _expand_short_command(command)

    print(f"✓ Recognized: {command}")

    # A long, unrelated sentence can contain a command word by accident.
    if len(command.split()) > 5 and not _looks_like_stop_command(command):
        print("  Command not in allow-list.")
        return

    # --------------------------------------------------------
    # STOP — intentionally forgiving because Google often
    # drops the final "AccessAI" words.
    # --------------------------------------------------------
    if _looks_like_stop_command(command):
        set_status("VOICE → STOP ARKAI", 2)
        running = False
        voice_stop_event.set()
        return

    # --------------------------------------------------------
    # CHROME
    # --------------------------------------------------------
    if (
        "open chrome" in command
        or "launch chrome" in command
        or "start chrome" in command
    ):
        open_chrome()
        return

    # --------------------------------------------------------
    # CALCULATOR
    # --------------------------------------------------------
    if (
        "open calculator" in command
        or "open calc" in command
        or "launch calculator" in command
    ):
        open_calculator()
        return

    # --------------------------------------------------------
    # DOCUMENTS
    # --------------------------------------------------------
    if (
        "open documents" in command
        or "open document" in command
        or "open my documents" in command
    ):
        open_documents()
        return

    # --------------------------------------------------------
    # BROWSER NAVIGATION
    # --------------------------------------------------------
    if "go back" in command or command == "back":
        if sys.platform == "darwin":
            if not chrome_do(
                'tell application "Google Chrome" to activate\n'
                'tell application "System Events" to keystroke "[" using command down'
            ):
                browser_hotkey("command", "left")
        else:
            pyautogui.hotkey("alt", "left")
        set_status("VOICE → GO BACK")
        return

    if "go forward" in command or command == "forward":
        if sys.platform == "darwin":
            if not chrome_do(
                'tell application "Google Chrome" to activate\n'
                'tell application "System Events" to keystroke "]" using command down'
            ):
                browser_hotkey("command", "right")
        else:
            pyautogui.hotkey("alt", "right")
        set_status("VOICE → GO FORWARD")
        return

    if "refresh" in command or "reload" in command:
        reload_browser_page()
        set_status("VOICE → REFRESH")
        return

    # --------------------------------------------------------
    # CHROME TAB CONTROL
    # These make voice useful for opening/closing tabs and then
    # using the face cursor + click to select links/sites.
    # --------------------------------------------------------
    if (
        "new tab" in command
        or "open new tab" in command
        or "create new tab" in command
    ):
        if sys.platform == "darwin":
            opened = chrome_do(
                'tell application "Google Chrome"\n'
                'activate\n'
                'if (count of windows) = 0 then make new window\n'
                'tell front window to make new tab at end\n'
                'end tell'
            )
            if not opened:
                browser_hotkey("command", "t")
        else:
            pyautogui.hotkey("ctrl", "t")
        set_status("VOICE → NEW TAB")
        return

    if (
        "close tab" in command
        or "close this tab" in command
    ):
        if sys.platform == "darwin":
            closed = chrome_do(
                'tell application "Google Chrome"\n'
                'activate\n'
                'close active tab of front window\n'
                'end tell'
            )
            if not closed:
                browser_hotkey("command", "w")
        else:
            pyautogui.hotkey("ctrl", "w")
        set_status("VOICE → CLOSE TAB")
        return

    if (
        "next tab" in command
        or "switch tab" in command
    ):
        if sys.platform == "darwin":
            moved = chrome_do(
                'tell application "Google Chrome"\n'
                'activate\n'
                'set w to front window\n'
                'set n to active tab index of w\n'
                'if n < (count of tabs of w) then set active tab index of w to n + 1\n'
                'end tell'
            )
            if not moved:
                browser_hotkey("ctrl", "tab")
        else:
            pyautogui.hotkey("ctrl", "tab")
        set_status("VOICE → NEXT TAB")
        return

    if (
        "previous tab" in command
        or "last tab" in command
    ):
        if sys.platform == "darwin":
            moved = chrome_do(
                'tell application "Google Chrome"\n'
                'activate\n'
                'set w to front window\n'
                'set n to active tab index of w\n'
                'if n > 1 then set active tab index of w to n - 1\n'
                'end tell'
            )
            if not moved:
                browser_hotkey("ctrl", "shift", "tab")
        else:
            pyautogui.hotkey("ctrl", "shift", "tab")
        set_status("VOICE → PREVIOUS TAB")
        return

    # --------------------------------------------------------
    # SCROLL
    # Increased from 5 to 12 wheel units because the previous
    # setting produced only about a line of movement in Chrome.
    # --------------------------------------------------------
    if "scroll up" in command or "scroll upward" in command:
        if not chrome_do(
            'tell application "Google Chrome" to tell active tab of front window '
            'to execute javascript "window.scrollBy(0, -500)"'
        ):
            activate_browser()
            pyautogui.press("pageup")
        set_status("POINT + SCROLL UP")
        return

    if "scroll down" in command or "scroll downward" in command:
        if not chrome_do(
            'tell application "Google Chrome" to tell active tab of front window '
            'to execute javascript "window.scrollBy(0, 500)"'
        ):
            activate_browser()
            pyautogui.press("pagedown")
        set_status("POINT + SCROLL DOWN")
        return

    # --------------------------------------------------------
    # POINT + VOICE
    # The cursor position was locked when speech started. These
    # commands interact with that element: click, double-click,
    # right-click, or open whatever is under the pointer.
    # --------------------------------------------------------
    if "double click" in command or "double-click" in command:
        act_at_pointed_element(pyautogui.doubleClick)
        set_status("POINT + DOUBLE CLICK")
        return

    if "right click" in command or "right-click" in command:
        act_at_pointed_element(
            lambda: pyautogui.click(button="right")
        )
        set_status("POINT + RIGHT CLICK")
        return

    if (
        command in {
            "click",
            "left click",
            "select",
            "open this",
            "open it",
            "press this",
            "press it",
            "yes",
            "confirm",
            "confirm click",
        }
        or "click here" in command
        or "click this" in command
        or "click that" in command
        or "click link" in command
        or "click on" in command
        or "select this" in command
        or "open this" in command
        or "press this" in command
    ):
        focus_window_under_cursor()
        note_intentional_activation()
        act_at_pointed_element(
            lambda: pyautogui.click(button="left")
        )
        set_status("VOICE → CONFIRM CLICK")
        return

    # --------------------------------------------------------
    # KEYBOARD
    # --------------------------------------------------------
    if command == "enter" or "press enter" in command:
        if sys.platform == "darwin":
            activate_browser()
        pyautogui.press("enter")
        set_status("VOICE → ENTER")
        return

    if command == "space" or "press space" in command:
        if sys.platform == "darwin":
            activate_browser()
        pyautogui.press("space")
        set_status("VOICE → SPACE")
        return

    if command == "home" or "go home" in command:
        if sys.platform == "darwin":
            if not chrome_do(
                'tell application "Google Chrome" to tell active tab of front window '
                'to execute javascript "window.scrollTo(0, 0)"'
            ):
                browser_hotkey("command", "up")
        else:
            pyautogui.press("home")
        set_status("VOICE → HOME")
        return

    print("  Command not in allow-list.")


# ============================================================
# VOICE THREAD
# ============================================================

def _record_wav_with_soundcard():
    """
    Fast speech capture using the Windows default microphone via SoundCard/WASAPI.

    Instead of recording a fixed 5-second block, this uses a small energy-based
    speech endpoint detector. It starts with a short pre-roll, waits for speech,
    and stops after a short silence or the maximum recording time.
    This makes short commands much faster while keeping enough audio for Google.
    """
    if not SOUNDCARD_AVAILABLE:
        raise RuntimeError(
            "SoundCard is not installed. Run: python -m pip install soundcard numpy"
        )

    microphone = sc.default_microphone()
    if microphone is None:
        raise RuntimeError("Windows default microphone was not found.")

    # The gap inside "open chrome" or "new tab" is about 150 ms, so the
    # end-of-command pause has to be longer than that.
    fast_capture = bool(_elevenlabs_api_key())
    chunk_seconds = 0.04 if fast_capture else 0.10
    speech_cap = 1.8 if fast_capture else VOICE_RECORD_SECONDS
    idle_pause = 0.28 if fast_capture else VOICE_IDLE_PAUSE
    record_seconds = VOICE_RECORD_SECONDS
    # Dictated sentences are longer and have natural pauses between words.
    if typing_mode:
        speech_cap = 8.0
        idle_pause = 0.70
        record_seconds = 9.0
    chunk_frames = int(VOICE_SAMPLE_RATE * chunk_seconds)
    max_frames = int(record_seconds * VOICE_SAMPLE_RATE)
    pre_roll_chunks = 2 if fast_capture else 3
    silence_chunks_needed = max(1, int(round(idle_pause / chunk_seconds)))
    min_speech_chunks = 2

    print(f"   ✓ Windows microphone: {microphone.name}")
    print(f"   Format: {VOICE_SAMPLE_RATE} Hz, mono")
    print("   🎙️ LISTENING — say your command")

    chunks = []
    speech_started = False
    speech_started_at = None
    speech_peak = 0.0
    speech_chunks = 0
    silent_chunks = 0
    total_frames = 0

    # First few chunks establish the local noise floor. We still keep them as
    # pre-roll so the first syllable is less likely to be clipped.
    noise_levels = []

    with microphone.recorder(
        samplerate=VOICE_SAMPLE_RATE,
        channels=VOICE_CHANNELS
    ) as recorder:
        start_time = time.monotonic()

        while total_frames < max_frames:
            if voice_stop_event.is_set() or not running:
                break

            data = recorder.record(numframes=chunk_frames)
            if data is None or len(data) == 0:
                continue

            data = np.asarray(data, dtype=np.float32)
            if data.ndim > 1:
                data = data[:, 0]
            data = np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)
            data = np.clip(data, -1.0, 1.0)

            level = float(np.sqrt(np.mean(data * data)))
            chunks.append(data.copy())
            total_frames += len(data)

            elapsed = time.monotonic() - start_time

            # Estimate noise from the first 200 ms. A minimum threshold prevents
            # a very quiet microphone from becoming oversensitive.
            if not speech_started and len(noise_levels) < pre_roll_chunks:
                noise_levels.append(level)

            noise_floor = float(np.median(noise_levels)) if noise_levels else 0.003
            threshold = max(0.004, noise_floor * 2.2)

            if not speech_started:
                if level >= threshold and len(noise_levels) >= pre_roll_chunks:
                    speech_started = True
                    speech_started_at = time.monotonic()
                    speech_peak = level
                    print("   🎤 SPEECH DETECTED")
                    capture_pointed_target()
                    speech_chunks = 1
                    silent_chunks = 0
            else:
                still_speaking = level >= max(threshold, speech_peak * 0.12)
                if still_speaking:
                    speech_peak = max(speech_peak, level)
                    speech_chunks += 1
                    silent_chunks = 0
                else:
                    silent_chunks += 1
                    if (
                        speech_chunks >= min_speech_chunks
                        and silent_chunks >= silence_chunks_needed
                    ):
                        break

                if (
                    speech_started_at is not None
                    and time.monotonic() - speech_started_at >= speech_cap
                ):
                    break

            # Hard safety limit even if there is continuous background noise.
            # Typing mode waits until speech starts before the limit applies.
            if elapsed >= record_seconds or (
                not speech_started and elapsed >= VOICE_RECORD_SECONDS
            ):
                break

    if not chunks:
        raise RuntimeError("No microphone audio was captured.")

    samples = np.concatenate(chunks, axis=0)
    samples = samples[:max_frames]

    # If speech was detected, remove excessive trailing silence while keeping
    # a small tail so the final word is not cut off.
    if speech_started:
        keep_tail = int(VOICE_SAMPLE_RATE * 0.12)
        samples = samples[:min(len(samples), total_frames - max(0, silent_chunks * chunk_frames) + keep_tail)]

    samples = np.asarray(samples, dtype=np.float32)
    samples = np.nan_to_num(samples, nan=0.0, posinf=0.0, neginf=0.0)
    samples = np.clip(samples, -1.0, 1.0)

    rms = float(np.sqrt(np.mean(samples * samples)))
    peak = float(np.max(np.abs(samples)))
    duration = len(samples) / VOICE_SAMPLE_RATE
    print(f"   Audio RMS : {rms:.5f}")
    print(f"   Audio Peak: {peak:.5f}")
    print(f"   ✓ Captured speech window: {duration:.2f}s")

    # Convert float samples to standard 16-bit PCM WAV.
    pcm = (samples * 32767.0).astype(np.int16)

    fd, wav_path = tempfile.mkstemp(
        prefix="accessai_voice_",
        suffix=".wav"
    )
    os.close(fd)

    with wave.open(wav_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(VOICE_SAMPLE_RATE)
        wf.writeframes(pcm.tobytes())

    print("   ✓ Windows/WASAPI WAV created")
    return wav_path, speech_started, rms, peak


def voice_loop():
    """
    Dedicated voice worker.

    Critical design rule:
    Nothing in this function is executed by the camera/UI loop.
    A slow microphone or Google request therefore cannot freeze
    the OpenCV window.

    Voice path:
        Windows/WASAPI -> WAV -> SpeechRecognition AudioFile -> Google
    """
    global voice_status
    global last_voice_text
    global last_voice_time
    global voice_busy

    if not SPEECH_AVAILABLE:
        voice_status = "VOICE PACKAGE MISSING"
        print("⚠ SpeechRecognition is not installed.")
        return

    if not SOUNDCARD_AVAILABLE:
        voice_status = "SOUNDCARD MISSING"
        print("⚠ SoundCard is not installed.")
        print("   Run: python -m pip install soundcard numpy")
        return

    recognizer = sr.Recognizer()
    recognizer.operation_timeout = VOICE_OPERATION_TIMEOUT
    if _elevenlabs_api_key():
        _warm_elevenlabs()
    else:
        _transcribe_locally("")

    print()
    print("🎙 Voice thread started.")
    print("   Microphone: Windows default input (SoundCard/WASAPI)")
    print(f"   Recording: {VOICE_RECORD_SECONDS:.1f}s")
    print(f"   Google operation timeout: {VOICE_OPERATION_TIMEOUT}s")
    if _elevenlabs_api_key():
        print("   Speech: ElevenLabs Scribe, then the local listener")
    else:
        print("   Pipeline: Windows/WASAPI → WAV → Google SpeechRecognition")
    print()

    while not voice_stop_event.is_set() and running:
        wav_path = None

        try:
            voice_status = "LISTENING"

            wav_path, heard_speech, rms, peak = _record_wav_with_soundcard()

            if voice_stop_event.is_set() or not running:
                break

            # Short commands on the built-in mic can have low average energy,
            # so a clear peak is enough once speech was detected.
            if not heard_speech or (rms < 0.012 and peak < 0.10):
                print("   (too quiet, still listening)")
                voice_status = "VOICE READY"
                continue

            voice_status = "RECOGNIZING"
            text = ""
            matched = ""
            typed = False
            if _elevenlabs_api_key():
                print("   🎙 ElevenLabs...")
                started = time.perf_counter()
                text = _transcribe_elevenlabs(wav_path)
                elapsed = time.perf_counter() - started
                if text:
                    print(f"   ✓ ElevenLabs hearing: {text} ({elapsed:.2f}s)")
                typed = bool(text) and handle_typing_speech(text)
                if not typed:
                    matched = _match_spoken_command(text)
                    if text and not matched:
                        print("   ✗ Could not understand the speech.")
                        voice_status = "VOICE READY"
                        continue

            if not typed and not matched and os.environ.get("WISPR_API_KEY", "").strip():
                print("   🎙 Wispr Flow...")
                text = _transcribe_wispr(wav_path)
                if text:
                    print(f"   ✓ Wispr hearing: {text}")
                typed = bool(text) and handle_typing_speech(text)
                if not typed:
                    matched = _match_spoken_command(text)

            if not typed and not matched:
                print("   🎙 Hearing the command locally...")
                text = _transcribe_locally(wav_path)
                typed = bool(text) and handle_typing_speech(text)
                if not typed:
                    matched = _match_spoken_command(text)

            if typed:
                voice_status = "TYPING" if typing_mode else "VOICE READY"
                voice_stop_event.wait(VOICE_COOLDOWN)
                continue

            if not matched:
                print("   ☁ Asking Google once...")
                with sr.AudioFile(wav_path) as source:
                    audio = recognizer.record(source)
                google_text = ""
                try:
                    google_text = recognizer.recognize_google(
                        audio,
                        language="en-IN"
                    )
                except sr.UnknownValueError:
                    google_text = ""
                if google_text:
                    print(f"   ✓ Google hearing: {google_text}")
                    if handle_typing_speech(google_text):
                        voice_status = "TYPING" if typing_mode else "VOICE READY"
                        continue
                    matched = _match_spoken_command(google_text) or google_text

            if matched:
                if matched != _normalize_voice_command(text or ""):
                    print(f"   ✓ Using command: {matched}")
                text = matched

            if not text or not _match_spoken_command(text):
                print("   ✗ Could not understand the speech.")
                voice_status = "VOICE READY"
                continue

            text = _match_spoken_command(text)

            now = time.time()
            normalized = text.strip().lower()

            if (
                normalized == last_voice_text
                and now - last_voice_time < 3.0
            ):
                print("   Duplicate command ignored.")
            else:
                last_voice_text = normalized
                last_voice_time = now
                execute_voice_command(text)

            voice_status = "VOICE READY"

            voice_stop_event.wait(VOICE_COOLDOWN)

        except sr.WaitTimeoutError:
            print("   Microphone timeout.")
            voice_status = "VOICE READY"

        except sr.UnknownValueError:
            print("   ✗ Google could not understand the speech.")
            voice_status = "VOICE READY"

        except sr.RequestError as e:
            print(f"   ✗ Google recognition unavailable: {e}")
            voice_status = "GOOGLE UNAVAILABLE"
            voice_stop_event.wait(3.0)

        except Exception as e:
            # Voice errors must never terminate the facial system.
            print(f"   ✗ Voice error: {type(e).__name__}: {e}")
            voice_status = "VOICE ERROR"
            voice_stop_event.wait(2.0)

        finally:
            voice_busy = False
            if wav_path and os.path.exists(wav_path):
                try:
                    os.remove(wav_path)
                except Exception:
                    pass

    voice_status = "VOICE STOPPED"
    print("🎙 Voice thread stopped.")


def start_voice_thread():
    global voice_thread
    global voice_started

    if not VOICE_ENABLED:
        print("Voice control disabled.")
        return

    if not SPEECH_AVAILABLE:
        print("⚠ SpeechRecognition unavailable; voice disabled.")
        return

    if voice_started:
        return

    voice_started = True

    voice_thread = threading.Thread(
        target=voice_loop,
        name="AccessAI-Voice",
        daemon=True
    )

    voice_thread.start()


# ============================================================
# MEDIAPIPE
# ============================================================

def create_landmarker():
    if not os.path.exists(MODEL_PATH):
        print()
        print("ERROR: Face model not found:")
        print(MODEL_PATH)
        print()
        raise SystemExit(1)

    BaseOptions = mp.tasks.BaseOptions
    FaceLandmarker = mp.tasks.vision.FaceLandmarker
    FaceLandmarkerOptions = mp.tasks.vision.FaceLandmarkerOptions
    RunningMode = mp.tasks.vision.RunningMode

    options = FaceLandmarkerOptions(
        base_options=BaseOptions(
            model_asset_path=MODEL_PATH
        ),
        running_mode=RunningMode.IMAGE,
        num_faces=1
    )

    return FaceLandmarker.create_from_options(options)


# ============================================================
# DRAWING
# ============================================================

def draw_ui(frame, ear=None, scroll_status="SCROLL READY"):
    h, w = frame.shape[:2]

    # Control box.
    x1 = int(w * BOX_LEFT)
    x2 = int(w * BOX_RIGHT)
    y1 = int(h * BOX_TOP)
    y2 = int(h * BOX_BOTTOM)

    cv2.rectangle(
        frame,
        (x1, y1),
        (x2, y2),
        (255, 255, 255),
        2
    )

    # Center marker.
    cx = int(w * 0.5)
    cy = int(h * 0.5)

    cv2.line(
        frame,
        (cx - 12, cy),
        (cx + 12, cy),
        (255, 255, 255),
        1
    )

    cv2.line(
        frame,
        (cx, cy - 12),
        (cx, cy + 12),
        (255, 255, 255),
        1
    )

    cv2.putText(
        frame,
        "ARKAI",
        (18, 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.75,
        (255, 255, 255),
        2
    )

    face_text = "FACE: ACTIVE" if face_detected else "FACE: SEARCHING"

    cv2.putText(
        frame,
        face_text,
        (18, 58),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.52,
        (255, 255, 255),
        1
    )

    cv2.putText(
        frame,
        f"VOICE: {voice_status}" + ("  |  TYPING MODE" if typing_mode else ""),
        (18, 82),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.52,
        (255, 255, 255),
        1
    )

    cv2.putText(
        frame,
        "POINT + VOICE = ACT",
        (18, 106),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.48,
        (255, 255, 255),
        1
    )

    cv2.putText(
        frame,
        "HEAD = CURSOR",
        (18, h - 78),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.52,
        (255, 255, 255),
        1
    )

    cv2.putText(
        frame,
        "LONG BLINK = CLICK",
        (18, h - 53),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.52,
        (255, 255, 255),
        1
    )

    cv2.putText(
        frame,
        "TILT = SCROLL",
        (18, h - 28),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.52,
        (255, 255, 255),
        1
    )

    if ear is not None:
        cv2.putText(
            frame,
            f"EAR: {ear:.3f}",
            (w - 125, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            (255, 255, 255),
            1
        )

    if dwell_progress >= 0.25:
        cv2.putText(
            frame,
            f"DWELL {int(dwell_progress * 100)}%",
            (w - 160, h - 52),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.52,
            (255, 255, 255),
            1
        )

    if time.time() < status_until:
        cv2.putText(
            frame,
            status_text,
            (w - 250, h - 25),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.52,
            (255, 255, 255),
            1
        )

    if center_locked:
        cv2.putText(
            frame,
            "CENTER LOCK",
            (w - 135, 58),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            (255, 255, 255),
            1
        )

    return frame


# ============================================================
# MAIN
# ============================================================

def main():
    global running
    global frame_counter
    global face_detected
    global blink_start
    global last_blink
    global blink_open_frames
    global blink_anchor
    global ear_baseline
    global dwell_anchor
    global dwell_started
    global dwell_progress
    global last_scroll_time
    global tilt_state
    global tilt_candidate
    global tilt_candidate_frames
    global tilt_release_frames

    print()
    print("=" * 60)
    print("                         ARKAI")
    print("=" * 60)
    print()
    print("FACE")
    print("  Head movement  -> Cursor")
    print("  Long blink     -> Click")
    print("  Hold still     -> Dwell click")
    print("  Head tilt      -> Scroll")
    print()
    print("VOICE")
    print("  Open Chrome / Calculator / Documents")
    print("  Back / Forward / Refresh")
    print("  Enter / Space / Stop ARKAI")
    print()
    print("VOICE TYPING")
    print("  Say \"typing mode\", then speak to type")
    print("  Enter / Backspace / Space / Tab / Escape / Delete")
    print("  Select all / Copy / Paste")
    print("  \"Type ...\" types once; \"exit typing\" stops")
    print()
    print("POINT + VOICE")
    print("  Look at an element, then say:")
    print("  Click / Open this / Double click / Right click / Scroll")
    print()
    print("Performance:")
    print(f"  Camera: {CAMERA_WIDTH}x{CAMERA_HEIGHT}")
    print("  Voice: isolated background thread")
    print("  Voice: Windows/WASAPI → WAV → Google SpeechRecognition")
    print("  Voice network timeout:", VOICE_OPERATION_TIMEOUT, "seconds")
    print()
    print("Press Q in the camera window to quit.")
    print("=" * 60)
    print()

    # Disable PyAutoGUI's default pause so cursor movement is responsive.
    # The corner failsafe would otherwise stop the pointer dead.
    pyautogui.PAUSE = 0
    pyautogui.FAILSAFE = False

    landmarker = None
    cap = None

    try:
        print("Loading face model...")
        landmarker = create_landmarker()
        print("✓ Face model loaded")

        print("Starting camera...")

        cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_DSHOW)

        if not cap.isOpened():
            # Fallback if DirectShow is unavailable.
            cap.release()
            cap = cv2.VideoCapture(CAMERA_INDEX)

        if not cap.isOpened():
            raise RuntimeError("Could not access camera.")

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, CAMERA_BUFFER_SIZE)
        cap.set(cv2.CAP_PROP_FPS, 30)

        print("✓ Camera started")
        print()

        # Start voice ONLY after camera initialization.
        # The voice thread is completely independent of the
        # camera processing loop.
        start_voice_thread()

        print("ARKAI is running.")
        print()

        while running:

            success, frame = cap.read()

            if not success:
                print("⚠ Camera frame read failed.")
                time.sleep(0.05)
                continue

            frame_counter += 1

            # Mirror camera.
            frame = cv2.flip(frame, 1)

            ear_value = None
            scroll_status = "SCROLL READY"

            # Process every frame by default. Set to 2 if CPU usage
            # becomes high on a slower computer.
            should_process = (
                frame_counter % PROCESS_EVERY_N_FRAMES == 0
            )

            if should_process:

                rgb = cv2.cvtColor(
                    frame,
                    cv2.COLOR_BGR2RGB
                )

                mp_image = mp.Image(
                    image_format=mp.ImageFormat.SRGB,
                    data=rgb
                )

                try:
                    result = landmarker.detect(mp_image)
                except Exception as e:
                    print(f"⚠ Face detection error: {e}")
                    result = None

                if result is not None and result.face_landmarks:

                    face_detected = True
                    landmarks = result.face_landmarks[0]

                    # --------------------------------------------
                    # 1. HEAD -> CURSOR
                    # --------------------------------------------

                    nose = landmarks[1]

                    face_x = float(nose.x)
                    face_y = float(nose.y)

                    target_x, target_y = map_cursor(
                        face_x,
                        face_y
                    )

                    # --------------------------------------------
                    # 2. BLINK -> CLICK
                    # --------------------------------------------

                    left_ear = eye_aspect_ratio(
                        landmarks,
                        LEFT_EYE
                    )

                    right_ear = eye_aspect_ratio(
                        landmarks,
                        RIGHT_EYE
                    )

                    ear_value = (
                        left_ear + right_ear
                    ) / 2.0

                    if typing_mode:
                        _pause_cursor_controls()
                        scroll_status = "POINTER PAUSED"
                    else:
                        now = time.time()

                        closed_below = BLINK_THRESHOLD
                        if ear_baseline is not None:
                            closed_below = max(
                                BLINK_THRESHOLD,
                                ear_baseline * BLINK_CLOSED_RATIO,
                            )
                        eyes_closed = ear_value < closed_below

                        if eyes_closed:
                            blink_open_frames = 0
                            if blink_start is None:
                                blink_start = now
                                blink_anchor = (current_x, current_y)
                            elif now - blink_start > MAX_BLINK_DURATION:
                                # A long "closed" reading is the head moving, not
                                # a click. Drop it so the pointer is never held.
                                blink_start = None
                                blink_open_frames = 0
                                blink_anchor = None
                        else:
                            if blink_start is None:
                                ear_baseline = (
                                    ear_value
                                    if ear_baseline is None
                                    else ear_baseline * 0.95 + ear_value * 0.05
                                )
                            else:
                                blink_open_frames += 1

                        if (
                            blink_start is not None
                            and blink_open_frames >= BLINK_OPEN_FRAMES
                        ):
                            blink_duration = now - blink_start

                            if blink_duration >= 0.15:
                                print(f"   Blink held {blink_duration:.2f}s")

                            valid_blink = (
                                MIN_BLINK_DURATION
                                <= blink_duration
                                <= MAX_BLINK_DURATION
                            )

                            cooldown_finished = (
                                now - last_blink
                                >= BLINK_COOLDOWN
                            )

                            if valid_blink and cooldown_finished:
                                if blink_anchor is not None:
                                    pyautogui.moveTo(
                                        int(blink_anchor[0]),
                                        int(blink_anchor[1]),
                                    )
                                intentional_click("GESTURE → CLICK")

                            blink_start = None
                            blink_open_frames = 0
                            blink_anchor = None

                        # The pointer keeps following the head. A blink only
                        # remembers where it started, then clicks that spot.
                        move_cursor(
                            target_x,
                            target_y
                        )
                        update_dwell()

                        # --------------------------------------------
                        # 3. HEAD TILT -> SCROLL
                        # --------------------------------------------

                        left_eye = landmarks[33]
                        right_eye = landmarks[263]

                        eye_slope = (
                            right_eye.y - left_eye.y
                        )

                        if eye_slope > TILT_THRESHOLD:
                            candidate = 1
                        elif eye_slope < -TILT_THRESHOLD:
                            candidate = -1
                        else:
                            candidate = 0

                        # Hysteresis / stability:
                        # require several frames before changing state.
                        if candidate != 0:

                            tilt_release_frames = 0

                            if candidate == tilt_candidate:
                                tilt_candidate_frames += 1
                            else:
                                tilt_candidate = candidate
                                tilt_candidate_frames = 1

                            if (
                                tilt_candidate_frames
                                >= TILT_CONFIRM_FRAMES
                            ):
                                tilt_state = candidate

                        else:

                            tilt_candidate_frames = 0
                            tilt_candidate = 0
                            tilt_release_frames += 1

                            if (
                                tilt_release_frames
                                >= TILT_RELEASE_FRAMES
                            ):
                                tilt_state = 0

                        now = time.time()

                        if (
                            tilt_state != 0
                            and now - last_scroll_time
                            >= SCROLL_INTERVAL
                        ):

                            if tilt_state > 0:
                                pyautogui.scroll(-SCROLL_STEP)
                                scroll_status = "SCROLL DOWN"
                            else:
                                pyautogui.scroll(SCROLL_STEP)
                                scroll_status = "SCROLL UP"

                            last_scroll_time = now

                        elif tilt_state > 0:
                            scroll_status = "SCROLL DOWN"

                        elif tilt_state < 0:
                            scroll_status = "SCROLL UP"

                else:
                    face_detected = False
                    blink_start = None
                    blink_open_frames = 0
                    blink_anchor = None
                    dwell_anchor = None
                    dwell_started = None
                    dwell_progress = 0.0
                    tilt_state = 0
                    tilt_candidate = 0
                    tilt_candidate_frames = 0
                    tilt_release_frames = 0

            # --------------------------------------------
            # DISPLAY
            # --------------------------------------------

            frame = draw_ui(
                frame,
                ear=ear_value,
                scroll_status=scroll_status
            )

            cv2.imshow(
                "ARKAI",
                frame
            )

            key = cv2.waitKey(1) & 0xFF

            if key == ord("q") or key == ord("Q"):
                running = False
                voice_stop_event.set()
                break

            # ESC also exits.
            if key == 27:
                running = False
                voice_stop_event.set()
                break

    except KeyboardInterrupt:
        print()
        print("Keyboard interrupt received.")
        running = False
        voice_stop_event.set()

    except Exception as e:
        print()
        print("ERROR:", type(e).__name__)
        print(e)
        running = False
        voice_stop_event.set()

    finally:
        print()
        print("Stopping ARKAI...")

        running = False
        voice_stop_event.set()

        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass

        cv2.destroyAllWindows()

        if landmarker is not None:
            try:
                landmarker.close()
            except Exception:
                pass

        # Do not wait indefinitely for a network operation.
        if voice_thread is not None and voice_thread.is_alive():
            voice_thread.join(timeout=1.0)

        print("✓ Camera released")
        print("✓ Voice worker stopped")
        print("✓ ARKAI closed")


if __name__ == "__main__":
    main()

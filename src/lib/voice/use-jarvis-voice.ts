import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { VoiceNavConfig, VoiceNavStatus, VoiceCommand } from "./types";
import type { FontSize } from "@/lib/app-state";
import { parseVoiceCommand } from "./command-parser";
import { askJarvis } from "../ai.functions";
import { playJarvisChime, speakJarvis, stopJarvis } from "./jarvis-speech";
import {
  renderNumberedBadgesOverlay,
  removeNumberedBadgesOverlay,
  executeClickNumber,
  executeClickText,
  executeSelectJobCard,
  executeScroll,
  executeSearchQuery,
  executeTypeText,
  executeClearInput,
  readMainPageContent,
} from "./dom-actions";

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: (e: SpeechRecognitionResultEvent) => void;
  onend: () => void;
  onerror: (e: SpeechRecognitionErrorEvent) => void;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
};

type SpeechRecognitionErrorEvent = { error: string };

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

type WindowWithSpeech = {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export type UseJarvisVoiceOptions = {
  config: VoiceNavConfig;
  onConfigChange?: (updater: (prev: VoiceNavConfig) => VoiceNavConfig) => void;
  onHelp?: () => void;
  appActions: {
    highContrast: boolean;
    setHighContrast: (v: boolean) => void;
    dyslexiaFont: boolean;
    setDyslexiaFont: (v: boolean) => void;
    readingRuler: boolean;
    setReadingRuler: (v: boolean) => void;
    liveCaptions: boolean;
    setLiveCaptions: (v: boolean) => void;
    reducedDistraction: boolean;
    setReducedDistraction: (v: boolean) => void;
    fontSize: string;
    setFontSize: (v: FontSize) => void;
    toggleTheme: () => void;
    setCaptionText: (t: string) => void;
    eyeTrackingEnabled: boolean;
    gesturesEnabled: boolean;
  };
};

export function useJarvisVoice({
  config,
  onConfigChange,
  onHelp,
  appActions,
}: UseJarvisVoiceOptions) {
  const [status, setStatus] = useState<VoiceNavStatus>("idle");
  const [isSleeping, setIsSleeping] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [lastCommand, setLastCommand] = useState<VoiceCommand | null>(null);
  const [lastActionFeedback, setLastActionFeedback] = useState<string>("");
  const [announcement, setAnnouncement] = useState("");
  const [showBadgesLocal, setShowBadgesLocal] = useState(config.showNumberedBadges);

  const navigate = useNavigate();
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const shouldListenRef = useRef(config.enabled);
  const isSleepingRef = useRef(isSleeping);
  const configRef = useRef(config);
  const appActionsRef = useRef(appActions);
  // After the user says "Hey Janvi", accept a short sequence of follow-up
  // commands. Each accepted command refreshes the window for hands-free use.
  const commandWindowUntilRef = useRef(0);

  // Sync refs
  useEffect(() => {
    shouldListenRef.current = config.enabled;
    configRef.current = config;
    setShowBadgesLocal(config.showNumberedBadges);
  }, [config]);

  useEffect(() => {
    isSleepingRef.current = isSleeping;
  }, [isSleeping]);

  useEffect(() => {
    appActionsRef.current = appActions;
  }, [appActions]);

  // Execute a recognized voice command
  const executeCommand = useCallback(
    (command: VoiceCommand) => {
      setLastCommand(command);
      const conf = configRef.current;
      const actions = appActionsRef.current;

      const respond = (speech: string, feedbackText?: string) => {
        const display = feedbackText || speech;
        setLastActionFeedback(display);
        setAnnouncement(display);
        actions.setCaptionText(`JANVI: "${display}"`);

        if (conf.soundEffects) {
          playJarvisChime("confirm");
        }
        if (conf.speechFeedback) {
          speakJarvis(speech, { rate: conf.ttsRate, lang: conf.lang });
        }
      };

      switch (command.type) {
        // --- Navigation ---
        case "nav_jobs":
          respond(
            actions.eyeTrackingEnabled && actions.gesturesEnabled
              ? "Opening job search. Eye tracking and gestures are active. Look steadily at a job card to open its details."
              : "Opening job search. Eye tracking and gestures are starting. Look steadily at a job card to open its details once the camera is ready.",
            actions.eyeTrackingEnabled && actions.gesturesEnabled
              ? "Jobs ready for gaze selection"
              : "Jobs opening; hands-free controls starting",
          );
          navigate({ to: "/jobs", search: { q: "" } as never });
          break;

        case "nav_dashboard":
          respond("Opening your dashboard.", "Navigated to Dashboard");
          navigate({ to: "/dashboard" as never });
          break;

        case "nav_profile":
          respond("Opening your profile.", "Navigated to Profile");
          navigate({ to: "/profile" as never });
          break;

        case "nav_applications":
          respond("Opening your submitted applications.", "Navigated to Applications");
          navigate({ to: "/applications" as never });
          break;

        case "nav_resume_match":
          respond("Opening resume matching engine.", "Navigated to Resume Match");
          navigate({ to: "/resume-match" as never });
          break;

        case "nav_career_gps":
          respond("Opening Career GPS with Angie.", "Navigated to Career GPS");
          navigate({ to: "/career-gps" as never });
          break;

        case "nav_employer":
          respond("Opening employer portal.", "Navigated to Employer Portal");
          navigate({ to: "/employer" as never });
          break;

        case "nav_privacy":
          respond("Opening privacy and India rights guide.", "Navigated to Privacy & Rights");
          navigate({ to: "/privacy" as never });
          break;

        case "nav_home":
          respond("Returning to home page.", "Navigated to Home");
          navigate({ to: "/" as never });
          break;

        case "nav_back":
          respond("Going back.", "Navigated Back");
          if (typeof window !== "undefined") window.history.back();
          break;

        case "nav_forward":
          respond("Going forward.", "Navigated Forward");
          if (typeof window !== "undefined") window.history.forward();
          break;

        case "nav_reload":
          respond("Reloading page.", "Reloaded Page");
          if (typeof window !== "undefined") window.location.reload();
          break;

        // --- Scrolling ---
        case "scroll_down":
          executeScroll("down");
          respond("Scrolling down.");
          break;

        case "scroll_up":
          executeScroll("up");
          respond("Scrolling up.");
          break;

        case "scroll_top":
          executeScroll("top");
          respond("Scrolled to top.");
          break;

        case "scroll_bottom":
          executeScroll("bottom");
          respond("Scrolled to bottom.");
          break;

        // --- Click by Number ---
        case "click_number": {
          const num = typeof command.payload === "number" ? command.payload : 0;
          const result = executeClickNumber(num);
          if (result.success) {
            respond(
              `Clicked item ${num}: ${result.label || "Element"}`,
              `Clicked [${num}] ${result.label || ""}`,
            );
          } else {
            respond(
              `Could not find clickable number ${num}. Say show numbers to view badges.`,
              `Number ${num} not found`,
            );
          }
          break;
        }

        // --- Click by Text ---
        case "click_text": {
          const query = typeof command.payload === "string" ? command.payload : "";
          const result = executeClickText(query);
          if (result.success) {
            respond(`Clicked ${result.label || query}`, `Clicked "${result.label || query}"`);
          } else {
            respond(
              `Could not find "${query}" on screen. Try clicking by number.`,
              `"${query}" not found`,
            );
          }
          break;
        }

        // --- Select a result card by spoken ordinal ---
        case "select_job": {
          const position = typeof command.payload === "number" ? command.payload : 0;
          const result = executeSelectJobCard(position);
          if (result.success) {
            respond(`Opening job ${position}.`, `Opened job ${position}: ${result.label || ""}`);
          } else {
            respond(
              `I could not find job ${position} on this page. Open Jobs first, then try again.`,
              `Job ${position} not found`,
            );
          }
          break;
        }

        // --- Number Badges Overlay ---
        case "show_numbers":
          setShowBadgesLocal(true);
          onConfigChange?.((prev) => ({ ...prev, showNumberedBadges: true }));
          renderNumberedBadgesOverlay();
          respond(
            "Showing numbered click targets. Say click followed by any number.",
            "Numbered Badges Displayed",
          );
          break;

        case "hide_numbers":
          setShowBadgesLocal(false);
          onConfigChange?.((prev) => ({ ...prev, showNumberedBadges: false }));
          removeNumberedBadgesOverlay();
          respond("Numbered targets hidden.", "Numbered Badges Hidden");
          break;

        // --- Search & Input ---
        case "search_query": {
          const q = typeof command.payload === "string" ? command.payload : "";
          const ok = executeSearchQuery(q);
          if (ok) {
            respond(`Searching for ${q}.`, `Searched for "${q}"`);
          } else {
            // Fallback: navigate to /jobs with query
            respond(`Searching jobs for ${q}.`, `Searched for "${q}"`);
            navigate({ to: "/jobs", search: { q } as never });
          }
          break;
        }

        case "type_text": {
          const text = typeof command.payload === "string" ? command.payload : "";
          const typed = executeTypeText(text);
          if (typed) {
            respond(`Typed ${text}.`, `Typed "${text}"`);
          } else {
            respond("No input field currently focused. Please click an input field first.");
          }
          break;
        }

        case "clear_input":
          executeClearInput();
          respond("Input cleared.");
          break;

        case "submit_form": {
          if (typeof document !== "undefined") {
            const active = document.activeElement;
            const form = active?.closest("form") || document.querySelector("form");
            if (form) {
              form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
              respond("Form submitted.");
            } else {
              respond("No active form found to submit.");
            }
          }
          break;
        }

        // --- Accessibility Controls ---
        case "toggle_contrast": {
          const next = !actions.highContrast;
          actions.setHighContrast(next);
          respond(next ? "High contrast mode activated." : "Standard contrast restored.");
          break;
        }

        case "toggle_dyslexia": {
          const next = !actions.dyslexiaFont;
          actions.setDyslexiaFont(next);
          respond(next ? "Dyslexia-friendly font enabled." : "Standard typography restored.");
          break;
        }

        case "toggle_ruler": {
          const next = !actions.readingRuler;
          actions.setReadingRuler(next);
          respond(next ? "Reading ruler enabled." : "Reading ruler disabled.");
          break;
        }

        case "toggle_captions": {
          const next = !actions.liveCaptions;
          actions.setLiveCaptions(next);
          respond(next ? "Live captions enabled." : "Live captions disabled.");
          break;
        }

        case "toggle_distraction": {
          const next = !actions.reducedDistraction;
          actions.setReducedDistraction(next);
          respond(next ? "Distraction-free focus mode enabled." : "Standard view restored.");
          break;
        }

        case "font_increase": {
          const next =
            actions.fontSize === "small"
              ? "medium"
              : actions.fontSize === "medium"
                ? "large"
                : "x-large";
          actions.setFontSize(next);
          respond(`Font size increased to ${next}.`);
          break;
        }

        case "font_decrease": {
          const next =
            actions.fontSize === "x-large"
              ? "large"
              : actions.fontSize === "large"
                ? "medium"
                : "small";
          actions.setFontSize(next);
          respond(`Font size decreased to ${next}.`);
          break;
        }

        case "font_reset":
          actions.setFontSize("medium");
          respond("Font size reset to normal.");
          break;

        case "toggle_theme": {
          const wasDark =
            typeof document !== "undefined" && document.documentElement.classList.contains("dark");
          actions.toggleTheme();
          respond(wasDark ? "Light theme enabled." : "Dark theme enabled.");
          break;
        }

        // --- Reading Aloud ---
        case "read_page": {
          const content = readMainPageContent();
          if (content) {
            respond("Reading main page content aloud.", "Reading Content Aloud");
            speakJarvis(content, { rate: conf.ttsRate, lang: conf.lang });
          } else {
            respond("No readable text found on this page.");
          }
          break;
        }

        case "stop_speech":
          stopJarvis();
          respond("Speech stopped.", "Speech Stopped");
          break;

        // --- System States ---
        case "sleep":
          setIsSleeping(true);
          if (conf.soundEffects) playJarvisChime("sleep");
          respond(
            "Standby mode activated. Say 'Hey Janvi' or 'Wake up' to resume listening.",
            "Janvi in Standby",
          );
          break;

        case "wake":
          setIsSleeping(false);
          if (conf.soundEffects) playJarvisChime("wake");
          respond("Janvi online and ready. What can I do for you?", "Janvi Ready");
          break;

        case "help":
          respond(
            "You can say: Go to jobs, Open dashboard, Scroll down, Show numbers, Click number, Search for developer, High contrast, or Janvi sleep.",
            "Command Options Available",
          );
          onHelp?.();
          break;

        case "ask_question": {
          const question = typeof command.payload === "string" ? command.payload : "";
          respond("I’m checking the project for that.", "Searching project context…");
          void askJarvis({ data: { question } })
            .then((result) => {
              const answer = result.ok ? result.answer : result.error;
              setLastActionFeedback(answer);
              setAnnouncement(answer);
              actions.setCaptionText(`JANVI: "${answer}"`);
              if (conf.speechFeedback) speakJarvis(answer, { rate: conf.ttsRate, lang: conf.lang });
            })
            .catch(() => {
              const answer = "I couldn’t reach the project assistant right now.";
              setLastActionFeedback(answer);
              setAnnouncement(answer);
              actions.setCaptionText(`JANVI: "${answer}"`);
              if (conf.speechFeedback) speakJarvis(answer, { rate: conf.ttsRate, lang: conf.lang });
            });
          break;
        }

        case "disable":
          if (onConfigChange) {
            onConfigChange((prev) => ({ ...prev, enabled: false }));
          }
          respond("Voice navigation deactivated. Goodbye.", "Voice Navigation Off");
          break;

        default:
          break;
      }
    },
    [navigate, onConfigChange, onHelp],
  );

  // Initialize and manage Web Speech API Recognition
  useEffect(() => {
    if (typeof window === "undefined") return;

    const win = window as unknown as WindowWithSpeech;
    const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setStatus("unsupported");
      return;
    }

    if (!config.enabled) {
      setStatus("idle");
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Browser may have already stopped listening.
        }
        recognitionRef.current = null;
      }
      removeNumberedBadgesOverlay();
      return;
    }

    let isUnmounted = false;

    function startRecognition() {
      if (isUnmounted || !shouldListenRef.current || !SpeechRecognitionClass) return;

      try {
        const rec = new SpeechRecognitionClass();
        recognitionRef.current = rec;
        // Keep the recognition engine ready for the wake phrase. Command parsing
        // still ignores ordinary speech unless it follows "Hey Janvi".
        rec.continuous = true;
        rec.interimResults = false;
        rec.lang = configRef.current.lang || "en-IN";
        rec.maxAlternatives = 1;

        rec.onresult = (e) => {
          let interim = "";
          let final = "";

          for (let i = e.resultIndex; i < e.results.length; i++) {
            const result = e.results[i];
            const alternative = result?.[0];
            if (!result || !alternative) continue;

            const transcript = alternative.transcript;
            if (result.isFinal) {
              final += transcript;
            } else {
              interim += transcript;
            }
          }

          setLiveTranscript(interim || final);

          if (final.trim()) {
            const commandWindowOpen = Date.now() < commandWindowUntilRef.current;
            const parsed = parseVoiceCommand(final.trim(), {
              // A command can be spoken either in one phrase ("Hey Janvi,
              // open jobs") or as the follow-up to a wake word.
              wakeWordRequired: !commandWindowOpen,
              isSleeping: isSleepingRef.current,
            });

            if (parsed) {
              if (parsed.type === "sleep" || parsed.type === "disable") {
                commandWindowUntilRef.current = 0;
              } else {
                // Keep the hands-free session open for 5 seconds after each
                // accepted command, so repeated "scroll down" commands work.
                commandWindowUntilRef.current = Date.now() + 5_000;
              }
              setStatus("executing");
              executeCommand(parsed);
              setTimeout(() => {
                if (!isUnmounted && shouldListenRef.current) {
                  setStatus(isSleepingRef.current ? "sleeping" : "listening");
                }
              }, 80);
            } else if (isSleepingRef.current) {
              // Ignore while sleeping
            } else if (configRef.current.wakeWordRequired) {
              // Ignored because missing wake word
            }
          }
        };

        rec.onerror = (e) => {
          if (e.error === "not-allowed") {
            setStatus("permission_denied");
          } else if (e.error === "no-speech") {
            // Normal silence timeout, keep going
          } else {
            console.debug("Speech recognition event:", e.error);
          }
        };

        rec.onend = () => {
          // Continuous loop: auto-restart if enabled
          if (!isUnmounted && shouldListenRef.current) {
            setTimeout(() => {
              if (!isUnmounted && shouldListenRef.current) {
                startRecognition();
              }
            }, 50);
          } else {
            setStatus("idle");
          }
        };

        rec.start();
        setStatus(isSleepingRef.current ? "sleeping" : "listening");
      } catch (err) {
        console.debug("Failed to start speech recognition:", err);
      }
    }

    startRecognition();

    return () => {
      isUnmounted = true;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Recognition is already closed.
        }
        recognitionRef.current = null;
      }
    };
  }, [config.enabled, executeCommand]);

  // Manage numbered badges overlay sync
  useEffect(() => {
    if (!config.enabled || !showBadgesLocal) {
      removeNumberedBadgesOverlay();
      return;
    }

    renderNumberedBadgesOverlay();

    // Re-render badges on scroll or resize
    const handleUpdate = () => {
      if (showBadgesLocal) {
        renderNumberedBadgesOverlay();
      }
    };

    window.addEventListener("scroll", handleUpdate, { passive: true });
    window.addEventListener("resize", handleUpdate, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleUpdate);
      window.removeEventListener("resize", handleUpdate);
      removeNumberedBadgesOverlay();
    };
  }, [config.enabled, showBadgesLocal]);

  // Toggle Standby
  const toggleStandby = useCallback(() => {
    setIsSleeping((prev) => {
      const next = !prev;
      if (next) {
        if (config.soundEffects) playJarvisChime("sleep");
        setLastActionFeedback("Janvi in Standby");
      } else {
        if (config.soundEffects) playJarvisChime("wake");
        setLastActionFeedback("Janvi Ready");
        speakJarvis("Janvi ready.", { rate: config.ttsRate, lang: config.lang });
      }
      return next;
    });
  }, [config.soundEffects, config.ttsRate, config.lang]);

  // Toggle Number Badges
  const toggleBadges = useCallback(() => {
    const next = !showBadgesLocal;
    setShowBadgesLocal(next);
    onConfigChange?.((current) => ({ ...current, showNumberedBadges: next }));
    if (next) {
      renderNumberedBadgesOverlay();
      if (config.speechFeedback) {
        speakJarvis("Showing numbered targets.", { rate: config.ttsRate, lang: config.lang });
      }
    } else {
      removeNumberedBadgesOverlay();
    }
  }, [showBadgesLocal, config.speechFeedback, config.ttsRate, config.lang, onConfigChange]);

  // Directly execute voice or typed text (e.g. from Wispr Pro dictation or keyboard)
  const executeVoiceText = useCallback(
    (rawText: string) => {
      const trimmed = rawText.trim();
      if (!trimmed) return;

      setLiveTranscript(trimmed);
      const parsed = parseVoiceCommand(trimmed, {
        wakeWordRequired: false,
        isSleeping: false,
      });

      if (parsed) {
        if (parsed.type === "sleep" || parsed.type === "disable") {
          commandWindowUntilRef.current = 0;
        } else {
          commandWindowUntilRef.current = Date.now() + 5_000;
        }
        setStatus("executing");
        executeCommand(parsed);
        setTimeout(() => {
          if (shouldListenRef.current) {
            setStatus(isSleepingRef.current ? "sleeping" : "listening");
          }
        }, 120);
      } else if (trimmed.length >= 3) {
        // Fallback to project question / AI assistant
        setStatus("executing");
        executeCommand({
          type: "ask_question",
          payload: trimmed,
          rawText: trimmed,
          confidence: 0.9,
        });
        setTimeout(() => {
          if (shouldListenRef.current) {
            setStatus(isSleepingRef.current ? "sleeping" : "listening");
          }
        }, 120);
      }
    },
    [executeCommand],
  );

  return {
    status,
    isSleeping,
    liveTranscript,
    lastCommand,
    lastActionFeedback,
    announcement,
    showBadges: showBadgesLocal,
    toggleStandby,
    toggleBadges,
    executeCommand,
    executeVoiceText,
  };
}

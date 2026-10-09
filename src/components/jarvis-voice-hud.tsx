import { useCallback, useEffect, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  Moon,
  Sun,
  Volume2,
  VolumeX,
  HelpCircle,
  X,
  ChevronUp,
  ChevronDown,
  Layers,
  Sparkles,
  Command,
  ArrowRight,
} from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { useJarvisVoice } from "@/lib/voice/use-jarvis-voice";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Janvi Hands-Free Voice Control HUD.
 * Designed specifically for users with zero or limited motor control (no hands).
 * Provides continuous listening, live visual feedback, wake-word standby, and click-by-number overlays.
 */
export function JarvisVoiceHud() {
  const {
    voiceNavConfig,
    eyeTrackingConfig,
    gestureConfig,
    setVoiceNavConfig,
    setVoiceNavEnabled,
    highContrast,
    setHighContrast,
    dyslexiaFont,
    setDyslexiaFont,
    readingRuler,
    setReadingRuler,
    liveCaptions,
    setLiveCaptions,
    reducedDistraction,
    setReducedDistraction,
    fontSize,
    setFontSize,
    toggleTheme,
    setCaptionText,
  } = useAppState();

  const [collapsed, setCollapsed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [wisprInput, setWisprInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const openHelp = useCallback(() => setHelpOpen(true), []);

  const {
    status,
    isSleeping,
    liveTranscript,
    lastActionFeedback,
    announcement,
    showBadges,
    toggleStandby,
    toggleBadges,
    executeVoiceText,
  } = useJarvisVoice({
    config: voiceNavConfig,
    onConfigChange: setVoiceNavConfig,
    onHelp: openHelp,
    appActions: {
      highContrast,
      setHighContrast,
      dyslexiaFont,
      setDyslexiaFont,
      readingRuler,
      setReadingRuler,
      liveCaptions,
      setLiveCaptions,
      reducedDistraction,
      setReducedDistraction,
      fontSize,
      setFontSize,
      toggleTheme,
      setCaptionText,
      eyeTrackingEnabled: eyeTrackingConfig.enabled,
      gesturesEnabled: gestureConfig.enabled,
    },
  });

  const toggleSpeechFeedback = () => {
    setVoiceNavConfig((prev) => ({
      ...prev,
      speechFeedback: !prev.speechFeedback,
    }));
  };

  // Global shortcut (Cmd+J or Ctrl+J) to focus Wispr Pro command input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setCollapsed(false);
        setTimeout(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        }, 50);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleWisprSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!wisprInput.trim()) return;
    executeVoiceText(wisprInput);
    setWisprInput("");
  };

  if (!voiceNavConfig.enabled) {
    return null;
  }

  return (
    <>
      {/* ARIA Live Region for Screen Readers */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <aside
        aria-label="Janvi Voice Navigation HUD"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 rounded-2xl border-2 border-[#191716] bg-card/95 p-3.5 shadow-[4px_4px_0px_#191716] backdrop-blur-md max-w-sm w-[340px] transition-all dark:border-stone-700"
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between gap-2 border-b border-border/70 pb-2">
          <div className="flex items-center gap-2">
            {/* Pulsing Arc Reactor / Mic Orb */}
            <div className="relative flex size-6 items-center justify-center">
              {status === "listening" && !isSleeping && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7BD3C2] opacity-75" />
              )}
              <div
                className={`relative flex size-6 items-center justify-center rounded-full border border-[#191716] transition-colors ${
                  isSleeping
                    ? "bg-amber-400 text-stone-900"
                    : status === "executing"
                      ? "bg-emerald-400 text-stone-900 animate-bounce"
                      : status === "listening"
                        ? "bg-[#7BD3C2] text-[#141817]"
                        : "bg-stone-300 text-stone-600"
                }`}
              >
                {isSleeping ? (
                  <Moon className="size-3.5" />
                ) : (
                  <Mic className="size-3.5 animate-pulse" />
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold tracking-tight font-serif text-foreground">
                  Janvi Voice
                </span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider ${
                    isSleeping
                      ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                      : status === "listening"
                        ? "bg-[#7BD3C2]/40 text-[#141817] dark:text-white"
                        : "bg-stone-100 text-stone-600 dark:bg-stone-800"
                  }`}
                >
                  {isSleeping
                    ? "Standby"
                    : status === "executing"
                      ? "Action"
                      : status === "permission_denied"
                        ? "Mic blocked"
                        : status === "unsupported"
                          ? "Unavailable"
                          : "Listening"}
                </span>
              </div>
            </div>
          </div>

          {/* Quick HUD controls */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Voice Commands Guide"
              aria-label="Open voice commands guide"
            >
              <HelpCircle className="size-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              title={collapsed ? "Expand HUD" : "Collapse HUD"}
              aria-label={collapsed ? "Expand HUD" : "Collapse HUD"}
            >
              {collapsed ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setVoiceNavEnabled(false)}
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title="Turn Off Voice Control"
              aria-label="Turn off voice control"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Collapsible Body */}
        {!collapsed && (
          <div className="space-y-2.5 pt-1">
            {/* Live Transcript / Feedback Strip */}
            <div className="rounded-xl border border-border/80 bg-background/80 p-2.5 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="font-semibold uppercase tracking-wider">
                  {isSleeping ? "Say 'Hey Janvi' or 'Wake up'" : "Live Speech:"}
                </span>
                {liveTranscript && (
                  <span className="flex size-1.5 rounded-full bg-brand animate-ping" />
                )}
              </div>

              <p className="text-xs font-medium text-foreground min-h-[1.25rem] truncate">
                {liveTranscript ? (
                  <span className="italic">"{liveTranscript}"</span>
                ) : isSleeping ? (
                  <span className="text-muted-foreground italic">Sleeping… Say "Wake up"</span>
                ) : (
                  <span className="text-muted-foreground italic">
                    Say "Hey Siri", "Hey Google", or "Hey Janvi"
                  </span>
                )}
              </p>

              {lastActionFeedback && (
                <div className="mt-1 flex items-center gap-1.5 rounded-lg bg-[#7BD3C2]/20 border border-[#7BD3C2]/40 px-2 py-1 text-[11px] font-semibold text-[#141817] dark:text-[#7BD3C2]">
                  <Sparkles className="size-3 shrink-0" />
                  <span className="truncate">{lastActionFeedback}</span>
                </div>
              )}
            </div>

            {/* Wispr Pro / Direct Voice Command Bar */}
            <form onSubmit={handleWisprSubmit} className="relative flex items-center">
              <input
                ref={inputRef}
                type="text"
                value={wisprInput}
                onChange={(e) => setWisprInput(e.target.value)}
                placeholder="Wispr dictate or type… (Cmd+J)"
                className="w-full rounded-xl border border-border/80 bg-background/90 py-1.5 pl-2.5 pr-8 text-xs text-foreground placeholder:text-muted-foreground/80 focus:border-[#7BD3C2] focus:outline-none focus:ring-1 focus:ring-[#7BD3C2] transition-colors"
                aria-label="Wispr Pro dictation or voice command input"
              />
              <button
                type="submit"
                disabled={!wisprInput.trim()}
                className="absolute right-1 flex size-5 items-center justify-center rounded-lg bg-[#7BD3C2] text-[#141817] disabled:opacity-30 disabled:pointer-events-none hover:brightness-105 transition-opacity"
                title="Execute Command (Enter)"
                aria-label="Execute command"
              >
                <ArrowRight className="size-3" />
              </button>
            </form>

            {/* Action Buttons Toolbar */}
            <div className="grid grid-cols-3 gap-1.5">
              {/* Standby / Wake */}
              <button
                type="button"
                onClick={toggleStandby}
                className={`flex items-center justify-center gap-1 rounded-lg border py-1.5 text-xs font-semibold transition-all ${
                  isSleeping
                    ? "border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                    : "border-border bg-secondary/60 text-foreground hover:bg-secondary"
                }`}
                title={isSleeping ? "Wake Janvi up" : "Put Janvi in standby"}
              >
                {isSleeping ? (
                  <Sun className="size-3 text-amber-600" />
                ) : (
                  <Moon className="size-3" />
                )}
                <span>{isSleeping ? "Wake" : "Standby"}</span>
              </button>

              {/* Number Badges Toggle */}
              <button
                type="button"
                onClick={toggleBadges}
                className={`flex items-center justify-center gap-1 rounded-lg border py-1.5 text-xs font-semibold transition-all ${
                  showBadges
                    ? "border-[#191716] bg-[#7BD3C2] text-[#141817] shadow-[1px_1px_0px_#141817]"
                    : "border-border bg-secondary/60 text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
                title="Show numbered click targets for every button and link"
              >
                <Layers className="size-3" />
                <span>Badges {showBadges ? "✓" : ""}</span>
              </button>

              {/* Voice Speech Audio Feedback */}
              <button
                type="button"
                onClick={toggleSpeechFeedback}
                className={`flex items-center justify-center gap-1 rounded-lg border py-1.5 text-xs font-semibold transition-all ${
                  voiceNavConfig.speechFeedback
                    ? "border-border bg-secondary/60 text-foreground"
                    : "border-border bg-muted text-muted-foreground"
                }`}
                title={
                  voiceNavConfig.speechFeedback
                    ? "Janvi Voice Speech: ON"
                    : "Janvi Voice Speech: Muted"
                }
              >
                {voiceNavConfig.speechFeedback ? (
                  <Volume2 className="size-3 text-brand" />
                ) : (
                  <VolumeX className="size-3" />
                )}
                <span>{voiceNavConfig.speechFeedback ? "Voice" : "Mute"}</span>
              </button>
            </div>

            {/* Quick Prompt Hint */}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t border-border/50 pt-1.5 px-0.5">
              <span>
                Wake words: <strong>"Hey Siri"</strong> / <strong>"Hey Google"</strong>
              </span>
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="underline hover:text-foreground"
              >
                All Commands
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Voice Commands Cheatsheet Dialog */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-serif text-xl font-bold">
              <span className="flex size-8 items-center justify-center rounded-full bg-[#7BD3C2] text-[#141817] text-sm">
                <Mic className="size-4" />
              </span>
              Janvi Voice Commands Reference
            </DialogTitle>
          </DialogHeader>

          <p className="text-xs text-muted-foreground">
            Janvi gives people with zero motor function (no hands) complete, hands-free mastery
            over Ableo. Speak naturally into your microphone or dictate with Wispr Pro.
          </p>

          <div className="space-y-4 pt-2 text-xs">
            {/* Wispr Pro Supercharged Dictation */}
            <div className="rounded-xl border border-[#7BD3C2]/50 bg-[#7BD3C2]/10 p-3 space-y-1.5">
              <h4 className="font-bold text-foreground flex items-center gap-1.5 text-sm">
                <Sparkles className="size-4 text-brand" />
                Wispr Pro Dictation (Zero Transcription Errors)
              </h4>
              <p className="text-muted-foreground">
                If you have the Wispr Pro desktop app installed, you can dictate commands without speech recognition errors:
              </p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground font-medium">
                <li>
                  Press <kbd className="rounded border px-1 py-0.5 font-mono text-[10px] bg-background">Cmd+J</kbd> (Mac) or <kbd className="rounded border px-1 py-0.5 font-mono text-[10px] bg-background">Ctrl+J</kbd> to focus the Janvi input.
                </li>
                <li>
                  Trigger your <strong>Wispr Pro hotkey</strong> and speak (e.g. <em>"Click 3"</em>, <em>"Go to jobs"</em>, or <em>"What accommodations exist?"</em>).
                </li>
                <li>
                  Press <kbd className="rounded border px-1 py-0.5 font-mono text-[10px] bg-background">Enter</kbd> (or click the arrow) — Janvi executes immediately!
                </li>
              </ol>
            </div>
            {/* Clicking by Number */}
            <div className="rounded-xl border border-[#7BD3C2]/50 bg-[#7BD3C2]/10 p-3">
              <h4 className="font-bold text-foreground flex items-center gap-1.5 text-sm mb-1">
                <Layers className="size-4 text-brand" />
                Clicking Anything by Number (Hands-Free Mastery)
              </h4>
              <p className="text-muted-foreground mb-2">
                Say <strong>"Show numbers"</strong> to tag every button, card, and link on the page
                with a numbered badge, then say:
              </p>
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                <div className="rounded bg-background p-1.5 border">"Click 3" / "Open 5"</div>
                <div className="rounded bg-background p-1.5 border">"Select 12" / "Target 7"</div>
                <div className="rounded bg-background p-1.5 border">"Show numbers"</div>
                <div className="rounded bg-background p-1.5 border">"Hide numbers"</div>
              </div>
            </div>

            {/* Navigation */}
            <div className="rounded-xl border border-border p-3 space-y-1.5">
              <h4 className="font-bold text-foreground flex items-center gap-1.5 text-sm">
                <Command className="size-4 text-muted-foreground" />
                Navigation Commands
              </h4>
              <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                <div>
                  • <strong>"Go to jobs"</strong> / "Find jobs"
                </div>
                <div>
                  • <strong>"Open dashboard"</strong>
                </div>
                <div>
                  • <strong>"Go to profile"</strong>
                </div>
                <div>
                  • <strong>"My applications"</strong>
                </div>
                <div>
                  • <strong>"Resume match"</strong>
                </div>
                <div>
                  • <strong>"Career coach"</strong> / "Angie"
                </div>
                <div>
                  • <strong>"Employer portal"</strong>
                </div>
                <div>
                  • <strong>"Rights guide"</strong> / "Privacy"
                </div>
                <div>
                  • <strong>"Go back"</strong> / "Go forward"
                </div>
                <div>
                  • <strong>"Reload page"</strong> / "Home"
                </div>
              </div>
            </div>

            {/* Scrolling & Reading */}
            <div className="rounded-xl border border-border p-3 space-y-1.5">
              <h4 className="font-bold text-foreground flex items-center gap-1.5 text-sm">
                📜 Scrolling & Reading Aloud
              </h4>
              <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                <div>
                  • <strong>"Scroll down"</strong> / "Page down"
                </div>
                <div>
                  • <strong>"Scroll up"</strong> / "Page up"
                </div>
                <div>
                  • <strong>"Scroll to top"</strong>
                </div>
                <div>
                  • <strong>"Scroll to bottom"</strong>
                </div>
                <div>
                  • <strong>"Read page"</strong> (aloud)
                </div>
                <div>
                  • <strong>"Stop speaking"</strong> / "Silence"
                </div>
              </div>
            </div>

            {/* Search & Typing */}
            <div className="rounded-xl border border-border p-3 space-y-1.5">
              <h4 className="font-bold text-foreground flex items-center gap-1.5 text-sm">
                🔍 Search & Typing
              </h4>
              <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                <div>
                  • <strong>"Search for React in Mumbai"</strong>
                </div>
                <div>
                  • <strong>"Type [your text]"</strong>
                </div>
                <div>
                  • <strong>"Clear search"</strong>
                </div>
                <div>
                  • <strong>"Submit form"</strong>
                </div>
              </div>
            </div>

            {/* Accessibility Controls */}
            <div className="rounded-xl border border-border p-3 space-y-1.5">
              <h4 className="font-bold text-foreground flex items-center gap-1.5 text-sm">
                ♿ Accessibility Controls
              </h4>
              <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                <div>
                  • <strong>"High contrast"</strong>
                </div>
                <div>
                  • <strong>"Dyslexia font"</strong>
                </div>
                <div>
                  • <strong>"Reading ruler"</strong>
                </div>
                <div>
                  • <strong>"Live captions"</strong>
                </div>
                <div>
                  • <strong>"Distraction free"</strong>
                </div>
                <div>
                  • <strong>"Bigger text"</strong> / "Smaller text"
                </div>
              </div>
            </div>

            {/* System Control */}
            <div className="rounded-xl border border-border p-3 space-y-1.5">
              <h4 className="font-bold text-foreground flex items-center gap-1.5 text-sm">
                ⚙️ Standby & System
              </h4>
              <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                <div>
                  • <strong>"Janvi sleep"</strong> / "Standby"
                </div>
                <div>
                  • <strong>"Wake up"</strong> / "Hey Janvi"
                </div>
                <div>
                  • <strong>"Help"</strong> (shows this guide)
                </div>
                <div>
                  • <strong>"Turn off voice"</strong>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

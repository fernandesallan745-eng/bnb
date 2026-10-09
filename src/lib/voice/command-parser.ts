import { extractSpokenNumber } from "./words-to-numbers";
import type { VoiceCommand } from "./types";

const WAKE_WORDS = [
  // Google
  "hey google",
  "okay google",
  "ok google",
  // Siri
  "hey siri",
  // Janvi & variations
  "hey janvi",
  "okay janvi",
  "ok janvi",
  "hello janvi",
  "hi janvi",
  // Jarvis
  "hey jarvis",
  "okay jarvis",
  "ok jarvis",
  // Alexa & computer
  "hey alexa",
  "computer",
  // Common phonetic mishearings by speech-to-text engines
  "hey johnny",
  "hey generic",
  "hey january",
  "hey jan vi",
  "hey genvi",
  "hey jenny",
  "hey jaanvi",
  "a janvi",
  // Single-word wake triggers (tested after prefixes)
  "google",
  "siri",
  "janvi",
  "jarvis",
  "alexa",
];

export type ParseOptions = {
  wakeWordRequired?: boolean;
  isSleeping?: boolean;
};

/**
 * Strips leading wake words from spoken speech transcript.
 * Returns { hasWakeWord: boolean, cleanText: string }
 */
export function stripWakeWord(raw: string): { hasWakeWord: boolean; cleanText: string } {
  const lower = raw.toLowerCase().trim();
  for (const w of WAKE_WORDS) {
    if (lower === w) {
      return { hasWakeWord: true, cleanText: "" };
    }
    if (lower.startsWith(`${w} `) || lower.startsWith(`${w},`)) {
      const rest = lower
        .slice(w.length)
        .replace(/^[,.\s]+/, "")
        .trim();
      return { hasWakeWord: true, cleanText: rest };
    }
  }
  return { hasWakeWord: false, cleanText: lower };
}

/** Normalize conversational speech without changing the user's intent. */
function normalizeIntentText(text: string): string {
  let normalized = text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[!?.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const leadIns = [
    /^(?:please|kindly)\s+/,
    /^(?:can|could|would|will)\s+you\s+/,
    /^(?:i want to|i'd like to|i would like to|help me|let's)\s+/,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const leadIn of leadIns) {
      if (leadIn.test(normalized)) {
        normalized = normalized.replace(leadIn, "").trim();
        changed = true;
      }
    }
  }

  return normalized.replace(/\s+(?:for me|please)$/i, "").trim();
}

/**
 * Parses raw speech input into an executable Janvi voice command.
 */
export function parseVoiceCommand(
  rawTranscript: string,
  options: ParseOptions = {},
): VoiceCommand | null {
  const { wakeWordRequired = true, isSleeping = false } = options;
  const { hasWakeWord, cleanText } = stripWakeWord(rawTranscript);

  // If in standby/sleeping mode, only wake commands are permitted
  if (isSleeping) {
    if (
      (cleanText === "" && hasWakeWord) ||
      /\b(wake up|wake|resume|listen|start listening|i'm back|online)\b/.test(cleanText) ||
      /\b(?:janvi|siri|google|jarvis)\s+wake|wake\s+(?:up\s+)?(?:janvi|siri|google|jarvis)\b/.test(
        rawTranscript.toLowerCase(),
      )
    ) {
      return {
        type: "wake",
        rawText: rawTranscript,
        confidence: 0.95,
      };
    }
    return null; // Ignore everything else while sleeping
  }

  // If wake word is strictly required and missing, ignore
  if (wakeWordRequired && !hasWakeWord) {
    return null;
  }

  // If user just said "Hey Janvi" with no follow-up, treat as wake/attention check
  if (hasWakeWord && cleanText === "") {
    return {
      type: "wake",
      rawText: rawTranscript,
      confidence: 1.0,
    };
  }

  const text = normalizeIntentText(cleanText);

  // 1. SLEEP & STANDBY
  if (
    /\b(sleep|go to sleep|standby|pause listening|stop listening|take a break|mute mic)\b/.test(
      text,
    )
  ) {
    return { type: "sleep", rawText: rawTranscript, confidence: 0.95 };
  }

  // 2. DISABLE / EXIT
  if (
    /\b(turn off voice|disable voice|exit voice|quit voice|deactivate voice|close voice)\b/.test(
      text,
    )
  ) {
    return { type: "disable", rawText: rawTranscript, confidence: 0.95 };
  }

  // 3. HELP & COMMANDS
  if (
    /\b(help|what can i say|show commands|list commands|voice guide|commands guide)\b/.test(text)
  ) {
    return { type: "help", rawText: rawTranscript, confidence: 0.95 };
  }

  // 4. SHOW / HIDE NUMBERED BADGES
  if (
    /\b(show numbers|show badges|show tags|show targets|display numbers|numbers on|activate numbers)\b/.test(
      text,
    )
  ) {
    return { type: "show_numbers", rawText: rawTranscript, confidence: 0.95 };
  }
  if (
    /\b(hide numbers|hide badges|hide tags|hide targets|remove numbers|numbers off)\b/.test(text)
  ) {
    return { type: "hide_numbers", rawText: rawTranscript, confidence: 0.95 };
  }

  // 5. SELECT A JOB RESULT BY ITS POSITION.
  // This must precede generic click-by-number handling: "select the first job"
  // means the first result card, not numbered badge #1 elsewhere on the page.
  const selectJobMatch = text.match(
    /\b(?:select|choose|open|view|show)\s+(?:the\s+)?([a-z0-9\s-]+?)\s+(?:job|result|listing|role)\b/i,
  );
  if (selectJobMatch) {
    const position = extractSpokenNumber(selectJobMatch[1] ?? "");
    if (position !== null && position > 0) {
      return { type: "select_job", payload: position, rawText: rawTranscript, confidence: 0.94 };
    }
  }

  // 6. CLICK BY NUMBER
  // e.g. "click 3", "click number 3", "press 14", "select 5", "open 2", "number 8", "choose 10"
  const clickNumberMatch = text.match(
    /\b(?:click|press|select|open|choose|target|number|item)\s+(?:number\s+)?([a-z0-9\s-]+)\b/i,
  );
  if (clickNumberMatch) {
    const num = extractSpokenNumber(clickNumberMatch[1] ?? "");
    if (num !== null && num > 0) {
      return { type: "click_number", payload: num, rawText: rawTranscript, confidence: 0.9 };
    }
  }

  // 7. SCROLLING
  if (
    /\b(scroll down|page down|move down|move the page down|go down|go down a little|down a bit)\b/.test(
      text,
    )
  ) {
    return { type: "scroll_down", rawText: rawTranscript, confidence: 0.95 };
  }
  if (/\b(scroll up|page up|move up|move the page up|go up|go up a little|up a bit)\b/.test(text)) {
    return { type: "scroll_up", rawText: rawTranscript, confidence: 0.95 };
  }
  if (/\b(scroll to top|scroll top|go to top|top of page|back to top)\b/.test(text)) {
    return { type: "scroll_top", rawText: rawTranscript, confidence: 0.95 };
  }
  if (/\b(scroll to bottom|scroll bottom|bottom of page|go to bottom)\b/.test(text)) {
    return { type: "scroll_bottom", rawText: rawTranscript, confidence: 0.95 };
  }

  // 8. NAVIGATION
  if (
    /\b(?:go to|open|show|find|browse|take me to|bring me to|navigate to|send me to)\s+(?:the\s+)?(?:job|jobs|search|vacancies|openings|job board|job listings)\b/.test(
      text,
    ) ||
    /\b(?:job search|job board|job listings|available jobs|open roles)\b/.test(text) ||
    text === "jobs" ||
    text === "find jobs"
  ) {
    return { type: "nav_jobs", rawText: rawTranscript, confidence: 0.95 };
  }

  if (
    /\b(?:go to|open|show|take me to|bring me to|navigate to)\s+(?:(?:the|my)\s+)?dashboard\b/.test(
      text,
    ) ||
    text === "dashboard" ||
    text === "my dashboard"
  ) {
    return { type: "nav_dashboard", rawText: rawTranscript, confidence: 0.95 };
  }

  if (
    /\b(?:go to|open|show|edit|take me to|bring me to|navigate to|view)\s+(?:my\s+)?(?:profile|resume|cv)\b/.test(
      text,
    ) ||
    text === "profile" ||
    text === "my profile"
  ) {
    return { type: "nav_profile", rawText: rawTranscript, confidence: 0.95 };
  }

  if (
    /\b(?:go to|open|show|see|take me to|bring me to|navigate to|view|check)\s+(?:my\s+)?applications\b/.test(
      text,
    ) ||
    text === "applications" ||
    text === "applied jobs" ||
    text === "my applications"
  ) {
    return { type: "nav_applications", rawText: rawTranscript, confidence: 0.95 };
  }

  if (
    /\b(?:go to|open|run|take me to|bring me to|navigate to|use)\s+(?:the\s+)?(?:resume match|resume matcher|cv matcher)\b/.test(
      text,
    ) ||
    text === "resume match" ||
    text === "match resume"
  ) {
    return { type: "nav_resume_match", rawText: rawTranscript, confidence: 0.95 };
  }

  if (
    /\b(?:go to|open|talk to|chat with|take me to|bring me to|navigate to)\s+(?:the\s+)?(?:career gps|career coach|coach|angie|ai coach)\b/.test(
      text,
    ) ||
    text === "career gps" ||
    text === "career coach" ||
    text === "angie"
  ) {
    return { type: "nav_career_gps", rawText: rawTranscript, confidence: 0.95 };
  }

  if (
    /\b(?:go to|open|show|take me to|bring me to|navigate to)\s+(?:the\s+)?(?:employer portal|employer|hire|recruit)\b/.test(
      text,
    ) ||
    text === "employer" ||
    text === "employer portal"
  ) {
    return { type: "nav_employer", rawText: rawTranscript, confidence: 0.95 };
  }

  if (
    /\b(?:go to|open|show|take me to|bring me to|navigate to)\s+(?:the\s+)?(?:privacy|rights|legal rights|rpwd|rights guide)\b/.test(
      text,
    ) ||
    text === "privacy" ||
    text === "rights guide"
  ) {
    return { type: "nav_privacy", rawText: rawTranscript, confidence: 0.95 };
  }

  if (
    /\b(?:go to|open|show|take me to|bring me to|navigate to)\s+(?:the\s+)?(?:home|home page|landing page)\b/.test(
      text,
    ) ||
    text === "home" ||
    text === "go home"
  ) {
    return { type: "nav_home", rawText: rawTranscript, confidence: 0.95 };
  }

  if (/\b(go back|back page|navigate back|previous page)\b/.test(text) || text === "back") {
    return { type: "nav_back", rawText: rawTranscript, confidence: 0.95 };
  }

  if (/\b(go forward|forward page|navigate forward|next page)\b/.test(text) || text === "forward") {
    return { type: "nav_forward", rawText: rawTranscript, confidence: 0.95 };
  }

  if (/\b(reload|reload page|refresh|refresh page)\b/.test(text)) {
    return { type: "nav_reload", rawText: rawTranscript, confidence: 0.95 };
  }

  // 9. SEARCH & INPUT
  const searchMatch = text.match(
    /\b(?:search for|search|find jobs for|find me|look up|look for)\s+(?:some\s+)?([a-z0-9\s,.-]+)\b/i,
  );
  if (
    searchMatch &&
    searchMatch[1]?.trim() &&
    !searchMatch[1].match(/^(jobs?|dashboard|profile)$/i)
  ) {
    return {
      type: "search_query",
      payload: searchMatch[1].trim(),
      rawText: rawTranscript,
      confidence: 0.9,
    };
  }

  const typeMatch = text.match(/\b(?:type|enter|write)\s+([a-z0-9\s,.-]+)\b/i);
  if (typeMatch && typeMatch[1]?.trim()) {
    return {
      type: "type_text",
      payload: typeMatch[1].trim(),
      rawText: rawTranscript,
      confidence: 0.85,
    };
  }

  if (/\b(clear search|clear input|clear text|reset search|erase input)\b/.test(text)) {
    return { type: "clear_input", rawText: rawTranscript, confidence: 0.95 };
  }

  if (/\b(submit|submit form|press enter|enter key|send form)\b/.test(text)) {
    return { type: "submit_form", rawText: rawTranscript, confidence: 0.95 };
  }

  // 10. ACCESSIBILITY TOGGLES
  if (/\b(high contrast|contrast)\b/.test(text)) {
    return { type: "toggle_contrast", rawText: rawTranscript, confidence: 0.95 };
  }
  if (/\b(dyslexia font|dyslexia|open dyslexic)\b/.test(text)) {
    return { type: "toggle_dyslexia", rawText: rawTranscript, confidence: 0.95 };
  }
  if (/\b(reading ruler|ruler|focus ruler|reading guide)\b/.test(text)) {
    return { type: "toggle_ruler", rawText: rawTranscript, confidence: 0.95 };
  }
  if (/\b(live captions|captions|subtitles)\b/.test(text)) {
    return { type: "toggle_captions", rawText: rawTranscript, confidence: 0.95 };
  }
  if (/\b(distraction free|distraction-free|focus mode|reduce distraction)\b/.test(text)) {
    return { type: "toggle_distraction", rawText: rawTranscript, confidence: 0.95 };
  }
  if (
    /\b(increase font|increase text|bigger font|bigger text|larger text|zoom text)\b/.test(text)
  ) {
    return { type: "font_increase", rawText: rawTranscript, confidence: 0.95 };
  }
  if (/\b(decrease font|decrease text|smaller font|smaller text)\b/.test(text)) {
    return { type: "font_decrease", rawText: rawTranscript, confidence: 0.95 };
  }
  if (/\b(reset font|normal font|medium font|default font)\b/.test(text)) {
    return { type: "font_reset", rawText: rawTranscript, confidence: 0.95 };
  }
  if (/\b(dark mode|light mode|toggle theme|switch theme)\b/.test(text)) {
    return { type: "toggle_theme", rawText: rawTranscript, confidence: 0.95 };
  }

  // 11. READING ALOUD
  if (/\b(read page|read aloud|read this|read content|speak content|read article)\b/.test(text)) {
    return { type: "read_page", rawText: rawTranscript, confidence: 0.95 };
  }
  if (/\b(stop reading|stop speaking|stop talking|silence|quiet|shh|pause reading)\b/.test(text)) {
    return { type: "stop_speech", rawText: rawTranscript, confidence: 0.95 };
  }

  // 12. CLICK BY TEXT (e.g. "click apply", "click sign in", "click save", "click filters")
  const clickTextMatch = text.match(/\b(?:click|press|tap)\s+([a-z0-9\s-]+)\b/i);
  if (clickTextMatch && clickTextMatch[1]?.trim()) {
    const targetText = clickTextMatch[1].trim();
    return {
      type: "click_text",
      payload: targetText,
      rawText: rawTranscript,
      confidence: 0.8,
    };
  }

  // Direct standalone number e.g. "three", "number four", "seven".
  // Keep this last because speech recognition often hears "to" in commands
  // such as "go to jobs", and it must not become click target two.
  if (/^(?:number\s+)?[a-z0-9\s-]+$/i.test(text)) {
    const standaloneNum = extractSpokenNumber(text);
    if (standaloneNum !== null && standaloneNum > 0) {
      return {
        type: "click_number",
        payload: standaloneNum,
        rawText: rawTranscript,
        confidence: 0.85,
      };
    }
  }

  // Once Janvi has the user's attention, treat otherwise-unmatched speech
  // as a question instead of forcing the user to learn a command vocabulary.
  // The server-side assistant answers from a read-only, redacted project index.
  if (text.length >= 3) {
    return {
      type: "ask_question",
      payload: text,
      rawText: rawTranscript,
      confidence: 0.65,
    };
  }

  return null;
}

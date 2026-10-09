import { describe, expect, it } from "vitest";
import { parseVoiceCommand, stripWakeWord } from "@/lib/voice/command-parser";
import { extractSpokenNumber } from "@/lib/voice/words-to-numbers";

describe("Janvi voice command parser", () => {
  it("understands spoken numbers for click-by-number navigation", () => {
    expect(extractSpokenNumber("twenty one")).toBe(21);
    expect(extractSpokenNumber("the fourth target")).toBe(4);
    expect(parseVoiceCommand("Hey Janvi, click twenty one")?.type).toBe("click_number");
    expect(parseVoiceCommand("Hey Janvi, click twenty one")?.payload).toBe(21);
  });

  it("requires a wake word when that safety setting is enabled", () => {
    expect(parseVoiceCommand("open dashboard", { wakeWordRequired: true })).toBeNull();
    expect(parseVoiceCommand("Hey Janvi, open dashboard", { wakeWordRequired: true })?.type).toBe(
      "nav_dashboard",
    );
    expect(stripWakeWord("Hey Janvi, show numbers")).toEqual({
      hasWakeWord: true,
      cleanText: "show numbers",
    });
  });

  it("supports multiple popular wake words like Hey Siri and Hey Google", () => {
    expect(parseVoiceCommand("Hey Siri, open dashboard", { wakeWordRequired: true })?.type).toBe(
      "nav_dashboard",
    );
    expect(parseVoiceCommand("Hey Google, go to jobs", { wakeWordRequired: true })?.type).toBe(
      "nav_jobs",
    );
    expect(parseVoiceCommand("OK Google, scroll down", { wakeWordRequired: true })?.type).toBe(
      "scroll_down",
    );
    expect(parseVoiceCommand("Hey Siri")?.type).toBe("wake");
    expect(parseVoiceCommand("Hey Google")?.type).toBe("wake");
    expect(stripWakeWord("Hey Siri, click 3")).toEqual({
      hasWakeWord: true,
      cleanText: "click 3",
    });
    expect(stripWakeWord("Hey Google, show numbers")).toEqual({
      hasWakeWord: true,
      cleanText: "show numbers",
    });
  });

  it("accepts one normal command after the wake-word command window opens", () => {
    // The hook opens this window for eight seconds after "Hey Janvi".
    expect(parseVoiceCommand("open jobs", { wakeWordRequired: false })?.type).toBe("nav_jobs");
    expect(parseVoiceCommand("scroll down", { wakeWordRequired: false })?.type).toBe("scroll_down");
  });

  it("only wakes from standby until explicitly resumed", () => {
    expect(parseVoiceCommand("scroll down", { isSleeping: true })).toBeNull();
    expect(parseVoiceCommand("wake up", { isSleeping: true })?.type).toBe("wake");
  });

  it("maps navigation, page controls, and search to safe commands", () => {
    expect(parseVoiceCommand("Hey Janvi, go to jobs")?.type).toBe("nav_jobs");
    expect(parseVoiceCommand("Hey Janvi, scroll to bottom")?.type).toBe("scroll_bottom");
    expect(parseVoiceCommand("Hey Janvi, search for accessible designer in Pune")?.payload).toBe(
      "accessible designer in pune",
    );
  });

  it("selects a job result by spoken ordinal instead of a numbered overlay", () => {
    const command = parseVoiceCommand("Hey Janvi, select the first job");
    expect(command?.type).toBe("select_job");
    expect(command?.payload).toBe(1);
  });

  it("understands natural polite English and different phrasing", () => {
    expect(parseVoiceCommand("Hey Janvi, could you please take me to the job listings")?.type).toBe(
      "nav_jobs",
    );
    expect(parseVoiceCommand("Hey Janvi, I want to see my applications")?.type).toBe(
      "nav_applications",
    );
    expect(parseVoiceCommand("Hey Janvi, find me remote frontend jobs in Pune")?.payload).toBe(
      "remote frontend jobs in pune",
    );
    expect(parseVoiceCommand("Hey Janvi, could you move the page down a little")?.type).toBe(
      "scroll_down",
    );
  });

  it("passes natural project questions to the assistant after wake", () => {
    const command = parseVoiceCommand("Hey Janvi, how does the job matching work?");
    expect(command?.type).toBe("ask_question");
    expect(command?.payload).toBe("how does the job matching work");
  });

  it("handles clean Wispr Pro formatted dictation with or without wake words", () => {
    // When dictated through Wispr Pro into the command bar (wakeWordRequired: false)
    expect(parseVoiceCommand("Click 4.", { wakeWordRequired: false })?.type).toBe("click_number");
    expect(parseVoiceCommand("Click 4.", { wakeWordRequired: false })?.payload).toBe(4);
    expect(parseVoiceCommand("Go to jobs.", { wakeWordRequired: false })?.type).toBe("nav_jobs");
    expect(parseVoiceCommand("Scroll down.", { wakeWordRequired: false })?.type).toBe("scroll_down");
    expect(
      parseVoiceCommand("Hey Janvi, open my dashboard.", { wakeWordRequired: false })?.type,
    ).toBe("nav_dashboard");
    expect(
      parseVoiceCommand("What accessibility accommodations are supported?", {
        wakeWordRequired: false,
      })?.type,
    ).toBe("ask_question");
  });

  it("handles 'hey jaanvi' and 'jaanvi' phonetic wake word variations and consecutive follow-ups", () => {
    // 1st command: Initial navigation
    expect(parseVoiceCommand("hey jaanvi go to jobs", { wakeWordRequired: true })?.type).toBe(
      "nav_jobs",
    );
    expect(parseVoiceCommand("jaanvi go to jobs", { wakeWordRequired: true })?.type).toBe(
      "nav_jobs",
    );
    expect(parseVoiceCommand("okay jaanvi go to jobs", { wakeWordRequired: true })?.type).toBe(
      "nav_jobs",
    );

    // 2nd command: Follow-up command during hands-free command window (wakeWordRequired: false)
    expect(parseVoiceCommand("scroll down", { wakeWordRequired: false })?.type).toBe("scroll_down");
    expect(parseVoiceCommand("click 1", { wakeWordRequired: false })?.type).toBe("click_number");
    expect(parseVoiceCommand("click 1", { wakeWordRequired: false })?.payload).toBe(1);
    expect(parseVoiceCommand("show numbers", { wakeWordRequired: false })?.type).toBe("show_numbers");

    // 2nd command: Follow-up command spoken with wake word repeated
    expect(parseVoiceCommand("hey jaanvi scroll down", { wakeWordRequired: true })?.type).toBe(
      "scroll_down",
    );
    expect(parseVoiceCommand("hey jaanvi click 1", { wakeWordRequired: true })?.type).toBe(
      "click_number",
    );
    expect(parseVoiceCommand("jaanvi click 1", { wakeWordRequired: true })?.payload).toBe(1);
  });
});


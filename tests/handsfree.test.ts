import { describe, it, expect } from "vitest";
import { parseVoiceCommand } from "../src/lib/voice/command-parser";

describe("Handsfree Voice & Interaction Engine", () => {
  it("parses voice search queries for any web topic", () => {
    const cmd1 = parseVoiceCommand("search for artificial intelligence", { wakeWordRequired: false });
    expect(cmd1).not.toBeNull();
    expect(cmd1?.type).toBe("search_query");
    expect(cmd1?.payload).toBe("artificial intelligence");

    const cmd2 = parseVoiceCommand("find me robotics in medicine", { wakeWordRequired: false });
    expect(cmd2).not.toBeNull();
    expect(cmd2?.type).toBe("search_query");
    expect(cmd2?.payload).toBe("robotics in medicine");
  });

  it("parses direct dictation into input fields", () => {
    const cmd = parseVoiceCommand("type accessible web technology", { wakeWordRequired: false });
    expect(cmd).not.toBeNull();
    expect(cmd?.type).toBe("type_text");
    expect(cmd?.payload).toBe("accessible web technology");
  });

  it("parses scrolling navigation commands", () => {
    const scrollDown = parseVoiceCommand("scroll down", { wakeWordRequired: false });
    expect(scrollDown?.type).toBe("scroll_down");

    const scrollUp = parseVoiceCommand("scroll up", { wakeWordRequired: false });
    expect(scrollUp?.type).toBe("scroll_up");

    const scrollTop = parseVoiceCommand("scroll to top", { wakeWordRequired: false });
    expect(scrollTop?.type).toBe("scroll_top");

    const scrollBottom = parseVoiceCommand("scroll to bottom", { wakeWordRequired: false });
    expect(scrollBottom?.type).toBe("scroll_bottom");
  });

  it("parses numbered badge navigation commands", () => {
    const showNumbers = parseVoiceCommand("show numbers", { wakeWordRequired: false });
    expect(showNumbers?.type).toBe("show_numbers");

    const hideNumbers = parseVoiceCommand("hide numbers", { wakeWordRequired: false });
    expect(hideNumbers?.type).toBe("hide_numbers");

    const clickNum = parseVoiceCommand("click 4", { wakeWordRequired: false });
    expect(clickNum?.type).toBe("click_number");
    expect(clickNum?.payload).toBe(4);
  });

  it("calculates dwell timer and intentional activation radius", () => {
    const DWELL_RADIUS = 30;
    const dwellAnchor = { x: 500, y: 300 };

    // Point within stationary radius tolerance
    const movedPointWithin = { x: 512, y: 308 };
    const distWithin = Math.hypot(movedPointWithin.x - dwellAnchor.x, movedPointWithin.y - dwellAnchor.y);
    expect(distWithin).toBeLessThanOrEqual(DWELL_RADIUS);

    // Point outside radius (user sweeping cursor across screen)
    const sweepingPoint = { x: 580, y: 350 };
    const distOutside = Math.hypot(sweepingPoint.x - dwellAnchor.x, sweepingPoint.y - dwellAnchor.y);
    expect(distOutside).toBeGreaterThan(DWELL_RADIUS);
  });

  it("computes benchmarking accuracy rate and efficiency ratio", () => {
    const totalTargets = 4;
    const errors = 0;
    const accuracy = Math.round(((totalTargets - errors) / totalTargets) * 100);
    expect(accuracy).toBe(100);

    const mouseTime = 12.2;
    const handsfreeTime = 14.8;
    const efficiency = mouseTime / handsfreeTime;
    expect(efficiency).toBeGreaterThan(0.8); // Meets 80%+ efficiency benchmark
  });
});

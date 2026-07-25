import { describe, expect, it, vi } from "vitest";
import { deliverCorrectionOutput } from "./correctionOutput";

describe("correction output delivery", () => {
  it("pastes corrected text in the default direct-paste mode", async () => {
    const paste = vi.fn().mockResolvedValue(undefined);
    const showPopup = vi.fn();

    await expect(
      deliverCorrectionOutput(
        "paste",
        { title: "Correction result", text: "corrected" },
        { paste, showPopup },
      ),
    ).resolves.toBe("pasted");

    expect(paste).toHaveBeenCalledWith("corrected");
    expect(showPopup).not.toHaveBeenCalled();
  });

  it("shows result-only popup mode without pasting", async () => {
    const paste = vi.fn().mockResolvedValue(undefined);
    const showPopup = vi.fn();
    const payload = { title: "Translate result", text: "translated" };

    await expect(
      deliverCorrectionOutput("popup", payload, { paste, showPopup }),
    ).resolves.toBe("popup");

    expect(showPopup).toHaveBeenCalledWith(payload);
    expect(paste).not.toHaveBeenCalled();
  });
});

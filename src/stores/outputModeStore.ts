import Store from "electron-store";
import {
  DEFAULT_CORRECTION_OUTPUT_MODE,
  normalizeCorrectionOutputMode,
} from "~/shared/outputMode";
import type { CorrectionOutputMode } from "~/shared/outputMode";

type OutputModeSchema = {
  correctionOutputMode: CorrectionOutputMode;
};

class OutputModeStore {
  private readonly store = new Store<OutputModeSchema>({
    name: "outputMode",
    defaults: {
      correctionOutputMode: DEFAULT_CORRECTION_OUTPUT_MODE,
    },
    clearInvalidConfig: true,
  });

  getCorrectionOutputMode(): CorrectionOutputMode {
    return normalizeCorrectionOutputMode(
      this.store.get(
        "correctionOutputMode",
        DEFAULT_CORRECTION_OUTPUT_MODE,
      ),
    );
  }

  setCorrectionOutputMode(mode: CorrectionOutputMode): void {
    this.store.set("correctionOutputMode", mode);
  }
}

export const outputModeStore = new OutputModeStore();

import type { CorrectionResultPayload } from "~/shared/correctionResult";
import type { CorrectionOutputMode } from "~/shared/outputMode";

type CorrectionOutputDependencies = {
  paste: (text: string) => Promise<void>;
  showPopup: (payload: CorrectionResultPayload) => void;
};

export type CorrectionOutputDelivery = "pasted" | "popup";

export const deliverCorrectionOutput = async (
  mode: CorrectionOutputMode,
  payload: CorrectionResultPayload,
  dependencies: CorrectionOutputDependencies,
): Promise<CorrectionOutputDelivery> => {
  if (mode === "popup") {
    dependencies.showPopup(payload);
    return "popup";
  }

  await dependencies.paste(payload.text);
  return "pasted";
};

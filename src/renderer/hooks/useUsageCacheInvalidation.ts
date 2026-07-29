import { useEffect } from "react";
import { subscribeToUsageCacheInvalidation } from "./usageRequestCache";

export const useUsageCacheInvalidation = (): void => {
  useEffect(() => subscribeToUsageCacheInvalidation(window.electronAPI), []);
};

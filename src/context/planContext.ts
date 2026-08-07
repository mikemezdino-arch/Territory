import { createContext } from "react";

export interface PlanContextValue {
  isFreePlan: boolean;
  loading: boolean;
  refreshPlan: () => void;
}

// Free until proven otherwise — matches the pre-Phase-6 default and means
// a not-yet-loaded consumer fails closed (gated) rather than open.
export const PlanContext = createContext<PlanContextValue>({
  isFreePlan: true,
  loading: true,
  refreshPlan: () => {},
});

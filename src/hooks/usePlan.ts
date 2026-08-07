import { useContext } from "react";
import { PlanContext } from "../context/planContext";

export function usePlan() {
  return useContext(PlanContext);
}

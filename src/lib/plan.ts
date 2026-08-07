// Plan status itself now comes from usePlan() (src/hooks/usePlan.ts), which
// reads the real subscriptions table via PlanProvider. This file keeps only
// the plan-derived constant that isn't itself a plan lookup.
export const FREE_TIER_MAX_TERRITORIES = 1;

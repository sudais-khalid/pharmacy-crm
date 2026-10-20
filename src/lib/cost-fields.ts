/**
 * Cost and profit fields (docs/plan/02-architecture.md, section 5.5: sensitive data permissions). Without
 * cost.view they are removed from every API response by the route wrapper, so a cashier's browser never
 * receives a purchase price or a profit figure, whatever an endpoint returns.
 */
export const COST_FIELDS = new Set(["purchasePrice", "costPrice", "effectiveCost", "cogs", "profit", "grossProfit", "netProfit", "costValue", "stockValueCost", "margin"]);

/** JSON text of `data` without cost fields, at any depth. */
export function jsonWithoutCost(data: unknown): string {
  return JSON.stringify(data, (key, value) => (COST_FIELDS.has(key) ? undefined : value));
}

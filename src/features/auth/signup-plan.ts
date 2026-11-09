import { isPaidPlanKey, type Billing, type PaidPlanKey } from "@/config/pricing";
import { localizedPath } from "@/lib/routes";

/**
 * The plan a visitor picks on the website before registering: the plan
 * buttons of /cenik and the home page link to the registration with
 * `?tarif=pro&obdobi=rok`. The account still starts the 14-day trial; the
 * choice is kept for Settings → Subscription ("Vybraný tarif, zaplatíš po
 * zkušebce") and its pay button. Anything else in the address is ignored.
 */

export type SignupPlanChoice = { planKey: PaidPlanKey; billing: Billing };

export const SIGNUP_PLAN_PARAM = "tarif";
export const SIGNUP_BILLING_PARAM = "obdobi";

/** The words of the address for each period; the first one is what the website writes. */
const BILLING_WORDS: Record<Billing, readonly string[]> = {
  monthly: ["mesic", "mesicne", "month", "monthly"],
  yearly: ["rok", "rocne", "year", "yearly", "annual"],
};

type ParamValue = string | string[] | null | undefined;
type Params = URLSearchParams | Readonly<Record<string, ParamValue>>;

function first(params: Params, ...names: string[]): string {
  for (const name of names) {
    const raw = params instanceof URLSearchParams ? params.get(name) : params[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string" && value.trim()) return value.trim().toLowerCase().slice(0, 16);
  }
  return "";
}

function billingOf(word: string): Billing | null {
  for (const billing of Object.keys(BILLING_WORDS) as Billing[]) {
    if (BILLING_WORDS[billing].includes(word)) return billing;
  }
  return null;
}

/**
 * The choice in the address, or null without a valid plan. A missing or
 * unknown period is monthly; English names (`plan`, `period`) work too.
 */
export function parseSignupPlan(params: Params): SignupPlanChoice | null {
  const planKey = first(params, SIGNUP_PLAN_PARAM, "plan");
  if (!isPaidPlanKey(planKey)) return null;
  const billing = billingOf(first(params, SIGNUP_BILLING_PARAM, "period", "billing")) ?? "monthly";
  return { planKey, billing };
}

/** `tarif=pro&obdobi=rok`, the way the website writes it. */
export function signupPlanSearch(choice: SignupPlanChoice): string {
  const search = new URLSearchParams({
    [SIGNUP_PLAN_PARAM]: choice.planKey,
    [SIGNUP_BILLING_PARAM]: BILLING_WORDS[choice.billing][0],
  });
  return search.toString();
}

/** The registration in the page's language, with the plan picked when there is one. */
export function registerHref(locale: string, choice?: SignupPlanChoice | null): string {
  const path = localizedPath("register", locale);
  return choice ? `${path}?${signupPlanSearch(choice)}` : path;
}

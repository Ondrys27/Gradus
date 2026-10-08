/** How long a day's eligibility for the NPS card takes to open: 7 full days of use. */
export const NPS_ELIGIBLE_DAYS = 7;

/**
 * Whether the dashboard should offer the NPS card: the account is at least
 * seven days old and the question has never been asked (answered or
 * dismissed). Once `askedAt` is set, this is false forever.
 */
export function npsEligible(
  createdAt: string,
  askedAt: string | null,
  now: Date = new Date(),
): boolean {
  if (askedAt) return false;
  const signedUp = new Date(createdAt).getTime();
  if (!Number.isFinite(signedUp)) return false;
  const days = (now.getTime() - signedUp) / (24 * 60 * 60 * 1000);
  return days >= NPS_ELIGIBLE_DAYS;
}

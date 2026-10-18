// priceBundle(): the single price formula used by the agent filter AND venue order pricing (PLAN §8, M3).
// all_in_pp_cents = ceilToDollar(dinner_usd*100*(1+TAX+TIP) + show_usd*100*(1+TAX))

export const TAX = 0.0975; // UNVERIFIED LA rate; confirm before 11 PM (PLAN §19)
export const TIP = 0.18;

// Integer basis points so 0.0975 etc. never hit float rounding at a dollar boundary.
const BPS = 10_000;
const TAX_BPS = Math.round(TAX * BPS);
const TIP_BPS = Math.round(TIP * BPS);

/** Structural input: matches VenueBundle directly, and `{ dinner: option.data, show: option.data }` on the agent side. */
export type PriceableBundle = {
  dinner: { est_high_pp_usd: number };
  show: { est_high_pp_usd: number };
};

function wholeUsd(v: number, field: string): number {
  if (!Number.isInteger(v) || v < 0) throw new RangeError(`${field} must be a non-negative integer, got ${v}`);
  return v;
}

/** All-in per-person price in cents, rounded UP to a whole dollar. Everyone sees the same price. */
export function priceBundle(b: PriceableBundle): number {
  const dinner = wholeUsd(b.dinner.est_high_pp_usd, "dinner.est_high_pp_usd");
  const show = wholeUsd(b.show.est_high_pp_usd, "show.est_high_pp_usd");
  // usd * 100 cents * (BPS + rate_bps) / BPS, summed; then ceil to a whole dollar (100 cents).
  const centsTimesBps = dinner * 100 * (BPS + TAX_BPS + TIP_BPS) + show * 100 * (BPS + TAX_BPS);
  return Math.ceil(centsTimesBps / (100 * BPS)) * 100;
}

/** Share = all_in_pp_cents; total = share × party_size (no remainder). */
export function orderTotalCents(allInPpCents: number, partySize: number): number {
  if (!Number.isInteger(allInPpCents) || !Number.isInteger(partySize) || partySize < 1) {
    throw new RangeError("orderTotalCents expects integer cents and a positive integer party size");
  }
  return allInPpCents * partySize;
}

import { TAX, TIP, orderTotalCents, priceBundle, type OrderItem, type VenueBundle } from "@tab/shared";

/** M3: every amount is computed here from the bundle, never taken from a request body. */
export function priceOrder(bundle: VenueBundle, partySize: number) {
  const pp = priceBundle(bundle);
  const dinnerPp = Math.round(bundle.dinner.est_high_pp_usd * 100 * (1 + TAX + TIP));
  const items: OrderItem[] = [
    { kind: "dinner", name: bundle.dinner.name, address: bundle.dinner.address, time: bundle.dinner.time, unit_price_pp_cents: dinnerPp, qty: partySize },
    { kind: "show", name: bundle.show.name, address: bundle.show.address, time: bundle.show.time, unit_price_pp_cents: pp - dinnerPp, qty: partySize },
  ];
  return { sharePp: pp, total: orderTotalCents(pp, partySize), items };
}

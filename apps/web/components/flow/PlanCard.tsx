import { PlanTicket } from "@/components/brand/Ticket";
import type { PlanPreview } from "@/lib/agentSchemas";

/**
 * The plan as a sodium paper-page ticket (design-system 6.4). Counts only, never names: friends' names stay off the
 * web (ux-flow §7.2); the organizer sees who joined in iMessage. Two explicit variants, one per reader.
 */

/** Organizer plan-ready: "Sat, Oct 24 · 7:00 PM" / title / "Santa Monica · 4 people". */
export function PlanCard({ plan }: { plan: PlanPreview }) {
  return (
    <PlanTicket
      eyebrow={`${plan.date_label} · ${plan.time_label}`}
      title={plan.title}
      meta={`${plan.area} · ${plan.party_target} people`}
      filled={plan.joined}
      total={plan.party_target}
      titleAs="h3"
    />
  );
}

/** Friend invite: "{Maya} invited you" / title / "Sat, Oct 24 · 7:00 PM · Santa Monica". The page heading. */
export function InvitePlanCard({ plan }: { plan: PlanPreview }) {
  return (
    <PlanTicket
      eyebrow={plan.organizer_first_name ? `${plan.organizer_first_name} invited you` : "You’re invited"}
      title={plan.title}
      meta={`${plan.date_label} · ${plan.time_label} · ${plan.area}`}
      filled={plan.joined}
      total={plan.party_target}
      titleAs="h1"
    />
  );
}

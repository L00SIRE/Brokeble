"use client";

// The shared chat-first flow as one compound (ux-flow §9.7). StartFlow (organizer) and InviteFlow (friend) compose it:
//
//   <Flow.Provider role="guest" storageKey={joinSessionKey(code)} submit={…} describeError={…}>
//     {/* phone step */}
//     <Flow.PhoneStep aria-label="Join this plan">
//       <Flow.PhoneField label="Your iPhone number" />
//       <Flow.Submit busy="Saving your spot…">Join in iMessage</Flow.Submit>
//       <Flow.Legal>By joining, you agree SquadTab can text you about this plan. Text “forget me” anytime.</Flow.Legal>
//     </Flow.PhoneStep>
//     {/* after a submit: hand-off, then every live phase */}
//     <Flow.LiveStatus />
//   </Flow.Provider>
//
// Read state with useFlow(): `state.session` (null on the phone step), `state.phase`, `state.status.data`, `meta.platform`.
import { FlowProvider } from "./FlowContext";
import { Handoff, HandoffDesktop, HandoffPhone, MessagesDidntOpen, TextSquadTab, WaitingLong } from "./Handoff";
import { Closed, Joined, LiveStatus, PlanReady, Texted } from "./LiveStatus";
import { Legal, PhoneField, PhoneStep, SubmitButton } from "./PhoneStep";

export const Flow = {
  Provider: FlowProvider,
  PhoneStep,
  PhoneField,
  Submit: SubmitButton,
  Legal,
  Handoff,
  HandoffPhone,
  HandoffDesktop,
  WaitingLong,
  TextSquadTab,
  MessagesDidntOpen,
  LiveStatus,
  Texted,
  PlanReady,
  Joined,
  Closed,
};

export { defaultErrorCopy, type ErrorCopy, type SeatResponse, type SubmitInput, type SubmitResult, useFlow, usePlatform } from "./FlowContext";

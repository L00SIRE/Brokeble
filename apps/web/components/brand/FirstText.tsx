/**
 * "Your first text, typed for you" (design-system 6.3): the message Messages will open with, on a 3px sodium rule.
 * Plain text, deliberately not an Apple bubble. Pass the exact `sms:` body so what we show is what gets sent.
 */
export function FirstText({ text, label = "Your first text, typed for you" }: { text: string; label?: string }) {
  return (
    <figure className="firsttext m-0">
      <figcaption className="k">{label}</figcaption>
      <q>{text}</q>
    </figure>
  );
}

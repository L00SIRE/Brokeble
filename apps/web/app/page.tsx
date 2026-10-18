import type { Metadata } from "next";
import { CreatePlanForm } from "@/components/join/CreatePlanForm";
import { Shell } from "@/components/join/Shell";

export const metadata: Metadata = { title: "Create a plan · SquadTab" };

export default function CreatePlanPage() {
  return (
    <Shell title="Plan it. Split it. Book it." lede="Tell SquadTab the night. Everyone joins by text, shares what they like, and nobody fronts the bill.">
      <CreatePlanForm />
    </Shell>
  );
}

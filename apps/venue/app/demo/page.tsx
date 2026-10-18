import type { Metadata } from "next";
import { DemoPlayer } from "./DemoPlayer";

export const metadata: Metadata = {
  title: "SquadTab demo",
  description: "Scripted walkthrough of the SquadTab flow for recording.",
  robots: { index: false },
};

export default function DemoPage() {
  return <DemoPlayer />;
}

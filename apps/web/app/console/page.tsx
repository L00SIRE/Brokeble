import type { Metadata } from "next";
import { Console } from "@/components/console/Console";

export const metadata: Metadata = { title: "Trust Console", robots: { index: false } };

export default async function ConsolePage({ searchParams }: PageProps<"/console">) {
  const { k } = await searchParams;
  // The key travels only in the URL; never in a NEXT_PUBLIC_* var (PLAN §11).
  return <Console consoleKey={typeof k === "string" ? k : null} />;
}

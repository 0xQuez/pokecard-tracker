import type { Metadata } from "next";
import ValuationSharePage from "@/components/valuation/ValuationSharePage";

export const metadata: Metadata = {
  title: "Valuation",
  robots: { index: false, follow: false }, // unguessable share links shouldn't be indexed
};

export default async function ValuationShareRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ValuationSharePage token={token} />;
}

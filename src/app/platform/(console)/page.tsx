import { Card, PageHeader } from "@/components/ui";

/** Placeholder until the overview figures arrive with the pharmacies screens (roadmap task 1.8). */
export default function ConsoleOverviewPage() {
  return (
    <>
      <PageHeader title="Overview" subtitle="All pharmacies on this installation" />
      <Card className="p-6 text-sm text-fg-muted">Pharmacy management arrives in the next step.</Card>
    </>
  );
}

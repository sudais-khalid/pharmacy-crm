import { Badge } from "@/components/ui";

const TONE = { ACTIVE: "green", GRACE: "amber", SUSPENDED: "red", DEACTIVATED: "slate" } as const;
const LABEL = { ACTIVE: "Active", GRACE: "Grace period", SUSPENDED: "Suspended", DEACTIVATED: "Deactivated" } as const;

export type PharmacyStatus = keyof typeof TONE;

export function StatusBadge({ status }: { status: PharmacyStatus }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}

export const STATUS_LABEL = LABEL;

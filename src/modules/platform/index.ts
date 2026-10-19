export { settingsSchema } from "./schema";
export { audit, type AuditEntry, type AuditContext } from "./audit";
export { emit, type DomainEvents, type EventType } from "./events";
export { dispatchOutbox, outboxBackoffMs, OUTBOX_MAX_ATTEMPTS, type OutboxEvent, type OutboxHandler, type OutboxHandlers } from "./outbox";
export { getHealth, type Health, type CheckResult } from "./health";
export { nextNumber, type CounterKey } from "./counters";
export { getSettings, updateSettings, type PharmacySettingsView } from "./settings";
export { FEATURE_FLAGS, FEATURE_KEYS, getFeatureFlags, type FeatureKey } from "./flags";
export { desktopActionSchema, isDesktopInstall, recordDesktopAction, type DesktopAction } from "./desktop";

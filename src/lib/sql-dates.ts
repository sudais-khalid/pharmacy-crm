import { Prisma } from "@prisma/client";
import { TZ } from "./dates";

/**
 * Timestamps are stored as UTC wall time (`timestamp(3)` without zone). To get the pharmacy's local time,
 * mark the value as UTC first, then convert: `x AT TIME ZONE tz` alone would read the UTC value as if it
 * were local, and put a sale at 1 am on the previous day.
 */
export const localTime = (column: Prisma.Sql) => Prisma.sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})`;

/** The pharmacy-local calendar date of a timestamp column. */
export const localDate = (column: Prisma.Sql) => Prisma.sql`(${localTime(column)})::date`;

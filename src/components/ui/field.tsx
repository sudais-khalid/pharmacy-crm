"use client";
import React, { useId } from "react";

/** Label, hint and error wired to the child input through id and aria attributes. */
export function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; children: React.ReactElement; className?: string }) {
  const id = useId();
  const child = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-err` : hint ? `${id}-hint` : undefined,
  });
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
      {child}
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-fg-muted">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

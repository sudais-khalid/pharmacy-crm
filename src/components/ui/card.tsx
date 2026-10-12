import React from "react";
import { cn } from "./cn";

export function Card({ children, className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...p}>{children}</div>;
}

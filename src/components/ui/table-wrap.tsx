import React from "react";

/** Horizontal scroll container so wide tables never push the page sideways. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-collapse">{children}</table></div>;
}

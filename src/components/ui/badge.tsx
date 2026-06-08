import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "inline-flex w-fit items-center rounded-md border border-border bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground",
        className,
      )}
      {...props}
    />
  );
}

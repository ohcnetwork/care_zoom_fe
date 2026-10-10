import { cn } from "@/lib/utils";

/** Mirrors care_fe/src/components/ui/skeleton.tsx (Care UI registry). */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-gray-900/10", className)}
      {...props}
    />
  );
}

export { Skeleton };

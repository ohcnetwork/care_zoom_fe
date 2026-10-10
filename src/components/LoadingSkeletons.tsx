import { Skeleton } from "./ui/skeleton";

/** Mirrors ParticipantCard's shape while the appointment is loading. */
function ParticipantCardSkeleton() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Skeleton className="size-11 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3 w-14 rounded-full" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

/** Shown while the appointment eligibility check is in flight (CallPage's `!data` state). */
export function PrejoinCardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <ParticipantCardSkeleton />
        <Skeleton className="hidden size-5 shrink-0 sm:block" />
        <ParticipantCardSkeleton />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-full max-w-sm" />
      </div>
      <Skeleton className="h-10 w-36 rounded-md" />
    </div>
  );
}

/** Shown while the ZoomCall chunk + SDK load, matching its final prejoin layout. */
export function ZoomCallSkeleton() {
  return (
    <div className="zoom-prejoin">
      <div className="zoom-prejoin-preview">
        <Skeleton className="zoom-preview-stage aspect-video w-full" />
        <div className="flex justify-between gap-2">
          <div className="space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-10 w-36 shrink-0 rounded-md" />
        </div>
      </div>
    </div>
  );
}

/** Shown while StaffAppointmentDetails loads, matching its card layout. */
export function AppointmentSidebarSkeleton() {
  return (
    <div className="min-w-0 space-y-3">
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3">
          <Skeleton className="h-3 w-28" />
        </div>
        <div className="flex items-start gap-3 p-4">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
        <div className="mx-4 space-y-4 border-t border-gray-100 py-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="border-t border-gray-100 bg-gray-50/70 px-4 py-3 space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-full" />
        </div>
      </section>
      <div className="space-y-2">
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
      <Skeleton className="h-3 w-full" />
    </div>
  );
}

/** Shown while a patient's video appointments list loads. */
export function AppointmentListSkeleton() {
  return (
    <ul className="space-y-3">
      {[0, 1].map((key) => (
        <li
          key={key}
          className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3 last:border-0 last:pb-0"
        >
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-8 w-24 rounded-md" />
        </li>
      ))}
    </ul>
  );
}

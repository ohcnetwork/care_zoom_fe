import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  Stethoscope,
  UserRound,
  Video,
  VideoOff,
} from "lucide-react";
import Page from "../components/Page";
import { Button } from "../components/ui/button";
import { authKind, useCareAuth } from "../hooks/useCareAuth";
import { useAppointment } from "../hooks/useAppointment";
import { useGuestSession } from "../hooks/useGuestSession";
import { ApiError, getJoinToken } from "../utils/api";
import { staffCallPath } from "../utils/routes";
import type { AppointmentInfo } from "../types";
import type { ZoomCallHandle } from "../components/ZoomCall";
import {
  AppointmentSidebarSkeleton,
  PrejoinCardSkeleton,
  ZoomCallSkeleton,
} from "../components/LoadingSkeletons";
import { cn } from "@/lib/utils";
const ZoomCall = lazy(() => import("../components/ZoomCall"));
const StaffAppointmentDetails = lazy(
  () => import("../components/StaffAppointmentDetails"),
);
/** Mirrors StaffAppointmentDetails' card so patient/guest and staff routes share the same sidebar look. */
function AppointmentSummaryCard({ metadata }: { metadata: AppointmentInfo }) {
  const { t } = useTranslation();
  const start = new Date(metadata.start_datetime);
  const end = new Date(metadata.end_datetime);
  return (
    <aside
      aria-label={t("zoom__appointment_details")}
      className="min-w-0 space-y-3"
    >
      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <h2 className="border-b border-gray-100 bg-linear-to-r from-primary-100 to-transparent px-4 py-3 text-sm font-semibold text-gray-500">
          {t("zoom__appointment_details")}
        </h2>
        <div className="divide-y divide-gray-100">
          <div className="flex items-start gap-3 p-4">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700"
            >
              <Stethoscope className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="mb-0.5 text-xs text-gray-500">
                {t("zoom__doctor_badge")}
              </p>
              <p className="break-words text-base font-semibold leading-snug text-gray-900">
                {metadata.practitioner_name}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-4">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700"
            >
              <UserRound className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="mb-0.5 text-xs text-gray-500">
                {t("zoom__patient_badge")}
              </p>
              <p className="break-words text-base font-semibold leading-snug text-gray-900">
                {metadata.patient_name}
              </p>
            </div>
          </div>
        </div>
        <dl className="mx-4 space-y-3 border-t border-gray-100 py-4 text-sm">
          <div className="relative min-w-0 pl-6">
            <dt className="text-xs text-gray-500">
              <CalendarDays
                className="absolute top-0.5 left-0 size-4 text-gray-400"
                aria-hidden="true"
              />
              {t("zoom__appointment_time")}
            </dt>
            <dd className="mt-1 font-medium text-gray-900">
              <time dateTime={metadata.start_datetime}>
                {start.toLocaleDateString([], { dateStyle: "medium" })}
              </time>
              <span className="mt-0.5 block text-xs font-normal text-gray-600">
                <time dateTime={metadata.start_datetime}>
                  {start.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                {" – "}
                <time dateTime={metadata.end_datetime}>
                  {end.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </span>
            </dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}
export default function CallPage({
  bookingId,
  facilityId,
  patientId,
}: {
  bookingId: string;
  facilityId?: string;
  patientId?: string;
}) {
  const { t } = useTranslation();
  const zoomCall = useRef<ZoomCallHandle>(null);
  const auth = useCareAuth();
  const guestSession = useGuestSession(bookingId);
  // No sign-in gate on the public link: fall back to an anonymous guest identity immediately.
  const kind = authKind(auth) ?? "guest";
  const identity =
    kind === "staff"
      ? `staff:${auth?.user?.id}`
      : kind === "patient"
        ? `patient:${auth?.patientToken?.phoneNumber}`
        : `guest:${guestSession.session.id}`;
  const { data, error, retry } = useAppointment(
    bookingId,
    kind,
    guestSession.session.id,
  );
  const [active, setActive] = useState<{
    identity: string;
    bookingId: string;
    info: AppointmentInfo;
  }>();
  const appLogo = window.__CORE_ENV__?.mainLogo?.dark;
  const call =
    active?.identity === identity && active?.bookingId === bookingId && kind
      ? active
      : undefined;
  const expired =
    error instanceof ApiError &&
    (error.status === 401 || error.code === "token_not_valid");
  const metadata = call?.info ?? data;
  const staffContext = kind === "staff" ? metadata?.staff_context : undefined;
  const staffRouteReady =
    !!staffContext &&
    staffContext.facility_id === facilityId &&
    staffContext.patient_id === patientId;
  const showAppointment = !!call || !error;
  useEffect(() => {
    if (!call && data?.can_join && identity) {
      setActive({ identity, bookingId, info: data });
    }
  }, [call, data, identity, bookingId]);
  useEffect(() => {
    if (staffContext && !staffRouteReady) {
      window.location.replace(
        staffCallPath(
          bookingId,
          staffContext.facility_id,
          staffContext.patient_id,
        ),
      );
    }
  }, [
    bookingId,
    staffContext?.facility_id,
    staffContext?.patient_id,
    staffRouteReady,
  ]);
  return (
    <Page>
      <div
        className={cn(
          "zoom-call-page mx-auto w-full max-w-6xl px-3 text-secondary-900 sm:px-4",
          kind !== "staff" && "py-4",
        )}
      >
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex w-full justify-between gap-2.5">
            <div className="flex gap-2 items-center justify-center min-w-0">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 border border-primary-200 text-primary-500">
                <Video className="size-4" aria-hidden="true" />
              </span>

              <h1 className="text-lg font-semibold tracking-tight text-gray-900">
                {t("zoom__call_title")}
              </h1>
            </div>
            {kind !== "staff" && appLogo && (
              <img src={appLogo} alt="" className="w-20 object-contain" />
            )}
          </div>
          {/* {kind !== "staff" && showAppointment && metadata && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
              <time dateTime={metadata.start_datetime}>
                {new Date(metadata.start_datetime).toLocaleString([], {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
            </div>
          )} */}
        </header>
        <div
          className={
            (kind === "staff" && staffRouteReady) ||
            (kind !== "staff" && metadata)
              ? "zoom-call-layout grid items-start gap-4"
              : "mx-auto max-w-6xl"
          }
        >
          <section
            className={
              call
                ? "min-w-0"
                : "min-w-0 rounded-xl border border-gray-200 bg-white p-5 sm:p-6"
            }
          >
            {call ? (
              <>
                {/* Eligibility gates fresh token requests; polling must not destroy an ongoing call. */}
                <Suspense fallback={<ZoomCallSkeleton />}>
                  <ZoomCall
                    ref={zoomCall}
                    key={`${identity}:${bookingId}`}
                    patientName={call.info.patient_name}
                    practitionerName={call.info.practitioner_name}
                    requestToken={() =>
                      getJoinToken(bookingId, kind, guestSession.session.name)
                    }
                    onExit={() => setActive(undefined)}
                  />
                </Suspense>
              </>
            ) : error ? (
              <div role="alert">
                <p>
                  {t(
                    expired
                      ? "zoom__session_expired"
                      : error instanceof ApiError &&
                          [403, 404].includes(error.status)
                        ? "zoom__unavailable"
                        : "zoom__load_failed",
                  )}
                </p>
                <Button variant="outline" onClick={retry}>
                  {t("zoom__retry")}
                </Button>
              </div>
            ) : !data ||
              (kind === "staff" && staffContext && !staffRouteReady) ? (
              <PrejoinCardSkeleton />
            ) : kind === "staff" && !staffContext ? (
              <div role="alert">
                <p>{t("zoom__load_failed")}</p>
                <Button variant="outline" onClick={retry}>
                  {t("zoom__retry")}
                </Button>
              </div>
            ) : data.can_join ? (
              <p
                role="status"
                className="py-10 text-center text-sm text-gray-500"
              >
                {t("zoom__loading")}
              </p>
            ) : (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                  <VideoOff className="size-6" aria-hidden="true" />
                </span>
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-gray-900">
                    {data.reason || t("zoom__call_not_available")}
                  </h2>
                  <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-xs text-gray-500">
                    <CalendarDays
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      {t("zoom__appointment_scheduled_for", {
                        datetime: new Date(data.start_datetime).toLocaleString(
                          [],
                          {
                            dateStyle: "medium",
                            timeStyle: "short",
                          },
                        ),
                      })}
                    </span>
                    {Date.now() < new Date(data.join_opens_at).getTime() ? (
                      <span>
                        ·{" "}
                        {t("zoom__join_opens_before", {
                          count: Math.round(
                            (new Date(data.start_datetime).getTime() -
                              new Date(data.join_opens_at).getTime()) /
                              60000,
                          ),
                        })}
                      </span>
                    ) : (
                      Date.now() > new Date(data.join_closes_at).getTime() && (
                        <span>· {t("zoom__join_window_closed")}</span>
                      )
                    )}
                  </p>
                </div>
              </div>
            )}
          </section>
          {kind !== "staff" && metadata && (
            <AppointmentSummaryCard metadata={metadata} />
          )}
          {kind === "staff" &&
            staffRouteReady &&
            (call || (!error && !expired)) && (
              <Suspense fallback={<AppointmentSidebarSkeleton />}>
                <StaffAppointmentDetails
                  key={`${identity}:${bookingId}:${facilityId}:${patientId}`}
                  bookingId={bookingId}
                  facilityId={facilityId!}
                  patientId={patientId!}
                  onStartConsultation={() => {
                    // Request synchronously in the click, before the link opens the encounter.
                    void zoomCall.current?.openPictureInPicture();
                  }}
                />
              </Suspense>
            )}
        </div>
      </div>
    </Page>
  );
}

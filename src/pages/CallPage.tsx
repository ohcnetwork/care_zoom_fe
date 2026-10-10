import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  CalendarDays,
  Stethoscope,
  UserRound,
  Video,
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
const ZoomCall = lazy(() => import("../components/ZoomCall"));
const StaffAppointmentDetails = lazy(
  () => import("../components/StaffAppointmentDetails"),
);
function ParticipantCard({
  icon,
  badge,
  name,
  description,
}: {
  icon: React.ReactNode;
  badge: string;
  name: string;
  description: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
        {icon}
      </span>
      <div className="min-w-0">
        <span className="inline-block rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary-800 uppercase">
          {badge}
        </span>
        <p className="truncate font-semibold text-gray-900">{name}</p>
        <p className="truncate text-sm text-gray-500">{description}</p>
      </div>
    </div>
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
      <div className="zoom-call-page mx-auto w-full max-w-6xl px-3 text-secondary-900 sm:px-4">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 border border-primary-200 text-primary-500">
              <Video className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-gray-900">
                {t("zoom__call_title")}
              </h1>
            </div>
          </div>
          {kind !== "staff" && showAppointment && metadata && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
              <time dateTime={metadata.start_datetime}>
                {new Date(metadata.start_datetime).toLocaleString([], {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
            </div>
          )}
        </header>
        <div
          className={
            kind === "staff" && staffRouteReady
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
            ) : (
              <div className="space-y-4">
                {kind !== "staff" && (
                  <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
                    <ParticipantCard
                      icon={
                        <Stethoscope className="size-5" aria-hidden="true" />
                      }
                      badge={t("zoom__doctor_badge")}
                      name={data.practitioner_name}
                      description={t("zoom__doctor_description")}
                    />
                    <div className="flex shrink-0 flex-col items-center gap-1 text-gray-400 sm:px-2">
                      <span className="hidden text-[11px] font-medium tracking-wide uppercase sm:block">
                        {t("zoom__consultation_with")}
                      </span>
                      <ArrowRight
                        className="size-5 rotate-90 sm:rotate-0"
                        aria-hidden="true"
                      />
                    </div>
                    <ParticipantCard
                      icon={<UserRound className="size-5" aria-hidden="true" />}
                      badge={t("zoom__patient_badge")}
                      name={data.patient_name}
                      description={t("zoom__patient_description")}
                    />
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-semibold">
                    {t("zoom__prejoin")}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    {t("zoom__prejoin_help")}
                  </p>
                </div>
                {data.reason && (
                  <div className="space-y-1.5 rounded-md bg-gray-100 p-3">
                    <p role="status" className="text-sm text-gray-800">
                      {data.reason}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
                      <CalendarDays
                        className="size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span>
                        {t("zoom__appointment_scheduled_for", {
                          datetime: new Date(
                            data.start_datetime,
                          ).toLocaleString([], {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }),
                        })}
                      </span>
                      {!data.can_join &&
                        (Date.now() < new Date(data.join_opens_at).getTime() ? (
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
                          Date.now() >
                            new Date(data.join_closes_at).getTime() && (
                            <span>· {t("zoom__join_window_closed")}</span>
                          )
                        ))}
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
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

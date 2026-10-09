import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Video } from "lucide-react";
import Page from "../components/Page";
import PatientLogin from "../components/PatientLogin";
import { Button } from "../components/ui/button";
import { authKind, useCareAuth } from "../hooks/useCareAuth";
import { useAppointment } from "../hooks/useAppointment";
import { ApiError, getJoinToken } from "../utils/api";
import { staffCallPath } from "../utils/routes";
import type { AppointmentInfo } from "../types";
import type { ZoomCallHandle } from "../components/ZoomCall";
const ZoomCall = lazy(() => import("../components/ZoomCall"));
const StaffAppointmentDetails = lazy(
  () => import("../components/StaffAppointmentDetails"),
);
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
  const kind = authKind(auth);
  const identity =
    kind === "staff"
      ? `staff:${auth?.user?.id}`
      : kind === "patient"
        ? `patient:${auth?.patientToken?.phoneNumber}`
        : null;
  const { data, error, retry } = useAppointment(bookingId, kind);
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
  const showAppointment = !!call || (!!kind && !error && !expired);
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
      <div className="zoom-call-page mx-auto my-4 w-full max-w-[100rem] px-3 text-secondary-900 sm:px-4">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
              <Video className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight text-gray-900">
                {t("zoom__call_title")}
              </h1>
              {kind !== "staff" && showAppointment && metadata && (
                <p className="mt-0.5 break-words text-sm text-gray-600">
                  {metadata.patient_name} · {metadata.practitioner_name}
                </p>
              )}
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
                <Suspense fallback={<p role="status">{t("zoom__loading")}</p>}>
                  <ZoomCall
                    ref={zoomCall}
                    key={`${identity}:${bookingId}`}
                    patientName={call.info.patient_name}
                    practitionerName={call.info.practitioner_name}
                    requestToken={() => getJoinToken(bookingId, kind!)}
                    onExit={() => setActive(undefined)}
                  />
                </Suspense>
              </>
            ) : !kind || expired ? (
              <>
                {expired && (
                  <p role="alert" className="mb-3 text-red-700">
                    {t("zoom__session_expired")}
                  </p>
                )}
                <PatientLogin bookingId={bookingId} />
              </>
            ) : error ? (
              <div role="alert">
                <p>
                  {t(
                    error instanceof ApiError &&
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
              <p role="status">{t("zoom__loading")}</p>
            ) : kind === "staff" && !staffContext ? (
              <div role="alert">
                <p>{t("zoom__load_failed")}</p>
                <Button variant="outline" onClick={retry}>
                  {t("zoom__retry")}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold">
                    {t("zoom__prejoin")}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    {t("zoom__prejoin_help")}
                  </p>
                </div>
                {data.reason && (
                  <p role="status" className="rounded-md bg-gray-100 p-3">
                    {data.reason}
                  </p>
                )}
                {data.can_join && identity && (
                  <Button
                    onClick={() =>
                      setActive({ identity, bookingId, info: data })
                    }
                  >
                    <Video aria-hidden="true" />
                    {t("zoom__prepare")}
                  </Button>
                )}
              </div>
            )}
          </section>
          {kind === "staff" &&
            staffRouteReady &&
            (call || (!error && !expired)) && (
              <Suspense fallback={<p role="status">{t("zoom__loading")}</p>}>
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

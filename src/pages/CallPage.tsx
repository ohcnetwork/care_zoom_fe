import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import Page from "../components/Page";
import PatientLogin from "../components/PatientLogin";
import { Button } from "../components/ui/button";
import { authKind, useCareAuth } from "../hooks/useCareAuth";
import { useAppointment } from "../hooks/useAppointment";
import { ApiError, getJoinToken } from "../utils/api";
import type { AppointmentInfo } from "../types";
const ZoomCall = lazy(() => import("../components/ZoomCall"));
export default function CallPage({ bookingId }: { bookingId: string }) {
  const { t } = useTranslation();
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
  return (
    <Page>
      <main className="mx-auto my-6 max-w-4xl rounded-lg border border-gray-200 bg-white p-5 text-secondary-900 shadow-sm sm:p-8">
        <h1 className="mb-5 text-2xl font-bold">{t("zoom__call_title")}</h1>
        {call ? (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">
              {metadata?.patient_name} · {metadata?.practitioner_name}
            </h2>
            {/* Eligibility gates fresh token requests; polling must not destroy an ongoing call. */}
            <Suspense fallback={<p role="status">{t("zoom__loading")}</p>}>
              <ZoomCall
                key={`${identity}:${bookingId}`}
                requestToken={() => getJoinToken(bookingId, kind!)}
                onExit={() => setActive(undefined)}
              />
            </Suspense>
          </div>
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
                error instanceof ApiError && [403, 404].includes(error.status)
                  ? "zoom__unavailable"
                  : "zoom__load_failed",
              )}
            </p>
            <Button variant="outline" onClick={retry}>
              {t("zoom__retry")}
            </Button>
          </div>
        ) : !data ? (
          <p role="status">{t("zoom__loading")}</p>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">
                {data.patient_name} · {data.practitioner_name}
              </h2>
              <p className="text-sm text-gray-600">
                {new Date(data.start_datetime).toLocaleString()}
              </p>
            </div>
            {data.reason && (
              <p role="status" className="rounded-md bg-gray-100 p-3">
                {data.reason}
              </p>
            )}
            {data.can_join && identity && (
              <Button
                onClick={() => setActive({ identity, bookingId, info: data })}
              >
                {t("zoom__prepare")}
              </Button>
            )}
          </div>
        )}
      </main>
    </Page>
  );
}

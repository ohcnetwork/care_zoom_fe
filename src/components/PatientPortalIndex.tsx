import { useEffect, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useCareAuth } from "../hooks/useCareAuth";
import { getVideoAppointments } from "../utils/api";
import type { AppointmentInfo } from "../types";
import { Button } from "./ui/button";
import Page from "./Page";
export default function PatientPortalIndex({
  __base: Base,
  ...props
}: {
  __base: ComponentType<Record<string, unknown>>;
  [key: string]: unknown;
}) {
  const { t } = useTranslation();
  const auth = useCareAuth();
  const token = auth?.patientToken?.token;
  const [loaded, setLoaded] = useState<{
    token: string;
    appointments: AppointmentInfo[];
  }>();
  const appointments =
    loaded?.token === token ? loaded?.appointments : undefined;
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setLoaded(undefined);
    if (!token) return;
    const controller = new AbortController();
    setError(false);
    getVideoAppointments(controller.signal)
      .then((appointments) => {
        if (!controller.signal.aborted) setLoaded({ token, appointments });
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [token, revision]);
  return (
    <>
      <Page>
        <section
          className="mb-5 rounded-md border border-gray-200 bg-white p-4 shadow-sm"
          aria-labelledby="zoom-appointments-title"
        >
          <h2 id="zoom-appointments-title" className="mb-3 text-lg font-bold">
            {t("zoom__appointments")}
          </h2>
          {error ? (
            <p role="alert">
              {t("zoom__load_failed")}{" "}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRevision((value) => value + 1)}
              >
                {t("zoom__retry")}
              </Button>
            </p>
          ) : !appointments ? (
            <p role="status">{t("zoom__loading")}</p>
          ) : !appointments.length ? (
            <p className="text-sm text-gray-600">
              {t("zoom__no_appointments")}
            </p>
          ) : (
            <ul className="space-y-3">
              {appointments.map((item) => (
                <li
                  key={item.booking_id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3 last:border-0 last:pb-0"
                >
                  <div>
                    <p className="font-semibold">
                      {item.patient_name} · {item.practitioner_name}
                    </p>
                    <p className="text-sm text-gray-600">
                      {new Date(item.start_datetime).toLocaleString()}
                    </p>
                  </div>
                  <Button asChild size="sm">
                    <a href={item.join_path} referrerPolicy="no-referrer">
                      {t("zoom__open_call")}
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Page>
      <Base {...props} />
    </>
  );
}

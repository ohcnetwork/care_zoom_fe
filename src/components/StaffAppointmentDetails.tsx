import {
  CalendarDays,
  ExternalLink,
  Hospital,
  NotebookPen,
  Stethoscope,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCareAuth } from "../hooks/useCareAuth";
import type { StaffAppointment } from "../types";
import { ApiError, getStaffAppointment, getStaffFacility } from "../utils/api";
import { Button } from "./ui/button";

interface Props {
  bookingId: string;
  facilityId: string;
  patientId: string;
  onStartConsultation?: () => void;
}

export default function StaffAppointmentDetails(props: Props) {
  const auth = useCareAuth();
  if (!auth?.user) return null;
  return (
    <AppointmentDetails
      key={`${auth.user.id}:${props.facilityId}:${props.patientId}:${props.bookingId}`}
      {...props}
      isSuperuser={!!auth.user.is_superuser}
    />
  );
}

function AppointmentDetails({
  bookingId,
  facilityId,
  patientId,
  isSuperuser,
  onStartConsultation,
}: Props & { isSuperuser: boolean }) {
  const { t } = useTranslation();
  const [data, setData] = useState<{
    appointment: StaffAppointment;
    permissions: string[];
  }>();
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    async function load() {
      try {
        const facility = await getStaffFacility(facilityId, controller.signal);
        if (
          facility.id !== facilityId ||
          (!isSuperuser && !facility.permissions.includes("can_list_booking"))
        ) {
          throw new ApiError(403, "Appointment access denied");
        }
        const appointment = await getStaffAppointment(
          facilityId,
          bookingId,
          controller.signal,
        );
        if (
          appointment.id !== bookingId ||
          appointment.facility.id !== facilityId ||
          appointment.patient.id !== patientId
        ) {
          throw new ApiError(404, "Appointment does not match route");
        }
        if (!controller.signal.aborted) {
          setData({ appointment, permissions: facility.permissions });
        }
      } catch {
        if (!controller.signal.aborted) {
          setData(undefined);
          setError(true);
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [bookingId, facilityId, patientId, isSuperuser, revision]);

  useEffect(() => {
    // Returning from the native encounter form picks up the new association.
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  if (error) {
    return (
      <div
        role="alert"
        className="space-y-2 rounded-xl border border-gray-200 bg-white p-4"
      >
        <p className="text-sm text-gray-600">
          {t("zoom__appointment_details_failed")}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRevision((value) => value + 1)}
        >
          {t("zoom__retry")}
        </Button>
      </div>
    );
  }
  if (!data)
    return (
      <p
        role="status"
        className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500"
      >
        {t("zoom__loading")}
      </p>
    );

  const { appointment, permissions } = data;
  const appointmentUrl = `/facility/${encodeURIComponent(facilityId)}/patient/${encodeURIComponent(patientId)}/appointments/${encodeURIComponent(bookingId)}`;
  const canCreateEncounter =
    isSuperuser || permissions.includes("can_create_encounter");
  const canWriteAppointment =
    isSuperuser || permissions.includes("can_write_booking");
  const isFinal = [
    "fulfilled",
    "noshow",
    "cancelled",
    "entered_in_error",
    "rescheduled",
  ].includes(appointment.status);
  const start = new Date(appointment.token_slot.start_datetime);
  // Match AppointmentDetail's calendar-day window, including daylight-saving changes.
  const earliest = new Date(start);
  const latest = new Date(start);
  earliest.setDate(earliest.getDate() - 1);
  latest.setDate(latest.getDate() + 1);
  const canStart =
    canWriteAppointment &&
    ["booked", "checked_in"].includes(appointment.status) &&
    Date.now() >= earliest.getTime() &&
    Date.now() <= latest.getTime();
  const encounterId = appointment.associated_encounter?.id;
  const patientInitials = appointment.patient.name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase();

  return (
    <aside
      aria-label={t("zoom__appointment_details")}
      className="min-w-0 space-y-3"
    >
      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-500">
          {t("zoom__appointment_details")}
        </h2>
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-800"
          >
            {patientInitials || <UserRound className="size-5" />}
          </span>
          <div className="min-w-0">
            <p className="break-words text-base font-semibold text-gray-900">
              {appointment.patient.name}
            </p>
            <p className="text-xs text-gray-500">
              {t("zoom__appointment_patient")}
            </p>
          </div>
        </div>
        <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700">
          {t(`zoom__appointment_status_${appointment.status}`)}
        </span>
        <dl className="space-y-4 border-t border-gray-100 pt-4 text-sm">
          <div className="relative min-w-0 pl-6">
            <dt className="text-xs text-gray-500">
              <Hospital
                className="absolute left-0 top-0.5 size-4 text-gray-400"
                aria-hidden="true"
              />
              {t("zoom__appointment_facility")}
            </dt>
            <dd className="mt-0.5 break-words font-medium">
              {appointment.facility.name}
            </dd>
          </div>
          <div className="relative min-w-0 pl-6">
            <dt className="text-xs text-gray-500">
              <CalendarDays
                className="absolute left-0 top-0.5 size-4 text-gray-400"
                aria-hidden="true"
              />
              {t("zoom__appointment_time")}
            </dt>
            <dd className="mt-0.5 font-medium">
              <time dateTime={appointment.token_slot.start_datetime}>
                {start.toLocaleString([], {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
              {" – "}
              <time dateTime={appointment.token_slot.end_datetime}>
                {new Date(
                  appointment.token_slot.end_datetime,
                ).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </dd>
          </div>
        </dl>
        <div className="border-t border-gray-100 pt-4">
          <h3 className="mb-1.5 text-xs font-semibold text-gray-500">
            {t("zoom__appointment_notes")}
          </h3>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-600">
            {appointment.note || t("zoom__appointment_no_notes")}
          </p>
        </div>
      </section>
      <div className="flex flex-col gap-2">
        {encounterId ? (
          <Button
            asChild
            size="lg"
            className="h-auto min-h-10 whitespace-normal text-center"
          >
            <a
              href={`/facility/${encodeURIComponent(facilityId)}/patient/${encodeURIComponent(patientId)}/encounter/${encodeURIComponent(encounterId)}/updates`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Stethoscope aria-hidden="true" />
              {t("zoom__view_encounter")}
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        ) : (
          canCreateEncounter &&
          !isFinal && (
            <Button
              asChild
              size="lg"
              className="h-auto min-h-10 whitespace-normal text-center"
            >
              <a
                href={`${appointmentUrl}${canStart ? "?from_queue=true" : ""}`}
                onClick={canStart ? onStartConsultation : undefined}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Stethoscope aria-hidden="true" />
                {t(
                  canStart
                    ? "zoom__start_consultation"
                    : "zoom__manage_appointment_encounter",
                )}
                <ExternalLink aria-hidden="true" />
              </a>
            </Button>
          )
        )}
        <Button
          asChild
          variant="outline"
          className="h-auto min-h-10 whitespace-normal text-center"
        >
          <a href={appointmentUrl} target="_blank" rel="noopener noreferrer">
            <NotebookPen aria-hidden="true" />
            {t("zoom__open_appointment_details")}
            <ExternalLink aria-hidden="true" />
          </a>
        </Button>
      </div>
      <p className="px-2 text-center text-xs leading-relaxed text-gray-500">
        {t("zoom__appointment_new_tab_hint")}
      </p>
    </aside>
  );
}

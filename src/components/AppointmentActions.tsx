import { useEffect, useState, type ReactNode } from "react";
import { Check, Link, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast, Toaster } from "sonner";
import { useAppointment } from "../hooks/useAppointment";
import { callPath, callUrl, staffCallPath } from "../utils/routes";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import Page from "./Page";
export default function AppointmentActions({
  bookingId,
  facilityId,
  patientId,
  children,
}: {
  bookingId: string;
  facilityId?: string;
  patientId?: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const { data } = useAppointment(bookingId, "staff");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const facility = data?.staff_context?.facility_id ?? facilityId;
  const patient = data?.staff_context?.patient_id ?? patientId;
  const staffPath =
    facility && patient
      ? staffCallPath(bookingId, facility, patient)
      : callPath(bookingId);
  return (
    <Page>
      <Toaster position="top-center" richColors closeButton />
      <div
        role="group"
        aria-label={t("zoom__appointment_actions")}
        className="flex flex-wrap items-center"
      >
        {data?.eligible && (
          <>
            <ButtonGroup>
              {data.caller_role === "host" && (
                <Button asChild size="lg">
                  <a href={staffPath}>
                    <Video />
                    {t("zoom__join")}
                  </a>
                </Button>
              )}
              <Button
                variant="outline"
                size="lg"
                className="w-10 px-0"
                title={t(copied ? "zoom__copied" : "zoom__copy")}
                aria-label={t(copied ? "zoom__copied" : "zoom__copy")}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(callUrl(bookingId));
                    setCopied(true);
                    setCopyError(false);
                    toast.success(t("zoom__copy_success_toast"));
                  } catch {
                    setCopyError(true);
                  }
                }}
              >
                {copied ? <Check /> : <Link />}
              </Button>
            </ButtonGroup>
            {copyError && (
              <span role="alert" className="text-sm text-red-700">
                {t("zoom__copy_failed")}{" "}
                <a className="underline" href={callPath(bookingId)}>
                  {t("zoom__open_call")}
                </a>
              </span>
            )}
          </>
        )}
        {children}
      </div>
    </Page>
  );
}

import { useState } from "react";
import { Copy, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppointment } from "../hooks/useAppointment";
import { callPath, callUrl } from "../utils/routes";
import { Button } from "./ui/button";
import Page from "./Page";
export default function AppointmentActions({
  bookingId,
}: {
  bookingId: string;
}) {
  const { t } = useTranslation();
  const { data } = useAppointment(bookingId, "staff");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  if (!data?.eligible) return null;
  return (
    <Page>
      <div className="flex flex-wrap items-center gap-2">
        {data.caller_role === "host" && (
          <Button asChild size="sm">
            <a href={callPath(bookingId)}>
              <Video />
              {t("zoom__join")}
            </a>
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(callUrl(bookingId));
              setCopied(true);
              setCopyError(false);
            } catch {
              setCopyError(true);
            }
          }}
        >
          <Copy />
          {t(copied ? "zoom__copied" : "zoom__copy")}
        </Button>
        {copyError && (
          <span role="alert" className="text-sm text-red-700">
            {t("zoom__copy_failed")}{" "}
            <a className="underline" href={callPath(bookingId)}>
              {t("zoom__open_call")}
            </a>
          </span>
        )}
      </div>
    </Page>
  );
}

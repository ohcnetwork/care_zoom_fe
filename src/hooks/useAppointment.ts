import { useEffect, useState } from "react";
import type { AppointmentInfo, AuthKind } from "../types";
import { getAppointment } from "../utils/api";
import { useCareAuth } from "./useCareAuth";
export function useAppointment(
  id: string,
  kind: AuthKind | null,
  passcode?: string,
) {
  const auth = useCareAuth();
  const identity =
    kind === "guest"
      ? passcode
      : kind === "patient"
        ? auth?.patientToken?.token
        : auth?.user?.id;
  const identityKey = `${id}:${kind}:${identity ?? ""}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    data: AppointmentInfo;
  }>();
  const data = loaded?.key === identityKey ? loaded.data : undefined;
  const [error, setError] = useState<unknown>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setLoaded(undefined);
    setError(undefined);
    if (!kind) return;
    const controller = new AbortController();
    const update = () =>
      getAppointment(id, kind, controller.signal, passcode)
        .then((value) => {
          if (!controller.signal.aborted) {
            setLoaded({ key: identityKey, data: value });
            setError(undefined);
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setLoaded(undefined);
            setError(error);
          }
        });
    void update();
    const timer = window.setInterval(update, 30000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [id, kind, identity, identityKey, revision, passcode]);
  return { data, error, retry: () => setRevision((value) => value + 1) };
}

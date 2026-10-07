import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useCareAuth } from "../hooks/useCareAuth";
import { loginOtp, sendOtp } from "../utils/api";
import { callPath, staffLoginUrl } from "../utils/routes";
import { Button } from "./ui/button";
export default function PatientLogin({ bookingId }: { bookingId: string }) {
  const { t } = useTranslation();
  const auth = useCareAuth();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(false);
    setBusy(true);
    try {
      if (sent) {
        const { access } = await loginOtp(phone, otp);
        auth?.patientLogin(
          {
            token: access,
            phoneNumber: phone,
            createdAt: new Date().toISOString(),
          },
          callPath(bookingId),
        );
      } else {
        await sendOtp(phone);
        setSent(true);
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <p>{t("zoom__sign_in_help")}</p>
      {!window.__CORE_ENV__?.disablePatientLogin && (
        <form className="space-y-3" onSubmit={submit}>
          <label className="block text-sm font-semibold">
            {t("zoom__phone")}
            <input
              className="mt-1 block h-10 w-full rounded-md border border-gray-400 px-3 font-normal"
              type="tel"
              autoComplete="tel"
              placeholder="+919876543210"
              required
              pattern="\+[1-9][0-9]{7,14}"
              value={phone}
              disabled={sent || busy}
              onChange={(event) =>
                setPhone(event.target.value.replace(/\s/g, ""))
              }
            />
          </label>
          {sent && (
            <label className="block text-sm font-semibold">
              {t("zoom__otp")}
              <input
                className="mt-1 block h-10 w-full rounded-md border border-gray-400 px-3 font-normal"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{5}"
                maxLength={5}
                required
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {t("zoom__otp_failed")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !auth}>
              {t(
                busy
                  ? "zoom__loading"
                  : sent
                    ? "zoom__verify_otp"
                    : "zoom__send_otp",
              )}
            </Button>
            {sent && (
              <Button
                variant="outline"
                type="button"
                disabled={busy}
                onClick={() => {
                  setSent(false);
                  setOtp("");
                  setError(false);
                }}
              >
                {t("zoom__change_phone")}
              </Button>
            )}
          </div>
        </form>
      )}
      <a
        className="inline-block font-semibold text-primary-700 underline"
        href={staffLoginUrl(bookingId)}
      >
        {t("zoom__staff_login")}
      </a>
    </div>
  );
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import PatientInfoCard from "../src/components/PatientInfoCard";
import PatientPortalIndex from "../src/components/PatientPortalIndex";
import PublicRouter from "../src/components/PublicRouter";
import CallPage from "../src/pages/CallPage";
import manifest from "../src/manifest";
import { authKind } from "../src/hooks/useCareAuth";
import {
  authToken,
  getJoinToken,
  getVideoAppointments,
} from "../src/utils/api";
import {
  callUrl,
  staffCallPath,
  staffLoginUrl,
  teleconsultMatch,
} from "../src/utils/routes";
import type { AppointmentInfo, CareAuth } from "../src/types";
import locale from "../public/locale/en.json";
vi.mock("../src/components/ZoomCall", () => ({
  default: () => <div>Active SDK call</div>,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: keyof typeof locale) => locale[key] ?? key,
  }),
}));
const id = "e6875f90-10fe-4674-96ae-0d6b0fc19d7b";
const info: AppointmentInfo = {
  booking_id: id,
  status: "in_consultation",
  patient_name: "Test Patient",
  practitioner_name: "Test Doctor",
  start_datetime: new Date(Date.now() - 3600000).toISOString(),
  end_datetime: new Date().toISOString(),
  join_opens_at: new Date().toISOString(),
  join_closes_at: new Date(Date.now() + 3600000).toISOString(),
  join_path: `/teleconsult/${id}`,
  eligible: true,
  can_join: false,
  caller_role: "host",
  configured: false,
  reason: "Credentials not configured",
};
const patientToken = {
  token: "care-patient-token",
  phoneNumber: "+919876543210",
  createdAt: new Date().toISOString(),
};
const patientAuth: CareAuth = {
  patientToken,
  patientLogin: vi.fn(),
  signOut: vi.fn(),
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
function authRender(
  element: React.ReactNode,
  value: CareAuth | null = patientAuth,
) {
  const Context = createContext<CareAuth | null>(value);
  window.AuthUserContext = Context;
  return render(<Context.Provider value={value}>{element}</Context.Provider>);
}
beforeEach(() => {
  localStorage.clear();
  window.CARE_API_URL = "https://care.example";
  window.history.replaceState({}, "", "/");
  window.__CORE_ENV__ = {};
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(info)));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("pinned host entry points before SDK integration", () => {
  it("registers facility appointment calls while keeping shared links patient-facing", () => {
    expect(
      manifest.routes[
        "/facility/:facilityId/patient/:patientId/appointments/:bookingId/video"
      ],
    ).toBeTypeOf("function");
    expect(staffCallPath(id, "facility", "patient")).toBe(
      `/facility/facility/patient/patient/appointments/${id}/video`,
    );
    expect(callUrl(id)).toBe(
      new URL(`/teleconsult/${id}`, window.location.origin).href,
    );
  });
  it("preserves PatientInfoCard props, children and non-appointment usage", () => {
    const base = vi.fn(({ children }) => (
      <div data-testid="core-card">{children}</div>
    ));
    render(
      <PatientInfoCard
        __base={base}
        tagEntityType="patient"
        tagEntityId={id}
        facilityId="facility"
      >
        <span>Existing child</span>
      </PatientInfoCard>,
    );
    expect(screen.getByText("Existing child")).toBeTruthy();
    expect(base.mock.calls[0][0].facilityId).toBe("facility");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("appends assigned-doctor actions without removing original children", async () => {
    render(
      <PatientInfoCard
        __base={({ children }) => <div>{children as React.ReactNode}</div>}
        tagEntityType="appointment"
        tagEntityId={id}
        facilityId="facility"
        patient={{ id: "patient" }}
      >
        <span>Original appointment controls</span>
      </PatientInfoCard>,
    );
    expect(await screen.findByText("Copy call link")).toBeTruthy();
    expect(screen.getByText("Original appointment controls")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Join video call" })
        .getAttribute("href"),
    ).toBe(`/facility/facility/patient/patient/appointments/${id}/video`);
  });
  it("other booking readers get copy without practitioner join", async () => {
    vi.mocked(fetch).mockResolvedValue(
      response({ ...info, caller_role: "observer" }),
    );
    render(
      <PatientInfoCard
        __base={({ children }) => <div>{children as React.ReactNode}</div>}
        tagEntityType="appointment"
        tagEntityId={id}
      />,
    );
    await screen.findByText("Copy call link");
    expect(screen.queryByText("Join video call")).toBeNull();
  });
  it("public override matches only the stable UUID path and preserves other routes/props", () => {
    const matcher = manifest.overrides[2].condition!.custom;
    expect(matcher({ route: `/teleconsult/${id}` })).toBe(true);
    for (const route of [
      "/login",
      "/patient/home",
      "/teleconsult/not-a-uuid",
      `/teleconsult/${id}/extra`,
    ])
      expect(matcher({ route })).toBe(false);
    const base = vi.fn(({ children }) => <div>{children}</div>);
    render(
      <PublicRouter __base={base} existing="prop">
        Existing public page
      </PublicRouter>,
    );
    expect(screen.getByText("Existing public page")).toBeTruthy();
    expect(base.mock.calls[0][0].existing).toBe("prop");
  });
  it("shows public OTP login with encoded absolute same-origin staff return", () => {
    authRender(<CallPage bookingId={id} />, {
      ...patientAuth,
      patientToken: null,
    });
    const href = screen
      .getByRole("link", { name: "Sign in as practitioner" })
      .getAttribute("href")!;
    expect(href).toBe(staffLoginUrl(id));
    expect(new URLSearchParams(href.split("?")[1]).get("redirect")).toBe(
      callUrl(id),
    );
    expect(new URL(callUrl(id)).origin).toBe(window.location.origin);
  });
  it("uses existing OTP endpoints then the exposed host patientLogin with the same link", async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      response(
        String(input).endsWith("/send/")
          ? { otp: "generated" }
          : { access: "new-care-patient-token" },
      ),
    );
    const patientLogin = vi.fn();
    authRender(<CallPage bookingId={id} />, {
      ...patientAuth,
      patientToken: null,
      patientLogin,
    });
    fireEvent.change(
      screen.getByLabelText("Phone number (with country code)"),
      { target: { value: "+919876543210" } },
    );
    fireEvent.click(screen.getByText("Send verification code"));
    const otpInput = await screen.findByLabelText("Verification code");
    expect(otpInput.getAttribute("maxlength")).toBe("5");
    expect(otpInput.getAttribute("pattern")).toBe("[0-9]{5}");
    fireEvent.change(otpInput, { target: { value: "45612" } });
    fireEvent.click(screen.getByText("Verify and continue"));
    await waitFor(() =>
      expect(patientLogin).toHaveBeenCalledWith(
        expect.objectContaining({
          token: "new-care-patient-token",
          phoneNumber: "+919876543210",
        }),
        `/teleconsult/${id}`,
      ),
    );
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "https://care.example/api/v1/otp/send/",
    );
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe(
      "https://care.example/api/v1/otp/login/",
    );
    expect(localStorage.getItem("care_patient_token")).toBeNull(); // Host owns CARE session storage.
  });
  it("OTP patient reaches call metadata via public fallback", async () => {
    window.history.replaceState({}, "", `/teleconsult/${id}`);
    localStorage.setItem("care_patient_token", JSON.stringify(patientToken));
    authRender(<PublicRouter __base={() => <div>Fallback</div>} />);
    expect(await screen.findByText("Test Patient · Test Doctor")).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain(
      `/api/care_zoom/otp/appointments/${id}/`,
    );
  });
  it("preserves patient portal base, includes started appointments and follows pagination", async () => {
    const base = vi.fn(({ children }) => <div>{children}</div>);
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("get_appointments/"))
        return response({
          results: [],
          next: "https://care.example/api/v1/otp/slots/get_appointments/?page=2",
        });
      if (url.includes("page=2"))
        return response({
          results: [
            {
              id,
              status: "in_consultation",
              resource_type: "practitioner",
              token_slot: info,
            },
          ],
          next: null,
        });
      return response(info);
    });
    authRender(
      <PatientPortalIndex __base={base} existing="portal-prop">
        Core appointment tabs
      </PatientPortalIndex>,
    );
    expect(await screen.findByText("Test Patient · Test Doctor")).toBeTruthy();
    expect(screen.getByText("Core appointment tabs")).toBeTruthy();
    expect(base.mock.calls[0][0].existing).toBe("portal-prop");
    expect(
      screen
        .getByRole("link", { name: "Open video call" })
        .getAttribute("href"),
    ).toBe(`/teleconsult/${id}`);
  });
});
describe("authorization/token client boundaries", () => {
  it("uses reactive host identity and reads the matching fresh CARE bearer per request", async () => {
    localStorage.setItem("care_access_token", "stale-staff-token");
    localStorage.setItem("care_patient_token", JSON.stringify(patientToken));
    expect(authKind(patientAuth)).toBe("patient");
    expect(authKind({ ...patientAuth, user: { id: "staff" } })).toBe("staff");
    expect(authToken("patient")).toBe("care-patient-token");
    vi.mocked(fetch).mockResolvedValue(
      response({ token: "zoom-memory-only", role: "participant" }),
    );
    await getJoinToken(id, "patient");
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      `https://care.example/api/care_zoom/otp/appointments/${id}/token/`,
    );
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: "{}",
      cache: "no-store",
      headers: { Authorization: "Bearer care-patient-token" },
    });
    expect(JSON.stringify({ ...localStorage })).not.toContain(
      "zoom-memory-only",
    );
  });
  it("refuses pagination token exfiltration", async () => {
    vi.mocked(fetch).mockResolvedValue(
      response({ results: [], next: "https://evil.example/steal" }),
    );
    await expect(
      getVideoAppointments(new AbortController().signal),
    ).rejects.toThrow("Invalid appointment pagination");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("handles malformed saved patient tokens", () => {
    localStorage.setItem("care_patient_token", "not-json");
    expect(authToken("patient")).toBeNull();
  });
  it("returns to OTP sign-in on expired CARE authentication", async () => {
    vi.mocked(fetch).mockResolvedValue(response({}, 401));
    authRender(<CallPage bookingId={id} />);
    expect(
      await screen.findByText(
        "Your CARE session has expired. Please sign in again.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Send verification code")).toBeTruthy();
  });
});

it("clears previous patient metadata while loading a changed phone session", async () => {
  vi.mocked(fetch).mockImplementation(async (input) =>
    String(input).includes("get_appointments")
      ? response({
          results: [
            {
              id,
              status: "booked",
              resource_type: "practitioner",
              token_slot: info,
            },
          ],
        })
      : response(info),
  );
  const Context = createContext<CareAuth | null>(patientAuth);
  window.AuthUserContext = Context;
  const portal = <PatientPortalIndex __base={() => <div>Core portal</div>} />;
  const view = render(
    <Context.Provider value={patientAuth}>{portal}</Context.Provider>,
  );
  await screen.findByText("Test Patient · Test Doctor");
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  view.rerender(
    <Context.Provider
      value={{
        ...patientAuth,
        patientToken: { ...patientToken, token: "different-phone-token" },
      }}
    >
      {portal}
    </Context.Provider>,
  );
  expect(screen.queryByText("Test Patient · Test Doctor")).toBeNull();
  expect(screen.getByText("Core portal")).toBeTruthy();
});
it("reauthorizes after OTP renewal without changing the patient auth kind", async () => {
  vi.mocked(fetch).mockResolvedValue(response({}, 401));
  const Context = createContext<CareAuth | null>(patientAuth);
  window.AuthUserContext = Context;
  const view = render(
    <Context.Provider value={patientAuth}>
      <CallPage bookingId={id} />
    </Context.Provider>,
  );
  await screen.findByText(
    "Your CARE session has expired. Please sign in again.",
  );
  vi.mocked(fetch).mockResolvedValue(response(info));
  view.rerender(
    <Context.Provider
      value={{
        ...patientAuth,
        patientToken: { ...patientToken, token: "renewed-care-token" },
      }}
    >
      <CallPage bookingId={id} />
    </Context.Provider>,
  );
  expect(await screen.findByText("Test Patient · Test Doctor")).toBeTruthy();
});

it("keeps an active call through metadata changes, then unmounts on phone identity change", async () => {
  let poll: (() => Promise<unknown>) | undefined;
  const interval = vi
    .spyOn(window, "setInterval")
    .mockImplementation((callback) => {
      poll = callback as () => Promise<unknown>;
      return 123;
    });
  vi.mocked(fetch).mockResolvedValue(
    response({ ...info, can_join: true, configured: true, reason: null }),
  );
  const Context = createContext<CareAuth | null>(patientAuth);
  window.AuthUserContext = Context;
  const view = render(
    <Context.Provider value={patientAuth}>
      <CallPage bookingId={id} />
    </Context.Provider>,
  );
  fireEvent.click(await screen.findByText("Prepare for call"));
  await screen.findByText("Active SDK call");
  vi.mocked(fetch).mockResolvedValue(response({}, 404));
  await act(async () => {
    await poll?.();
  });
  expect(screen.getByText("Active SDK call")).toBeTruthy();
  view.rerender(
    <Context.Provider
      value={{
        ...patientAuth,
        patientToken: {
          ...patientToken,
          phoneNumber: "+919999999999",
          token: "new-patient",
        },
      }}
    >
      <CallPage bookingId={id} />
    </Context.Provider>,
  );
  expect(screen.queryByText("Active SDK call")).toBeNull();
  interval.mockRestore();
});

it("recognizes pinned CARE expired staff JWT code even when HTTP status is 403", async () => {
  vi.mocked(fetch).mockResolvedValue(
    response(
      {
        code: "token_not_valid",
        detail: "Do not display arbitrary server response details",
      },
      403,
    ),
  );
  authRender(<CallPage bookingId={id} />, {
    ...patientAuth,
    user: { id: "staff" },
  });
  expect(
    await screen.findByText(
      "Your CARE session has expired. Please sign in again.",
    ),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Sign in as practitioner" })
      .getAttribute("href"),
  ).toBe(staffLoginUrl(id));
  expect(
    screen.queryByText("Do not display arbitrary server response details"),
  ).toBeNull();
});

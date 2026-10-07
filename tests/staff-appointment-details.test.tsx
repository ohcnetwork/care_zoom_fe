import { createContext, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StaffAppointmentDetails from "../src/components/StaffAppointmentDetails";
import type { CareAuth, StaffAppointment } from "../src/types";
import { getStaffAppointment, getStaffFacility } from "../src/utils/api";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const props = {
  facilityId: "facility-1",
  patientId: "patient-1",
  bookingId: "booking-1",
};
const appointmentUrl =
  "/facility/facility-1/patient/patient-1/appointments/booking-1";
const staff: CareAuth = {
  user: { id: "doctor-1" },
  patientToken: null,
  patientLogin: vi.fn(),
  signOut: vi.fn(),
};
const patient: CareAuth = {
  ...staff,
  user: undefined,
  patientToken: {
    token: "patient-token",
    phoneNumber: "+919876543210",
    createdAt: "",
  },
};
const appointment: StaffAppointment = {
  id: props.bookingId,
  status: "booked",
  note: "Review lab results\nDiscuss follow-up",
  facility: { id: props.facilityId, name: "Test facility" },
  patient: { id: props.patientId, name: "Test patient" },
  token_slot: {
    start_datetime: new Date().toISOString(),
    end_datetime: new Date(Date.now() + 1800000).toISOString(),
  },
  associated_encounter: null,
};
const permissions = [
  "can_list_booking",
  "can_create_encounter",
  "can_write_booking",
];
function api(booking = appointment, allowed = permissions) {
  vi.mocked(fetch).mockImplementation(
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes("/appointments/")
            ? booking
            : {
                id: props.facilityId,
                name: "Test facility",
                permissions: allowed,
              },
        ),
      ),
  );
}
function renderWithAuth(element: ReactNode, auth = staff) {
  const Context = createContext<CareAuth | null>(auth);
  window.AuthUserContext = Context;
  return {
    ...render(<Context.Provider value={auth}>{element}</Context.Provider>),
    Context,
  };
}
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("care_access_token", "staff-token");
  localStorage.setItem(
    "care_patient_token",
    JSON.stringify(patient.patientToken),
  );
  window.CARE_API_URL = "https://care.example";
  vi.stubGlobal("fetch", vi.fn());
  api();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("staff appointment details", () => {
  it("shows multiline notes and details and opens the native appointment-bound start form in a new tab", async () => {
    const onStartConsultation = vi.fn();
    renderWithAuth(
      <StaffAppointmentDetails
        {...props}
        onStartConsultation={onStartConsultation}
      />,
    );
    const start = await screen.findByRole("link", {
      name: "zoom__start_consultation",
    });
    expect(start.getAttribute("href")).toBe(
      `${appointmentUrl}?from_queue=true`,
    );
    expect(start.getAttribute("target")).toBe("_blank");
    expect(start.getAttribute("rel")).toBe("noopener noreferrer");
    expect(fireEvent.click(start)).toBe(true);
    expect(onStartConsultation).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Test patient")).toBeTruthy();
    expect(screen.getByText("Test facility")).toBeTruthy();
    expect(
      screen.getByText("Review lab results Discuss follow-up").textContent,
    ).toBe(appointment.note);
    for (const [, options] of vi.mocked(fetch).mock.calls) {
      expect(options?.headers).toMatchObject({
        Authorization: "Bearer staff-token",
      });
      expect(options?.cache).toBe("no-store");
    }
  });

  it("opens an existing encounter and refreshes the association when returning from another tab", async () => {
    renderWithAuth(<StaffAppointmentDetails {...props} />);
    await screen.findByRole("link", { name: "zoom__start_consultation" });
    api({ ...appointment, associated_encounter: { id: "encounter-1" } });
    fireEvent.focus(window);
    const encounter = await screen.findByRole("link", {
      name: "zoom__view_encounter",
    });
    expect(encounter.getAttribute("href")).toBe(
      "/facility/facility-1/patient/patient-1/encounter/encounter-1/updates",
    );
    expect(encounter.getAttribute("target")).toBe("_blank");
    expect(
      screen.queryByRole("link", { name: "zoom__start_consultation" }),
    ).toBeNull();
  });

  it("treats the core API's empty encounter object as no encounter", async () => {
    api({ ...appointment, associated_encounter: {} });
    renderWithAuth(<StaffAppointmentDetails {...props} />);
    const start = await screen.findByRole("link", {
      name: "zoom__start_consultation",
    });
    expect(start.getAttribute("href")).toBe(
      `${appointmentUrl}?from_queue=true`,
    );
    expect(
      screen.queryByRole("link", { name: "zoom__view_encounter" }),
    ).toBeNull();
  });

  it("uses appointment management outside the native start-consultation window", async () => {
    api({
      ...appointment,
      token_slot: {
        ...appointment.token_slot,
        start_datetime: new Date(Date.now() + 3 * 86400000).toISOString(),
      },
    });
    renderWithAuth(<StaffAppointmentDetails {...props} />);
    const manage = await screen.findByRole("link", {
      name: "zoom__manage_appointment_encounter",
    });
    expect(manage.getAttribute("href")).toBe(appointmentUrl);
    expect(
      screen.queryByRole("link", { name: "zoom__start_consultation" }),
    ).toBeNull();
  });

  it("does not offer encounter creation without the facility encounter permission", async () => {
    api(appointment, ["can_list_booking", "can_write_booking"]);
    renderWithAuth(<StaffAppointmentDetails {...props} />);
    await screen.findByText("Test patient");
    expect(
      screen.queryByRole("link", { name: "zoom__start_consultation" }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", {
        name: "zoom__manage_appointment_encounter",
      }),
    ).toBeNull();
  });

  it("does not auto-open consultation when appointment-write permission is missing", async () => {
    api(appointment, ["can_list_booking", "can_create_encounter"]);
    renderWithAuth(<StaffAppointmentDetails {...props} />);
    const manage = await screen.findByRole("link", {
      name: "zoom__manage_appointment_encounter",
    });
    expect(manage.getAttribute("href")).toBe(appointmentUrl);
  });

  it("does not load appointment details without appointment-view permission", async () => {
    api(appointment, ["can_create_encounter"]);
    renderWithAuth(<StaffAppointmentDetails {...props} />);
    await screen.findByRole("alert");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Test patient")).toBeNull();
  });

  it("honors the host superuser permission override", async () => {
    api(appointment, []);
    renderWithAuth(<StaffAppointmentDetails {...props} />, {
      ...staff,
      user: { id: "admin", is_superuser: true },
    });
    await screen.findByRole("link", { name: "zoom__start_consultation" });
  });

  it("does not show creation actions for a finalized appointment", async () => {
    api({ ...appointment, status: "fulfilled", note: "" });
    renderWithAuth(<StaffAppointmentDetails {...props} />);
    await screen.findByText("zoom__appointment_no_notes");
    expect(
      screen.queryByRole("link", { name: "zoom__start_consultation" }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", {
        name: "zoom__manage_appointment_encounter",
      }),
    ).toBeNull();
  });

  it("rejects mismatched patient routes without displaying appointment data", async () => {
    renderWithAuth(
      <StaffAppointmentDetails {...props} patientId="another-patient" />,
    );
    await screen.findByRole("alert");
    expect(screen.queryByText("Test patient")).toBeNull();
    expect(
      screen.queryByText("Review lab results Discuss follow-up"),
    ).toBeNull();
  });

  it("never requests or retains staff details for a patient session, even with a leftover staff token", async () => {
    const { rerender, Context } = renderWithAuth(
      <StaffAppointmentDetails {...props} />,
    );
    await screen.findByText("Test patient");
    vi.mocked(fetch).mockClear();
    rerender(
      <Context.Provider value={patient}>
        <StaffAppointmentDetails {...props} />
      </Context.Provider>,
    );
    expect(screen.queryByText("Test patient")).toBeNull();
    fireEvent.focus(window);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not fall back to a patient token in staff API functions", async () => {
    localStorage.removeItem("care_access_token");
    await expect(getStaffFacility(props.facilityId)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      getStaffAppointment(props.facilityId, props.bookingId),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("offers retry after an API failure without blocking the call", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network unavailable"));
    renderWithAuth(<StaffAppointmentDetails {...props} />);
    await screen.findByRole("alert");
    api();
    fireEvent.click(screen.getByRole("button", { name: "zoom__retry" }));
    await waitFor(() => expect(screen.getByText("Test patient")).toBeTruthy());
  });
});

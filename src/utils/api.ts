import type {
  AppointmentInfo,
  AuthKind,
  JoinToken,
  PublicAppointment,
  ScheduleVideoSettings,
  StaffAppointment,
  StaffFacility,
} from "../types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: "token_not_valid",
  ) {
    super(message);
  }
}
export function authToken(kind: AuthKind): string | null {
  if (kind === "staff") return localStorage.getItem("care_access_token");
  if (kind === "guest") return null;
  try {
    return (
      JSON.parse(localStorage.getItem("care_patient_token") || "null")?.token ??
      null
    );
  } catch {
    return null;
  }
}
export async function request<T>(
  path: string,
  kind: AuthKind | null,
  options: RequestInit = {},
): Promise<T> {
  const token = kind ? authToken(kind) : null;
  const response = await fetch(
    `${window.CARE_API_URL.replace(/\/$/, "")}${path}`,
    {
      ...options,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    },
  );
  // Never include request/response bodies or authentication tokens in errors or logs.
  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    const code =
      body?.code === "token_not_valid" ? "token_not_valid" : undefined;
    throw new ApiError(
      response.status,
      `Request failed (${response.status})`,
      code,
    );
  }
  return response.json() as Promise<T>;
}
const appointmentPath = (id: string, kind: AuthKind) =>
  `/api/care_zoom/${kind === "patient" ? "otp/" : kind === "guest" ? "guest/" : ""}appointments/${encodeURIComponent(id)}/`;
export const getAppointment = (
  id: string,
  kind: AuthKind,
  signal?: AbortSignal,
) => request<AppointmentInfo>(appointmentPath(id, kind), kind, { signal });
export const getJoinToken = (id: string, kind: AuthKind, guestName?: string) =>
  request<JoinToken>(`${appointmentPath(id, kind)}token/`, kind, {
    method: "POST",
    body: JSON.stringify(
      kind === "guest" ? { display_name: guestName, consent: true } : {},
    ),
  });
const scheduleVideoPath = (facilityId: string, scheduleId: string) =>
  `/api/care_zoom/facility/${encodeURIComponent(facilityId)}/schedules/${encodeURIComponent(scheduleId)}/video/`;
export const getScheduleVideoSettings = (
  facilityId: string,
  scheduleId: string,
  signal?: AbortSignal,
) =>
  request<ScheduleVideoSettings>(
    scheduleVideoPath(facilityId, scheduleId),
    "staff",
    { signal },
  );
export const updateScheduleVideoSettings = (
  facilityId: string,
  scheduleId: string,
  video_enabled: boolean,
) =>
  request<ScheduleVideoSettings>(
    scheduleVideoPath(facilityId, scheduleId),
    "staff",
    {
      method: "PATCH",
      body: JSON.stringify({ video_enabled }),
    },
  );
export async function getStaffFacility(id: string, signal?: AbortSignal) {
  if (!authToken("staff"))
    throw new ApiError(401, "Staff authentication required");
  return request<StaffFacility>(
    `/api/v1/facility/${encodeURIComponent(id)}/`,
    "staff",
    { signal },
  );
}
export async function getStaffAppointment(
  facilityId: string,
  bookingId: string,
  signal?: AbortSignal,
) {
  if (!authToken("staff"))
    throw new ApiError(401, "Staff authentication required");
  return request<StaffAppointment>(
    `/api/v1/facility/${encodeURIComponent(facilityId)}/appointments/${encodeURIComponent(bookingId)}/`,
    "staff",
    { signal },
  );
}
export async function getVideoAppointments(
  signal: AbortSignal,
): Promise<AppointmentInfo[]> {
  const apiOrigin = new URL(window.CARE_API_URL).origin;
  const listPath = "/api/v1/otp/slots/get_appointments/";
  let path: string | null = listPath;
  const appointments: PublicAppointment[] = [];
  const visited = new Set<string>();
  while (path && !visited.has(path)) {
    visited.add(path);
    const page: { results: PublicAppointment[]; next?: string | null } =
      await request(path, "patient", { signal });
    appointments.push(...page.results);
    if (!page.next) break;
    const next: URL = new URL(page.next, new URL(path, window.CARE_API_URL));
    // A server-provided next URL must never send the patient bearer to another origin/path.
    if (next.origin !== apiOrigin || next.pathname !== listPath)
      throw new Error("Invalid appointment pagination");
    path = next.pathname + next.search;
  }
  const candidates = [
    ...new Map(appointments.map((item) => [item.id, item])).values(),
  ].filter(
    (item) =>
      item.resource_type === "practitioner" &&
      ["booked", "arrived", "checked_in", "in_consultation"].includes(
        item.status,
      ) &&
      Date.parse(item.token_slot.end_datetime) + 60 * 60 * 1000 >= Date.now(),
  );
  const info = await Promise.all(
    candidates.map(async (item) => {
      try {
        return await getAppointment(item.id, "patient", signal);
      } catch (error) {
        if (error instanceof ApiError && [403, 404].includes(error.status))
          return null;
        throw error;
      }
    }),
  );
  return info
    .filter((item): item is AppointmentInfo => !!item?.eligible)
    .sort(
      (a, b) => Date.parse(a.start_datetime) - Date.parse(b.start_datetime),
    );
}

import { test, expect, type Page } from "@playwright/test";
// These integration tests run the real pinned CARE frontend and federated plugin.
// API responses below are isolated fixtures; they do not prove backend authorization or live Zoom calls.
const bookingId = "e6875f90-10fe-4674-96ae-0d6b0fc19d7b";
const patientId = "11111111-1111-4111-8111-111111111111";
const facilityId = "22222222-2222-4222-8222-222222222222";
const doctor = {
  id: "33333333-3333-4333-8333-333333333333",
  username: "zoom-test-doctor",
  first_name: "Test",
  last_name: "Doctor",
  prefix: "Dr",
  user_type: "Doctor",
  is_superuser: true,
  is_staff: true,
  permissions: [],
  facilities: [],
  organizations: [],
  mfa_enabled: false,
  phone_number: "+919999999999",
  email: "test@example.invalid",
};
const now = Date.now();
const start = new Date(now - 10 * 60000).toISOString();
const end = new Date(now + 20 * 60000).toISOString();
const patient = {
  id: patientId,
  name: "Zoom Test Patient",
  gender: "male",
  date_of_birth: "1990-01-01",
  phone_number: "+919876543210",
  address: "Test address",
  pincode: "682001",
  deceased_datetime: null,
  identifiers: [],
  permissions: [],
  geo_organization: null,
};
const facility = {
  id: facilityId,
  name: "Zoom Test Facility",
  permissions: [],
  facility_type: "Hospital",
  geo_organization: null,
  meta: {},
  features: [],
};
const booking = {
  id: bookingId,
  patient,
  facility,
  resource: doctor,
  resource_type: "practitioner",
  status: "booked",
  tags: [],
  token: null,
  token_slot: {
    id: "44444444-4444-4444-8444-444444444444",
    start_datetime: start,
    end_datetime: end,
    availability: { name: "Test schedule", id: "schedule" },
  },
  booked_on: start,
  modified_date: start,
  created_by: doctor,
  updated_by: doctor,
  booked_by: doctor,
  note: "Existing appointment notes stay visible",
  associated_encounter: null,
};
const info = {
  booking_id: bookingId,
  status: "booked",
  patient_name: patient.name,
  practitioner_name: "Dr Test Doctor",
  start_datetime: start,
  end_datetime: end,
  join_opens_at: start,
  join_closes_at: end,
  join_path: `/teleconsult/${bookingId}`,
  eligible: true,
  can_join: false,
  caller_role: "host",
  configured: false,
  reason: "Zoom credentials are not configured.",
};
async function apiFixtures(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = { results: [], count: 0, next: null, previous: null };
    if (path.endsWith("/plug_config/")) data = { configs: [] };
    else if (
      path.endsWith("/auth/login/") ||
      path.endsWith("/auth/token/refresh/")
    )
      data = {
        access: "fixture-staff-access",
        refresh: "fixture-staff-refresh",
      };
    else if (path.endsWith("/users/getcurrentuser/")) data = doctor;
    else if (path.endsWith("/otp/send/")) data = { otp: "generated" };
    else if (path.endsWith("/otp/login/"))
      data = { access: "fixture-patient-access" };
    else if (path.includes("/care_zoom/"))
      data = {
        ...info,
        caller_role: path.includes("/otp/") ? "participant" : "host",
      };
    else if (path.endsWith("/otp/patient/"))
      data = { results: [patient], count: 1, next: null };
    else if (path.endsWith("/otp/slots/get_appointments/"))
      data = { results: [booking] };
    else if (path === `/api/v1/facility/${facilityId}/`) data = facility;
    else if (
      path === `/api/v1/facility/${facilityId}/appointments/${bookingId}/`
    )
      data = booking;
    await route.fulfill({
      status: 200,
      json: data,
      headers: { "access-control-allow-origin": "*" },
    });
  });
}
async function staffSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("care_access_token", "fixture-staff-access");
    localStorage.setItem("care_refresh_token", "fixture-staff-refresh");
  });
}
async function patientSession(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem(
      "care_patient_token",
      JSON.stringify({
        token: "fixture-patient-access",
        phoneNumber: "+919876543210",
        createdAt: new Date().toISOString(),
      }),
    ),
  );
}

test.beforeEach(async ({ page }) => apiFixtures(page));
test("public UUID route preserves core login and staff login returns to the same call", async ({
  page,
}) => {
  await page.goto(`/teleconsult/${bookingId}`);
  await expect(
    page.getByRole("heading", { name: "Video consultation" }),
  ).toBeVisible();
  const login = page.getByRole("link", { name: "Sign in as practitioner" });
  expect(
    new URLSearchParams((await login.getAttribute("href"))!.split("?")[1]).get(
      "redirect",
    ),
  ).toBe(new URL(`/teleconsult/${bookingId}`, page.url()).href);
  await login.click();
  await expect(page.locator("#username")).toBeVisible();
  await page.locator("#username").fill("zoom-test-doctor");
  await page.locator("#password").fill("fixture-password");
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp(`/teleconsult/${bookingId}$`));
  await expect(
    page.getByText(`${patient.name} · Dr Test Doctor`),
  ).toBeVisible();
});
test("existing OTP login reaches the call through PatientRouter fallback", async ({
  page,
}) => {
  await page.goto(`/teleconsult/${bookingId}`);
  await page
    .getByLabel("Phone number (with country code)")
    .fill("+919876543210");
  await page.getByRole("button", { name: "Send verification code" }).click();
  await page.getByLabel("Verification code").fill("45612");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(
    page.getByText(`${patient.name} · Dr Test Doctor`),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/teleconsult/${bookingId}$`));
});
test("patient portal wrapper retains core appointment tabs and adds in-progress video appointment", async ({
  page,
}) => {
  await patientSession(page);
  await page.goto("/patient/home");
  await expect(
    page.getByRole("heading", { name: "Video appointments" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Scheduled" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "History" })).toBeVisible();
  await expect(
    page.getByText(`${patient.name} · Dr Test Doctor`),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open video call" }).click();
  await expect(
    page.getByRole("heading", { name: "Video consultation" }),
  ).toBeVisible();
});
test("staff appointment card keeps core patient/actions/tags and adds Join/Copy", async ({
  page,
}) => {
  await staffSession(page);
  await page.goto(
    `/facility/${facilityId}/patient/${patientId}/appointments/${bookingId}`,
  );
  await expect(
    page.getByRole("button", { name: "Copy call link" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Join video call" }),
  ).toBeVisible();
  await expect(
    page.getByText("Existing appointment notes stay visible"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Add tags/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Check-In/i })).toBeVisible();
});
test("unrelated public routes retain the core login", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("#username")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Video consultation" }),
  ).toHaveCount(0);
  await page.goto("/teleconsult/not-a-uuid");
  await expect(page.locator("#username")).toBeVisible();
});

test("real lazy Zoom SDK prejoin loads and reports browser media denial without requesting a Zoom token", async ({
  page,
  context,
}) => {
  let tokenRequests = 0;
  await page.route("**/api/care_zoom/**", async (route) => {
    if (route.request().method() === "POST") tokenRequests++;
    await route.fulfill({
      status: 200,
      json: { ...info, configured: true, can_join: true, reason: null },
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await patientSession(page);
  await page.goto(`/teleconsult/${bookingId}`);
  await context.grantPermissions([], { origin: new URL(page.url()).origin });
  await page.getByRole("button", { name: "Prepare for call" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your camera and microphone" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/prejoin.png", fullPage: true });
  await page.getByRole("button", { name: "Check camera", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Camera or microphone access is blocked",
  );
  await expect(
    page.getByRole("button", { name: "Join video call" }),
  ).toBeEnabled();
  expect(tokenRequests).toBe(0);
  await page.goto("/patient/home");
  await expect(
    page.getByRole("heading", { name: "Video appointments" }),
  ).toBeVisible();
});

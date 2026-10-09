import { expect, test } from "@playwright/test";

// Opt in with npm run test:host:live after explicitly running care_zoom.tests.seed_local.
// Uses the isolated development stack without API mocks, database resets or Zoom calls.
const facilityId = "961913dd-696c-56e9-b262-3b71731172a0";
const patientId = "879bf9ac-d520-5d5d-aee0-4701a328df8a";
const bookingId = "bd2953dc-53b6-5455-b779-41ef60172504";
const username = "care-doctor";

test("seeded doctor appointment and Schedule Management render against the real backend", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const boundaryErrors: string[] = [];
  let zoomTokenRequests = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /\[override\]|\[Plugin Error\]|Uncaught error:/.test(message.text())
    ) {
      boundaryErrors.push(message.text());
    }
  });
  page.on("request", (request) => {
    if (
      request.url().includes("/api/care_zoom/") &&
      request.url().includes("/token/")
    ) {
      zoomTokenRequests++;
    }
  });

  await page.goto("/login");
  await page.locator("#username").fill(username);
  await page
    .locator("#password")
    .fill(process.env.CARE_TEST_PASSWORD ?? "Ohcn@123");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("#username")).not.toBeVisible();

  await page.goto(
    `/facility/${facilityId}/patient/${patientId}/appointments/${bookingId}`,
  );
  await expect(
    page.getByRole("button", { name: "Copy call link" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Join video call" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Check-In/i })).toBeVisible();
  const actions = page.getByRole("group", { name: "Appointment actions" });
  await expect(
    actions.getByRole("button", { name: /Check-In/i }),
  ).toBeVisible();
  await expect(
    actions.getByRole("link", { name: "Join video call" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/schedule-video-appointment.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    actions.getByRole("button", { name: /Check-In/i }),
  ).toBeVisible();
  await expect(
    actions.getByRole("link", { name: "Join video call" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/schedule-video-appointment-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole("button", { name: /Add tags/i })).toBeVisible();
  await expect(
    page.getByText("A plugin override for", { exact: false }),
  ).toHaveCount(0);

  // Opening the native patient card exercises serialized identifier data as well.
  await page
    .locator('[data-slot="popover-trigger"]')
    .filter({ hasText: "Zoom Verification Patient" })
    .click();
  await expect(
    page.getByRole("link", { name: "View Profile", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Shared links resolve to the facility appointment route for signed-in staff.
  await page.goto(`/teleconsult/${bookingId}`);
  await expect(page).toHaveURL(
    `/facility/${facilityId}/patient/${patientId}/appointments/${bookingId}/video`,
  );
  const details = page.getByRole("complementary", {
    name: "Appointment details",
  });
  await expect(details).toBeVisible();
  await expect(
    details.getByText("Zoom Verification Patient", { exact: true }),
  ).toBeVisible();
  await expect(
    details.getByRole("heading", { name: "Notes", exact: true }),
  ).toBeVisible();
  await expect(
    details.getByRole("link", { name: "Start consultation", exact: true }),
  ).toHaveAttribute(
    "href",
    `/facility/${facilityId}/patient/${patientId}/appointments/${bookingId}?from_queue=true`,
  );
  await page.screenshot({
    path: "test-results/staff-appointment-call.png",
    fullPage: true,
  });
  const [encounterPage] = await Promise.all([
    page.waitForEvent("popup"),
    details
      .getByRole("link", { name: "Start consultation", exact: true })
      .click(),
  ]);
  await expect(
    encounterPage.getByRole("dialog", { name: "Initiate Patient Encounter" }),
  ).toBeVisible();
  await expect(
    encounterPage.getByRole("button", {
      name: /^Create Encounter/,
    }),
  ).toBeVisible();
  await encounterPage.close(); // Inspect the native form without creating clinical data.

  await page.goto(
    `/facility/${facilityId}/users/${encodeURIComponent(username)}/availability`,
  );
  await expect(
    page.getByRole("button", { name: "Schedule", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Zoom verification", { exact: true }).first(),
  ).toBeVisible();
  const settingsResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/care_zoom/facility/") &&
      response.url().endsWith("/video/"),
  );
  await page
    .getByRole("button", { name: "Consultation mode", exact: true })
    .click();
  const settings = await settingsResponse;
  expect(settings.ok()).toBe(true);
  const original = (await settings.json()) as { video_enabled: boolean };
  expect(original.video_enabled).toBe(true);
  const dialog = page.getByRole("dialog", {
    name: "Consultation mode",
    exact: true,
  });
  await expect(
    dialog.getByRole("radio", { name: "Video call", exact: true }),
  ).toBeChecked();
  await page.screenshot({
    path: "test-results/schedule-video-settings.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/schedule-video-settings-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  try {
    await dialog.getByRole("radio", { name: "In person", exact: true }).check();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const metadata = page.waitForResponse((response) =>
      response.url().includes(`/care_zoom/appointments/${bookingId}/`),
    );
    await page.goto(
      `/facility/${facilityId}/patient/${patientId}/appointments/${bookingId}`,
    );
    expect((await (await metadata).json()).eligible).toBe(false);
    await expect(page.getByRole("button", { name: /Check-In/i })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Join video call" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Copy call link" }),
    ).toHaveCount(0);
  } finally {
    // Restore only this synthetic schedule, even if a UI assertion fails.
    const restored = await page.request.patch(settings.url(), {
      headers: { Authorization: settings.request().headers().authorization },
      data: { video_enabled: original.video_enabled },
    });
    expect(restored.ok()).toBe(true);
  }
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Join video call" }),
  ).toBeVisible();
  await expect(
    page.getByText("A plugin override for", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      /Care has encountered an unexpected error|Sorry\.\. there was an error/,
    ),
  ).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(boundaryErrors).toEqual([]);
  expect(zoomTokenRequests).toBe(0);
});

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
  const details = page.getByRole("region", { name: "Appointment details" });
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

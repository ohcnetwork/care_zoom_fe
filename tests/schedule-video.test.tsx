import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import ScheduleVideoSettings from "../src/components/ScheduleVideoSettings";
import manifest from "../src/manifest";
import locale from "../public/locale/en.json";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: keyof typeof locale) => locale[key] ?? key,
  }),
}));

const path =
  "https://care.example/api/care_zoom/facility/facility/schedules/schedule/video/";
const settings = (video_enabled: boolean) => ({
  schedule_id: "schedule",
  video_enabled,
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const props = {
  template: { id: "schedule", name: "Morning clinic" },
  facilityId: "facility",
  resourceType: "practitioner",
  resourceId: "doctor",
  trigger: <button>Edit schedule</button>,
};
const base = vi.fn(({ trigger }: { trigger?: ReactNode }) => (
  <div>{trigger}</div>
));
function show() {
  return render(<ScheduleVideoSettings {...props} __base={base} />);
}
function open() {
  fireEvent.click(screen.getByRole("button", { name: "Consultation mode" }));
}

beforeAll(() => {
  // jsdom does not implement native modal dialogs; browser tests cover their layout/focus.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value() {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value() {
        this.removeAttribute("open");
      },
    },
  });
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("care_access_token", "staff-token");
  localStorage.setItem(
    "care_patient_token",
    JSON.stringify({ token: "patient-token" }),
  );
  window.CARE_API_URL = "https://care.example";
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => response(settings(false))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("registers the schedule override, preserves the core editor, and only adds practitioner settings", () => {
  expect(
    manifest.overrides.some(
      (item) => item.component === "EditScheduleTemplateSheet",
    ),
  ).toBe(true);
  const onOpenChange = vi.fn();
  const view = render(
    <ScheduleVideoSettings
      {...props}
      __base={base}
      open
      onOpenChange={onOpenChange}
    />,
  );
  expect(screen.getByRole("button", { name: "Edit schedule" })).toBeTruthy();
  expect(base.mock.calls[0][0]).toMatchObject({
    ...props,
    open: true,
    onOpenChange,
  });
  expect(fetch).not.toHaveBeenCalled();
  view.rerender(
    <ScheduleVideoSettings {...props} __base={base} resourceType="location" />,
  );
  expect(
    screen.queryByRole("button", { name: "Consultation mode" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Edit schedule" })).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

it("loads only when opened, saves the whole schedule with staff auth, and reloads on reopen", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(response(settings(false)))
    .mockResolvedValueOnce(response(settings(true)))
    .mockResolvedValueOnce(response(settings(true)));
  show();
  expect(fetch).not.toHaveBeenCalled();
  open();
  expect(
    await screen.findByRole("radio", { name: "In person" }),
  ).toHaveProperty("checked", true);
  expect(screen.getByText(locale.zoom__schedule_mode_warning)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(screen.getByRole("radio", { name: "Video call" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(fetch).toHaveBeenNthCalledWith(
    2,
    path,
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ video_enabled: true }),
      headers: expect.objectContaining({ Authorization: "Bearer staff-token" }),
    }),
  );
  open();
  expect(
    await screen.findByRole("radio", { name: "Video call" }),
  ).toHaveProperty("checked", true);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("retries loading and preserves the selection after a failed save", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(response({}, 503))
    .mockResolvedValueOnce(response(settings(false)))
    .mockResolvedValueOnce(response({}, 403))
    .mockResolvedValueOnce(response(settings(true)));
  show();
  open();
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    locale.zoom__schedule_mode_load_failed,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  fireEvent.click(await screen.findByRole("radio", { name: "Video call" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    locale.zoom__schedule_mode_save_failed,
  );
  expect(screen.getByRole("radio", { name: "Video call" })).toHaveProperty(
    "checked",
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("prevents duplicate saves or closing the dialog while a save is pending", async () => {
  let finish!: (value: Response) => void;
  vi.mocked(fetch)
    .mockResolvedValueOnce(response(settings(false)))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  show();
  open();
  fireEvent.click(await screen.findByRole("radio", { name: "Video call" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(
    screen.getByRole("radio", { name: "Video call" }).matches(":disabled"),
  ).toBe(true);
  const cancellation = new Event("cancel", { cancelable: true });
  fireEvent(screen.getByRole("dialog"), cancellation);
  expect(cancellation.defaultPrevented).toBe(true);
  expect(screen.getByRole("dialog")).toBeTruthy();
  await act(async () => finish(response(settings(true))));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("cancels an unfinished load when the dialog closes", async () => {
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  show();
  open();
  const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
  expect(signal?.aborted).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRef, StrictMode } from "react";
import ZoomCall, { type ZoomCallHandle } from "../src/components/ZoomCall";
import locale from "../public/locale/en.json";
import type { JoinToken } from "../src/types";

const mock = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const user = {
    userId: 1,
    displayName: "Doctor",
    bVideoOn: false,
    audio: "",
    muted: true,
  };
  const stream = {
    startVideo: vi.fn(async () => {
      user.bVideoOn = true;
      return "";
    }),
    stopVideo: vi.fn(async () => {
      user.bVideoOn = false;
      return "";
    }),
    startAudio: vi.fn(async () => {
      user.audio = "computer";
      user.muted = false;
      return "";
    }),
    stopAudio: vi.fn(async () => ""),
    muteAudio: vi.fn(async () => {
      user.muted = true;
      return "";
    }),
    unmuteAudio: vi.fn(async () => {
      user.muted = false;
      return "";
    }),
    switchCamera: vi.fn(async () => ""),
    switchMicrophone: vi.fn(async () => ""),
    switchSpeaker: vi.fn(async () => ""),
    getMaxRenderableVideos: () => 4,
    attachVideo: vi.fn(async () => document.createElement("video-player")),
    detachVideo: vi.fn(async () => []),
  };
  const client = {
    init: vi.fn(async () => ""),
    join: vi.fn(async () => user),
    leave: vi.fn(async () => ""),
    on: vi.fn((name, fn) => listeners.set(name, fn)),
    off: vi.fn((name) => listeners.delete(name)),
    getMediaStream: () => stream,
    getAllUser: vi.fn(() => [user]),
    getCurrentUserInfo: () => user,
    isHost: vi.fn(() => true),
    reclaimHost: vi.fn(async () => ""),
  };
  const camera = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    switchCamera: vi.fn(async () => undefined),
  };
  const microphone = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    unmute: vi.fn(async () => undefined),
    getCurrentVolume: () => 30,
  };
  const sdk = {
    createClient: vi.fn(() => client),
    destroyClient: vi.fn(async () => undefined),
    checkSystemRequirements: () => ({ audio: true, video: true }),
    getDevices: vi.fn(async () => [
      { kind: "videoinput", deviceId: "camera-1", label: "Camera one" },
      { kind: "audioinput", deviceId: "mic-1", label: "Mic one" },
    ]),
    createLocalVideoTrack: vi.fn(() => camera),
    createLocalAudioTrack: vi.fn(() => microphone),
  };
  return { listeners, user, stream, client, camera, microphone, sdk };
});
vi.mock("@zoom/videosdk", () => ({ default: mock.sdk }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: keyof typeof locale) => locale[key] ?? key,
  }),
}));
const token: JoinToken = {
  token: "secret-memory-only",
  session_name: "care-booking",
  session_key: "booking",
  display_name: "Doctor",
  role: "host",
  expires_at: "2030-01-01T00:00:00Z",
};
const requestToken = vi.fn(async () => token);
async function ready() {
  await screen.findByText("Ready to join?");
}
async function join() {
  fireEvent.click(screen.getByText("Join video call"));
  await screen.findByText("Enable audio");
}
function mockPictureInPicture() {
  const pip = Object.assign(new EventTarget(), {
    document: document.implementation.createHTMLDocument("Call"),
    closed: false,
    close: vi.fn(() => {
      pip.closed = true;
      pip.dispatchEvent(new Event("pagehide"));
    }),
  });
  const requestWindow = vi.fn(async () => pip as unknown as Window);
  vi.stubGlobal("documentPictureInPicture", { requestWindow });
  const actions = new Map<string, (() => void) | null>();
  const mediaSession = {
    setActionHandler: vi.fn((action: string, handler: (() => void) | null) => {
      actions.set(action, handler);
    }),
  };
  vi.stubGlobal("navigator", {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    mediaSession,
  });
  return { pip, requestWindow, actions, mediaSession };
}
beforeEach(() => {
  vi.clearAllMocks();
  requestToken.mockResolvedValue(token);
  mock.listeners.clear();
  Object.assign(mock.user, { bVideoOn: false, audio: "", muted: true });
  mock.client.init.mockResolvedValue("");
  mock.client.join.mockResolvedValue(mock.user);
  mock.client.leave.mockResolvedValue("");
  mock.client.isHost.mockReturnValue(true);
  mock.camera.start.mockResolvedValue(undefined);
  mock.sdk.getDevices.mockResolvedValue([
    { kind: "videoinput", deviceId: "camera-1", label: "Camera one" },
    { kind: "audioinput", deviceId: "mic-1", label: "Mic one" },
  ]);
  mock.stream.startAudio.mockImplementation(async () => {
    mock.user.audio = "computer";
    mock.user.muted = false;
    return "";
  });
  vi.stubGlobal("isSecureContext", true);
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  cleanup();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("opens native PiP from a consultation action with working controls and restores without restarting media", async () => {
  const { pip, requestWindow } = mockPictureInPicture();
  const sheet = document.createElement("style");
  sheet.textContent = ".care-zoom-container { color: green; }";
  document.head.append(sheet);
  const call = createRef<ZoomCallHandle>();
  const view = render(
    <>
      <button onClick={() => void call.current?.openPictureInPicture()}>
        Start consultation
      </button>
      <ZoomCall ref={call} requestToken={requestToken} />
    </>,
  );
  await ready();
  expect(screen.queryByText(locale.zoom__picture_in_picture)).toBeNull();
  fireEvent.click(screen.getByText("Start consultation"));
  expect(requestWindow).not.toHaveBeenCalled();
  await join();
  expect(window.location.protocol).toBe("http:");
  expect(
    screen.getByText(locale.zoom__picture_in_picture_http_help),
  ).toBeTruthy();
  const settings = screen.getByRole("button", { name: "Camera settings" });
  fireEvent.click(settings);
  expect(settings.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByLabelText("Camera", { selector: "select" })).toBeTruthy();
  fireEvent.click(settings);
  expect(settings.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByText("Start camera"));
  await screen.findByText("Stop camera");
  const player = document.querySelector("video-player");
  expect(player).toBeTruthy();
  fireEvent.click(settings);
  expect(screen.getByLabelText("Camera", { selector: "select" })).toBeTruthy();
  fireEvent.click(screen.getByText("Start consultation"));
  // Must request in the original click, before browser activation is lost.
  expect(requestWindow).toHaveBeenCalledTimes(1);
  await screen.findByText(locale.zoom__call_in_picture_in_picture);
  expect(requestWindow).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Start consultation"));
  expect(requestWindow).toHaveBeenCalledTimes(1);
  expect(pip.document.querySelector("video-player")).toBe(player);
  expect(pip.document.head.textContent).toContain(sheet.textContent);
  expect(pip.document.querySelector(".care-zoom-container")).toBeTruthy();
  const floating = within(pip.document.body);
  expect(floating.queryByLabelText("Camera settings")).toBeNull();
  expect(
    floating.queryByLabelText("Microphone and speaker settings"),
  ).toBeNull();
  expect(pip.document.querySelector("select")).toBeNull();
  act(() => floating.getByText("Enable audio").click());
  await waitFor(() => expect(floating.getByText("Mute")).toBeTruthy());
  act(() => floating.getByText("Mute").click());
  await waitFor(() => expect(floating.getByText("Unmute")).toBeTruthy());
  expect(mock.stream.muteAudio).toHaveBeenCalledTimes(1);
  act(() => pip.close());
  await screen.findByText(locale.zoom__picture_in_picture);
  expect(document.querySelector("video-player")).toBe(player);
  expect(mock.client.join).toHaveBeenCalledTimes(1);
  expect(mock.stream.attachVideo).toHaveBeenCalledTimes(1);
  expect(mock.stream.detachVideo).not.toHaveBeenCalled();
  expect(mock.client.leave).not.toHaveBeenCalled();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Camera settings" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
  sheet.remove();
  view.unmount();
});

it("registers browser automatic PiP only in a call and cleans up the window and action on hangup", async () => {
  const { pip, actions, mediaSession } = mockPictureInPicture();
  render(<ZoomCall requestToken={requestToken} />);
  await ready();
  expect(mediaSession.setActionHandler).not.toHaveBeenCalled();
  await join();
  expect(actions.get("enterpictureinpicture")).toBeTypeOf("function");
  await act(async () => actions.get("enterpictureinpicture")?.());
  await screen.findByText(locale.zoom__call_in_picture_in_picture);
  act(() => within(pip.document.body).getByText("Leave").click());
  await screen.findByText("You left the call.");
  expect(pip.close).toHaveBeenCalledTimes(1);
  expect(actions.get("enterpictureinpicture")).toBeNull();
  expect(mock.client.leave).toHaveBeenCalledTimes(1);
});

it("closes a PiP request resolving after the call unmounts without orphaning call media", async () => {
  const { pip, requestWindow, actions } = mockPictureInPicture();
  let openWindow!: (window: Window) => void;
  requestWindow.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        openWindow = resolve;
      }),
  );
  const view = render(<ZoomCall requestToken={requestToken} />);
  await ready();
  await join();
  fireEvent.click(screen.getByText(locale.zoom__picture_in_picture));
  view.unmount();
  await act(async () => openWindow(pip as unknown as Window));
  expect(pip.close).toHaveBeenCalledTimes(1);
  expect(pip.document.body.childElementCount).toBe(0);
  expect(actions.get("enterpictureinpicture")).toBeNull();
  await waitFor(() => expect(mock.sdk.destroyClient).toHaveBeenCalledTimes(1));
});

it("keeps the call usable when native PiP is unavailable or a window request is denied", async () => {
  const view = render(<ZoomCall requestToken={requestToken} />);
  await ready();
  await join();
  expect(
    screen.getByText(locale.zoom__picture_in_picture_unavailable),
  ).toBeTruthy();
  expect(screen.queryByText(locale.zoom__picture_in_picture)).toBeNull();
  view.unmount();

  const { requestWindow, mediaSession } = mockPictureInPicture();
  mediaSession.setActionHandler.mockImplementation(() => {
    throw new DOMException("Unsupported action", "NotSupportedError");
  });
  requestWindow.mockRejectedValueOnce(
    new DOMException("Blocked", "NotAllowedError"),
  );
  render(<ZoomCall requestToken={requestToken} />);
  await ready();
  await join();
  fireEvent.click(screen.getByText(locale.zoom__picture_in_picture));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    locale.zoom__picture_in_picture_failed,
  );
  expect(screen.getByText("Leave")).toBeTruthy();
  fireEvent.click(screen.getByText(locale.zoom__picture_in_picture));
  await screen.findByText(locale.zoom__call_in_picture_in_picture);
  expect(requestWindow).toHaveBeenCalledTimes(2);
});

it("checks devices locally, mints only on Join, starts audio from a separate click and keeps the token out of storage", async () => {
  render(<ZoomCall requestToken={requestToken} />);
  await ready();
  expect(requestToken).not.toHaveBeenCalled();
  expect(screen.getByRole("progressbar")).toHaveProperty("value", 0);
  expect(screen.getByText(locale.zoom__mic_check_hint)).toBeTruthy();
  expect(mock.sdk.createLocalAudioTrack).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Check camera"));
  await screen.findByText("Stop camera");
  fireEvent.click(screen.getByText("Check microphone"));
  await screen.findByText("Stop microphone check");
  await waitFor(() =>
    expect(screen.getByRole("progressbar")).toHaveProperty("value", 30),
  );
  await join();
  expect(mock.camera.stop).toHaveBeenCalled();
  expect(mock.microphone.stop).toHaveBeenCalled();
  expect(mock.client.join).toHaveBeenCalledWith(
    token.session_name,
    token.token,
    token.display_name,
  );
  expect(mock.stream.attachVideo).toHaveBeenCalledWith(1, 2);
  expect(mock.stream.startAudio).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Enable audio"));
  await screen.findByText("Mute");
  fireEvent.click(screen.getByText("Mute"));
  await screen.findByText("Unmute");
  expect(localStorage.length).toBe(0);
  expect(window.location.href).not.toContain(token.token);
  expect(mock.client.init).toHaveBeenCalledWith(
    "en-US",
    "Global",
    expect.objectContaining({ isLogDetailed: false }),
  );
});

it("groups live device selectors, switches active media, and dismisses the panel with Escape or an outside click", async () => {
  vi.stubGlobal(
    "AudioContext",
    class {
      setSinkId() {}
    },
  );
  mock.sdk.getDevices.mockResolvedValue([
    { kind: "videoinput", deviceId: "camera-1", label: "Camera one" },
    { kind: "audioinput", deviceId: "mic-1", label: "Mic one" },
    { kind: "audiooutput", deviceId: "speaker-1", label: "Speaker one" },
  ]);
  render(<ZoomCall requestToken={requestToken} />);
  await ready();
  await join();
  const audioSettings = screen.getByRole("button", {
    name: "Microphone and speaker settings",
  });
  const cameraSettings = screen.getByRole("button", {
    name: "Camera settings",
  });
  fireEvent.click(audioSettings);
  const microphone = screen.getByLabelText("Microphone", {
    selector: "select",
  });
  expect(document.activeElement).toBe(microphone);
  expect(audioSettings.getAttribute("aria-expanded")).toBe("true");
  expect(screen.queryByLabelText("Camera", { selector: "select" })).toBeNull();
  expect(
    document.getElementById(audioSettings.getAttribute("aria-controls")!),
  ).toBeTruthy();
  fireEvent.change(microphone, { target: { value: "mic-1" } });
  await waitFor(() => expect(microphone).toHaveProperty("value", "mic-1"));
  expect(mock.stream.switchMicrophone).not.toHaveBeenCalled();
  fireEvent.keyDown(microphone, { key: "Escape" });
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(document.activeElement).toBe(audioSettings);
  fireEvent.click(screen.getByText("Enable audio"));
  await screen.findByText("Mute");
  expect(mock.stream.startAudio).toHaveBeenCalledWith({
    microphoneId: "mic-1",
    speakerId: undefined,
  });
  fireEvent.click(audioSettings);
  fireEvent.change(
    screen.getByLabelText("Microphone", { selector: "select" }),
    { target: { value: "" } },
  );
  await waitFor(() =>
    expect(mock.stream.switchMicrophone).toHaveBeenCalledWith("mic-1"),
  );
  fireEvent.change(screen.getByLabelText("Speaker", { selector: "select" }), {
    target: { value: "speaker-1" },
  });
  await waitFor(() =>
    expect(mock.stream.switchSpeaker).toHaveBeenCalledWith("speaker-1"),
  );
  fireEvent.click(cameraSettings);
  expect(
    screen.queryByLabelText("Microphone", { selector: "select" }),
  ).toBeNull();
  expect(audioSettings.getAttribute("aria-expanded")).toBe("false");
  fireEvent.keyDown(screen.getByLabelText("Camera", { selector: "select" }), {
    key: "Escape",
  });
  expect(document.activeElement).toBe(cameraSettings);
  fireEvent.click(screen.getByText("Start camera"));
  await screen.findByText("Stop camera");
  fireEvent.click(cameraSettings);
  fireEvent.change(screen.getByLabelText("Camera", { selector: "select" }), {
    target: { value: "camera-1" },
  });
  await waitFor(() =>
    expect(mock.stream.switchCamera).toHaveBeenCalledWith("camera-1"),
  );
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(cameraSettings.getAttribute("aria-expanded")).toBe("false");
});
it("reports denied camera access and still permits joining without video", async () => {
  mock.camera.start.mockRejectedValueOnce(
    new DOMException("denied", "NotAllowedError"),
  );
  render(<ZoomCall requestToken={requestToken} />);
  await ready();
  fireEvent.click(screen.getByText("Check camera"));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    locale.zoom__media_denied,
  );
  await join();
  expect(mock.stream.startVideo).not.toHaveBeenCalled();
});
it("does not mistake resolved SDK errors for a successful audio connection", async () => {
  mock.stream.startAudio.mockResolvedValueOnce({
    type: "INTERNAL_ERROR",
    reason: "unavailable",
  } as never);
  render(<ZoomCall requestToken={requestToken} />);
  await ready();
  await join();
  fireEvent.click(screen.getByText("Enable audio"));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    locale.zoom__media_failed,
  );
  expect(screen.getByText("Enable audio")).toBeTruthy();
});
it("recovers connection feedback and cleans all listeners and media after host termination", async () => {
  render(<ZoomCall requestToken={requestToken} />);
  await ready();
  await join();
  act(() =>
    mock.listeners.get("connection-change")?.({ state: "Reconnecting" }),
  );
  expect(
    screen.getByText("Connection interrupted. Reconnecting…"),
  ).toBeTruthy();
  act(() => mock.listeners.get("connection-change")?.({ state: "Connected" }));
  await waitFor(() =>
    expect(
      screen.queryByText("Connection interrupted. Reconnecting…"),
    ).toBeNull(),
  );
  act(() =>
    mock.listeners.get("connection-change")?.({
      state: "Closed",
      reason: "ended by host",
    }),
  );
  expect(
    await screen.findByText("The practitioner ended the call."),
  ).toBeTruthy();
  await waitFor(() => expect(mock.sdk.destroyClient).toHaveBeenCalled());
  expect(mock.listeners.size).toBe(0);
  expect(mock.stream.stopVideo).toHaveBeenCalled();
  expect(mock.stream.stopAudio).toHaveBeenCalled();
});
it("only the server-authorized practitioner gets End and can reclaim host before ending", async () => {
  mock.client.isHost.mockReturnValue(false);
  render(<ZoomCall requestToken={requestToken} />);
  await ready();
  await join();
  fireEvent.click(screen.getByText("End for everyone"));
  await screen.findByText("The call has ended for everyone.");
  expect(mock.client.reclaimHost).toHaveBeenCalled();
  expect(mock.client.leave).toHaveBeenCalledWith(true);
  cleanup();
  requestToken.mockResolvedValue({ ...token, role: "participant" });
  render(<ZoomCall requestToken={requestToken} />);
  await ready();
  await join();
  expect(screen.queryByText("End for everyone")).toBeNull();
});
it("cleans an in-flight join on unmount and initializes a StrictMode mount only after cleanup", async () => {
  let joined!: (result: typeof mock.user) => void;
  mock.client.join.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        joined = resolve;
      }),
  );
  const view = render(
    <StrictMode>
      <ZoomCall requestToken={requestToken} />
    </StrictMode>,
  );
  await ready();
  fireEvent.click(screen.getByText("Join video call"));
  await waitFor(() => expect(mock.client.join).toHaveBeenCalled());
  view.unmount();
  await act(async () => joined(mock.user));
  await waitFor(() => expect(mock.sdk.destroyClient).toHaveBeenCalled());
  expect(mock.client.leave).toHaveBeenCalled();
  expect(mock.listeners.size).toBe(0);
});
it("reauthorizes each return to the call and reports an expired CARE session", async () => {
  render(<ZoomCall requestToken={requestToken} />);
  await ready();
  await join();
  fireEvent.click(screen.getByText("Leave"));
  await screen.findByText("You left the call.");
  requestToken.mockRejectedValueOnce({ status: 401 });
  fireEvent.click(screen.getByText("Return to device check"));
  await ready();
  fireEvent.click(screen.getByText("Join video call"));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    locale.zoom__session_expired,
  );
  expect(requestToken).toHaveBeenCalledTimes(2);
});

it("switches devices only when active and renders/detaches remote participants", async () => {
  render(<ZoomCall requestToken={requestToken} />);
  await ready();
  fireEvent.change(screen.getByLabelText("Camera", { selector: "select" }), {
    target: { value: "camera-1" },
  });
  await waitFor(() =>
    expect(
      screen.getByLabelText("Camera", { selector: "select" }),
    ).toHaveProperty("value", "camera-1"),
  );
  expect(mock.stream.switchCamera).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Check camera"));
  await screen.findByText("Stop camera");
  fireEvent.change(screen.getByLabelText("Camera", { selector: "select" }), {
    target: { value: "" },
  });
  await waitFor(() =>
    expect(mock.camera.switchCamera).toHaveBeenCalledWith("camera-1"),
  );
  await join();
  const patient = {
    ...mock.user,
    userId: 2,
    displayName: "Patient",
    bVideoOn: true,
  };
  mock.client.getAllUser.mockReturnValueOnce([mock.user, patient]);
  act(() => mock.listeners.get("user-added")?.([patient]));
  await waitFor(() =>
    expect(mock.stream.attachVideo).toHaveBeenCalledWith(2, 2),
  );
  expect(screen.getByText("Patient")).toBeTruthy();
  const gallery = document.querySelector(".zoom-gallery")!;
  expect(gallery.getAttribute("data-remotes")).toBe("1");
  expect(gallery.firstElementChild?.getAttribute("data-self")).toBe("false");
  expect(gallery.lastElementChild?.getAttribute("data-self")).toBe("true");
  act(() => mock.listeners.get("user-removed")?.([patient]));
  await waitFor(() => expect(screen.queryByText("Patient")).toBeNull());
  expect(gallery.getAttribute("data-remotes")).toBe("0");
  expect(mock.stream.detachVideo).toHaveBeenCalledWith(2);
});
it("handles a resolved join failure without entering a session", async () => {
  mock.client.join.mockResolvedValueOnce({
    type: "INVALID_PARAMETERS",
    reason: "invalid token",
    errorCode: 5013,
  } as never);
  render(<ZoomCall requestToken={requestToken} />);
  await ready();
  fireEvent.click(screen.getByText("Join video call"));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    locale.zoom__join_failed,
  );
  expect(screen.getByText("Ready to join?")).toBeTruthy();
  expect(screen.queryByText("End for everyone")).toBeNull();
  expect(console.error).toHaveBeenCalledExactlyOnceWith(
    "[care_zoom] Operation failed",
    { operation: "join", type: "INVALID_PARAMETERS", errorCode: 5013 },
  );
});

it("tears down only once when Closed fires during Leave, then unmounts", async () => {
  mock.client.leave.mockImplementationOnce(async () => {
    mock.listeners.get("connection-change")?.({ state: "Closed" });
    return "";
  });
  const view = render(<ZoomCall requestToken={requestToken} />);
  await ready();
  await join();
  fireEvent.click(screen.getByText("Leave"));
  await screen.findByText("You left the call.");
  view.unmount();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(mock.sdk.destroyClient).toHaveBeenCalledTimes(1);
  expect(mock.client.leave).toHaveBeenCalledTimes(1);
});
it("waits for delayed teardown before creating the next singleton", async () => {
  let finishDestroy!: () => void;
  mock.sdk.destroyClient.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishDestroy = resolve;
      }),
  );
  const view = render(<ZoomCall requestToken={requestToken} />);
  await ready();
  await join();
  fireEvent.click(screen.getByText("Leave"));
  await waitFor(() => expect(mock.sdk.destroyClient).toHaveBeenCalledTimes(1));
  view.unmount();
  render(<ZoomCall requestToken={requestToken} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(mock.sdk.createClient).toHaveBeenCalledTimes(1);
  await act(async () => finishDestroy());
  await ready();
  expect(mock.sdk.createClient).toHaveBeenCalledTimes(2);
  expect(mock.sdk.destroyClient).toHaveBeenCalledTimes(1);
});
it("offers appointment recovery when staff token rejection uses 403 token_not_valid", async () => {
  requestToken.mockRejectedValueOnce({ status: 403, code: "token_not_valid" });
  const onExit = vi.fn();
  render(<ZoomCall requestToken={requestToken} onExit={onExit} />);
  await ready();
  fireEvent.click(screen.getByText("Join video call"));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    locale.zoom__session_expired,
  );
  fireEvent.click(screen.getByText("Back to appointment"));
  expect(onExit).toHaveBeenCalled();
});

it("detaches an in-flight participant render before releasing an unmounted call", async () => {
  let finishAttach!: (node: HTMLElement) => void;
  mock.stream.attachVideo.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishAttach = resolve;
      }),
  );
  const view = render(<ZoomCall requestToken={requestToken} />);
  await ready();
  await join();
  const patient = {
    ...mock.user,
    userId: 2,
    displayName: "Patient",
    bVideoOn: true,
  };
  mock.client.getAllUser.mockReturnValueOnce([mock.user, patient]);
  act(() => mock.listeners.get("user-added")?.([patient]));
  await waitFor(() =>
    expect(mock.stream.attachVideo).toHaveBeenCalledWith(2, 2),
  );
  view.unmount();
  const node = document.createElement("video-player");
  await act(async () => finishAttach(node));
  await waitFor(() => expect(mock.sdk.destroyClient).toHaveBeenCalledTimes(1));
  expect(node.isConnected).toBe(false);
  expect(mock.stream.detachVideo).toHaveBeenCalledWith(2);
});

it("accepts the participant object returned by a successful SDK join", async () => {
  render(<ZoomCall requestToken={requestToken} />);
  await ready();
  await join();
  expect(screen.getByText("End for everyone")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(console.error).not.toHaveBeenCalled();
});

it("keeps a successful session open when rendering fails and logs only safe diagnostics", async () => {
  const failure = new TypeError(
    "private participant details and token: secret-memory-only",
  );
  mock.client.getAllUser.mockImplementationOnce(() => {
    throw failure;
  });
  render(<ZoomCall requestToken={requestToken} />);
  await ready();
  await join();
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    locale.zoom__media_failed,
  );
  expect(screen.getByText("End for everyone")).toBeTruthy();
  expect(console.error).toHaveBeenCalledExactlyOnceWith(
    "[care_zoom] Operation failed",
    { operation: "refresh-media", name: "TypeError" },
  );
});

it("logs initialization failures without arbitrary SDK reason, payload or token values", async () => {
  mock.client.init.mockRejectedValueOnce({
    type: "INTERNAL_ERROR",
    errorCode: 2,
    reason: "private participant details",
    token: token.token,
    payload: { sessionName: token.session_name },
  });
  render(<ZoomCall requestToken={requestToken} />);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    locale.zoom__sdk_failed,
  );
  expect(console.error).toHaveBeenCalledExactlyOnceWith(
    "[care_zoom] Operation failed",
    { operation: "initialize", type: "INTERNAL_ERROR", errorCode: 2 },
  );
});

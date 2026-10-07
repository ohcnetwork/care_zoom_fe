import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, expect, it, vi } from "vitest";
import { useCallPictureInPicture } from "../src/hooks/useCallPictureInPicture";

function Call() {
  const pip = useCallPictureInPicture(true);
  return (
    <>
      <button onClick={() => void pip.open()}>Pop out</button>
      <div ref={pip.mount} data-testid="call-mount" />
      {createPortal(
        <>
          <video data-testid="call-video" />
          <button onClick={pip.close}>Return to call</button>
        </>,
        pip.container,
      )}
      <span>{pip.active ? "Floating" : "In tab"}</span>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("moves live media into compact native PiP and restores it through the existing control", async () => {
  const pip = Object.assign(new EventTarget(), {
    document: document.implementation.createHTMLDocument("Call"),
    closed: false,
    close: vi.fn(() => {
      pip.closed = true;
      pip.dispatchEvent(new Event("pagehide"));
    }),
  });
  const requestWindow = vi.fn(async () => pip as unknown as Window);
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("documentPictureInPicture", { requestWindow });
  render(<Call />);
  const video = screen.getByTestId("call-video");
  fireEvent.click(screen.getByText("Pop out"));
  await screen.findByText("Floating");
  expect(requestWindow).toHaveBeenCalledWith({ width: 400, height: 300 });
  expect(pip.document.querySelector("video")).toBe(video);
  expect(video.parentElement?.classList.contains("care-zoom-native-pip")).toBe(
    true,
  );
  expect(pip.document.body.style.padding).toBe("0px");
  expect(pip.document.body.style.background).toBe("rgb(23, 23, 23)");

  act(() => {
    window.dispatchEvent(new Event("focus"));
    pip.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(pip.close).not.toHaveBeenCalled();
  expect(pip.document.querySelector("video")).toBe(video);

  act(() => within(pip.document.body).getByText("Return to call").click());
  expect(screen.getByText("In tab")).toBeTruthy();
  expect(screen.getByTestId("call-mount").contains(video)).toBe(true);
  expect(video.parentElement?.classList.contains("care-zoom-native-pip")).toBe(
    false,
  );
  expect(pip.close).toHaveBeenCalledTimes(1);
});

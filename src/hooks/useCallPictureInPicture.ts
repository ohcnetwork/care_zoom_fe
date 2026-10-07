import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type PictureInPictureAPI = {
  requestWindow: (options: {
    width: number;
    height: number;
  }) => Promise<Window>;
};

export function useCallPictureInPicture(enabled: boolean) {
  const mount = useRef<HTMLDivElement>(null);
  // Keep the React portal target stable while moving its live SDK nodes between documents.
  const [container] = useState(() => {
    const element = document.createElement("div");
    element.className = "care-zoom-container";
    return element;
  });
  const api = (
    window as Window & { documentPictureInPicture?: PictureInPictureAPI }
  ).documentPictureInPicture;
  const supported = Boolean(window.isSecureContext && api?.requestWindow);
  const [active, setActive] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const restore = useRef<(() => void) | undefined>(undefined);

  const close = useCallback(() => restore.current?.(), []);

  useLayoutEffect(() => {
    mount.current?.append(container);
    return () => {
      close();
      container.remove();
    };
  }, [close, container]);

  const open = useCallback(async () => {
    if (!enabled || !supported || !api || pending.current || restore.current)
      return;
    pending.current = true;
    setFailed(false);
    const requestGeneration = generation.current;
    let openedWindow: Window | undefined;
    try {
      // Called directly from a click or the browser's Media Session action, preserving activation.
      const pip = await api.requestWindow({ width: 400, height: 300 });
      openedWindow = pip;
      if (generation.current !== requestGeneration || !mount.current) {
        pip.close();
        return;
      }
      pip.document.title = document.title;
      pip.document.documentElement.lang = document.documentElement.lang;
      pip.document.documentElement.dir = document.documentElement.dir;
      pip.document.documentElement.style.colorScheme = "dark";
      const base = document.createElement("base");
      base.href = document.baseURI;
      pip.document.head.append(base);
      document
        .querySelectorAll('style, link[rel="stylesheet"]')
        .forEach((style) => {
          const copy = style.cloneNode(true) as HTMLElement;
          if (style instanceof HTMLLinkElement)
            copy.setAttribute("href", style.href);
          pip.document.head.append(copy);
        });
      Object.assign(pip.document.body.style, {
        margin: "0",
        padding: "0",
        height: "100vh",
        overflow: "hidden",
        background: "#171717",
        fontFamily: getComputedStyle(container).fontFamily,
      });
      const restoreToTab = () => {
        pip.removeEventListener("pagehide", restoreToTab);
        container.classList.remove("care-zoom-native-pip");
        mount.current?.append(container);
        restore.current = undefined;
        setActive(false);
        if (!pip.closed) pip.close();
      };
      restore.current = restoreToTab;
      pip.addEventListener("pagehide", restoreToTab);
      container.classList.add("care-zoom-native-pip");
      pip.document.body.append(container);
      setActive(true);
    } catch {
      openedWindow?.close();
      if (generation.current === requestGeneration) setFailed(true);
    } finally {
      if (generation.current === requestGeneration) pending.current = false;
    }
  }, [api, container, enabled, supported]);

  useEffect(() => {
    if (!enabled) {
      close();
      setFailed(false);
    }
    let registered = false;
    // Chrome also requires HTTPS (or file:); HTTP localhost supports only manual PiP.
    // Capture state and the user's Auto PiP setting determine the remaining eligibility.
    // visibilitychange alone cannot open a native window because it lacks user activation.
    const action = "enterpictureinpicture" as MediaSessionAction;
    if (enabled && supported && navigator.mediaSession) {
      try {
        navigator.mediaSession.setActionHandler(action, () => void open());
        registered = true;
      } catch {
        // Manual Document PiP remains available when the automatic action is unsupported.
      }
    }
    return () => {
      generation.current += 1;
      pending.current = false;
      if (registered) navigator.mediaSession.setActionHandler(action, null);
    };
  }, [close, enabled, open, supported]);

  return { mount, container, supported, active, failed, open, close };
}

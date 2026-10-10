import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type ZoomVideo from "@zoom/videosdk";
import type {
  ConnectionChangePayload,
  LocalAudioTrack,
  LocalVideoTrack,
} from "@zoom/videosdk";
import {
  ChevronUp,
  Mic,
  MicOff,
  Maximize2,
  PhoneOff,
  PictureInPicture2,
  Signal,
  Users,
  Video,
  VideoOff,
  WifiOff,
} from "lucide-react";
import type { JoinToken } from "../types";
import { useCallPictureInPicture } from "../hooks/useCallPictureInPicture";
import { ZoomCallSkeleton } from "./LoadingSkeletons";
import { Button } from "./ui/button";

type SDK = typeof ZoomVideo;
type Client = ReturnType<SDK["createClient"]>;
type Stream = ReturnType<Client["getMediaStream"]>;
type SDKListener = Parameters<Client["off"]>[1];
type Tile = {
  figure: HTMLElement;
  container: HTMLElement;
  caption: HTMLElement;
  avatar: HTMLElement;
  attached: boolean;
};
type Runtime = {
  sdk: SDK;
  client: Client;
  stream?: Stream;
  joined: boolean;
  disposed: boolean;
  unmounted?: boolean;
  cleanup?: Promise<void>;
  queue: Promise<void>;
  listeners: [string, SDKListener][];
  camera?: LocalVideoTrack;
  microphone?: LocalAudioTrack;
  tiles: Map<number, Tile>;
};
type Phase =
  | "loading"
  | "prejoin"
  | "joining"
  | "connected"
  | "reconnecting"
  | "ended";

// The SDK owns one client per browser page. A new mount must wait for the previous teardown.
let previousCleanup: Promise<void> = Promise.resolve();

const sdkErrorTypes = new Set([
  "INVALID_OPERATION",
  "INTERNAL_ERROR",
  "OPERATION_TIMEOUT",
  "INSUFFICIENT_PRIVILEGES",
  "IMPROPER_MEETING_STATE",
  "INVALID_PARAMETERS",
  "OPERATION_LOCKED",
  "OPERATION_CANCELLED",
  "JOIN_MEETING_FAILED",
]);
function reportFailure(operation: string, cause: unknown) {
  const detail = cause as { type?: string; errorCode?: number } | null;
  // Never log SDK payloads, reasons, tokens or participant information.
  console.error("[care_zoom] Operation failed", {
    operation,
    ...(detail?.type && sdkErrorTypes.has(detail.type)
      ? { type: detail.type }
      : {}),
    ...(Number.isInteger(detail?.errorCode)
      ? { errorCode: detail!.errorCode }
      : {}),
    ...(cause instanceof Error &&
    [
      "Error",
      "TypeError",
      "RangeError",
      "NotAllowedError",
      "NotFoundError",
      "NotReadableError",
      "AbortError",
      "SecurityError",
      "InvalidStateError",
      "OverconstrainedError",
      "NotSupportedError",
    ].includes(cause.name)
      ? { name: cause.name }
      : {}),
  });
}
async function checked(result: Promise<unknown>) {
  const value = await result;
  // SDK 2.5.0 join resolves with a participant, despite its declared empty-string result.
  if (
    value &&
    typeof value === "object" &&
    "type" in value &&
    typeof value.type === "string" &&
    sdkErrorTypes.has(value.type) &&
    "reason" in value &&
    typeof value.reason === "string"
  )
    throw value;
}
async function stopPreview(runtime: Runtime) {
  await Promise.allSettled([
    runtime.camera?.stop(),
    runtime.microphone?.stop(),
  ]);
  runtime.camera = undefined;
  runtime.microphone = undefined;
}
async function detach(runtime: Runtime, userId: number) {
  try {
    const nodes = await runtime.stream?.detachVideo(userId);
    (Array.isArray(nodes) ? nodes : nodes ? [nodes] : []).forEach((node) =>
      node.remove(),
    );
  } finally {
    const tile = runtime.tiles.get(userId);
    if (tile) {
      tile.container.replaceChildren();
      tile.attached = false;
    }
  }
}
function release(runtime: Runtime): Promise<void> {
  if (runtime.cleanup) return runtime.cleanup;
  runtime.disposed = true;
  runtime.cleanup = (async () => {
    runtime.listeners.forEach(([event, listener]) =>
      runtime.client.off(event, listener),
    );
    runtime.listeners = [];
    await stopPreview(runtime);
    if (runtime.stream) {
      await Promise.allSettled(
        [...runtime.tiles.keys()].map((id) => detach(runtime, id)),
      );
      await Promise.allSettled([
        runtime.stream.stopVideo(),
        runtime.stream.stopAudio(),
      ]);
    }
    runtime.tiles.forEach((tile) => tile.figure.remove());
    runtime.tiles.clear();
    if (runtime.joined) {
      await runtime.client.leave().catch(() => undefined);
      runtime.joined = false;
    }
    await runtime.sdk.destroyClient();
  })();
  return runtime.cleanup;
}
function isMobileCamera() {
  return (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase();
}

export type ZoomCallHandle = { openPictureInPicture: () => Promise<void> };

export default function ZoomCall({
  ref,
  requestToken,
  onExit,
  patientName,
  practitionerName,
}: {
  ref?: Ref<ZoomCallHandle>;
  requestToken: () => Promise<JoinToken>;
  onExit?: () => void;
  patientName?: string;
  practitionerName?: string;
}) {
  const { t } = useTranslation();
  const runtime = useRef<Runtime | undefined>(undefined);
  const preview = useRef<HTMLVideoElement>(null);
  const gallery = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [microphoneId, setMicrophoneId] = useState("");
  const [speakerId, setSpeakerId] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [checkingMic, setCheckingMic] = useState(false);
  const [prejoinDevicePanel, setPrejoinDevicePanel] = useState<
    "audio" | "camera" | null
  >(null);
  const [audioOn, setAudioOn] = useState(false);
  const [muted, setMuted] = useState(true);
  const [host, setHost] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const [devicePanel, setDevicePanel] = useState<"audio" | "camera" | null>(
    null,
  );
  const devicePanelRef = useRef<HTMLDivElement>(null);
  const audioSettingsRef = useRef<HTMLButtonElement>(null);
  const cameraSettingsRef = useRef<HTMLButtonElement>(null);
  const prejoinDevicePanelRef = useRef<HTMLDivElement>(null);
  const prejoinAudioTriggerRef = useRef<HTMLButtonElement>(null);
  const prejoinCameraTriggerRef = useRef<HTMLButtonElement>(null);
  const deviceSettingsId = useId();
  const [startedAt, setStartedAt] = useState<number>();
  const [elapsed, setElapsed] = useState(0);
  const connected = phase === "connected" || phase === "reconnecting";
  const pictureInPicture = useCallPictureInPicture(connected);
  useImperativeHandle(
    ref,
    () => ({ openPictureInPicture: pictureInPicture.open }),
    [pictureInPicture.open],
  );
  const speakerSelection =
    typeof AudioContext !== "undefined" &&
    "setSinkId" in AudioContext.prototype;
  const mobileCamera = isMobileCamera();
  const compact = pictureInPicture.active;
  const duration = `${Math.floor(elapsed / 60)
    .toString()
    .padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`;
  const callName = patientName || t("zoom__call_title");

  useEffect(() => {
    if (!connected || startedAt === undefined) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [connected, startedAt]);

  useEffect(() => {
    if (compact || !connected) setDevicePanel(null);
  }, [compact, connected]);

  useEffect(() => {
    if (!devicePanel || compact || !connected) return;
    const ownerDocument = devicePanelRef.current?.ownerDocument;
    devicePanelRef.current?.querySelector("select")?.focus();
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        !devicePanelRef.current?.contains(target) &&
        !audioSettingsRef.current?.contains(target) &&
        !cameraSettingsRef.current?.contains(target)
      )
        setDevicePanel(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setDevicePanel(null);
      (devicePanel === "audio"
        ? audioSettingsRef
        : cameraSettingsRef
      ).current?.focus();
    };
    ownerDocument?.addEventListener("pointerdown", dismiss);
    ownerDocument?.addEventListener("keydown", escape);
    return () => {
      ownerDocument?.removeEventListener("pointerdown", dismiss);
      ownerDocument?.removeEventListener("keydown", escape);
    };
  }, [devicePanel, compact, connected]);

  useEffect(() => {
    if (phase !== "prejoin") setPrejoinDevicePanel(null);
  }, [phase]);

  useEffect(() => {
    if (!prejoinDevicePanel || phase !== "prejoin") return;
    const ownerDocument = prejoinDevicePanelRef.current?.ownerDocument;
    prejoinDevicePanelRef.current?.querySelector("select")?.focus();
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        !prejoinDevicePanelRef.current?.contains(target) &&
        !prejoinAudioTriggerRef.current?.contains(target) &&
        !prejoinCameraTriggerRef.current?.contains(target)
      )
        setPrejoinDevicePanel(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPrejoinDevicePanel(null);
      (prejoinDevicePanel === "audio"
        ? prejoinAudioTriggerRef
        : prejoinCameraTriggerRef
      ).current?.focus();
    };
    ownerDocument?.addEventListener("pointerdown", dismiss);
    ownerDocument?.addEventListener("keydown", escape);
    return () => {
      ownerDocument?.removeEventListener("pointerdown", dismiss);
      ownerDocument?.removeEventListener("keydown", escape);
    };
  }, [prejoinDevicePanel, phase]);

  // ── Live audio level meter ────────────────────────────────────────────────
  // Drives the mic-check bar from a plain Web Audio analyser against the
  // selected device, independent of the SDK's own (unreliable before join)
  // volume reporting.
  const [micLevel, setMicLevel] = useState(0);
  const vizAudioCtxRef = useRef<AudioContext | null>(null);
  const vizAnimRef = useRef<number | null>(null);
  const vizStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!checkingMic) {
      if (vizAnimRef.current) cancelAnimationFrame(vizAnimRef.current);
      vizAudioCtxRef.current?.close();
      vizAudioCtxRef.current = null;
      vizStreamRef.current?.getTracks().forEach((track) => track.stop());
      vizStreamRef.current = null;
      setMicLevel(0);
      return;
    }

    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({
        audio: microphoneId ? { deviceId: { exact: microphoneId } } : true,
        video: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        vizStreamRef.current = stream;

        const ctx = new AudioContext();
        vizAudioCtxRef.current = ctx;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.75;
        ctx.createMediaStreamSource(stream).connect(analyser);

        const freqData = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          analyser.getByteFrequencyData(freqData);
          const average =
            freqData.reduce((sum, value) => sum + value, 0) / freqData.length;
          setMicLevel(Math.min(100, (average / 255) * 100));
          vizAnimRef.current = requestAnimationFrame(tick);
        };
        vizAnimRef.current = requestAnimationFrame(tick);
      })
      .catch(() => {
        /* mic permission denied – level stays at 0 */
      });

    return () => {
      cancelled = true;
      if (vizAnimRef.current) cancelAnimationFrame(vizAnimRef.current);
      vizAudioCtxRef.current?.close();
      vizAudioCtxRef.current = null;
      vizStreamRef.current?.getTracks().forEach((track) => track.stop());
      vizStreamRef.current = null;
    };
  }, [checkingMic, microphoneId]);

  function errorKey(cause: unknown, fallback = "zoom__media_failed") {
    const detail = cause as {
      name?: string;
      reason?: string;
      type?: string;
      status?: number;
      code?: string;
    } | null;
    if (detail?.status === 401 || detail?.code === "token_not_valid")
      return "zoom__session_expired";
    if (detail?.status && [403, 404, 409].includes(detail.status))
      return "zoom__unavailable";
    const code = `${detail?.name} ${detail?.reason} ${detail?.type}`;
    if (/NotAllowed|PERMISSION|FORBIDDEN|denied/i.test(code))
      return "zoom__media_denied";
    if (/NotFound|NOT_DETECT|NOT_FIND/i.test(code))
      return "zoom__device_missing";
    return fallback;
  }
  function run(
    operation: string,
    action: (current: Runtime) => Promise<void>,
    failure?: string,
    background = false,
  ) {
    const current = runtime.current;
    if (!current || current.disposed) return;
    if (!background) {
      setBusy(true);
      setError("");
    }
    const task = current.queue.then(async () => {
      if (!current.disposed) await action(current);
    });
    current.queue = task
      .catch((cause) => {
        const afterJoin = failure === "zoom__join_failed" && current.joined;
        reportFailure(afterJoin ? "refresh-media" : operation, cause);
        if (!current.disposed)
          setError(errorKey(cause, afterJoin ? "zoom__media_failed" : failure));
      })
      .finally(() => {
        if (!current.disposed && !background) setBusy(false);
      });
  }
  async function refreshDevices(current: Runtime) {
    if (current.disposed) return;
    const list = await current.sdk.getDevices(true);
    if (!current.disposed) {
      setDevices(list);
      if (!mobileCamera)
        setCameraId((value) =>
          list.some((device) => device.deviceId === value) ? value : "",
        );
      setMicrophoneId((value) =>
        list.some((device) => device.deviceId === value) ? value : "",
      );
      setSpeakerId((value) =>
        list.some((device) => device.deviceId === value) ? value : "",
      );
    }
  }
  async function refreshParticipants(current: Runtime) {
    if (
      !current.joined ||
      current.disposed ||
      !current.stream ||
      !gallery.current
    )
      return;
    const users = current.client.getAllUser();
    setParticipantCount(users.length);
    const self = current.client.getCurrentUserInfo();
    setCameraOn(self.bVideoOn);
    setAudioOn(Boolean(self.audio));
    setMuted(self.muted ?? true);
    const shown = [
      ...users.filter((user) => user.userId !== self.userId),
      ...users.filter((user) => user.userId === self.userId),
    ].slice(0, current.stream.getMaxRenderableVideos());
    gallery.current.dataset.remotes = String(
      shown.filter((user) => user.userId !== self.userId).length,
    );
    for (const [id, tile] of current.tiles) {
      if (!shown.some((user) => user.userId === id)) {
        if (tile.attached) await detach(current, id);
        tile.figure.remove();
        current.tiles.delete(id);
      }
    }
    for (const user of shown) {
      if (current.disposed || !gallery.current) return;
      let tile = current.tiles.get(user.userId);
      if (!tile) {
        const figure = document.createElement("figure");
        figure.className = "zoom-participant";
        const container = document.createElement("video-player-container");
        container.className = "zoom-participant-video";
        const placeholder = document.createElement("div");
        placeholder.className = "zoom-participant-placeholder";
        const avatar = document.createElement("span");
        avatar.className = "zoom-avatar";
        const cameraOff = document.createElement("span");
        cameraOff.textContent = t("zoom__camera_off");
        placeholder.append(avatar, cameraOff);
        const caption = document.createElement("figcaption");
        caption.className = "zoom-participant-caption";
        figure.append(placeholder, container, caption);
        gallery.current.insertBefore(
          figure,
          user.userId === self.userId
            ? null
            : gallery.current.querySelector('[data-self="true"]'),
        );
        tile = { figure, container, caption, avatar, attached: false };
        current.tiles.set(user.userId, tile);
      }
      tile.figure.dataset.self = String(user.userId === self.userId);
      tile.figure.dataset.video = String(user.bVideoOn);
      tile.figure.dataset.muted = String(!user.audio || user.muted);
      tile.avatar.textContent = initials(user.displayName);
      tile.avatar.setAttribute("aria-hidden", "true");
      tile.caption.textContent =
        user.userId === self.userId
          ? `${t("zoom__you")} · ${user.displayName}`
          : user.displayName;
      tile.container.setAttribute("aria-label", user.displayName);
      if (user.bVideoOn && !tile.attached) {
        const player = await current.stream.attachVideo(user.userId, 2);
        if (!(player instanceof HTMLElement)) throw player;
        if (current.disposed) {
          player.remove();
          return;
        }
        Object.assign(player.style, {
          width: "100%",
          height: "100%",
          aspectRatio: "16/9",
        });
        tile.container.append(player);
        tile.attached = true;
      } else if (!user.bVideoOn && tile.attached)
        await detach(current, user.userId);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let current: Runtime | undefined;
    const predecessor = previousCleanup;
    const devicesChanged = () =>
      run("refresh-devices", refreshDevices, undefined, true);
    setPhase("loading");
    setBusy(false);
    setError("");
    setNotice("");
    setHost(false);
    setCameraOn(false);
    setCheckingMic(false);
    setPrejoinDevicePanel(null);
    setAudioOn(false);
    setMuted(true);
    setDevicePanel(null);
    setStartedAt(undefined);
    setElapsed(0);
    const boot = (async () => {
      await predecessor;
      const { default: sdk } = await import("@zoom/videosdk");
      if (cancelled) return;
      const support = sdk.checkSystemRequirements();
      if (!support.audio || !support.video || !window.isSecureContext)
        throw new Error("unsupported");
      current = {
        sdk,
        client: sdk.createClient(),
        queue: Promise.resolve(),
        listeners: [],
        tiles: new Map(),
        joined: false,
        disposed: false,
      };
      runtime.current = current;
      await checked(
        current.client.init("en-US", "Global", {
          patchJsMedia: true,
          enforceMultipleVideos: true,
          isLogDetailed: false,
          leaveOnPageUnload: true,
        }),
      );
      if (cancelled) return;
      const enqueueRefresh = () =>
        run("refresh-participants", refreshParticipants, undefined, true);
      const connection = (event: ConnectionChangePayload) => {
        if (!current || current.disposed) return;
        if (event.state === "Reconnecting") {
          setPhase("reconnecting");
          setNotice("zoom__reconnecting");
        } else if (event.state === "Connected" && current.joined) {
          setPhase("connected");
          setNotice("");
          enqueueRefresh();
        } else if (event.state === "Closed" || event.state === "Fail") {
          setPhase("ended");
          setNotice(
            event.reason === "ended by host"
              ? "zoom__ended_by_host"
              : "zoom__disconnected",
          );
          run("disconnect", async (active) => {
            await release(active);
            if (!active.unmounted) setBusy(false);
          });
        }
      };
      const listen = (event: string, listener: SDKListener) => {
        current!.client.on(event, listener);
        current!.listeners.push([event, listener]);
      };
      listen("connection-change", connection);
      [
        "user-added",
        "user-updated",
        "user-removed",
        "peer-video-state-change",
        "current-audio-change",
        "video-capturing-change",
      ].forEach((event) => listen(event, enqueueRefresh));
      listen("auto-play-audio-failed", () => {
        setAudioOn(false);
      });
      listen("active-media-failed", () => {
        setError("zoom__media_failed");
        enqueueRefresh();
      });
      listen("device-change", devicesChanged);
      navigator.mediaDevices?.addEventListener("devicechange", devicesChanged);
      await refreshDevices(current);
      if (!cancelled) setPhase("prejoin");
    })().catch(async (cause) => {
      reportFailure("initialize", cause);
      if (!cancelled) {
        setPhase("ended");
        setError("zoom__sdk_failed");
      }
      if (current && !current.disposed)
        await release(current).catch(() => undefined);
    });
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener(
        "devicechange",
        devicesChanged,
      );
      if (current) {
        current.unmounted = true;
        current.disposed = true;
        current.listeners.forEach(([event, listener]) =>
          current!.client.off(event, listener),
        );
        current.listeners = [];
      }
      previousCleanup = boot.then(async () => {
        if (!current) return;
        await current.queue;
        await release(current).catch(() => undefined);
      });
    };
    // A call mount owns its SDK instance; language changes must not disconnect the call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  function toggleCamera() {
    run("camera", async (current) => {
      if (current.joined) {
        await checked(
          cameraOn
            ? current.stream!.stopVideo()
            : current.stream!.startVideo({ cameraId: cameraId || undefined }),
        );
        await refreshParticipants(current);
      } else if (current.camera) {
        await checked(current.camera.stop());
        current.camera = undefined;
        if (!current.disposed) setCameraOn(false);
      } else {
        current.camera = current.sdk.createLocalVideoTrack(
          cameraId || undefined,
        );
        try {
          await checked(current.camera.start(preview.current!));
          if (!current.disposed) setCameraOn(true);
        } catch (cause) {
          await current.camera.stop().catch(() => undefined);
          current.camera = undefined;
          throw cause;
        }
      }
      await refreshDevices(current);
    });
  }
  function toggleMicCheck() {
    run("microphone-check", async (current) => {
      if (current.microphone) {
        await checked(current.microphone.stop());
        current.microphone = undefined;
        if (!current.disposed) setCheckingMic(false);
      } else {
        current.microphone = current.sdk.createLocalAudioTrack(
          microphoneId || undefined,
        );
        try {
          await checked(current.microphone.start());
          if (current.disposed) return;
          await checked(current.microphone.unmute());
          if (current.disposed) return;
          setCheckingMic(true);
        } catch (cause) {
          await current.microphone.stop().catch(() => undefined);
          current.microphone = undefined;
          throw cause;
        }
      }
      await refreshDevices(current);
    });
  }
  function join() {
    run(
      "join",
      async (current) => {
        const token = await requestToken(); // Keep the JWT only in this action and the SDK's memory.
        if (current.disposed) return;
        setPhase("joining");
        await stopPreview(current);
        if (current.disposed) return;
        setCheckingMic(false);
        try {
          await checked(
            current.client.join(
              token.session_name,
              token.token,
              token.display_name,
            ),
          );
        } catch (cause) {
          if (!current.disposed) {
            setPhase("prejoin");
            setCameraOn(false);
          }
          throw cause;
        }
        current.joined = true;
        current.stream = current.client.getMediaStream();
        if (current.disposed) return;
        setHost(token.role === "host");
        setStartedAt(Date.now());
        setPhase("connected");
        if (cameraOn) {
          try {
            await checked(
              current.stream.startVideo({ cameraId: cameraId || undefined }),
            );
          } catch (cause) {
            reportFailure("start-video", cause);
            if (!current.disposed) {
              setCameraOn(false);
              setError(errorKey(cause));
            }
          }
        }
        await refreshParticipants(current);
        await refreshDevices(current);
      },
      "zoom__join_failed",
    );
  }
  function toggleAudio() {
    run("audio", async (current) => {
      if (!audioOn)
        await checked(
          current.stream!.startAudio({
            microphoneId: microphoneId || undefined,
            speakerId: speakerSelection ? speakerId || undefined : undefined,
          }),
        );
      else
        await checked(
          muted ? current.stream!.unmuteAudio() : current.stream!.muteAudio(),
        );
      if (current.disposed) return;
      setNotice("");
      await refreshParticipants(current);
      await refreshDevices(current);
    });
  }
  function changeDevice(kind: "camera" | "microphone" | "speaker", id: string) {
    run("change-device", async (current) => {
      const deviceKind =
        kind === "camera"
          ? "videoinput"
          : kind === "microphone"
            ? "audioinput"
            : "audiooutput";
      const choices = devices.filter(
        (device) => device.kind === deviceKind && device.deviceId,
      );
      const selected =
        id ||
        (kind === "camera" && mobileCamera
          ? "user"
          : (choices.find((device) => device.deviceId === "default")
              ?.deviceId ?? choices[0]?.deviceId));
      if (!selected) throw { name: "NotFoundError" };
      if (kind === "camera") {
        if (current.joined && cameraOn)
          await checked(current.stream!.switchCamera(selected));
        else if (current.camera)
          await checked(current.camera.switchCamera(selected));
        if (!current.disposed) setCameraId(id);
      } else if (kind === "microphone") {
        if (current.joined && audioOn)
          await checked(current.stream!.switchMicrophone(selected));
        else if (current.microphone) {
          await checked(current.microphone.stop());
          if (current.disposed) return;
          current.microphone = current.sdk.createLocalAudioTrack(selected);
          await checked(current.microphone.start());
          if (current.disposed) return;
          await checked(current.microphone.unmute());
        }
        if (!current.disposed) setMicrophoneId(id);
      } else {
        if (current.joined && audioOn)
          await checked(current.stream!.switchSpeaker(selected));
        if (!current.disposed) setSpeakerId(id);
      }
    });
  }
  function leave(end = false) {
    run(
      "leave",
      async (current) => {
        if (end && !current.client.isHost())
          await checked(current.client.reclaimHost());
        if (end) await checked(current.client.leave(true));
        else await current.client.leave(false).catch(() => undefined);
        current.joined = false;
        await release(current);
        if (current.unmounted) return;
        setPhase("ended");
        setNotice(end ? "zoom__call_ended" : "zoom__call_left");
        setBusy(false);
      },
      "zoom__leave_failed",
    );
  }
  const cameraOptions = mobileCamera
    ? [
        { deviceId: "user", label: t("zoom__front_camera") },
        { deviceId: "environment", label: t("zoom__back_camera") },
      ]
    : devices.filter((device) => device.kind === "videoinput");
  // Device labels are blank until the browser has granted camera/mic access at
  // least once; only offer the switcher once there's something real to pick from.
  const hasMicDevices = devices.some(
    (device) => device.kind === "audioinput" && device.label,
  );
  const hasCameraDevices =
    mobileCamera ||
    devices.some((device) => device.kind === "videoinput" && device.label);
  function deviceSelect(
    kind: "camera" | "microphone" | "speaker",
    value: string,
    options: { deviceId: string; label: string }[],
  ) {
    // Chrome/Edge expose the active default as its own entry (id "default"/
    // "communications") for audio devices; cameras never get one, so fall
    // back to the first listed camera — that's the one actually in use.
    const defaultDevice =
      options.find((device) => device.deviceId === "default") ?? options[0];
    const defaultLabel = defaultDevice?.label.replace(/^default\s*-\s*/i, "");
    return (
      <label className="block space-y-1 text-sm font-medium">
        {t(`zoom__${kind}`)}
        <select
          aria-label={t(`zoom__${kind}`)}
          className="block h-9 w-full rounded-md border border-gray-400 bg-white px-3 text-sm text-gray-900 focus:border-primary-600 focus:ring-2 focus:ring-primary-600/30 focus:outline-hidden"
          value={value}
          disabled={busy || phase === "reconnecting"}
          onChange={(event) => changeDevice(kind, event.target.value)}
        >
          <option value="">
            {defaultLabel
              ? `${t("zoom__system_default")} (${defaultLabel})`
              : t("zoom__system_default")}
          </option>
          {options
            .filter(
              (device) =>
                device.deviceId &&
                device.deviceId !== "default" &&
                device.deviceId !== "communications",
            )
            .map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `${t(`zoom__${kind}`)} ${index + 1}`}
              </option>
            ))}
        </select>
      </label>
    );
  }
  const microphoneSelect = deviceSelect(
    "microphone",
    microphoneId,
    devices.filter((device) => device.kind === "audioinput"),
  );
  const speakerSelect = speakerSelection ? (
    deviceSelect(
      "speaker",
      speakerId,
      devices.filter((device) => device.kind === "audiooutput"),
    )
  ) : (
    <p className="self-end text-sm text-gray-600">
      {t("zoom__system_speaker")}
    </p>
  );
  function prejoinDeviceTrigger(panel: "audio" | "camera") {
    return (
      <button
        ref={
          panel === "audio" ? prejoinAudioTriggerRef : prejoinCameraTriggerRef
        }
        type="button"
        className="zoom-device-trigger"
        title={t(`zoom__${panel}_settings`)}
        aria-label={t(`zoom__${panel}_settings`)}
        aria-expanded={prejoinDevicePanel === panel}
        disabled={busy}
        onClick={() =>
          setPrejoinDevicePanel(prejoinDevicePanel === panel ? null : panel)
        }
      >
        <ChevronUp aria-hidden="true" />
      </button>
    );
  }
  function deviceTrigger(panel: "audio" | "camera") {
    return (
      <button
        ref={panel === "audio" ? audioSettingsRef : cameraSettingsRef}
        type="button"
        className="zoom-device-trigger"
        title={t(`zoom__${panel}_settings`)}
        aria-label={t(`zoom__${panel}_settings`)}
        aria-expanded={devicePanel === panel}
        aria-controls={devicePanel === panel ? deviceSettingsId : undefined}
        disabled={busy || phase === "reconnecting"}
        onClick={() => setDevicePanel(devicePanel === panel ? null : panel)}
      >
        <ChevronUp aria-hidden="true" />
      </button>
    );
  }
  function control(
    label: string,
    icon: ReactNode,
    onClick: () => void,
    options: {
      off?: boolean;
      danger?: boolean;
      disabled?: boolean;
      className?: string;
    } = {},
  ) {
    return (
      <button
        type="button"
        title={t(label)}
        className={`zoom-control ${options.off ? "zoom-control-off" : ""} ${options.danger ? "zoom-control-danger" : ""} ${options.className || ""}`}
        disabled={options.disabled}
        onClick={onClick}
      >
        {icon}
        <span className="sr-only">{t(label)}</span>
      </button>
    );
  }
  const audioLabel = !audioOn
    ? "zoom__enable_audio"
    : muted
      ? "zoom__unmute"
      : "zoom__mute";
  const activeMode = pictureInPicture.active ? "native" : "full";
  const call = (
    <section
      className="zoom-call"
      data-mode={activeMode}
      aria-label={t("zoom__call_controls")}
    >
      <div className="zoom-call-feedback">
        {error && (
          <p role="alert" className="zoom-feedback-error">
            {t(error)}
          </p>
        )}
        {notice && phase !== "ended" && (
          <p role="status" className="zoom-feedback-notice">
            {t(notice)}
          </p>
        )}
        {pictureInPicture.failed && (
          <p role="alert" className="zoom-feedback-error">
            {t("zoom__picture_in_picture_failed")}
          </p>
        )}
      </div>
      {(phase === "loading" || phase === "joining") && (
        <div
          role="status"
          aria-label={t(
            phase === "loading" ? "zoom__sdk_loading" : "zoom__connecting",
          )}
        >
          <ZoomCallSkeleton />
        </div>
      )}
      {phase === "prejoin" && (
        <div className="zoom-prejoin">
          <div className="zoom-prejoin-preview">
            <div className="zoom-preview-stage">
              <video
                ref={preview}
                muted
                autoPlay
                playsInline
                className="zoom-preview"
                aria-label={t("zoom__camera_preview")}
              />
              {!cameraOn && (
                <div className="zoom-preview-placeholder">
                  <VideoOff aria-hidden="true" className="size-16" />

                  <span className="flex flex-col items-center gap-1">
                    <span className="text-sm font-medium text-white">
                      {t("zoom__camera_preview")}
                    </span>
                    <span className="text-xs text-gray-300">
                      {t("zoom__camera_preview_hint")}
                    </span>
                  </span>
                </div>
              )}
              <span className="zoom-preview-name">{t("zoom__you")}</span>
              <div className="zoom-preview-controls">
                <div className="zoom-control-group">
                  <div
                    className="zoom-mic-ring"
                    style={
                      checkingMic
                        ? ({ "--mic-level": micLevel } as CSSProperties)
                        : undefined
                    }
                  >
                    {control(
                      checkingMic ? "zoom__stop_mic_check" : "zoom__check_mic",
                      checkingMic ? <Mic /> : <MicOff />,
                      toggleMicCheck,
                      { off: !checkingMic, disabled: busy },
                    )}
                  </div>
                  {hasMicDevices && prejoinDeviceTrigger("audio")}
                </div>
                <div className="zoom-control-group">
                  {control(
                    cameraOn ? "zoom__stop_camera" : "zoom__check_camera",
                    cameraOn ? <Video /> : <VideoOff />,
                    toggleCamera,
                    { off: !cameraOn, disabled: busy },
                  )}
                  {hasCameraDevices && prejoinDeviceTrigger("camera")}
                </div>
                {prejoinDevicePanel && (
                  <div
                    ref={prejoinDevicePanelRef}
                    className="zoom-device-popover"
                    data-device={prejoinDevicePanel}
                    role="region"
                    aria-label={t(`zoom__${prejoinDevicePanel}_settings`)}
                  >
                    {prejoinDevicePanel === "audio" ? (
                      <>
                        {microphoneSelect}
                        {speakerSelect}
                      </>
                    ) : (
                      deviceSelect("camera", cameraId, cameraOptions)
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2 justify-between">
              <div>
                <h3 className="text-lg font-semibold">
                  {t("zoom__ready_to_join")}
                </h3>
                <p className="text-xs text-gray-500">
                  {t("zoom__prejoin_help")}
                </p>
              </div>

              <Button
                disabled={busy}
                onClick={join}
                size="lg"
                className="w-auto"
              >
                <Video />
                {t("zoom__join")}
              </Button>
            </div>
          </div>
        </div>
      )}
      <div className={connected ? "zoom-connected" : "hidden"}>
        <div className="zoom-stage-with-toolbar">
          <div className="zoom-stage">
            <div className="zoom-waiting" hidden={participantCount > 1}>
              <span className="zoom-avatar" aria-hidden="true">
                {patientName ? initials(patientName) : <Users />}
              </span>
              <strong>{callName}</strong>
              <span>{t("zoom__waiting_for_others")}</span>
              {practitionerName && (
                <span className="zoom-practitioner">{practitionerName}</span>
              )}
            </div>
            <div ref={gallery} className="zoom-gallery" />
            <div className="zoom-stage-status">
              <span className="zoom-name-pill" title={callName}>
                {callName}
              </span>
              <span className="zoom-duration">
                <span
                  className={
                    phase === "reconnecting"
                      ? "zoom-status-dot zoom-status-reconnecting"
                      : "zoom-status-dot"
                  }
                />
                <time aria-label={t("zoom__call_duration")}>{duration}</time>
              </span>
              <span className="zoom-connection">
                {phase === "reconnecting" ? <WifiOff /> : <Signal />}
                {t(
                  phase === "reconnecting"
                    ? "zoom__connection_reconnecting"
                    : "zoom__connection_connected",
                )}
              </span>
            </div>
            {(!audioOn || muted) && (
              <span className="zoom-muted-badge">
                <MicOff size={13} aria-hidden="true" />
                {t(
                  !audioOn
                    ? "zoom__audio_not_connected"
                    : "zoom__you_are_muted",
                )}
              </span>
            )}
          </div>
          {connected && (
            <div className="zoom-call-toolbar">
              <div className="zoom-main-controls">
                {!compact && devicePanel && (
                  <div
                    ref={devicePanelRef}
                    id={deviceSettingsId}
                    className="zoom-device-popover"
                    data-device={devicePanel}
                    role="region"
                    aria-label={t(`zoom__${devicePanel}_settings`)}
                  >
                    {devicePanel === "audio" ? (
                      <>
                        {microphoneSelect}
                        {speakerSelect}
                      </>
                    ) : (
                      deviceSelect("camera", cameraId, cameraOptions)
                    )}
                  </div>
                )}
                <div className="zoom-control-group">
                  {control(
                    audioLabel,
                    audioOn && !muted ? <Mic /> : <MicOff />,
                    toggleAudio,
                    {
                      off: !audioOn || muted,
                      disabled: busy || phase === "reconnecting",
                    },
                  )}
                  {!compact && deviceTrigger("audio")}
                </div>
                <div className="zoom-control-group">
                  {control(
                    cameraOn ? "zoom__stop_camera" : "zoom__start_camera",
                    cameraOn ? <Video /> : <VideoOff />,
                    toggleCamera,
                    {
                      off: !cameraOn,
                      disabled: busy || phase === "reconnecting",
                      className: "zoom-camera-control",
                    },
                  )}
                  {!compact && deviceTrigger("camera")}
                </div>
                {pictureInPicture.supported &&
                  control(
                    pictureInPicture.active
                      ? "zoom__return_call_to_tab"
                      : "zoom__picture_in_picture",
                    pictureInPicture.active ? (
                      <Maximize2 />
                    ) : (
                      <PictureInPicture2 />
                    ),
                    () =>
                      pictureInPicture.active
                        ? pictureInPicture.close()
                        : void pictureInPicture.open(),
                  )}
                {control("zoom__leave", <PhoneOff />, () => leave(), {
                  danger: true,
                  disabled: busy,
                })}
              </div>
            </div>
          )}
        </div>
        {connected && (
          <div className="zoom-call-footer">
            <span className="zoom-participant-count">
              <Users size={14} aria-hidden="true" />
              {t("zoom__participants", { count: participantCount })}
            </span>
            <div>
              {host && (
                <button
                  className="zoom-end-action"
                  type="button"
                  disabled={busy || phase === "reconnecting"}
                  onClick={() => leave(true)}
                >
                  {t("zoom__end_everyone")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {connected && !compact && (
        <p className="zoom-pip-help">
          {t(
            pictureInPicture.supported
              ? window.location.protocol === "http:"
                ? "zoom__picture_in_picture_http_help"
                : "zoom__picture_in_picture_help"
              : "zoom__picture_in_picture_unavailable",
          )}
        </p>
      )}
      {error === "zoom__session_expired" && phase !== "ended" && onExit && (
        <Button variant="outline" onClick={onExit}>
          {t("zoom__back_appointment")}
        </Button>
      )}
      {phase === "ended" && (
        <div className="zoom-call-ended">
          <span className="zoom-avatar">
            <PhoneOff aria-hidden="true" />
          </span>
          <h3>
            {t(
              startedAt === undefined
                ? "zoom__call_not_started"
                : "zoom__call_finished",
            )}
          </h3>
          {notice && <p role="status">{t(notice)}</p>}
          {startedAt !== undefined && (
            <p className="zoom-ended-duration">
              {t("zoom__call_duration")} <time>{duration}</time>
            </p>
          )}
          <div>
            <Button
              disabled={busy}
              onClick={() => setAttempt((value) => value + 1)}
            >
              {t("zoom__return_prejoin")}
            </Button>
            {onExit && (
              <Button variant="white" onClick={onExit}>
                {t("zoom__back_appointment")}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
  return (
    <div className="zoom-call-layout" data-mode={activeMode}>
      <div ref={pictureInPicture.mount} className="zoom-call-mount" />
      {createPortal(call, pictureInPicture.container)}
      {pictureInPicture.active && (
        <div className="zoom-call-placeholder">
          <span className="zoom-placeholder-icon">
            <PictureInPicture2 aria-hidden="true" />
          </span>
          <h3>{t("zoom__call_continues")}</h3>
          <p role="status">{t("zoom__call_in_picture_in_picture")}</p>
          <p>
            {callName} · <time>{duration}</time>
          </p>
          <Button variant="outline" onClick={pictureInPicture.close}>
            <Maximize2 />
            {t("zoom__return_call_to_tab")}
          </Button>
        </div>
      )}
    </div>
  );
}

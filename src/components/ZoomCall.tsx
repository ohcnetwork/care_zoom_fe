import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type ZoomVideo from "@zoom/videosdk";
import type {
  ConnectionChangePayload,
  LocalAudioTrack,
  LocalVideoTrack,
} from "@zoom/videosdk";
import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import type { JoinToken } from "../types";
import { Button } from "./ui/button";

type SDK = typeof ZoomVideo;
type Client = ReturnType<SDK["createClient"]>;
type Stream = ReturnType<Client["getMediaStream"]>;
type SDKListener = Parameters<Client["off"]>[1];
type Tile = {
  figure: HTMLElement;
  container: HTMLElement;
  caption: HTMLElement;
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
  meter?: ReturnType<typeof setInterval>;
  tiles: Map<number, Tile>;
};
type Phase =
  "loading" | "prejoin" | "joining" | "connected" | "reconnecting" | "ended";

// The SDK owns one client per browser page. A new mount must wait for the previous teardown.
let previousCleanup: Promise<void> = Promise.resolve();

async function checked(result: Promise<unknown>) {
  const value = await result;
  if (value) throw value; // SDK calls can resolve with an ExecutedFailure instead of rejecting.
}
async function stopPreview(runtime: Runtime) {
  if (runtime.meter) clearInterval(runtime.meter);
  runtime.meter = undefined;
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

export default function ZoomCall({
  requestToken,
  onExit,
}: {
  requestToken: () => Promise<JoinToken>;
  onExit?: () => void;
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
  const [audioOn, setAudioOn] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(0);
  const [host, setHost] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const connected = phase === "connected" || phase === "reconnecting";
  const speakerSelection =
    typeof AudioContext !== "undefined" &&
    "setSinkId" in AudioContext.prototype;
  const mobileCamera = isMobileCamera();

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
        if (!current.disposed) setError(errorKey(cause, failure));
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
    const shown = users.slice(0, current.stream.getMaxRenderableVideos());
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
        figure.className =
          "overflow-hidden rounded-lg border border-gray-200 bg-gray-100";
        const container = document.createElement("video-player-container");
        Object.assign(container.style, {
          display: "block",
          width: "100%",
          aspectRatio: "16/9",
          background: "#111827",
        });
        const caption = document.createElement("figcaption");
        caption.className = "px-3 py-2 text-sm font-medium";
        figure.append(container, caption);
        gallery.current.append(figure);
        tile = { figure, container, caption, attached: false };
        current.tiles.set(user.userId, tile);
      }
      tile.caption.textContent = `${user.displayName}${user.userId === self.userId ? ` (${t("zoom__you")})` : ""}${user.bVideoOn ? "" : ` · ${t("zoom__camera_off")}`}`;
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
    const devicesChanged = () => run(refreshDevices, undefined, true);
    setPhase("loading");
    setBusy(false);
    setError("");
    setNotice("");
    setHost(false);
    setCameraOn(false);
    setCheckingMic(false);
    setAudioOn(false);
    setMuted(true);
    setVolume(0);
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
      const enqueueRefresh = () => run(refreshParticipants, undefined, true);
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
          run(async (active) => {
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
        setNotice("zoom__enable_audio_hint");
      });
      listen("active-media-failed", () => {
        setError("zoom__media_failed");
        enqueueRefresh();
      });
      listen("device-change", devicesChanged);
      navigator.mediaDevices?.addEventListener("devicechange", devicesChanged);
      await refreshDevices(current);
      if (!cancelled) setPhase("prejoin");
    })().catch(async () => {
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
    run(async (current) => {
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
    run(async (current) => {
      if (current.microphone) {
        await checked(current.microphone.stop());
        current.microphone = undefined;
        if (current.meter) clearInterval(current.meter);
        current.meter = undefined;
        if (!current.disposed) {
          setCheckingMic(false);
          setVolume(0);
        }
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
          current.meter = setInterval(() => {
            if (!current.disposed)
              setVolume(
                Math.min(
                  100,
                  Math.max(0, current.microphone?.getCurrentVolume() ?? 0),
                ),
              );
          }, 150);
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
    run(async (current) => {
      const token = await requestToken(); // Keep the JWT only in this action and the SDK's memory.
      if (current.disposed) return;
      setPhase("joining");
      await stopPreview(current);
      if (current.disposed) return;
      setCheckingMic(false);
      setVolume(0);
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
      setPhase("connected");
      setNotice("zoom__enable_audio_hint");
      if (cameraOn) {
        try {
          await checked(
            current.stream.startVideo({ cameraId: cameraId || undefined }),
          );
        } catch (cause) {
          if (!current.disposed) {
            setCameraOn(false);
            setError(errorKey(cause));
          }
        }
      }
      await refreshParticipants(current);
      await refreshDevices(current);
    }, "zoom__join_failed");
  }
  function toggleAudio() {
    run(async (current) => {
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
    run(async (current) => {
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
    run(async (current) => {
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
    }, "zoom__leave_failed");
  }
  const cameraOptions = mobileCamera
    ? [
        { deviceId: "user", label: t("zoom__front_camera") },
        { deviceId: "environment", label: t("zoom__back_camera") },
      ]
    : devices.filter((device) => device.kind === "videoinput");
  function deviceSelect(
    kind: "camera" | "microphone" | "speaker",
    value: string,
    options: { deviceId: string; label: string }[],
  ) {
    return (
      <label className="block space-y-1 text-sm font-medium">
        {t(`zoom__${kind}`)}
        <select
          aria-label={t(`zoom__${kind}`)}
          className="block h-10 w-full rounded-md border border-gray-400 bg-white px-3 text-gray-900"
          value={value}
          disabled={busy || phase === "reconnecting"}
          onChange={(event) => changeDevice(kind, event.target.value)}
        >
          <option value="">{t("zoom__system_default")}</option>
          {options
            .filter((device) => device.deviceId)
            .map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `${t(`zoom__${kind}`)} ${index + 1}`}
              </option>
            ))}
        </select>
      </label>
    );
  }
  return (
    <section className="space-y-4" aria-label={t("zoom__call_controls")}>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800"
        >
          {t(error)}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md bg-gray-100 p-3">
          {t(notice)}
        </p>
      )}
      {phase === "loading" || phase === "joining" ? (
        <p role="status">
          {t(phase === "loading" ? "zoom__sdk_loading" : "zoom__connecting")}
        </p>
      ) : null}
      {phase === "prejoin" && (
        <>
          <h3 className="text-lg font-semibold">{t("zoom__prejoin")}</h3>
          <p className="text-sm text-gray-600">{t("zoom__prejoin_help")}</p>
          <video
            ref={preview}
            muted
            autoPlay
            playsInline
            className="aspect-video w-full rounded-lg bg-gray-900"
            aria-label={t("zoom__camera_preview")}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={toggleCamera}>
              {cameraOn ? <VideoOff /> : <Video />}
              {t(cameraOn ? "zoom__stop_camera" : "zoom__check_camera")}
            </Button>
            <Button variant="outline" disabled={busy} onClick={toggleMicCheck}>
              <Mic />
              {t(checkingMic ? "zoom__stop_mic_check" : "zoom__check_mic")}
            </Button>
          </div>
          {checkingMic && (
            <label className="block text-sm">
              {t("zoom__mic_level")}
              <progress
                className="ml-2 align-middle"
                value={volume}
                max={100}
              />
            </label>
          )}
        </>
      )}
      <div
        ref={gallery}
        className={
          connected ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : "hidden"
        }
      />
      {connected && (
        <>
          <p className="text-sm text-gray-600" role="status">
            {t("zoom__participants", { count: participantCount })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={audioOn && !muted ? "outline" : "primary"}
              disabled={busy || phase === "reconnecting"}
              onClick={toggleAudio}
            >
              {audioOn && !muted ? <Mic /> : <MicOff />}
              {t(
                !audioOn
                  ? "zoom__enable_audio"
                  : muted
                    ? "zoom__unmute"
                    : "zoom__mute",
              )}
            </Button>
            <Button
              variant="outline"
              disabled={busy || phase === "reconnecting"}
              onClick={toggleCamera}
            >
              {cameraOn ? <Video /> : <VideoOff />}
              {t(cameraOn ? "zoom__stop_camera" : "zoom__start_camera")}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => leave()}>
              <PhoneOff />
              {t("zoom__leave")}
            </Button>
            {host && (
              <Button
                variant="destructive"
                disabled={busy || phase === "reconnecting"}
                onClick={() => leave(true)}
              >
                {t("zoom__end_everyone")}
              </Button>
            )}
          </div>
        </>
      )}
      {(phase === "prejoin" || connected) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {deviceSelect("camera", cameraId, cameraOptions)}
          {deviceSelect(
            "microphone",
            microphoneId,
            devices.filter((device) => device.kind === "audioinput"),
          )}
          {speakerSelection ? (
            deviceSelect(
              "speaker",
              speakerId,
              devices.filter((device) => device.kind === "audiooutput"),
            )
          ) : (
            <p className="self-end text-sm text-gray-600">
              {t("zoom__system_speaker")}
            </p>
          )}
        </div>
      )}
      {phase === "prejoin" && (
        <Button disabled={busy} onClick={join}>
          {t("zoom__join")}
        </Button>
      )}
      {error === "zoom__session_expired" && phase !== "ended" && onExit && (
        <Button variant="outline" onClick={onExit}>
          {t("zoom__back_appointment")}
        </Button>
      )}
      {phase === "ended" && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("zoom__return_prejoin")}
          </Button>
          {onExit && (
            <Button variant="outline" onClick={onExit}>
              {t("zoom__back_appointment")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

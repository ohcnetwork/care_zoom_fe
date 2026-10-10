import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import { MoreVertical, Pencil, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getScheduleVideoSettings,
  updateScheduleVideoSettings,
} from "../utils/api";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import Page from "./Page";

type Props = {
  __base: ComponentType<Record<string, unknown>>;
  template: { id: string; name: string };
  facilityId: string;
  resourceType: string;
  trigger?: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
  [key: string]: unknown;
};

export default function ScheduleVideoSettings({
  __base: Base,
  trigger,
  onOpenChange,
  ...props
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const isPractitioner = props.resourceType === "practitioner";
  return (
    <>
      <Base
        {...props}
        onOpenChange={onOpenChange}
        trigger={
          isPractitioner ? (
            <span className="hidden" aria-hidden="true" />
          ) : (
            trigger
          )
        }
      />
      {isPractitioner && (
        <Page>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                title={t("zoom__more_actions")}
              >
                <MoreVertical className="size-4" />
                <span className="sr-only">{t("zoom__more_actions")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onOpenChange?.(true)}>
                <Pencil />
                {t("zoom__edit_schedule")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setOpen(true)}>
                <Video />
                {t("zoom__schedule_mode")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {open && (
            <ScheduleModeDialog
              key={`${props.facilityId}:${props.template.id}`}
              facilityId={props.facilityId}
              scheduleId={props.template.id}
              name={props.template.name}
              onClose={() => setOpen(false)}
            />
          )}
        </Page>
      )}
    </>
  );
}

function ScheduleModeDialog({
  facilityId,
  scheduleId,
  name,
  onClose,
}: {
  facilityId: string;
  scheduleId: string;
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoadFailed(false);
    getScheduleVideoSettings(facilityId, scheduleId, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setSaved(data.video_enabled);
        setVideoEnabled(data.video_enabled);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true);
      });
    return () => controller.abort();
  }, [facilityId, scheduleId, revision]);

  async function save() {
    if (saving || saved === null || saved === videoEnabled) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await updateScheduleVideoSettings(facilityId, scheduleId, videoEnabled);
      onClose();
    } catch {
      setSaveFailed(true);
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description ${id}-warning`}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      className="m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-md overflow-auto rounded-lg border border-gray-200 bg-white p-6 text-gray-900 shadow-lg backdrop:bg-black/50"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div>
          <h2 id={`${id}-title`} className="text-lg font-bold">
            {t("zoom__schedule_mode")}
          </h2>
          <p className="mt-1 font-semibold">{name}</p>
          <p id={`${id}-description`} className="mt-1 text-sm text-gray-600">
            {t("zoom__schedule_mode_description")}
          </p>
        </div>
        {loadFailed ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-red-700">
              {t("zoom__schedule_mode_load_failed")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRevision((value) => value + 1)}
            >
              {t("zoom__retry")}
            </Button>
          </div>
        ) : saved === null ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        ) : (
          <fieldset disabled={saving} className="space-y-2">
            <legend className="sr-only">{t("zoom__schedule_mode")}</legend>
            {[false, true].map((video) => (
              <label
                key={String(video)}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-gray-300 p-3 text-sm font-semibold"
              >
                <input
                  type="radio"
                  name={`${id}-mode`}
                  checked={videoEnabled === video}
                  onChange={() => setVideoEnabled(video)}
                  className="size-4 accent-primary-700"
                />
                {t(video ? "zoom__video_call" : "zoom__in_person")}
              </label>
            ))}
          </fieldset>
        )}
        <p
          id={`${id}-warning`}
          className="rounded-md border border-warning-300 bg-warning-50 p-3 text-sm text-warning-900"
        >
          {t("zoom__schedule_mode_warning")}
        </p>
        {saveFailed && (
          <p role="alert" className="text-sm text-red-700">
            {t("zoom__schedule_mode_save_failed")}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onClose}
          >
            {t("zoom__cancel")}
          </Button>
          <Button
            type="submit"
            disabled={saving || saved === null || saved === videoEnabled}
          >
            {t(saving ? "zoom__saving" : "zoom__save")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

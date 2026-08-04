import { Action, ActionPanel, Form, Icon, Toast, showToast } from "@raycast/api";
import { useEffect, useState } from "react";
import {
  PauseSchedule,
  errorMessage,
  getPauseSchedule,
  pauseAeroSpaceForDays,
  resumeAeroSpaceNow,
} from "./utils/aerospace";

type PauseFormValues = {
  duration: string;
  customDays?: string;
};

function scheduleDescription(schedule: PauseSchedule | null): string {
  if (!schedule) return "AeroSpace is not currently using a scheduled pause.";
  return `Paused for ${schedule.days} day${schedule.days === 1 ? "" : "s"}. Automatic window management will resume around ${new Date(schedule.resumeAt).toLocaleString()}.`;
}

export function PauseAeroSpaceForm({ onComplete }: { onComplete?: () => void }) {
  const [duration, setDuration] = useState("5");
  const [schedule, setSchedule] = useState<PauseSchedule | null>(null);

  const refresh = async () => setSchedule(await getPauseSchedule());
  useEffect(() => {
    refresh();
  }, []);

  const pause = async (values: PauseFormValues) => {
    const days = Number(values.duration === "custom" ? values.customDays : values.duration);
    const toast = await showToast({ style: Toast.Style.Animated, title: "Scheduling AeroSpace Pause" });
    try {
      const result = await pauseAeroSpaceForDays(days);
      toast.style = Toast.Style.Success;
      toast.title = "AeroSpace Paused";
      toast.message = result.stdout;
      await refresh();
      onComplete?.();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Unable to Pause AeroSpace";
      toast.message = errorMessage(error);
    }
  };

  const resume = async () => {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Resuming AeroSpace" });
    try {
      const result = await resumeAeroSpaceNow();
      toast.style = Toast.Style.Success;
      toast.title = "AeroSpace Resumed";
      toast.message = result.stdout;
      await refresh();
      onComplete?.();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Unable to Resume AeroSpace";
      toast.message = errorMessage(error);
    }
  };

  return (
    <Form
      navigationTitle="Pause AeroSpace for Days"
      actions={
        <ActionPanel>
          {schedule ? (
            <Action title="Resume Now and Cancel Scheduled Pause" icon={Icon.Play} onAction={resume} />
          ) : null}
          <Action.SubmitForm
            title={schedule ? "Replace with New Pause Schedule" : "Pause and Schedule Resume"}
            icon={Icon.Pause}
            onSubmit={pause}
          />
        </ActionPanel>
      }
    >
      <Form.Description title="Current Status" text={scheduleDescription(schedule)} />
      {schedule ? (
        <Form.Description
          title="Resume Immediately"
          text="Press Enter to cancel this scheduled pause, remove its background resume task, and restore AeroSpace window management now."
        />
      ) : null}
      <Form.Separator />
      <Form.Dropdown id="duration" title="Pause Duration" value={duration} onChange={setDuration}>
        <Form.Dropdown.Item value="1" title="1 Day" />
        <Form.Dropdown.Item value="3" title="3 Days" />
        <Form.Dropdown.Item value="5" title="5 Days — Recommended" />
        <Form.Dropdown.Item value="7" title="1 Week" />
        <Form.Dropdown.Item value="14" title="2 Weeks" />
        <Form.Dropdown.Item value="30" title="30 Days" />
        <Form.Dropdown.Item value="custom" title="Custom Number of Days" />
      </Form.Dropdown>
      {duration === "custom" ? <Form.TextField id="customDays" title="Days" placeholder="1–365" /> : null}
      <Form.Description
        title="Automatic Resume"
        text="The extension creates a local one-time resume schedule. It survives logout and restart, retries after sleep, removes itself after AeroSpace resumes, and never changes your AeroSpace configuration."
      />
    </Form>
  );
}

export default function Command() {
  return <PauseAeroSpaceForm />;
}

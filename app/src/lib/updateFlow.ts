/// The update, told through toasts: the offer, the download's progress, and
/// a failure with a way to try again. Shared by the launch check and the
/// button in Settings, so both look and behave the same.

import { install, openReleasePage, skipVersion, type Available } from "@/lib/updater";
import { dismissToast, reason, toast } from "@/lib/toast";

/// One card for the whole story, replaced in place as it moves along.
const CARD = "yt2mp-update";

let running = false;

export function offerUpdate(update: Available, isBusy: () => boolean) {
  if (running) return;
  toast({
    id: CARD,
    tone: "info",
    sticky: true,
    title: "Update available",
    body: update.canInstall
      ? `Version ${update.version}. yt2mp restarts to install it.`
      : `Version ${update.version} is on GitHub.`,
    actions: [
      update.canInstall
        ? { label: "Update now", primary: true, onClick: () => void installUpdate(update, isBusy) }
        : {
            label: "Open GitHub",
            primary: true,
            onClick: () => {
              openReleasePage();
              dismissToast(CARD);
            },
          },
      {
        label: "Skip this version",
        onClick: () => {
          skipVersion(update.version);
          dismissToast(CARD);
        },
      },
    ],
  });
}

/// Resolves false when the update did not start or did not finish. On
/// success it never really resolves: the installer closes the app.
export async function installUpdate(
  update: Available,
  isBusy: () => boolean
): Promise<boolean> {
  if (!update.canInstall) {
    openReleasePage();
    return false;
  }
  if (running) return false;

  // Installing restarts the app, and a download running in it goes with it.
  if (isBusy()) {
    toast({
      id: "yt2mp-update-wait",
      tone: "warn",
      title: "Finish your download first",
      body: "Updating restarts yt2mp, which would stop it.",
    });
    return false;
  }

  running = true;
  const show = (progress: number | null) =>
    toast({
      id: CARD,
      tone: "info",
      title:
        progress === null
          ? `Updating to ${update.version}…`
          : `Updating to ${update.version}… ${Math.floor(progress)}%`,
      body: "yt2mp restarts when it's done.",
      progress,
    });

  show(null);
  try {
    await install(update, show);
    return true;
  } catch (err) {
    running = false;
    toast({
      id: CARD,
      tone: "error",
      sticky: true,
      title: "The update didn't install",
      body: reason(err, "Check your connection and try again."),
      actions: [
        { label: "Try again", primary: true, onClick: () => void installUpdate(update, isBusy) },
      ],
    });
    return false;
  }
}

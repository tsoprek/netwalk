function isOpenDialog(element: HTMLElement): boolean {
  return !element.hidden
    && element.getAttribute("aria-hidden") !== "true"
    && element.style.display !== "none";
}

function dismissLabel(element: HTMLElement): string {
  return (
    element.getAttribute("aria-label")
    || element.getAttribute("title")
    || element.textContent
    || ""
  ).trim();
}

function isDismissControl(element: HTMLElement): boolean {
  const label = dismissLabel(element);
  return /^cancel(?:\s|$)/i.test(label) || /^close$/i.test(label);
}

/** Close the top-most dialog through its own Cancel/Close action.
 *
 * Using the real button preserves each surface's existing cleanup behavior
 * instead of guessing which React state owns the dialog. */
export function dismissTopDialog(): boolean {
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"]'),
  ).filter(isOpenDialog);
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) return false;

  const control = Array.from(
    dialog.querySelectorAll<HTMLElement>('button, [role="button"]'),
  ).find((candidate) => (
    !candidate.hasAttribute("disabled")
    && candidate.getAttribute("aria-disabled") !== "true"
    && isDismissControl(candidate)
  ));
  if (!control) return false;

  control.click();
  return true;
}

/** Install app-wide Escape handling for dialogs with Cancel/Close controls. */
export function installEscapeDialogDismiss(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;

    // A select/menu gets the first Escape so it can close without also
    // dismissing the containing settings dialog.
    const target = event.target;
    if (
      target instanceof Element
      && (
        target.closest('.themed-select.open')
        || target.closest('[role="listbox"]')
        || target.closest('[role="menu"]')
      )
    ) {
      return;
    }

    if (!dismissTopDialog()) return;
    event.preventDefault();
    event.stopPropagation();
  };

  document.addEventListener("keydown", onKeyDown);
  return () => document.removeEventListener("keydown", onKeyDown);
}

type EnterKeyEvent = {
  key: string;
  target: EventTarget | null;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
  preventDefault: () => void;
};

/**
 * Explicitly submit a form when Enter is pressed in one of its single-line
 * inputs. Some desktop webviews do not consistently perform the browser's
 * implicit form submission for custom password inputs.
 */
export function submitFormOnEnter(event: EnterKeyEvent): boolean {
  if (
    event.key !== "Enter"
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
    || event.isComposing
    || event.nativeEvent?.isComposing
  ) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.form) return false;

  event.preventDefault();
  // Dispatch the submit event explicitly instead of relying on
  // HTMLFormElement.requestSubmit(). WebView2 can silently ignore
  // requestSubmit() when it is called from a password field's keydown
  // handler, even though the same form submits normally when clicked.
  target.form.dispatchEvent(new SubmitEvent("submit", {
    bubbles: true,
    cancelable: true,
  }));
  return true;
}

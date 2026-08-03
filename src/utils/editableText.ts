import { stripUnexpectedControlCharacters } from "./consoleText";

const TEXT_INPUT_TYPES = new Set(["", "text", "search", "password", "email", "url", "tel"]);

function editableTextControl(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (target instanceof HTMLTextAreaElement) return target;
  if (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type.toLowerCase())) return target;
  return null;
}

function setNativeValue(control: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = control instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(control, value);
  else control.value = value;
}

/**
 * Prevents WebKit from inserting C0 control characters (most visibly U+001C
 * and U+001D for Left/Right Arrow on affected macOS keyboard/WebView
 * combinations) into ordinary form controls. The input fallback also cleans
 * paste/IME paths that do not expose cancelable `beforeinput` data.
 */
export function installEditableControlCharacterGuard(documentTarget: Document = document): () => void {
  const beforeInput = (event: InputEvent) => {
    if (!editableTextControl(event.target) || event.data == null) return;
    if (stripUnexpectedControlCharacters(event.data) !== event.data) event.preventDefault();
  };

  const input = (event: Event) => {
    const control = editableTextControl(event.target);
    if (!control) return;
    const original = control.value;
    const cleaned = stripUnexpectedControlCharacters(original);
    if (cleaned === original) return;

    const selectionStart = control.selectionStart;
    const selectionEnd = control.selectionEnd;
    const cleanStart = selectionStart == null
      ? null
      : stripUnexpectedControlCharacters(original.slice(0, selectionStart)).length;
    const cleanEnd = selectionEnd == null
      ? null
      : stripUnexpectedControlCharacters(original.slice(0, selectionEnd)).length;
    setNativeValue(control, cleaned);
    if (cleanStart != null && cleanEnd != null) {
      try { control.setSelectionRange(cleanStart, cleanEnd); } catch { /* unsupported input subtype */ }
    }
  };

  documentTarget.addEventListener("beforeinput", beforeInput as EventListener, true);
  documentTarget.addEventListener("input", input, true);
  return () => {
    documentTarget.removeEventListener("beforeinput", beforeInput as EventListener, true);
    documentTarget.removeEventListener("input", input, true);
  };
}

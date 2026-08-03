const EDITABLE_TEXT_SELECTOR = [
  "input:not([type])",
  'input[type="text"]',
  'input[type="search"]',
  'input[type="password"]',
  'input[type="email"]',
  'input[type="url"]',
  'input[type="tel"]',
  "textarea",
].join(",");

function disableTextCorrections(element: Element) {
  const fields = element.matches(EDITABLE_TEXT_SELECTOR)
    ? [element]
    : [...element.querySelectorAll(EDITABLE_TEXT_SELECTOR)];

  for (const field of fields) {
    field.setAttribute("autocorrect", "off");
    field.setAttribute("autocapitalize", "none");
    field.setAttribute("spellcheck", "false");
  }
}

export function installCaseSensitiveInputDefaults() {
  const documentRoot = document.documentElement;

  // These attributes provide the default before React mounts. The observer
  // applies them directly to fields added later by pages and dialogs.
  documentRoot.setAttribute("autocorrect", "off");
  documentRoot.setAttribute("autocapitalize", "none");
  documentRoot.setAttribute("spellcheck", "false");
  disableTextCorrections(documentRoot);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) disableTextCorrections(node);
      }
    }
  });
  observer.observe(documentRoot, { childList: true, subtree: true });

  return () => observer.disconnect();
}

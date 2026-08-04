import { invoke } from "@tauri-apps/api/core";

export interface OnePasswordCredentialRef {
  itemReference: string;
  account?: string;
}

export interface OnePasswordLogin {
  username: string;
  password: string;
}

export interface LoginCredentialPair {
  username: string;
  password?: string;
}

export interface OnePasswordItemOption {
  title: string;
  vaultName: string;
  itemReference: string;
}

export interface DefaultLabOnePasswordConfig {
  enabled: boolean;
  credential: OnePasswordCredentialRef;
}

const DEFAULT_LAB_CREDENTIAL_KEY = "catwalk.defaultLabOnePassword";

export function normalizeOnePasswordItemReference(value: string): string {
  const reference = value.trim().replace(/\/+$/, "");
  if (!reference.startsWith("op://")) {
    throw new Error("1Password item reference must start with op://");
  }
  const parts = reference.slice(5).split("/").filter(Boolean);
  if (parts.length !== 2) {
    throw new Error("Use an item reference in the form op://Vault/Item");
  }
  return reference;
}

export function hasOnePasswordCredential(value: { onePassword?: OnePasswordCredentialRef }): boolean {
  return Boolean(value.onePassword?.itemReference?.trim());
}

export function onePasswordErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return "1Password request failed. Check ConnCat diagnostics for details.";
}

function deviceCredentialKey(deviceId: string | number): string {
  return `catwalk.deviceOnePassword.${deviceId}`;
}

export function getDeviceOnePasswordCredential(deviceId: string | number): OnePasswordCredentialRef | null {
  const raw = localStorage.getItem(deviceCredentialKey(deviceId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OnePasswordCredentialRef>;
    if (typeof value.itemReference !== "string") return null;
    return {
      itemReference: value.itemReference,
      ...(typeof value.account === "string" && value.account.trim() ? { account: value.account.trim() } : {}),
    };
  } catch {
    return null;
  }
}

export function setDeviceOnePasswordCredential(
  deviceId: string | number,
  credential: OnePasswordCredentialRef | null,
): void {
  const key = deviceCredentialKey(deviceId);
  if (!credential) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify({
    itemReference: credential.itemReference,
    ...(credential.account?.trim() ? { account: credential.account.trim() } : {}),
  }));
}

export function getDefaultLabOnePasswordConfig(): DefaultLabOnePasswordConfig {
  const fallback = { enabled: false, credential: { itemReference: "" } };
  const raw = localStorage.getItem(DEFAULT_LAB_CREDENTIAL_KEY);
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw) as Partial<DefaultLabOnePasswordConfig>;
    const credential = value.credential as Partial<OnePasswordCredentialRef> | undefined;
    return {
      enabled: value.enabled === true,
      credential: {
        itemReference: typeof credential?.itemReference === "string" ? credential.itemReference : "",
        ...(typeof credential?.account === "string" && credential.account.trim()
          ? { account: credential.account.trim() }
          : {}),
      },
    };
  } catch {
    return fallback;
  }
}

export function setDefaultLabOnePasswordConfig(config: DefaultLabOnePasswordConfig): void {
  localStorage.setItem(DEFAULT_LAB_CREDENTIAL_KEY, JSON.stringify({
    enabled: config.enabled === true,
    credential: {
      itemReference: config.credential.itemReference,
      ...(config.credential.account?.trim() ? { account: config.credential.account.trim() } : {}),
    },
  }));
}

export function getDefaultLabOnePasswordCredential(): OnePasswordCredentialRef | null {
  const config = getDefaultLabOnePasswordConfig();
  return config.enabled && config.credential.itemReference.trim() ? config.credential : null;
}

export function getConsoleOnePasswordCredential(
  deviceId: string | number,
): OnePasswordCredentialRef | null {
  return getDefaultLabOnePasswordCredential() ?? getDeviceOnePasswordCredential(deviceId);
}

export function selectDeviceLogin(
  onePassword: OnePasswordLogin | null,
  managed: OnePasswordLogin | null,
  fallbackUsername: string,
): LoginCredentialPair {
  if (onePassword) return { username: onePassword.username, password: onePassword.password };
  if (managed) return { username: managed.username, password: managed.password };
  return { username: fallbackUsername };
}

export async function resolveOnePasswordLogin(
  credential: OnePasswordCredentialRef,
): Promise<OnePasswordLogin> {
  const itemReference = normalizeOnePasswordItemReference(credential.itemReference);
  const result = await invoke<OnePasswordLogin>("onepassword_resolve_login", {
    itemReference,
    account: credential.account?.trim() || null,
  });
  if (!result?.username?.trim() || !result.password) {
    throw new Error("1Password item must contain username and password fields");
  }
  return { username: result.username.trim(), password: result.password };
}

export async function listOnePasswordLogins(account?: string): Promise<OnePasswordItemOption[]> {
  const result = await invoke<OnePasswordItemOption[]>("onepassword_list_logins", {
    account: account?.trim() || null,
  });
  return Array.isArray(result) ? result : [];
}

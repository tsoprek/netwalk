export type ConsoleCredentials = {
  username: string;
  password: string;
};

const CONSOLE_CREDENTIAL_TTL_MS = 30 * 60 * 1000;

let cachedCredentials: (ConsoleCredentials & { expiresAt: number }) | null = null;

export function getCachedConsoleCredentials(now = Date.now()): ConsoleCredentials | null {
  if (!cachedCredentials) return null;
  if (cachedCredentials.expiresAt <= now) {
    cachedCredentials = null;
    return null;
  }
  return {
    username: cachedCredentials.username,
    password: cachedCredentials.password,
  };
}

export function setCachedConsoleCredentials(
  credentials: ConsoleCredentials,
  now = Date.now(),
): ConsoleCredentials {
  cachedCredentials = {
    username: credentials.username,
    password: credentials.password,
    expiresAt: now + CONSOLE_CREDENTIAL_TTL_MS,
  };
  return credentials;
}

export function clearCachedConsoleCredentials(): void {
  cachedCredentials = null;
}

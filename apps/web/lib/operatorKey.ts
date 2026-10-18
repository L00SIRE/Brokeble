// The operator key is typed on the ops bar and kept only in sessionStorage (never in the URL or a NEXT_PUBLIC_* var).
const STORAGE_KEY = "tab.operatorKey";

export function readOperatorKey(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeOperatorKey(value: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    // storage blocked: the key just isn't remembered across reloads
  }
}

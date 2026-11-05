// Browser-local on/off preferences. Stored as 'true'; a missing key (or any
// other value) means off, so "off" never leaves a key behind.

export function getBoolPreference(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

export function setBoolPreference(key: string, enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(key, 'true');
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage may be unavailable
  }
}

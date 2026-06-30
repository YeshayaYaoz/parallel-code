const TOKEN_KEY = 'parallel-code-token';

/** Extract token from URL query param and persist to localStorage. */
export function initAuth(): string | null {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');

  if (urlToken) {
    localStorage.setItem(TOKEN_KEY, urlToken);
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.pathname + url.search);
    return urlToken;
  }

  return localStorage.getItem(TOKEN_KEY);
}

/** Get the stored token. */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** Clear stored token. */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export type ConnectResult = 'stored' | 'navigating' | 'invalid';

/**
 * Apply a pasted connection string — a full URL with `?token=…` (as shown by the
 * desktop "Connect Phone" dialog). When the URL points at a different origin
 * (e.g. the desktop's IP/port changed), navigate there so the new origin owns
 * the token; otherwise store it for the current origin.
 */
export function applyConnectionString(input: string): ConnectResult {
  const trimmed = input.trim();
  if (!trimmed) return 'invalid';

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'invalid';
  }

  // The input is user-pasted, so reject non-http(s) schemes — javascript:/data:/
  // file: URLs parse and expose a token but would execute or navigate to
  // attacker-controlled content when assigned to location.href.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'invalid';

  const token = url.searchParams.get('token');
  if (!token) return 'invalid';

  if (url.origin === window.location.origin) {
    localStorage.setItem(TOKEN_KEY, token);
    return 'stored';
  }
  window.location.href = url.href;
  return 'navigating';
}

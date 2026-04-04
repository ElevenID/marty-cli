/**
 * CLI Authentication — obtain and manage access tokens.
 *
 * Supported modes:
 *   • API key:             marty login --api-key <key>
 *   • Client credentials:  marty login --client-id <id> --client-secret <secret>
 *
 * Tokens / keys are persisted in ~/.marty/credentials.json (mode 0600).
 */

import { loadConfig, loadCredentials, saveCredentials, clearCredentials } from './config.js';

/**
 * Login with an API key (stored directly — no token exchange needed).
 */
export function loginWithApiKey(apiKey) {
  saveCredentials({ type: 'api_key', apiKey, savedAt: new Date().toISOString() });
}

/**
 * Login with OAuth2 client-credentials grant against Keycloak.
 */
export async function loginWithClientCredentials({ clientId, clientSecret, tokenUrl }) {
  const url = tokenUrl || `${loadConfig().apiUrl}/auth/realms/marty/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Token request failed (${response.status}): ${text}`);
  }

  const data = await response.json();

  saveCredentials({
    type: 'oauth2',
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null,
    savedAt: new Date().toISOString(),
  });

  return data;
}

/**
 * Return headers suitable for authenticated API requests.
 * Reads the stored credentials and builds the appropriate header.
 *
 * Supports session-cookie auth (used by integration tests that authenticate
 * via the Keycloak PKCE flow and pass the ``sessionId`` to the CLI).
 */
export function getAuthHeaders() {
  const creds = loadCredentials();

  if (creds.type === 'api_key' && creds.apiKey) {
    return { 'X-API-Key': creds.apiKey };
  }

  if (creds.type === 'oauth2' && creds.accessToken) {
    return { Authorization: `Bearer ${creds.accessToken}` };
  }

  if (creds.type === 'session' && creds.sessionId) {
    return { Cookie: `sessionId=${creds.sessionId}` };
  }

  return {};
}

/**
 * Check if the user is currently logged in (has stored credentials).
 */
export function isLoggedIn() {
  const creds = loadCredentials();
  return !!(creds.type && (creds.apiKey || creds.accessToken || creds.sessionId));
}

/**
 * Return a summary of the current auth state for `marty whoami`.
 */
export function whoami() {
  const creds = loadCredentials();
  if (!creds.type) return null;

  if (creds.type === 'api_key') {
    const masked = creds.apiKey
      ? creds.apiKey.slice(0, 8) + '…' + creds.apiKey.slice(-4)
      : '(none)';
    return { type: 'api_key', key: masked, savedAt: creds.savedAt };
  }

  if (creds.type === 'oauth2') {
    return {
      type: 'oauth2',
      expiresAt: creds.expiresAt,
      savedAt: creds.savedAt,
      expired: creds.expiresAt ? new Date(creds.expiresAt) < new Date() : false,
    };
  }

  return null;
}

export { clearCredentials as logout };

import type { KiBuddyModelSettings } from './types';

// Mirrors Ki-Model 0.1.1 OpenAIOptions::request_headers, without echoing credentials.
const hasInvalidHeaderValue = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9) || code === 127;
  });
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RESERVED_HEADERS = new Set(['content-type', 'content-length', 'transfer-encoding', 'host']);

/** Validates SDK-level options; Core must repeat validation at its trust boundary. */
export function validateKiBuddyGateway(apiKey: string, gateway: KiBuddyModelSettings['gateway']) {
  const bearer = gateway?.bearer !== false;
  const names = new Set<string>();
  for (const header of gateway?.headers ?? []) {
    if (!HEADER_NAME.test(header.name) || hasInvalidHeaderValue(header.value))
      return 'settings.kiBuddyModel.invalidHeader' as const;
    const name = header.name.toLowerCase();
    if (names.has(name)) return 'settings.kiBuddyModel.duplicateHeader' as const;
    if (name === 'authorization' && bearer) return 'settings.kiBuddyModel.authorizationConflict' as const;
    if (RESERVED_HEADERS.has(name)) return 'settings.kiBuddyModel.reservedHeader' as const;
    names.add(name);
  }
  if (bearer && !apiKey.trim()) return 'settings.kiBuddyModel.keyRequired' as const;
  if (bearer && hasInvalidHeaderValue(apiKey)) return 'settings.kiBuddyModel.invalidKey' as const;
  for (const timeout of [gateway?.connectTimeoutSeconds, gateway?.readTimeoutSeconds, gateway?.totalTimeoutSeconds]) {
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 0))
      return 'settings.kiBuddyModel.timeoutInvalid' as const;
  }
  return undefined;
}

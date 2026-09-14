import type { KiBuddyModelSettings } from './types';

// Mirrors Core gateway policy, including stricter transport headers and credential rules.
const hasInvalidHeaderValue = (value: string) =>
  new TextEncoder().encode(value).length > 8192 ||
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RESERVED_HEADERS = new Set([
  'content-type',
  'content-length',
  'transfer-encoding',
  'host',
  'connection',
  'proxy-authorization',
  'proxy-authenticate',
  'trailer',
  'upgrade',
  'te',
]);

/** Validate the published Core input limits without echoing credentials. */
export function validateKiBuddyGateway(apiKey: string, gateway: KiBuddyModelSettings['gateway']) {
  const bearer = gateway?.bearer !== false;
  if ((gateway?.headers?.length ?? 0) > 64) return 'settings.kiBuddyModel.invalidHeader' as const;
  const names = new Set<string>();
  for (const header of gateway?.headers ?? []) {
    if (!HEADER_NAME.test(header.name) || hasInvalidHeaderValue(header.value))
      return 'settings.kiBuddyModel.invalidHeader' as const;
    if (header.sensitive) {
      const action = header.credentialAction ?? 'replace';
      if (action === 'keep' && !header.configured) return 'settings.kiBuddyModel.credentialRequired' as const;
      if (
        action === 'replace' &&
        (!header.value.trim() ||
          header.value.includes('***') ||
          header.value.includes('•') ||
          header.value === '[REDACTED]')
      )
        return 'settings.kiBuddyModel.credentialRequired' as const;
    }
    const name = header.name.toLowerCase();
    if (names.has(name)) return 'settings.kiBuddyModel.duplicateHeader' as const;
    if (name === 'authorization' && bearer) return 'settings.kiBuddyModel.authorizationConflict' as const;
    if (RESERVED_HEADERS.has(name)) return 'settings.kiBuddyModel.reservedHeader' as const;
    names.add(name);
  }
  if (bearer && !apiKey.trim()) return 'settings.kiBuddyModel.keyRequired' as const;
  if (bearer && hasInvalidHeaderValue(apiKey)) return 'settings.kiBuddyModel.invalidKey' as const;
  for (const [timeout, max] of [
    [gateway?.connectTimeoutSeconds, 300],
    [gateway?.readTimeoutSeconds, 3600],
    [gateway?.totalTimeoutSeconds, 3600],
  ] as const) {
    if (
      timeout !== undefined &&
      (!Number.isFinite(timeout) ||
        timeout < 0.001 ||
        timeout > max ||
        Math.abs(timeout * 1000 - Math.round(timeout * 1000)) > 1e-7)
    )
      return 'settings.kiBuddyModel.timeoutInvalid' as const;
  }
  return undefined;
}

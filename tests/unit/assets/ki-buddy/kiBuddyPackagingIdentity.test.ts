import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProjectPackagingOverlay } from './packagingIdentity.fixture';

const { readProductConfig } = require('../../../../packages/shared-scripts/src/kiBuddyRelease');
const { resolveKiBuddyPackagingIdentity } = require('../../../../packages/shared-scripts/src/kiBuddyPackagingIdentity');
const projectRoot = resolve(__dirname, '../../../..');

describe('Ki-Buddy packaging identity', () => {
  it('resolves the existing Ki-Buddy packaging identity from product configuration', () => {
    const productConfig = readProductConfig(projectRoot);

    expect(resolveKiBuddyPackagingIdentity(productConfig)).toEqual({
      schemaVersion: 1,
      product: { runtimeIdentity: productConfig.runtimeIdentity },
      packageMetadata: productConfig.packageMetadata,
      desktop: productConfig.electronBuilder,
      resources: {
        platform: productConfig.assets.platform,
        packaged: {
          applicationIcon: 'app.png',
          runtimeIcon: productConfig.assets.packaged.icon,
          buildEvidence: 'ki-buddy-build-evidence.json',
          agentsMcpAdapter: 'app.asar.unpacked/out/main/builtin-mcp-agents.js',
          bundledAionCore: 'bundled-aioncore',
        },
      },
    });
  });

  it('returns a detached clone of a complete project packaging overlay', () => {
    const overlay = createProjectPackagingOverlay();
    const originalOverlay = structuredClone(overlay);

    const identity = resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay);

    expect(identity).toEqual(originalOverlay);
    expect(identity).not.toBe(overlay);
    expect(identity.desktop).not.toBe(overlay.desktop);
  });

  it('does not mutate or freeze the caller-owned project packaging overlay', () => {
    const overlay = createProjectPackagingOverlay();
    const originalOverlay = structuredClone(overlay);

    resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay);

    expect(overlay).toEqual(originalOverlay);
    expect(Object.isFrozen(overlay)).toBe(false);
    expect(Object.isFrozen(overlay.desktop)).toBe(false);
  });

  it('deep-freezes the resolved project packaging identity', () => {
    const identity = resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), createProjectPackagingOverlay());

    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(identity.desktop)).toBe(true);
    expect(Object.isFrozen(identity.resources.packaged)).toBe(true);
  });

  it('rejects mutation of a nested resolved identity field', () => {
    const identity = resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), createProjectPackagingOverlay());

    expect(() => {
      identity.desktop.productName = 'Changed Product';
    }).toThrow(TypeError);
    expect(identity.desktop.productName).toBe('Acme Buddy');
  });

  it.each([null, false, 0, ''])('rejects an explicit non-contract overlay value: %j', (overlay) => {
    expect(() => resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay)).toThrow(
      'Packaging overlay must be an object'
    );
  });

  it('rejects unknown fields in a project packaging overlay', () => {
    const overlay = createProjectPackagingOverlay() as ReturnType<typeof createProjectPackagingOverlay> & {
      unexpected?: boolean;
    };
    overlay.unexpected = true;

    expect(() => resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay)).toThrow(
      'Packaging overlay has unexpected or missing fields'
    );
  });

  it('rejects an unsupported project packaging overlay schema', () => {
    const overlay = createProjectPackagingOverlay();
    overlay.schemaVersion = 2;

    expect(() => resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay)).toThrow(
      'Unsupported packaging overlay schema'
    );
  });

  it('rejects a project packaging overlay with a missing runtime identity', () => {
    const overlay = createProjectPackagingOverlay();
    overlay.product.runtimeIdentity = '';

    expect(() => resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay)).toThrow(
      'Packaging runtime identity must be a non-empty string'
    );
  });

  it('rejects a project packaging overlay from another runtime family', () => {
    const overlay = createProjectPackagingOverlay();
    overlay.product.runtimeIdentity = 'ki-buddy-acme';

    expect(() => resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay)).toThrow(
      'Packaging runtime identity must remain ki-buddy'
    );
  });

  it('rejects unknown fields inside a project desktop identity', () => {
    const overlay = createProjectPackagingOverlay();
    Object.assign(overlay.desktop, { unexpected: true });

    expect(() => resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay)).toThrow(
      'Packaging desktop identity has unexpected or missing fields'
    );
  });

  it.each([
    [
      'package author',
      (overlay: ReturnType<typeof createProjectPackagingOverlay>) =>
        Object.assign(overlay.packageMetadata.author, { unexpected: true }),
    ],
    [
      'publish configuration',
      (overlay: ReturnType<typeof createProjectPackagingOverlay>) =>
        Object.assign(overlay.desktop.publish, { unexpected: true }),
    ],
    [
      'Linux desktop entry',
      (overlay: ReturnType<typeof createProjectPackagingOverlay>) =>
        Object.assign(overlay.desktop.linux.desktop.entry, { unexpected: true }),
    ],
  ])('rejects unknown fields inside the %s', (_name, mutate) => {
    const overlay = createProjectPackagingOverlay();
    mutate(overlay);

    expect(() => resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay)).toThrow(
      'unexpected or missing fields'
    );
  });

  it('rejects a project packaging overlay with inconsistent product names', () => {
    const overlay = createProjectPackagingOverlay();
    overlay.packageMetadata.productName = 'Different Product';

    expect(() => resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay)).toThrow(
      'Packaging product names must match'
    );
  });

  it('rejects a project packaging overlay that escapes the repository for an asset', () => {
    const overlay = createProjectPackagingOverlay();
    overlay.resources.platform.png = '../outside.png';

    expect(() => resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay)).toThrow(
      'Packaging platform asset png must be a safe relative path'
    );
  });

  it('rejects remapping the runtime-consumed icon destination', () => {
    const overlay = createProjectPackagingOverlay();
    overlay.resources.packaged.runtimeIcon = 'acme-buddy/runtime.png';

    expect(() => resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay)).toThrow(
      'Packaging runtime icon path cannot be remapped'
    );
  });

  it('rejects remapping the runtime-consumed Ki-Core bundle destination', () => {
    const overlay = createProjectPackagingOverlay();
    overlay.resources.packaged.bundledAionCore = 'acme-buddy-core';

    expect(() => resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay)).toThrow(
      'Packaging bundled AionCore path cannot be remapped'
    );
  });

  it('rejects a project packaging overlay with a missing installation identity', () => {
    const overlay = createProjectPackagingOverlay();
    overlay.desktop.appId = '';

    expect(() => resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay)).toThrow(
      'Packaging app id must be a non-empty string'
    );
  });

  it('rejects a project packaging overlay without a protocol scheme', () => {
    const overlay = createProjectPackagingOverlay();
    overlay.desktop.protocols[0].schemes = [];

    expect(() => resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay)).toThrow(
      'Packaging protocol schemes must contain non-empty unique strings'
    );
  });

  it('rejects a protocol scheme shared by multiple protocol registrations', () => {
    const overlay = createProjectPackagingOverlay();
    overlay.desktop.protocols.push({ name: 'Acme Buddy Secondary Protocol', schemes: ['acme-buddy'] });
    overlay.desktop.linux.desktop.entry.MimeType = 'x-scheme-handler/acme-buddy;x-scheme-handler/acme-buddy;';

    expect(() => resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay)).toThrow(
      'Packaging protocol schemes must be globally unique'
    );
  });

  it('accepts multiple protocol registrations with distinct schemes and matching Linux handlers', () => {
    const overlay = createProjectPackagingOverlay();
    overlay.desktop.protocols.push({ name: 'Acme Buddy Secondary Protocol', schemes: ['acme-buddy-secondary'] });
    overlay.desktop.linux.desktop.entry.MimeType = 'x-scheme-handler/acme-buddy;x-scheme-handler/acme-buddy-secondary;';

    const identity = resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay);

    expect(identity.desktop.protocols).toEqual(overlay.desktop.protocols);
  });

  it('rejects a Linux protocol handler that does not match the resolved protocol schemes', () => {
    const overlay = createProjectPackagingOverlay();
    overlay.desktop.linux.desktop.entry.MimeType = 'x-scheme-handler/different;';

    expect(() => resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay)).toThrow(
      'Packaging Linux protocol handlers must match protocol schemes'
    );
  });

  it.each([
    [
      'package name',
      (overlay: ReturnType<typeof createProjectPackagingOverlay>) => (overlay.packageMetadata.name = ''),
    ],
    [
      'package author',
      (overlay: ReturnType<typeof createProjectPackagingOverlay>) => (overlay.packageMetadata.author.name = ''),
    ],
    ['product name', (overlay: ReturnType<typeof createProjectPackagingOverlay>) => (overlay.desktop.productName = '')],
    [
      'executable name',
      (overlay: ReturnType<typeof createProjectPackagingOverlay>) => (overlay.desktop.executableName = ''),
    ],
    [
      'publish provider',
      (overlay: ReturnType<typeof createProjectPackagingOverlay>) =>
        ((overlay.desktop.publish as { provider: string | null }).provider = null),
    ],
    [
      'Linux MimeType',
      (overlay: ReturnType<typeof createProjectPackagingOverlay>) =>
        (overlay.desktop.linux.desktop.entry.MimeType = ''),
    ],
  ])('rejects an overlay with a missing %s', (_name, mutate) => {
    const overlay = createProjectPackagingOverlay();
    mutate(overlay);

    expect(() => resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot), overlay)).toThrow(
      'must be a non-empty string'
    );
  });
});

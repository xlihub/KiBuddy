import { resolve } from 'node:path';

const { readProductConfig } = require('../../../../packages/shared-scripts/src/kiBuddyRelease');
const { resolveKiBuddyPackagingIdentity } = require('../../../../packages/shared-scripts/src/kiBuddyPackagingIdentity');

const projectRoot = resolve(__dirname, '../../../..');

export function createProjectPackagingOverlay() {
  const identity = structuredClone(resolveKiBuddyPackagingIdentity(readProductConfig(projectRoot)));
  identity.packageMetadata = {
    ...identity.packageMetadata,
    name: 'ki-buddy-acme',
    productName: 'Acme Buddy',
  };
  identity.desktop = {
    ...identity.desktop,
    appId: 'com.example.acme-buddy',
    productName: 'Acme Buddy',
    executableName: 'Acme-Buddy',
    protocols: [{ name: 'Acme Buddy Protocol', schemes: ['acme-buddy'] }],
    linux: {
      ...identity.desktop.linux,
      desktop: {
        entry: {
          ...identity.desktop.linux.desktop.entry,
          Name: 'Acme Buddy',
          Icon: 'Acme-Buddy',
          MimeType: 'x-scheme-handler/acme-buddy;',
        },
      },
    },
  };
  identity.resources = {
    platform: {
      png: 'resources/ki-buddy/app.png',
      ico: 'resources/ki-buddy/app.ico',
      icns: 'resources/ki-buddy/app.icns',
    },
    packaged: {
      applicationIcon: 'acme-buddy/application.png',
      runtimeIcon: identity.resources.packaged.runtimeIcon,
      buildEvidence: 'acme-buddy/build-evidence.json',
      agentsMcpAdapter: identity.resources.packaged.agentsMcpAdapter,
      bundledAionCore: identity.resources.packaged.bundledAionCore,
    },
  };
  return identity;
}

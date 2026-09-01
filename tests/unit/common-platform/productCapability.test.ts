import { expect, it } from 'vitest';
import { KI_BUDDY_PRODUCT_CAPABILITY } from '@/common/platform/ki-buddy/productCapability';

it('builds the renderer capability from the validated product configuration', () => {
  expect(KI_BUDDY_PRODUCT_CAPABILITY).toMatchObject({
    id: 'ki-buddy',
    schemaVersion: 4,
    integrations: ['agentsGateway'],
    brand: { productName: 'Ki-Buddy', cliName: 'Ki CLI' },
    assets: { logo: 'ki-buddy-app', mascot: 'ki-buddy-mascot' },
    locale: { namespace: 'kiBuddy' },
    themes: { light: 'ki-buddy-light', dark: 'ki-buddy-dark' },
    experience: {
      schemaVersion: 1,
      features: { team: 'disabled', scheduledTasks: 'enabled' },
    },
  });
});

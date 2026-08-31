import { describe, expect, it } from 'vitest';
import {
  KI_BUDDY_DEFAULT_AGENTS_BASE_URL,
  loadKiBuddyProductConfig,
  parseKiBuddyProductConfig,
} from '@/common/platform/ki-buddy';

const validConfig = {
  schemaVersion: 4,
  runtimeIdentity: 'ki-buddy',
  source: {
    repository: 'xlihub/KiBuddy',
    url: 'https://github.com/xlihub/KiBuddy',
  },
  internalRelease: {
    provider: 'github',
    repository: 'xlihub/KiBuddy',
    tagPrefix: 'ki-buddy-v',
    releasePageUrl: 'https://github.com/xlihub/KiBuddy/releases',
  },
  publicDistribution: {
    provider: 'github',
    repository: 'xlihub/Ki-Buddy',
    releasePageUrl: 'https://github.com/xlihub/Ki-Buddy/releases',
  },
  defaults: { agentsBaseUrl: 'https://agents.example.com', language: 'zh-CN' },
  electronBuilder: {
    appId: 'com.xlihub.ki-buddy',
    protocols: [{ name: 'Ki-Buddy Protocol', schemes: ['ki-buddy'] }],
  },
  locale: { namespace: 'kiBuddy' },
  themes: { light: 'ki-buddy-light', dark: 'ki-buddy-dark' },
  updates: {
    provider: 'github',
    repository: 'xlihub/Ki-Buddy',
    tagPrefix: 'ki-buddy-v',
    releasePageUrl: 'https://github.com/xlihub/Ki-Buddy/releases',
  },
  brand: {
    productName: 'Ki-Buddy',
    shortName: 'Ki-Buddy',
    cliName: 'Ki CLI',
    description: 'AI agent desktop workspace',
    links: {
      homepage: 'https://github.com/xlihub/KiBuddy',
      repository: 'https://github.com/xlihub/KiBuddy',
      releases: 'https://github.com/xlihub/Ki-Buddy/releases',
      support: 'https://github.com/xlihub/KiBuddy/issues',
      feedback: 'https://github.com/xlihub/KiBuddy/issues/new',
    },
  },
  assets: {
    platform: {
      png: 'resources/ki-buddy/app.png',
      ico: 'resources/ki-buddy/app.ico',
      icns: 'resources/ki-buddy/app.icns',
    },
    packaged: { icon: 'ki-buddy/app.png' },
    renderer: { logo: 'ki-buddy-app', mascot: 'ki-buddy-mascot' },
  },
  experience: {
    schemaVersion: 1,
    features: {
      account: 'enabled',
      agents: 'enabled',
      about: 'enabled',
      appearance: 'enabled',
      assistants: 'enabled',
      channels: 'disabled',
      componentShowcase: 'disabled',
      conversation: 'enabled',
      desktopPet: 'disabled',
      extensionMarketplace: 'disabled',
      extensionRuntime: 'disabled',
      extensionSettings: 'disabled',
      feedback: 'enabled',
      guid: 'enabled',
      guidFeedback: 'disabled',
      guidGithubStar: 'disabled',
      guidWebUi: 'disabled',
      githubResources: 'enabled',
      models: 'enabled',
      scheduledTasks: 'enabled',
      skills: 'enabled',
      system: 'enabled',
      team: 'disabled',
      themeCustomEditor: 'disabled',
      themeMarketplace: 'disabled',
      themePresets: 'disabled',
      tools: 'enabled',
      webUi: 'disabled',
    },
    resources: {
      agent: {
        productBuiltin: 'use',
        upstreamBuiltin: 'hidden',
        custom: 'manage',
        extension: 'hidden',
        unclassified: 'hidden',
      },
      assistant: {
        productBuiltin: 'use',
        upstreamBuiltin: 'hidden',
        custom: 'manage',
        extension: 'hidden',
        unclassified: 'hidden',
      },
      model: {
        productBuiltin: 'manage',
        upstreamBuiltin: 'manage',
        custom: 'manage',
        extension: 'hidden',
        unclassified: 'hidden',
      },
      skill: {
        productBuiltin: 'use',
        upstreamBuiltin: 'hidden',
        custom: 'manage',
        extension: 'hidden',
        unclassified: 'hidden',
      },
      mcp: {
        productBuiltin: 'use',
        upstreamBuiltin: 'hidden',
        custom: 'manage',
        extension: 'hidden',
        unclassified: 'hidden',
      },
    },
    behaviorDefaults: {
      scheduledTaskExecutor: 'assistant',
      autoInjectedSkillExclusions: ['aionui-config'],
    },
  },
} as const;

describe('Ki-Buddy product configuration', () => {
  it('uses the public Agents deployment by default', () => {
    expect(KI_BUDDY_DEFAULT_AGENTS_BASE_URL).toBe('https://ksapi.kingsware.cn');
  });

  it.each([
    '',
    'ftp://agents.example.com',
    'https://user:secret@agents.example.com',
    'https://agents.example.com?token=secret',
    'https://agents.example.com#fragment',
  ])('rejects invalid default deployment URL %s', (agentsBaseUrl) => {
    expect(() =>
      parseKiBuddyProductConfig({
        ...validConfig,
        defaults: { agentsBaseUrl, language: 'zh-CN' },
      })
    ).toThrow('Agents base URL');
  });

  it('rejects an unsupported product language instead of silently disabling the default', () => {
    expect(() =>
      parseKiBuddyProductConfig({
        ...validConfig,
        defaults: { agentsBaseUrl: 'https://agents.example.com', language: 'unsupported' },
      })
    ).toThrow('default language');
  });

  it('exposes the validated brand and assets', () => {
    expect(parseKiBuddyProductConfig(validConfig)).toMatchObject({
      schemaVersion: 4,
      brand: {
        productName: 'Ki-Buddy',
        cliName: 'Ki CLI',
        links: {
          repository: 'https://github.com/xlihub/KiBuddy',
          releases: 'https://github.com/xlihub/Ki-Buddy/releases',
          support: 'https://github.com/xlihub/KiBuddy/issues',
        },
      },
      assets: {
        packaged: { icon: 'ki-buddy/app.png' },
        renderer: { logo: 'ki-buddy-app', mascot: 'ki-buddy-mascot' },
      },
      electronBuilder: { appId: 'com.xlihub.ki-buddy', protocolScheme: 'ki-buddy' },
      locale: { namespace: 'kiBuddy' },
      themes: { light: 'ki-buddy-light', dark: 'ki-buddy-dark' },
      experience: {
        schemaVersion: 1,
        features: { team: 'disabled', scheduledTasks: 'enabled', tools: 'enabled' },
      },
    });
  });

  it('deeply freezes the validated product configuration', () => {
    const config = parseKiBuddyProductConfig(validConfig);

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.brand)).toBe(true);
    expect(Object.isFrozen(config.brand.links)).toBe(true);
    expect(Object.isFrozen(config.assets.renderer)).toBe(true);
    expect(Object.isFrozen(config.experience.resources.assistant)).toBe(true);
  });

  it('keeps local CLI Agent management enabled for a local project distribution', () => {
    const localConfig = {
      ...validConfig,
      distribution: {
        schemaVersion: 1,
        distributionId: 'zxjt',
        identityMode: 'local',
        mode: 'preview',
        dataDirectory: 'Ki-Buddy-ZXJT-Preview',
        credentialNamespace: 'ki-buddy-zxjt-preview',
        integrations: [],
        nonSensitiveConfig: { deployment: 'local' },
      },
      experience: {
        ...validConfig.experience,
        features: {
          ...validConfig.experience.features,
          account: 'disabled',
          agents: 'enabled',
          about: 'disabled',
          feedback: 'disabled',
        },
      },
    } as const;

    expect(parseKiBuddyProductConfig(localConfig).distribution).toMatchObject({
      distributionId: 'zxjt',
      identityMode: 'local',
      dataDirectory: 'Ki-Buddy-ZXJT-Preview',
      integrations: [],
    });
    expect(parseKiBuddyProductConfig(localConfig).experience.features.agents).toBe('enabled');
    expect(() =>
      parseKiBuddyProductConfig({
        ...localConfig,
        experience: validConfig.experience,
      })
    ).toThrow('must disable account');
  });

  it('rejects unknown or external project identity configuration', () => {
    expect(() =>
      parseKiBuddyProductConfig({
        ...validConfig,
        distribution: {
          schemaVersion: 1,
          distributionId: 'zxjt',
          identityMode: 'external',
          mode: 'preview',
          dataDirectory: 'Ki-Buddy-ZXJT-Preview',
          credentialNamespace: 'ki-buddy-zxjt-preview',
          integrations: [],
          nonSensitiveConfig: {},
        },
      })
    ).toThrow('identity mode');
  });

  it('rejects an unsafe project data-directory identity', () => {
    expect(() =>
      parseKiBuddyProductConfig({
        ...validConfig,
        distribution: {
          schemaVersion: 1,
          distributionId: 'zxjt',
          identityMode: 'local',
          mode: 'preview',
          dataDirectory: '../Ki-Buddy',
          credentialNamespace: 'ki-buddy-zxjt-preview',
          integrations: [],
          nonSensitiveConfig: {},
        },
      })
    ).toThrow('data directory');
  });

  it('rejects unknown project integrations at runtime', () => {
    expect(() =>
      parseKiBuddyProductConfig({
        ...validConfig,
        distribution: {
          schemaVersion: 1,
          distributionId: 'zxjt',
          identityMode: 'local',
          mode: 'preview',
          dataDirectory: 'Ki-Buddy-ZXJT-Preview',
          credentialNamespace: 'ki-buddy-zxjt-preview',
          integrations: ['unknownIntegration'],
          nonSensitiveConfig: {},
        },
      })
    ).toThrow('integration');
  });

  it('rejects unknown runtime product fields', () => {
    expect(() => parseKiBuddyProductConfig({ ...validConfig, unexpected: true })).toThrow('unexpected unexpected');
  });

  it('rejects schema v3 instead of inferring the separated repository identities', () => {
    expect(() => parseKiBuddyProductConfig({ ...validConfig, schemaVersion: 3 })).toThrow('schema');
  });

  it('rejects a source URL that does not match the source repository', () => {
    expect(() =>
      parseKiBuddyProductConfig({
        ...validConfig,
        source: { ...validConfig.source, url: 'https://github.com/xlihub/Ki-Buddy' },
      })
    ).toThrow('source URL');
  });

  it('does not make runtime startup depend on internal release metadata', () => {
    expect(() =>
      parseKiBuddyProductConfig({
        ...validConfig,
        internalRelease: { repository: 'invalid-runtime-irrelevant-value' },
      })
    ).not.toThrow();
  });

  it('rejects a runtime identity that conflicts with the Ki-Buddy package marker', () => {
    expect(() => parseKiBuddyProductConfig({ ...validConfig, runtimeIdentity: 'other-product' })).toThrow(
      'runtime identity'
    );
  });

  it('captures packaged policy errors so startup can show installation integrity', () => {
    const result = loadKiBuddyProductConfig({
      ...validConfig,
      experience: { ...validConfig.experience, features: { team: 'disabled' } },
    });

    expect(result).toEqual({
      config: null,
      error: expect.stringContaining('missing'),
    });
  });

  it('captures a disabled required Guid as an installation integrity error', () => {
    const result = loadKiBuddyProductConfig({
      ...validConfig,
      experience: {
        ...validConfig.experience,
        features: {
          ...validConfig.experience.features,
          guid: 'disabled',
        },
      },
    });

    expect(result).toEqual({
      config: null,
      error: 'Product feature guid must be enabled',
    });
  });

  it('rejects missing theme resources at startup', () => {
    const { themes: _themes, ...withoutThemes } = validConfig;
    expect(() => parseKiBuddyProductConfig(withoutThemes)).toThrow('missing themes');
  });

  it('rejects malformed or unsupported product presentation resources at startup', () => {
    expect(() =>
      parseKiBuddyProductConfig({
        ...validConfig,
        assets: { ...validConfig.assets, renderer: { logo: 'unknown-logo', mascot: 'ki-buddy-mascot' } },
      })
    ).toThrow('renderer logo asset');
    expect(() =>
      parseKiBuddyProductConfig({ ...validConfig, themes: { light: 'unknown-light', dark: 'ki-buddy-dark' } })
    ).toThrow('light theme');
  });

  it('rejects malformed product protocol configuration at startup', () => {
    expect(() =>
      parseKiBuddyProductConfig({
        ...validConfig,
        electronBuilder: { ...validConfig.electronBuilder, protocols: [] },
      })
    ).toThrow('protocol');
    expect(() =>
      parseKiBuddyProductConfig({
        ...validConfig,
        electronBuilder: {
          ...validConfig.electronBuilder,
          protocols: [{ name: 'Ki-Buddy Protocol', schemes: ['not valid'] }],
        },
      })
    ).toThrow('protocol scheme');
  });

  it('rejects unknown nested brand fields', () => {
    expect(() =>
      parseKiBuddyProductConfig({ ...validConfig, brand: { ...validConfig.brand, alias: 'Buddy' } })
    ).toThrow('Ki-Buddy brand has invalid fields');
  });

  it('rejects a product link that is not an absolute HTTP(S) URL', () => {
    expect(() =>
      parseKiBuddyProductConfig({
        ...validConfig,
        brand: { ...validConfig.brand, links: { ...validConfig.brand.links, support: '/support' } },
      })
    ).toThrow('brand link');
  });

  it('rejects an update source that does not match the public distribution source', () => {
    expect(() =>
      parseKiBuddyProductConfig({
        ...validConfig,
        updates: { ...validConfig.updates, repository: 'iOfficeAI/AionUi' },
      })
    ).toThrow('update source');
  });
});

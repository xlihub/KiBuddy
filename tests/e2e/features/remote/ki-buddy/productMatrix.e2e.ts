import type { ElectronApplication, Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { httpDelete, httpInvoke, invokeBridge } from '../../../helpers';
import { FIRST_RELEASE_MATRIX } from './firstReleaseMatrix';
import { MATRIX_TEST_USER, startMatrixAgentsServer } from './fakeAgentsServer';
import {
  captureProcessTreeNetworkState,
  findUnexpectedApplicationListeners,
  partitionExpectedPlaywrightElectronListeners,
} from './processTreeNetworkState';
import {
  closePackagedApp,
  currentKiCoreRelease,
  currentSourceCommit,
  currentSourceStateSha256,
  isSourceTreeDirty,
  launchPackagedApp,
  readBackendBundleEvidence,
  readProductBuildEvidence,
  sha256Source,
  type LaunchedPackagedApp,
} from './packagedApp';

type ProductBootstrap = Readonly<{
  capability: null | {
    experience: {
      behaviorDefaults: unknown;
      features: unknown;
      resources: unknown;
      schemaVersion: number;
    };
    id: string;
    schemaVersion: number;
  };
  error: string | null;
  productIdentity: string | null;
  status: 'absent' | 'invalid' | 'ready';
}>;

type FirstFrameViolation = Readonly<{ html: string; selector: string }>;

const EXTENSION_CONTRIBUTION_QUERIES = [
  'extensions.get-loaded-extensions',
  'extensions.get-acp-adapters',
  'extensions.get-mcp-servers',
  'extensions.get-assistants',
  'extensions.get-agents',
  'extensions.get-skills',
  'extensions.get-themes',
  'extensions.get-settings-tabs',
  'extensions.get-webui-contributions',
] as const;

async function readOptionalRuntimeState(page: Page): Promise<{
  channels: { available: boolean; error?: string; value?: unknown };
  extensionContributions: Record<string, { available: boolean; error?: string; value?: unknown }>;
}> {
  const probe = async (key: string): Promise<{ available: boolean; error?: string; value?: unknown }> => {
    try {
      return { available: true, value: await invokeBridge(page, key, undefined, 1_500) };
    } catch (error) {
      return { available: false, error: String(error) };
    }
  };
  const [channels, ...extensionStates] = await Promise.all([
    probe('channel.get-plugin-status'),
    ...EXTENSION_CONTRIBUTION_QUERIES.map(probe),
  ]);
  return {
    channels,
    extensionContributions: Object.fromEntries(
      EXTENSION_CONTRIBUTION_QUERIES.map((key, index) => [key, extensionStates[index]])
    ),
  };
}

async function readFirstFrameViolations(page: Page): Promise<FirstFrameViolation[]> {
  const observerState = await page.evaluate(() => window.__getE2EUiObserverState?.());
  if (!observerState) throw new Error('The first-frame observer was not installed before renderer startup.');
  expect(observerState.selectors).toEqual([
    '[data-testid="installation-integrity-dialog"]',
    ...new Set(Object.values(FIRST_RELEASE_MATRIX.disabledFeatureEvidence.flashObserved).flat()),
  ]);
  return observerState.violations;
}

async function confirmVisibleAionModal(page: Page): Promise<void> {
  await page.locator('.aionui-modal-wrapper:visible .aionui-modal-std-footer button.arco-btn-primary').click();
}

async function revealHoverMenu(row: Locator, trigger: Locator, menuItem: Locator): Promise<void> {
  await expect(async () => {
    await row.hover();
    await trigger.hover();
    await expect(menuItem).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

async function attachClientState(testInfo: TestInfo, app: LaunchedPackagedApp, name: string): Promise<void> {
  const [snapshot, mainProcessState, optionalRuntimeState, processTreeNetworkState] = await Promise.all([
    app.page.evaluate(() => ({
      bodyText: document.body.innerText.slice(0, 6_000),
      hash: window.location.hash,
      title: document.title,
      bootstrap: window.__getKiBuddyProductBootstrap?.() ?? null,
    })),
    readMainProcessState(app.electronApp).catch((error: unknown) => ({ error: String(error) })),
    readOptionalRuntimeState(app.page).catch((error: unknown) => ({ error: String(error) })),
    Promise.resolve()
      .then(() => captureProcessTreeNetworkState(app.processId))
      .catch((error: unknown) => ({ error: String(error) })),
  ]);
  await testInfo.attach(`${name}.json`, {
    body: Buffer.from(
      JSON.stringify(
        { ...snapshot, mainProcessState, optionalRuntimeState, processTreeNetworkState, logs: app.logs.slice(-2_000) },
        null,
        2
      )
    ),
    contentType: 'application/json',
  });
  await testInfo.attach(`${name}.png`, {
    body: await app.page.screenshot(),
    contentType: 'image/png',
  });
}

async function skipOpeningGuide(page: Page): Promise<void> {
  const guideOrLogin = page.locator('#ki-buddy-opening-guide-title, input[autocomplete="username"]').first();
  await guideOrLogin.waitFor({ state: 'visible', timeout: 45_000 });
  const skip = page.getByRole('button', { name: /^(跳过|Skip)$/i });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.locator('input[autocomplete="username"]').waitFor({ state: 'visible', timeout: 15_000 });
}

async function login(page: Page, baseUrl: string): Promise<void> {
  await skipOpeningGuide(page);
  await page.locator('input[autocomplete="url"]').fill(baseUrl);
  await page.locator('input[autocomplete="username"]').fill(MATRIX_TEST_USER.userName);
  await page.locator('input[autocomplete="current-password"]').fill('matrix-password');
  await page.getByRole('button', { name: /^(登录|Sign In)$/i }).click();
  await expect(page).toHaveURL(/#\/guid$/, { timeout: 45_000 });
}

async function ensureLoggedIn(page: Page, baseUrl: string): Promise<void> {
  const currentUser = await httpInvoke<{ success: boolean }>(page, 'GET', '/api/auth/user').catch(() => null);
  if (currentUser?.success !== true) await login(page, baseUrl);
}

async function readMainProcessState(electronApp: ElectronApplication): Promise<{
  agentsMcpBridgePort: number | null;
  startedProductLifecycles: string[];
  trayMenuLabels: string[];
  windows: Array<{ title: string; url: string; visible: boolean }>;
}> {
  return electronApp.evaluate(async ({ BrowserWindow }) => {
    const e2eGlobal = globalThis as typeof globalThis & {
      __aionuiE2EStartedMainProductLifecycles?: () => string[];
      __aionuiE2ETrayMenuLabels?: () => Promise<string[]>;
    };
    const windows = BrowserWindow.getAllWindows().map((window) => ({
      title: window.getTitle(),
      url: window.webContents.getURL(),
      visible: window.isVisible(),
    }));
    const agentsMcpBridgeUrl = process.env.KI_BUDDY_AGENTS_ADAPTER_BRIDGE_URL;
    const agentsMcpBridgePort = agentsMcpBridgeUrl ? Number(new URL(agentsMcpBridgeUrl).port) : null;
    const trayMenuLabels = (await e2eGlobal.__aionuiE2ETrayMenuLabels?.()) ?? [];
    const startedProductLifecycles = e2eGlobal.__aionuiE2EStartedMainProductLifecycles?.() ?? [];
    return { agentsMcpBridgePort, startedProductLifecycles, trayMenuLabels, windows };
  });
}

test.describe.serial('Ki-Buddy packaged first-release product matrix', () => {
  test.skip(process.env.E2E_PACKAGED !== '1', 'This acceptance suite requires packaged Electron applications.');
  test.setTimeout(240_000);

  let productApp: LaunchedPackagedApp;
  let agents: Awaited<ReturnType<typeof startMatrixAgentsServer>>;

  test.beforeAll(async () => {
    agents = await startMatrixAgentsServer();
    productApp = await launchPackagedApp('ki-buddy');
  });

  test.afterAll(async () => {
    if (productApp) await closePackagedApp(productApp).catch(() => undefined);
    if (agents) await agents.close().catch(() => undefined);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus && productApp?.page && !productApp.page.isClosed()) {
      await attachClientState(testInfo, productApp, 'failure-state').catch(() => undefined);
    }
    if (productApp?.page && !productApp.page.isClosed()) {
      await productApp.page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
    }
  });

  test('attests product identity, policy sources, tested commit, release mapping, and policy oracle', async ({}, testInfo) => {
    const evidence = readProductBuildEvidence(productApp.package);
    const backendEvidence = readBackendBundleEvidence(productApp.package);
    const kiCoreRelease = currentKiCoreRelease();
    const bootstrap = await productApp.page.evaluate(
      () => window.__getKiBuddyProductBootstrap?.() as ProductBootstrap | undefined
    );
    const appIdentity = await productApp.electronApp.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      name: app.getName(),
      version: app.getVersion(),
    }));

    expect(appIdentity).toMatchObject({ isPackaged: true, name: 'Ki-Buddy' });
    expect(evidence).toMatchObject({
      schemaVersion: 2,
      product: { runtimeIdentity: 'ki-buddy', productName: 'Ki-Buddy' },
      source: {
        repository: 'xlihub/KiBuddy',
        commit: currentSourceCommit(),
        stateSha256: currentSourceStateSha256(),
        treeDirty: isSourceTreeDirty(),
      },
      release: {
        internal: { repository: 'xlihub/KiBuddy' },
        publicDistribution: { repository: 'xlihub/Ki-Buddy' },
        runtimeUpdates: { repository: 'xlihub/Ki-Buddy' },
      },
    });
    for (const source of Object.values(evidence.policySources)) {
      expect(source.sha256).toBe(sha256Source(source.path));
    }
    expect(backendEvidence).toMatchObject({
      kiCore: {
        releaseCommit: kiCoreRelease.releaseCommit,
        tag: kiCoreRelease.tag,
      },
      source: {
        policy: 'release-pinned',
        repository: kiCoreRelease.repository,
        tag: kiCoreRelease.tag,
        type: 'github-release',
      },
    });
    expect(bootstrap).toMatchObject({
      status: 'ready',
      productIdentity: 'ki-buddy',
      error: null,
      capability: {
        id: 'ki-buddy',
        schemaVersion: 3,
        experience: {
          schemaVersion: 1,
          features: FIRST_RELEASE_MATRIX.features,
          resources: FIRST_RELEASE_MATRIX.resources,
          behaviorDefaults: FIRST_RELEASE_MATRIX.behaviorDefaults,
        },
      },
    });
    expect(await readFirstFrameViolations(productApp.page)).toEqual([]);
    await testInfo.attach('packaged-build-evidence.json', {
      body: Buffer.from(JSON.stringify({ appIdentity, evidence, backendEvidence, kiCoreRelease, bootstrap }, null, 2)),
      contentType: 'application/json',
    });
    await attachClientState(testInfo, productApp, 'first-visible-frame');
  });

  test('keeps the product entry stable before login, after login, refresh, and restart', async ({}, testInfo) => {
    await skipOpeningGuide(productApp.page);
    await expect(productApp.page.locator('[data-settings-id="webui"], [data-settings-id="pet"]')).toHaveCount(0);
    expect(await readFirstFrameViolations(productApp.page)).toEqual([]);

    await login(productApp.page, agents.baseUrl);
    await expect(productApp.page.getByTestId('guid-input')).toBeVisible({ timeout: 30_000 });
    await expect(productApp.page.locator('[class*="guidQuickActions"]')).toHaveCount(0);
    expect(await readFirstFrameViolations(productApp.page)).toEqual([]);

    await productApp.page.reload();
    await expect(productApp.page).toHaveURL(/#\/guid$/, { timeout: 45_000 });
    await expect(productApp.page.getByTestId('guid-input')).toBeVisible({ timeout: 30_000 });
    expect(await readFirstFrameViolations(productApp.page)).toEqual([]);

    const sandboxDir = productApp.sandboxDir;
    await closePackagedApp(productApp, false);
    productApp = await launchPackagedApp('ki-buddy', sandboxDir);
    await expect(productApp.page).toHaveURL(/#\/guid$/, { timeout: 45_000 });
    await expect(productApp.page.getByTestId('guid-input')).toBeVisible({ timeout: 30_000 });
    expect(await readFirstFrameViolations(productApp.page)).toEqual([]);
    await attachClientState(testInfo, productApp, 'after-restart');
  });

  test('projects navigation, Appearance capabilities, and disabled-route replace redirects', async () => {
    await productApp.page.evaluate(() => {
      window.location.hash = '#/guid';
    });
    await expect(productApp.page.getByText(/^(新会话|New Chat)$/i)).toBeVisible({ timeout: 20_000 });
    await expect(productApp.page.getByText(/^(助手|Assistants)$/i)).toBeVisible();
    await expect(productApp.page.getByText(/^(定时任务|Scheduled Tasks)$/i)).toBeVisible();

    await productApp.page.evaluate(() => {
      window.location.hash = '#/settings/account';
    });
    await expect(productApp.page.locator('[data-settings-id="account"]')).toBeVisible({ timeout: 20_000 });
    const settingsIds = await productApp.page
      .locator('[data-settings-id]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-settings-id')).filter((value): value is string => Boolean(value))
      );
    expect(settingsIds).toEqual(FIRST_RELEASE_MATRIX.settingsEntries);
    await expect(productApp.page.locator('[data-settings-path^="ext/"]')).toHaveCount(0);

    await productApp.page.evaluate(() => {
      window.location.hash = '#/settings/appearance';
    });
    await expect(productApp.page).toHaveURL(/#\/settings\/appearance$/);
    await expect(productApp.page.getByText(/^(缩放|Scale)$/i)).toBeVisible({ timeout: 20_000 });
    await expect(productApp.page.getByText(/^(聊天|Chat)$/i)).toBeVisible();
    await expect(productApp.page.getByText(/^(主题|Theme)$/i)).toHaveCount(0);

    for (const route of [
      ...FIRST_RELEASE_MATRIX.disabledWorkspaceRoutes,
      ...FIRST_RELEASE_MATRIX.disabledSettingsRoutes,
    ]) {
      const historyLength = await productApp.page.evaluate(() => history.length);
      await productApp.page.evaluate((disabledRoute) => {
        window.location.hash = `#${disabledRoute}`;
      }, route);
      await expect
        .poll(() => productApp.page.evaluate(() => window.location.hash), { timeout: 15_000 })
        .not.toBe(`#${route}`);
      expect(await productApp.page.evaluate(() => history.length)).toBe(historyLength + 1);
    }
  });

  test('enforces Agent product-use, hidden-upstream, and Custom-management access', async () => {
    const baselineAgents = await httpInvoke<Array<Record<string, unknown> & { id: string; name: string }>>(
      productApp.page,
      'GET',
      '/api/agents/management'
    );
    const productAgent = baselineAgents.find(({ id }) => id === FIRST_RELEASE_MATRIX.productResources.agents[0]);
    if (!productAgent) throw new Error('The packaged Agent catalog is missing the product Agent fixture source.');
    const agentFixtures = [
      { ...productAgent, id: 'matrix-custom-agent', name: 'Matrix Custom Agent', agent_source: 'custom' },
      { ...productAgent, id: 'matrix-upstream-agent', name: 'Matrix Upstream Agent', agent_source: 'builtin' },
      {
        ...productAgent,
        id: 'matrix-extension-agent',
        name: 'Matrix Extension Agent',
        agent_source: 'extension',
        isExtension: true,
      },
      { ...productAgent, id: 'matrix-unclassified-agent', name: 'Matrix Unclassified Agent', agent_source: 'future' },
    ];
    const agentListPattern = '**/api/agents/management';
    await productApp.page.route(agentListPattern, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [...baselineAgents, ...agentFixtures] }),
      });
    });
    await productApp.page.reload();
    await productApp.page.evaluate(() => {
      window.location.hash = '#/settings/agent';
    });
    await expect(productApp.page.getByTestId('agent-management-page')).toBeVisible({ timeout: 30_000 });
    await expect(productApp.page.getByTestId('btn-add-custom-agent')).toBeVisible();
    await expect(productApp.page.getByTestId('agent-row-632f31d2')).toBeVisible({ timeout: 30_000 });
    await expect(productApp.page.getByTestId('agent-row-edit-632f31d2')).toHaveCount(0);
    await expect(productApp.page.getByTestId('agent-row-matrix-custom-agent')).toBeVisible();
    await expect(productApp.page.getByTestId('agent-row-edit-matrix-custom-agent')).toBeVisible();
    for (const hiddenAgentId of ['matrix-upstream-agent', 'matrix-extension-agent', 'matrix-unclassified-agent']) {
      await expect(productApp.page.getByTestId(`agent-row-${hiddenAgentId}`)).toHaveCount(0);
    }
    await productApp.page.unroute(agentListPattern);
  });

  test('creates, edits, and deletes a real Custom Model without inventing unavailable origins', async () => {
    const modelName = `ki-buddy-custom-model-${Date.now()}`;
    const providerBaseUrl = `${agents.baseUrl}/v1`;
    const fetchModelsPattern = '**/api/providers/fetch-models';
    const detectProtocolPattern = '**/api/providers/detect-protocol';
    const fetchModelRequests: unknown[] = [];
    const detectProtocolRequests: unknown[] = [];

    await productApp.page.route(fetchModelsPattern, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      fetchModelRequests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { models: [modelName] } }),
      });
    });
    await productApp.page.route(detectProtocolPattern, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      detectProtocolRequests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { success: true, protocol: 'openai', confidence: 100 } }),
      });
    });

    try {
      await productApp.page.evaluate(() => {
        window.location.hash = '#/settings/model';
      });
      await expect(productApp.page.getByTestId('model-header')).toBeVisible({ timeout: 20_000 });
      await productApp.page.getByTestId('model-add').click();
      await productApp.page.getByTestId('model-add-manual').click();

      const createForm = productApp.page.getByTestId('model-provider-create-form');
      await expect(createForm).toBeVisible();
      await createForm.getByTestId('model-provider-base-url').fill(providerBaseUrl);
      await createForm.getByTestId('model-provider-api-key').fill('sk-ki-buddy-matrix');
      await expect.poll(() => fetchModelRequests.length).toBeGreaterThan(0);
      await expect.poll(() => detectProtocolRequests.length).toBeGreaterThan(0);
      expect(fetchModelRequests[0]).toMatchObject({
        api_key: 'sk-ki-buddy-matrix',
        base_url: providerBaseUrl,
        platform: 'custom',
      });
      expect(detectProtocolRequests[0]).toMatchObject({
        api_key: 'sk-ki-buddy-matrix',
        base_url: providerBaseUrl,
      });

      const modelSelect = createForm.getByTestId('model-provider-models');
      await modelSelect.click();
      await modelSelect.locator('input').fill(modelName);
      await modelSelect.locator('input').press('Enter');
      await confirmVisibleAionModal(productApp.page);

      const providerEntry = productApp.page
        .locator(
          '[data-testid^="model-provider-"][data-product-resource-origin="custom"][data-product-resource-access="manage"]'
        )
        .filter({ hasText: modelName });
      await expect(providerEntry).toBeVisible({ timeout: 20_000 });
      await expect(productApp.page.locator('[data-product-resource-origin="productBuiltin"]')).toHaveCount(0);
      await expect(productApp.page.locator('[data-product-resource-origin="upstreamBuiltin"]')).toHaveCount(0);
      const createdProviders = await httpInvoke<
        Array<{ base_url: string; id: string; models: string[]; name: string; platform: string }>
      >(productApp.page, 'GET', '/api/providers');
      const createdProvider = createdProviders.find(({ models }) => models.includes(modelName));
      expect(createdProvider).toMatchObject({
        base_url: providerBaseUrl,
        models: expect.arrayContaining([modelName]),
        platform: 'custom',
      });
      if (!createdProvider) throw new Error('Custom Model was not persisted by the packaged backend.');

      await providerEntry.hover();
      await providerEntry.locator('[data-testid^="model-provider-edit-"]').click();
      const editForm = productApp.page.getByTestId('model-provider-edit-form');
      await expect(editForm).toBeVisible();
      const editedProviderName = `Ki-Buddy Custom Provider ${Date.now()}`;
      await editForm.getByTestId('model-provider-name').fill(editedProviderName);
      await confirmVisibleAionModal(productApp.page);
      await expect(providerEntry).toContainText(editedProviderName, { timeout: 20_000 });
      await expect
        .poll(
          async () => {
            const providers = await httpInvoke<Array<{ id: string; name: string }>>(
              productApp.page,
              'GET',
              '/api/providers'
            );
            return providers.find(({ id }) => id === createdProvider.id)?.name;
          },
          { timeout: 20_000 }
        )
        .toBe(editedProviderName);

      await providerEntry.hover();
      await providerEntry.locator('[data-testid^="model-provider-delete-"]').click();
      await productApp.page.locator('.arco-popconfirm:visible button.arco-btn-primary').click();
      await expect(providerEntry).toHaveCount(0, { timeout: 20_000 });
      await expect
        .poll(
          async () => {
            const providers = await httpInvoke<Array<{ id: string }>>(productApp.page, 'GET', '/api/providers');
            return providers.some(({ id }) => id === createdProvider.id);
          },
          { timeout: 20_000 }
        )
        .toBe(false);
      const remainingProviders = await httpInvoke<Array<{ id: string; models?: string[] }>>(
        productApp.page,
        'GET',
        '/api/providers'
      );
      expect(remainingProviders.map(({ id }) => id)).not.toContain(createdProvider.id);
      expect(remainingProviders.flatMap(({ models = [] }) => models)).not.toContain(modelName);
    } finally {
      await productApp.page.unroute(fetchModelsPattern);
      await productApp.page.unroute(detectProtocolPattern);
    }
  });

  test('enforces Assistant product-management, hidden-upstream, and Custom-management access', async () => {
    const baselineAssistants = await httpInvoke<Array<Record<string, unknown> & { id: string; name: string }>>(
      productApp.page,
      'GET',
      '/api/assistants'
    );
    const productAssistant = baselineAssistants.find(({ id }) => id === 'word-creator');
    if (!productAssistant) throw new Error('The packaged Assistant catalog is missing the product fixture source.');
    const productAssistantAgent =
      productAssistant.agent && typeof productAssistant.agent === 'object' ? productAssistant.agent : {};
    const assistantFixtures = [
      {
        ...productAssistant,
        id: 'matrix-custom-assistant',
        name: 'Matrix Custom Assistant',
        source: 'user',
        deletable: true,
      },
      { ...productAssistant, id: 'matrix-upstream-assistant', name: 'Matrix Upstream Assistant', source: 'builtin' },
      {
        ...productAssistant,
        id: 'matrix-extension-assistant',
        name: 'Matrix Extension Assistant',
        source: 'generated',
        agent: { ...productAssistantAgent, type: 'acp', source: 'extension' },
      },
      {
        ...productAssistant,
        id: 'matrix-unclassified-assistant',
        name: 'Matrix Unclassified Assistant',
        source: 'future',
      },
    ];
    const assistantListPattern = '**/api/assistants';
    await productApp.page.route(assistantListPattern, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [...baselineAssistants, ...assistantFixtures] }),
      });
    });
    await productApp.page.reload();
    await productApp.page.evaluate(() => {
      window.location.hash = '#/assistants';
    });
    await expect(productApp.page.getByTestId('assistants-header')).toBeVisible({ timeout: 30_000 });
    await expect(productApp.page.getByTestId('btn-create-assistant')).toBeVisible();
    await productApp.page.getByTestId('settings-tab-official').click();
    for (const assistantId of FIRST_RELEASE_MATRIX.productResources.assistants.filter(
      (resourceId) => !resourceId.startsWith('bare:')
    )) {
      await expect(productApp.page.getByTestId(`official-card-${assistantId}`)).toBeVisible({ timeout: 30_000 });
      await expect(productApp.page.getByTestId(`switch-enabled-${assistantId}`)).toBeVisible();
    }
    await expect(productApp.page.getByTestId('official-card-cowork')).toHaveCount(0);
    await productApp.page.getByTestId('settings-tab-mine').click();
    const bareAssistantId = FIRST_RELEASE_MATRIX.productResources.assistants.find((resourceId) =>
      resourceId.startsWith('bare:')
    );
    expect(bareAssistantId).toBeTruthy();
    await expect(productApp.page.getByTestId(`assistant-card-${bareAssistantId}`)).toBeVisible({ timeout: 30_000 });
    await expect(productApp.page.getByTestId('assistant-card-matrix-custom-assistant')).toBeVisible();
    await expect(productApp.page.getByTestId('switch-enabled-matrix-custom-assistant')).toBeVisible();
    for (const hiddenAssistantId of [
      'matrix-upstream-assistant',
      'matrix-extension-assistant',
      'matrix-unclassified-assistant',
    ]) {
      await expect(productApp.page.getByTestId(`official-card-${hiddenAssistantId}`)).toHaveCount(0);
      await expect(productApp.page.getByTestId(`assistant-card-${hiddenAssistantId}`)).toHaveCount(0);
    }
    await productApp.page.unroute(assistantListPattern);
  });

  test('enforces Skill product-use, hidden-upstream, and Custom-management access', async () => {
    const baselineSkills = await httpInvoke<Array<Record<string, unknown> & { name: string }>>(
      productApp.page,
      'GET',
      '/api/skills'
    );
    const productSkill = baselineSkills.find(({ name }) => name === FIRST_RELEASE_MATRIX.productResources.skills[0]);
    if (!productSkill) throw new Error('The packaged Skill catalog is missing the product fixture source.');
    const skillFixtures = [
      {
        ...productSkill,
        name: 'matrix-custom-skill',
        description: 'Matrix Custom Skill',
        source: 'custom',
        is_custom: true,
        is_auto_inject: false,
      },
      {
        ...productSkill,
        name: 'matrix-upstream-skill',
        description: 'Matrix Upstream Skill',
        source: 'builtin',
        is_custom: false,
        is_auto_inject: false,
      },
      {
        ...productSkill,
        name: 'matrix-extension-skill',
        description: 'Matrix Extension Skill',
        source: 'extension',
        is_custom: false,
        is_auto_inject: false,
      },
      {
        ...productSkill,
        name: 'matrix-unclassified-skill',
        description: 'Matrix Unclassified Skill',
        source: 'future',
        is_custom: false,
        is_auto_inject: false,
      },
    ];
    const skillListPattern = '**/api/skills';
    await productApp.page.route(skillListPattern, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [...baselineSkills, ...skillFixtures] }),
      });
    });
    await productApp.page.reload();
    await productApp.page.evaluate(() => {
      window.location.hash = '#/settings/skills';
    });
    await expect(productApp.page.getByTestId('skills-header')).toBeVisible({ timeout: 30_000 });
    await expect(productApp.page.getByTestId('btn-add-skill')).toBeVisible();
    await productApp.page.getByTestId('settings-tab-official').click();
    await expect(productApp.page.locator('[data-testid="extension-skills-section"]')).toHaveCount(0);
    await Promise.all(
      FIRST_RELEASE_MATRIX.productResources.skills.flatMap((skillName) => [
        expect(productApp.page.getByTestId(`official-skill-card-${skillName}`)).toBeVisible({ timeout: 30_000 }),
        expect(productApp.page.getByTestId(`btn-delete-${skillName}`)).toHaveCount(0),
      ])
    );
    await expect(productApp.page.getByTestId('official-skill-card-cron')).toHaveCount(0);
    await expect(productApp.page.getByTestId('official-skill-card-aionui-config')).toHaveCount(0);
    for (const hiddenSkillName of ['matrix-upstream-skill', 'matrix-extension-skill', 'matrix-unclassified-skill']) {
      await expect(productApp.page.getByText(hiddenSkillName, { exact: true })).toHaveCount(0);
    }
    await productApp.page.getByTestId('settings-tab-custom').click();
    await expect(productApp.page.getByTestId('my-skill-card-matrix-custom-skill')).toBeVisible();
    await expect(productApp.page.getByTestId('btn-delete-matrix-custom-skill')).toBeVisible();
    await productApp.page.unroute(skillListPattern);
  });

  test('tests the packaged Agents MCP Adapter through the generic backend connection API', async () => {
    type BackendMcpServer = Readonly<{
      builtin?: boolean;
      enabled: boolean;
      id: string;
      name: string;
      original_json: string;
      transport: Readonly<{ args?: string[]; command: string; type: string }>;
    }>;
    let agentsAdapter: BackendMcpServer | undefined;

    await ensureLoggedIn(productApp.page, agents.baseUrl);

    await expect
      .poll(
        async () => {
          const servers = await httpInvoke<BackendMcpServer[]>(productApp.page, 'GET', '/api/mcp/servers');
          agentsAdapter = servers.find(({ name }) => name === 'agents-mcp-adapter');
          return agentsAdapter;
        },
        { timeout: 30_000 }
      )
      .toMatchObject({
        builtin: true,
        enabled: true,
        transport: { type: 'stdio', command: 'node', args: [expect.stringContaining('builtin-mcp-agents.js')] },
      });
    if (!agentsAdapter) throw new Error('The packaged Agents MCP Adapter was not registered.');

    const result = await httpInvoke<{
      success: boolean;
      tools?: Array<{ name: string }>;
    }>(productApp.page, 'POST', '/api/mcp/test-connection', {
      ...agentsAdapter,
      runtime_scope_id: agentsAdapter.id,
    });

    expect(result.success).toBe(true);
    expect(result.tools?.map(({ name }) => name)).toContain('agents_list');
    expect(result.tools?.map(({ name }) => name)).toContain('agents_describe');
    expect(await readFirstFrameViolations(productApp.page)).toEqual([]);
  });

  test('enforces the MCP origin matrix and completes Custom MCP CRUD through the UI', async () => {
    const now = Date.now();
    const visibleProductMcp = {
      id: `matrix-product-mcp-${now}`,
      name: `Matrix Product MCP ${now}`,
      enabled: true,
      builtin: false,
      product_origin: 'productBuiltin',
      transport: { type: 'stdio', command: 'node', args: ['--version'] },
      original_json: '{}',
      created_at: now,
      updated_at: now,
    };
    const hiddenMcps = [
      {
        ...visibleProductMcp,
        id: `matrix-upstream-mcp-${now}`,
        name: `Matrix Upstream MCP ${now}`,
        builtin: true,
        product_origin: undefined,
      },
      {
        ...visibleProductMcp,
        id: `matrix-extension-mcp-${now}`,
        name: `Matrix Extension MCP ${now}`,
        product_origin: 'extension',
      },
      {
        ...visibleProductMcp,
        id: `matrix-unclassified-mcp-${now}`,
        name: `Matrix Unclassified MCP ${now}`,
        product_origin: 'unexpected-origin',
      },
    ];
    const mcpListPattern = '**/api/mcp/servers';
    await productApp.page.route(mcpListPattern, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [visibleProductMcp, ...hiddenMcps] }),
      });
    });

    await productApp.page.evaluate(() => {
      window.location.hash = '#/settings/tools';
    });
    await expect(productApp.page.getByTestId('tools-header')).toBeVisible({ timeout: 20_000 });
    const productEntry = productApp.page.locator(
      `[data-product-resource-id="${visibleProductMcp.id}"][data-product-resource-origin="productBuiltin"][data-product-resource-access="use"]`
    );
    await expect(productEntry).toBeVisible({ timeout: 20_000 });
    await expect(productEntry.getByTestId(`mcp-test-${visibleProductMcp.id}`)).toBeVisible();
    await expect(productEntry.getByTestId(`mcp-manage-${visibleProductMcp.id}`)).toHaveCount(0);
    for (const hiddenMcp of hiddenMcps) {
      await expect(productApp.page.getByText(hiddenMcp.name, { exact: true })).toHaveCount(0);
    }

    const customMcpName = `Matrix Custom MCP ${now}`;
    const customMcpJson = JSON.stringify({
      mcpServers: {
        [customMcpName]: { command: 'node', args: ['--version'], description: 'created by packaged matrix' },
      },
    });
    await productApp.page.getByTestId('mcp-add').click();
    await productApp.page.getByTestId('mcp-add-json').click();
    const editor = productApp.page.getByTestId('mcp-json-editor').locator('.cm-content');
    await editor.fill(customMcpJson);
    await confirmVisibleAionModal(productApp.page);

    const customEntry = productApp.page
      .locator('[data-product-resource-origin="custom"][data-product-resource-access="manage"]')
      .filter({ hasText: customMcpName });
    await expect(customEntry).toBeVisible({ timeout: 20_000 });
    const customMcpId = await customEntry.getAttribute('data-product-resource-id');
    if (!customMcpId) throw new Error('Custom MCP entry did not expose its persisted resource ID.');
    const manageCustomMcp = customEntry.getByTestId(`mcp-manage-${customMcpId}`);
    const editCustomMcp = productApp.page.getByTestId(`mcp-edit-${customMcpId}`);
    await revealHoverMenu(customEntry, manageCustomMcp, editCustomMcp);
    await editCustomMcp.click();
    const editedMcpJson = JSON.stringify({
      mcpServers: {
        [customMcpName]: { command: 'node', args: ['--help'], description: 'edited by packaged matrix' },
      },
    });
    await productApp.page.getByTestId('mcp-json-editor').locator('.cm-content').fill(editedMcpJson);
    await confirmVisibleAionModal(productApp.page);
    await expect(customEntry).toBeVisible();

    await productApp.page.unroute(mcpListPattern);
    const editedBackendMcps = await httpInvoke<
      Array<{ id: string; original_json?: string; transport?: { args?: string[] } }>
    >(productApp.page, 'GET', '/api/mcp/servers');
    const editedBackendMcp = editedBackendMcps.find(({ id }) => id === customMcpId);
    expect(editedBackendMcp).toBeTruthy();
    expect(editedBackendMcp?.transport?.args).toContain('--help');
    expect(editedBackendMcp?.original_json).toContain('--help');

    const deleteCustomMcp = productApp.page.getByTestId(`mcp-delete-${customMcpId}`);
    await revealHoverMenu(customEntry, manageCustomMcp, deleteCustomMcp);
    await deleteCustomMcp.click();
    await productApp.page.locator('.arco-modal:visible .arco-modal-footer button.arco-btn-primary').click();
    await expect(customEntry).toHaveCount(0, { timeout: 20_000 });

    const backendMcps = await httpInvoke<Array<{ id: string }>>(productApp.page, 'GET', '/api/mcp/servers');
    expect(backendMcps.map(({ id }) => id)).not.toContain(customMcpId);
  });

  test('creates and edits Scheduled Tasks with Assistant-only selection', async () => {
    const provider = await httpInvoke<{ id: string }>(productApp.page, 'POST', '/api/providers', {
      id: `ki-buddy-matrix-provider-${Date.now()}`,
      platform: 'new-api',
      name: 'Ki-Buddy Matrix Provider',
      base_url: 'https://api.example.com/v1',
      api_key: 'sk-ki-buddy-matrix',
      models: ['matrix-model'],
      enabled: true,
    });
    await productApp.page.reload();
    await expect(productApp.page.getByTestId('tools-header')).toBeVisible({ timeout: 30_000 });
    await productApp.page.evaluate(() => {
      window.location.hash = '#/scheduled';
    });
    await expect(productApp.page.getByTestId('scheduled-tasks-header')).toBeVisible({ timeout: 20_000 });
    await productApp.page
      .getByText(/新建任务|New Task/i)
      .first()
      .click();
    await productApp.page.getByText(/手动创建|Create manually/i).click();
    const createDialog = productApp.page.locator('.arco-modal:visible').last();
    await expect(createDialog).toBeVisible();
    const taskName = `Ki-Buddy Matrix ${Date.now()}`;
    await createDialog.locator('#name input').fill(taskName);
    const assistantSelect = createDialog.getByTestId('cron-assistant-select');
    await expect(assistantSelect).toBeVisible();
    await assistantSelect.click();
    const optionsText = await productApp.page.locator('.arco-select-option').allTextContents();
    expect(optionsText.length).toBeGreaterThan(0);
    expect(optionsText.join('\n')).not.toMatch(/\bTeam\b|团队/);
    await productApp.page.locator('.arco-select-option:not(.arco-select-option-disabled)').first().click();
    await createDialog.locator('#prompt textarea').fill('Verify the Ki-Buddy packaged task matrix.');
    await createDialog.getByRole('button', { name: /^(保存|Save)$/i }).click();
    await expect(createDialog).toBeHidden({ timeout: 30_000 });

    const taskEntry = productApp.page.getByText(taskName, { exact: true });
    await expect(taskEntry).toBeVisible({ timeout: 20_000 });
    await taskEntry.click();
    await expect(productApp.page).toHaveURL(/#\/scheduled\/[^/]+$/, { timeout: 20_000 });
    const jobId = productApp.page.url().split('/').at(-1);
    expect(jobId).toBeTruthy();

    const detailHeading = productApp.page.locator('h1').filter({ hasText: taskName });
    const detailActions = detailHeading.locator('..').locator('button');
    await detailActions.first().click();
    const editDialog = productApp.page.locator('.arco-modal:visible').last();
    await expect(editDialog).toBeVisible();
    const editedTaskName = `${taskName} Edited`;
    await editDialog.locator('#name input').fill(editedTaskName);
    await editDialog.getByRole('button', { name: /^(保存|Save)$/i }).click();
    await expect(editDialog).toBeHidden({ timeout: 30_000 });
    await expect(productApp.page.locator('h1').filter({ hasText: editedTaskName })).toBeVisible({ timeout: 20_000 });

    const updated = (await invokeBridge(productApp.page, 'cron.get-job', { job_id: jobId })) as {
      name: string;
      metadata?: { agent_config?: { assistant_id?: string; team_id?: string } };
    };
    expect(updated.name).toBe(editedTaskName);
    expect(updated.metadata?.agent_config?.assistant_id).toBeTruthy();
    expect(updated.metadata?.agent_config?.team_id).toBeUndefined();
    await invokeBridge(productApp.page, 'cron.remove-job', { job_id: jobId });
    await httpDelete(productApp.page, `/api/providers/${provider.id}`);
  });

  test('keeps Pet, WebUI, Channels, and Extension runtime inactive with state evidence', async ({}, testInfo) => {
    const backendPort = await productApp.page.evaluate(() => window.__backendPort ?? 0);
    const [state, optionalRuntimeState, processTreeNetworkState] = await Promise.all([
      readMainProcessState(productApp.electronApp),
      readOptionalRuntimeState(productApp.page),
      Promise.resolve().then(() => captureProcessTreeNetworkState(productApp.processId)),
    ]);
    const { applicationListeners, playwrightHarnessListeners } = partitionExpectedPlaywrightElectronListeners(
      processTreeNetworkState,
      state.agentsMcpBridgePort === null ? [backendPort] : [backendPort, state.agentsMcpBridgePort]
    );
    await testInfo.attach('disabled-runtime-state.json', {
      body: Buffer.from(
        JSON.stringify(
          {
            backendPort,
            state,
            optionalRuntimeState,
            processTreeNetworkState,
            playwrightHarnessListeners,
            applicationListeners,
          },
          null,
          2
        )
      ),
      contentType: 'application/json',
    });

    expect(state.windows).toHaveLength(1);
    expect(state.windows[0]).toMatchObject({ visible: true });
    expect(processTreeNetworkState.processes.some(({ command }) => /aioncore/i.test(command))).toBe(true);
    expect(processTreeNetworkState.listeners.some(({ port }) => port === backendPort)).toBe(true);
    expect(state.agentsMcpBridgePort).not.toBeNull();
    expect(processTreeNetworkState.listeners.some(({ port }) => port === state.agentsMcpBridgePort)).toBe(true);
    expect(playwrightHarnessListeners).toHaveLength(2);
    expect(findUnexpectedApplicationListeners(applicationListeners, [backendPort, state.agentsMcpBridgePort])).toEqual(
      []
    );
    expect(state.startedProductLifecycles).not.toContain('desktopPet');
    expect(state.startedProductLifecycles).not.toContain('webUi');
    expect(state.trayMenuLabels.length).toBeGreaterThan(0);
    expect(state.trayMenuLabels.join('\n')).not.toMatch(/Desktop Pet|桌面宠物|宠物/);
    expect(Object.values(optionalRuntimeState.extensionContributions)).toEqual(
      EXTENSION_CONTRIBUTION_QUERIES.map(() => expect.objectContaining({ available: false }))
    );
    expect(optionalRuntimeState.channels).toMatchObject({ available: false });

    await productApp.page.evaluate(() => {
      window.location.hash = '#/settings/account';
    });
    await expect(productApp.page.locator('[data-settings-id="webui"], [data-settings-id="pet"]')).toHaveCount(0);
    await expect(productApp.page.locator('[data-settings-path^="ext/"]')).toHaveCount(0);
    await expect(productApp.page.getByText(/Channels|渠道|频道/i)).toHaveCount(0);
  });

  test('reports missing required product resources while Account and diagnostics remain usable', async ({}, testInfo) => {
    await productApp.page.route('**/api/agents/management**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      });
    });
    await productApp.page.reload();
    await expect(productApp.page.getByTestId('installation-integrity-dialog')).toBeVisible({ timeout: 30_000 });
    const reportButton = productApp.page.getByTestId('installation-integrity-report');
    await expect(reportButton).toBeVisible();
    await reportButton.click();
    await expect(reportButton).toBeDisabled();
    await expect.poll(() => productApp.page.evaluate(() => window.__installationIntegrityReportCount ?? 0)).toBe(1);
    await attachClientState(testInfo, productApp, 'missing-product-resource');
    const integrityModal = productApp.page.locator('.arco-modal').filter({
      has: productApp.page.getByTestId('installation-integrity-dialog'),
    });
    await integrityModal.locator('.arco-modal-close-icon').click();
    await expect(productApp.page.getByTestId('installation-integrity-dialog')).toBeHidden({ timeout: 10_000 });
    await productApp.page.locator('[data-settings-id="account"]').click();
    await expect(productApp.page).toHaveURL(/#\/settings\/account$/);
    await expect(productApp.page.getByTestId('ki-buddy-account-card')).toBeVisible();
    await productApp.page.getByTestId('ki-buddy-account-menu-button').click();
    await expect(productApp.page.getByTestId('ki-buddy-account-logout-menu-item')).toBeVisible();
    await productApp.page.unroute('**/api/agents/management**');
  });

  test('preserves full packaged AionUi behavior when the Ki-Buddy capability is absent', async ({}, testInfo) => {
    const aionUiApp = await launchPackagedApp('aionui');
    try {
      const bootstrap = await aionUiApp.page.evaluate(
        () => window.__getKiBuddyProductBootstrap?.() as ProductBootstrap | undefined
      );
      expect(bootstrap).toEqual({
        status: 'absent',
        productIdentity: null,
        capability: null,
        error: null,
      });
      expect(await aionUiApp.electronApp.evaluate(({ app }) => app.getName())).toBe('AionUi');

      await aionUiApp.page.evaluate(() => {
        window.location.hash = '#/settings/system';
      });
      await expect(aionUiApp.page.locator('[data-settings-id="webui"]')).toBeVisible({ timeout: 30_000 });
      await expect(aionUiApp.page.locator('[data-settings-id="pet"]')).toBeVisible();
      const settingsIds = await aionUiApp.page
        .locator('[data-settings-id]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-settings-id')));
      expect(settingsIds).toEqual(
        expect.arrayContaining(['agent', 'model', 'skills', 'tools', 'webui', 'pet', 'appearance', 'system', 'about'])
      );

      await aionUiApp.page.evaluate(() => {
        window.location.hash = '#/settings/webui';
      });
      await expect(aionUiApp.page.locator('[data-webui-tab="channels"]')).toBeVisible({ timeout: 30_000 });
      await aionUiApp.page.evaluate(() => {
        window.location.hash = '#/settings/appearance';
      });
      await expect(
        aionUiApp.page.locator(
          '[data-product-features~="themeCustomEditor"][data-product-features~="themeMarketplace"]'
        )
      ).toBeVisible({ timeout: 30_000 });

      await aionUiApp.page.evaluate(() => {
        window.location.hash = '#/guid';
      });
      await expect(aionUiApp.page.getByTestId('guid-input')).toBeVisible({ timeout: 30_000 });
      await expect(aionUiApp.page.getByTestId('team-section-toggle')).toBeVisible();
      await expect(aionUiApp.page.locator('[data-product-feature="guidWebUi"]')).toBeVisible();
      await expect(aionUiApp.page.locator('[data-product-feature="guidFeedback"]')).toBeVisible();
      await expect(aionUiApp.page.locator('[data-product-feature="guidGithubStar"]')).toBeVisible();

      await aionUiApp.page.evaluate(() => {
        window.location.hash = '#/assistants';
      });
      await expect(aionUiApp.page.getByTestId('assistants-header')).toBeVisible({ timeout: 30_000 });
      await aionUiApp.page.evaluate(() => {
        window.location.hash = '#/scheduled';
      });
      await expect(aionUiApp.page.getByTestId('scheduled-tasks-header')).toBeVisible({ timeout: 30_000 });
      await aionUiApp.page.evaluate(() => {
        window.location.hash = '#/test/components';
      });
      await expect(aionUiApp.page).toHaveURL(/#\/test\/components$/);
      await attachClientState(testInfo, aionUiApp, 'aionui-capability-absent');
    } catch (error) {
      await attachClientState(testInfo, aionUiApp, 'aionui-failure-state').catch(() => undefined);
      throw error;
    } finally {
      await closePackagedApp(aionUiApp);
    }
  });
});

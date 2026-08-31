/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getClientBusinessSettingMock, mcpServiceMock } = vi.hoisted(() => ({
  getClientBusinessSettingMock: vi.fn(),
  mcpServiceMock: {
    listServers: { invoke: vi.fn() },
  },
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: getClientBusinessSettingMock,
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: mcpServiceMock,
}));

import { ensureBackendMcpCatalog, loadProductBuiltinMcpResourceState } from '@/renderer/hooks/mcp/catalog';
import { createKiBuddyProductExperience, KI_BUDDY_PRODUCT_CAPABILITY } from '@/common/platform/ki-buddy';
import productConfig from '../../../../ki-buddy-product.json';

describe('ensureBackendMcpCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientBusinessSettingMock.mockResolvedValue([]);
    mcpServiceMock.listServers.invoke.mockResolvedValue([
      {
        id: 'user-1',
        name: 'user one',
        enabled: true,
        transport: { type: 'stdio', command: 'user', args: [] },
        created_at: 2,
        updated_at: 2,
        original_json: '{}',
        builtin: false,
      },
    ]);
  });

  it('reads MCP catalog from backend settings without falling back to configService', async () => {
    getClientBusinessSettingMock.mockResolvedValue([
      {
        id: 'builtin-1',
        name: 'builtin one',
        enabled: true,
        transport: { type: 'stdio', command: 'builtin', args: [] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: true,
      },
    ]);

    const result = await ensureBackendMcpCatalog();

    expect(result.userServers).toHaveLength(1);
    expect(result.builtinServers).toHaveLength(1);
    expect(result.allServers).toHaveLength(2);
  });

  it('does not re-import legacy user MCP rows from backend client settings at runtime', async () => {
    getClientBusinessSettingMock.mockResolvedValue([
      {
        id: 'legacy-user-1',
        name: 'legacy user server',
        enabled: true,
        transport: { type: 'stdio', command: 'legacy-user', args: [] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: false,
      },
    ]);
    mcpServiceMock.listServers.invoke.mockResolvedValue([]);

    const result = await ensureBackendMcpCatalog();

    expect(result.userServers).toEqual([]);
    expect(result.builtinServers).toEqual([]);
    expect(result.allServers).toEqual([]);
  });

  it('preserves AionUi cross-source deduplication for the same built-in MCP name', async () => {
    getClientBusinessSettingMock.mockResolvedValue([
      {
        id: 'local-builtin',
        name: 'shared builtin',
        enabled: true,
        transport: { type: 'stdio', command: 'local', args: [] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: true,
      },
    ]);
    mcpServiceMock.listServers.invoke.mockResolvedValue([
      {
        id: 'backend-builtin',
        name: 'shared builtin',
        enabled: true,
        transport: { type: 'stdio', command: 'backend', args: [] },
        created_at: 2,
        updated_at: 2,
        original_json: '{}',
        builtin: true,
      },
    ]);

    const result = await ensureBackendMcpCatalog();

    expect(result.allServers.map(({ id }) => id)).toEqual(['backend-builtin']);
  });

  it('keeps custom and product built-in MCP entries while recording disallowed and unknown origins', async () => {
    getClientBusinessSettingMock.mockResolvedValue([
      {
        id: 'upstream-1',
        name: 'upstream one',
        enabled: true,
        transport: { type: 'stdio', command: 'upstream', args: [] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: true,
      },
    ]);
    mcpServiceMock.listServers.invoke.mockResolvedValue([
      {
        id: 'backend-agents-mcp-id',
        name: 'agents-mcp-adapter',
        enabled: true,
        transport: {
          type: 'stdio',
          command: 'node',
          args: ['/Applications/Ki-Buddy/resources/app.asar.unpacked/out/main/builtin-mcp-agents.js'],
        },
        created_at: 2,
        updated_at: 2,
        original_json: '{}',
        builtin: true,
      },
      {
        id: 'custom-1',
        name: 'custom one',
        enabled: true,
        transport: { type: 'http', url: 'https://example.com/mcp' },
        created_at: 3,
        updated_at: 3,
        original_json: '{}',
      },
      {
        id: 'unknown-1',
        name: 'unknown one',
        enabled: true,
        transport: { type: 'stdio', command: 'unknown', args: [] },
        created_at: 4,
        updated_at: 4,
        original_json: '{}',
        product_origin: 'future-origin',
      },
    ]);

    const result = await ensureBackendMcpCatalog(createKiBuddyProductExperience(productConfig.experience));

    expect(result.entries.map(({ server, origin, access }) => ({ id: server.id, origin, access }))).toEqual([
      { id: 'backend-agents-mcp-id', origin: 'productBuiltin', access: 'use' },
      { id: 'custom-1', origin: 'custom', access: 'manage' },
    ]);
    expect(result.allServers.map(({ id }) => id)).toEqual(['backend-agents-mcp-id', 'custom-1']);
    expect(result.hiddenResources).toEqual([
      expect.objectContaining({ resourceId: 'unknown-1', origin: 'unclassified' }),
      expect.objectContaining({ resourceId: 'upstream-1', origin: 'upstreamBuiltin' }),
    ]);
  });

  it('hides a legacy Agents MCP when the Agents Gateway integration is unavailable', async () => {
    mcpServiceMock.listServers.invoke.mockResolvedValue([
      {
        id: 'legacy-agents-mcp-id',
        name: 'agents-mcp-adapter',
        enabled: true,
        transport: {
          type: 'stdio',
          command: 'node',
          args: ['/Applications/Ki-Buddy/resources/app.asar.unpacked/out/main/builtin-mcp-agents.js'],
        },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: true,
      },
    ]);

    const result = await ensureBackendMcpCatalog(createKiBuddyProductExperience(productConfig.experience), []);

    expect(result.entries).toEqual([]);
    expect(result.allServers).toEqual([]);
    expect(result.hiddenResources).toEqual([
      expect.objectContaining({
        resourceId: 'builtin:agents-mcp-adapter',
        origin: 'productBuiltin',
        access: 'hidden',
      }),
    ]);
  });

  it('classifies and hides a local legacy Agents MCP when the Agents Gateway integration is unavailable', async () => {
    getClientBusinessSettingMock.mockResolvedValue([
      {
        id: 'local-legacy-agents-mcp-id',
        name: 'agents-mcp-adapter',
        enabled: true,
        transport: {
          type: 'stdio',
          command: 'node',
          args: ['/Applications/Ki-Buddy/resources/app.asar.unpacked/out/main/builtin-mcp-agents.js'],
        },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: true,
      },
    ]);
    mcpServiceMock.listServers.invoke.mockResolvedValue([]);

    const result = await ensureBackendMcpCatalog(createKiBuddyProductExperience(productConfig.experience), []);

    expect(result.builtinServers).toEqual([]);
    expect(result.allServers).toEqual([]);
    expect(result.hiddenResources).toContainEqual(
      expect.objectContaining({
        resourceId: 'builtin:agents-mcp-adapter',
        origin: 'productBuiltin',
        access: 'hidden',
      })
    );
  });

  it('emits structured diagnostics for MCP resources hidden by the active product policy', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    getClientBusinessSettingMock.mockResolvedValue([
      {
        id: 'upstream-1',
        name: 'upstream one',
        enabled: true,
        transport: { type: 'stdio', command: 'upstream', args: [] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: true,
      },
    ]);
    mcpServiceMock.listServers.invoke.mockResolvedValue([]);

    const catalog = await ensureBackendMcpCatalog(createKiBuddyProductExperience(productConfig.experience));

    expect(info).toHaveBeenCalledWith(
      '[ProductExperience] MCP resources hidden by product policy',
      expect.objectContaining({ code: 'product_resource_projection', resources: catalog.hiddenResources })
    );
    info.mockRestore();
  });

  it('preserves the backend rejection when the MCP catalog cannot be loaded', async () => {
    const error = new Error('catalog unavailable');
    mcpServiceMock.listServers.invoke.mockRejectedValue(error);

    await expect(ensureBackendMcpCatalog()).rejects.toBe(error);
  });
});

describe('loadProductBuiltinMcpResourceState', () => {
  const experience = createKiBuddyProductExperience(productConfig.experience);
  const requirements = [
    {
      featureId: 'tools' as const,
      resourceId: 'builtin:agents-mcp-adapter',
      resourceName: 'agents-mcp-adapter',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    window.__kiBuddyProductPresentation = null;
  });

  it('does not require the Agents MCP when the Agents Gateway integration is unavailable', async () => {
    window.__kiBuddyProductPresentation = { ...KI_BUDDY_PRODUCT_CAPABILITY, integrations: [] };
    mcpServiceMock.listServers.invoke.mockResolvedValue([]);

    await expect(loadProductBuiltinMcpResourceState(experience)).resolves.toEqual({ status: 'ready', missing: [] });
    expect(mcpServiceMock.listServers.invoke).not.toHaveBeenCalled();
  });

  it('reports an installation-integrity failure after a ready catalog omits a required product MCP', async () => {
    mcpServiceMock.listServers.invoke.mockResolvedValue([]);

    const result = await loadProductBuiltinMcpResourceState(experience, requirements);

    expect(result).toEqual({
      status: 'invalid',
      missing: [
        {
          code: 'required_product_resource_missing',
          featureId: 'tools',
          kind: 'mcp',
          origin: 'productBuiltin',
          resourceId: 'builtin:agents-mcp-adapter',
          resourceName: 'agents-mcp-adapter',
        },
      ],
    });
  });

  it('accepts the exact built-in registration without a Ki-Core product origin field', async () => {
    mcpServiceMock.listServers.invoke.mockResolvedValue([
      {
        id: 'generated-backend-id',
        name: 'agents-mcp-adapter',
        enabled: true,
        transport: {
          type: 'stdio',
          command: 'node',
          args: ['/Applications/Ki-Buddy/resources/app.asar.unpacked/out/main/builtin-mcp-agents.js'],
        },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: true,
      },
    ]);

    const result = await loadProductBuiltinMcpResourceState(experience, requirements);

    expect(result).toEqual({ status: 'ready', missing: [] });
  });

  it('does not classify a Custom MCP with the product name as product built-in', async () => {
    mcpServiceMock.listServers.invoke.mockResolvedValue([
      {
        id: 'custom-same-name',
        name: 'agents-mcp-adapter',
        enabled: true,
        transport: { type: 'stdio', command: 'node', args: ['/tmp/builtin-mcp-agents.js'] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: false,
      },
    ]);

    const result = await loadProductBuiltinMcpResourceState(experience, requirements);

    expect(result.status).toBe('invalid');
  });

  it('keeps the requirement pending when the backend catalog cannot be read', async () => {
    mcpServiceMock.listServers.invoke.mockRejectedValue(new Error('catalog unavailable'));

    const result = await loadProductBuiltinMcpResourceState(experience, requirements);

    expect(result).toEqual({ status: 'pending', missing: [] });
  });
});

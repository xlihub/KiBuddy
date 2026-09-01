/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  KI_BUDDY_PRODUCT_RUNTIME,
  readKiBuddyRuntimeIdentity,
  resolveKiBuddyProtocolScheme,
  resolveKiBuddyCliSafeDirectoryNames,
  resolveKiBuddyUserDataPath,
  resolveKiBuddyRuntimeIdentity,
  shouldEnableKiBuddyRuntime,
  shouldEnsureDefaultCoreUser,
} from '@/process/ki-buddy/runtimeIdentity';

describe('Ki-Buddy product runtime identity', () => {
  it('enables Ki-Buddy only for the explicit packaged product marker', () => {
    expect(resolveKiBuddyRuntimeIdentity({ productRuntime: KI_BUDDY_PRODUCT_RUNTIME })).toBe(true);
    expect(resolveKiBuddyRuntimeIdentity({ productName: 'Ki-Buddy' })).toBe(false);
    expect(resolveKiBuddyRuntimeIdentity({ name: 'ki-buddy' })).toBe(false);
    expect(resolveKiBuddyRuntimeIdentity({ productRuntime: 'aionui' })).toBe(false);
    expect(resolveKiBuddyRuntimeIdentity(null)).toBe(false);
  });

  it('keeps the upstream AionUi package on the capability-missing path', () => {
    const projectRoot = resolve(__dirname, '../../../../');
    const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as unknown;

    expect(resolveKiBuddyRuntimeIdentity(packageJson)).toBe(false);
    expect(readKiBuddyRuntimeIdentity(projectRoot)).toBe(false);
    expect(readKiBuddyRuntimeIdentity(resolve(projectRoot, 'missing-directory'))).toBe(false);
  });

  it('selects the configured protocol only for the explicit product package', () => {
    const productAppPath = mkdtempSync(join(tmpdir(), 'ki-buddy-runtime-'));
    try {
      writeFileSync(
        join(productAppPath, 'package.json'),
        JSON.stringify({ productRuntime: KI_BUDDY_PRODUCT_RUNTIME }),
        'utf8'
      );

      expect(resolveKiBuddyProtocolScheme(productAppPath)).toBe('ki-buddy');
      expect(resolveKiBuddyProtocolScheme(productAppPath, { config: null, error: 'missing team' })).toBeNull();
      expect(resolveKiBuddyProtocolScheme(resolve(productAppPath, 'missing'))).toBeNull();
    } finally {
      rmSync(productAppPath, { recursive: true });
    }
  });

  it('disables product capabilities outside the Ki-Buddy desktop runtime', () => {
    expect(shouldEnableKiBuddyRuntime({ productIdentity: false, webUi: false, resetPassword: false })).toBe(false);
    expect(shouldEnableKiBuddyRuntime({ productIdentity: true, webUi: true, resetPassword: false })).toBe(false);
    expect(shouldEnableKiBuddyRuntime({ productIdentity: true, webUi: false, resetPassword: true })).toBe(false);
    expect(shouldEnableKiBuddyRuntime({ productIdentity: true, webUi: false, resetPassword: false })).toBe(true);
  });

  it('preserves default Core user initialization for ordinary AionUi runtimes', () => {
    expect(shouldEnsureDefaultCoreUser(false)).toBe(true);
  });

  it('does not initialize the default Core user for the Ki-Buddy desktop runtime', () => {
    expect(shouldEnsureDefaultCoreUser(true, 'agents')).toBe(false);
  });

  it('uses an isolated user-data directory and default Core user for a local project distribution', () => {
    expect(shouldEnsureDefaultCoreUser(true, 'local')).toBe(true);
    expect(
      resolveKiBuddyUserDataPath('/Users/test/Library/Application Support', {
        config: {
          distribution: {
            dataDirectory: 'Ki-Buddy-ZXJT-Preview',
          },
        },
        error: null,
      } as never)
    ).toBe(join('/Users/test/Library/Application Support', 'Ki-Buddy-ZXJT-Preview'));
    expect(
      resolveKiBuddyCliSafeDirectoryNames({
        config: {
          distribution: {
            dataDirectory: 'Ki-Buddy-ZXJT-Preview',
          },
        },
        error: null,
      } as never)
    ).toEqual({
      config: '.ki-buddy-zxjt-preview-config',
      data: '.ki-buddy-zxjt-preview',
    });
  });

  it('keeps the generic Ki-Buddy user-data path when no distribution identity exists', () => {
    expect(resolveKiBuddyUserDataPath('/tmp/app-data')).toBeNull();
  });
});

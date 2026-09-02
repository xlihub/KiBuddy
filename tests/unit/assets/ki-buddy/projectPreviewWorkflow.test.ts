import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

type WorkflowStep = {
  if?: string;
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  needs?: string | string[];
  'runs-on'?: string;
  env?: Record<string, string>;
  outputs?: Record<string, string>;
  strategy?: { 'fail-fast'?: boolean; matrix?: string };
  steps: WorkflowStep[];
};

type Workflow = {
  permissions: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
};

function workflowSource(): string {
  return readFileSync(resolve(process.cwd(), '.github/workflows/build-project-preview.yml'), 'utf8');
}

function workflow(): Workflow {
  return load(workflowSource()) as Workflow;
}

function setupAction(): { runs: { steps: WorkflowStep[] } } {
  return load(readFileSync(resolve(process.cwd(), '.github/actions/setup-project-build/action.yml'), 'utf8')) as {
    runs: { steps: WorkflowStep[] };
  };
}

function step(job: WorkflowJob, name: string): WorkflowStep {
  const result = job.steps.find((item) => item.name === name);
  if (!result) throw new Error(`Workflow step not found: ${name}`);
  return result;
}

describe('project preview workflow trust boundary', () => {
  it('validates registration and source before a separate build job executes project code', () => {
    const config = workflow();
    const validate = config.jobs.validate;
    const build = config.jobs.build;

    expect(validate.steps.map(({ name }) => name)).toEqual([
      'Checkout trusted product registration',
      'Checkout requested project source',
      'Set up Node.js',
      'Resolve trusted preview build plan',
      'Upload immutable validation plan',
    ]);
    expect(step(validate, 'Resolve trusted preview build plan').run).toContain(
      'trusted/packages/shared-scripts/src/projectDistribution.js resolve'
    );
    expect(step(validate, 'Resolve trusted preview build plan').run).toContain(
      "require('./source/distribution-manifest.json').platforms.preview"
    );
    expect(step(validate, 'Resolve trusted preview build plan').run).toContain('--platforms-json "$platforms_json"');
    expect(step(validate, 'Resolve trusted preview build plan').run).toContain('create-build-matrix');
    expect(validate.outputs?.matrix).toContain('steps.resolve.outputs.matrix');
    expect(build.needs).toBe('validate');
    expect(build['runs-on']).toBe('${{ matrix.os }}');
    expect(build.strategy).toEqual({
      'fail-fast': false,
      matrix: '${{ fromJSON(needs.validate.outputs.matrix) }}',
    });
    expect(step(build, 'Checkout trusted project build setup').with?.ref).toBe(
      '${{ needs.validate.outputs.registration_revision }}'
    );
    expect(build.steps.indexOf(step(build, 'Download immutable validation plan'))).toBeLessThan(
      build.steps.indexOf(step(build, 'Prepare project build dependencies'))
    );
    expect(build.steps.indexOf(step(build, 'Prepare project build dependencies'))).toBeLessThan(
      build.steps.indexOf(step(build, 'Build preview package'))
    );
    expect(step(build, 'Build preview package').run).toBe('${{ matrix.command }}');
    expect(step(build, 'Prepare project build dependencies')).toMatchObject({
      uses: './trusted/.github/actions/setup-project-build',
      with: {
        platform: '${{ matrix.platform }}',
        arch: '${{ matrix.arch }}',
        'source-directory': '${{ github.workspace }}/source',
      },
    });
  });

  it('uses one trusted setup action for native modules and platform packaging dependencies', () => {
    const steps = setupAction().runs.steps;

    expect(steps.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'Install Linux system dependencies',
        'Install project dependencies',
        'Run project postinstall',
        'Rebuild native modules for Electron',
        'Rebuild Windows native modules for Electron',
      ])
    );
    expect(step({ steps }, 'Install Linux system dependencies').run).toContain('libsqlite3-dev');
    expect(step({ steps }, 'Rebuild native modules for Electron').run).toContain(
      'electron-builder install-app-deps --platform "$target_platform" --arch "${{ inputs.arch }}"'
    );
    expect(step({ steps }, 'Rebuild Windows native modules for Electron').run).toContain(
      'electron-builder install-app-deps --platform win32 --arch "${{ inputs.arch }}"'
    );
    expect(step({ steps }, 'Rebuild Windows native modules for Electron').run).toContain('better_sqlite3.node');
    expect(steps.indexOf(step({ steps }, 'Install MSVC ARM64 toolchain'))).toBeLessThan(
      steps.indexOf(step({ steps }, 'Set up MSBuild'))
    );
  });

  it('re-resolves the trusted plan and verifies every selected preview package in a fresh job', () => {
    const verify = workflow().jobs.verify;
    const verification = step(verify, 'Verify preview platform artifact');

    expect(verify.needs).toEqual(['validate', 'build']);
    expect(verify['runs-on']).toBe('${{ matrix.os }}');
    expect(verify.strategy).toEqual({
      'fail-fast': false,
      matrix: '${{ fromJSON(needs.validate.outputs.matrix) }}',
    });
    expect(step(verify, 'Checkout exact trusted registration revision').with?.ref).toBe(
      '${{ needs.validate.outputs.registration_revision }}'
    );
    expect(step(verify, 'Re-resolve expected plan from trusted sources').run).toContain(
      'cmp "$VALIDATED_PLAN" "$EXPECTED_PLAN"'
    );
    expect(verification.run).toContain('projectDistribution.js verify-artifact');
    expect(verification.run).toContain('--platform ${{ matrix.platform }}');
    expect(verification.run).toContain('--build-plan expected/project-build-plan.json');
    expect(verification.run).not.toContain('$EXPECTED_PLAN');
    expect(verification.run).not.toContain('$env:');
    const installerUpload = step(workflow().jobs.build, 'Upload unverified preview installer');
    const evidenceUpload = step(workflow().jobs.build, 'Upload unverified preview evidence');
    expect(installerUpload.with?.name).toContain('${{ matrix.platform }}');
    expect(installerUpload.with?.path).toContain('source/out/*.dmg');
    expect(installerUpload.with?.path).toContain('source/out/*.exe');
    expect(installerUpload.with?.path).toContain('source/out/*.deb');
    expect(installerUpload.with?.['if-no-files-found']).toBe('error');
    expect(evidenceUpload.with?.name).toContain('${{ matrix.platform }}');
    expect(evidenceUpload.with?.path).toBe('source/out/project-distribution/project-build-evidence.json');
    expect(verify.steps.at(-1)?.name).toBe('Upload verified preview package and immutable evidence');
    expect(verify.steps.at(-1)?.with?.name).toContain('${{ matrix.platform }}');
  });

  it('does not inherit or expose formal project credentials', () => {
    const config = workflow();
    const source = workflowSource();

    expect(config.permissions).toEqual({ contents: 'read' });
    expect(source).toContain('persist-credentials: false');
    expect(source).not.toContain('secrets: inherit');
    expect(source).not.toMatch(/secrets\.[A-Za-z_]/);
    expect(source).not.toContain('environment:');
  });

  it('pins every approved preview platform to release Ki-Core artifacts', () => {
    const build = workflow().jobs.build;

    expect(build.env).toMatchObject({
      AIONUI_BACKEND_SOURCE_POLICY: 'release-pinned',
      KI_BUDDY_RESOLVED_BUILD_PLAN: '${{ github.workspace }}/validated/project-build-plan.json',
    });
    expect(step(workflow().jobs.validate, 'Resolve trusted preview build plan').run).toContain(
      '--platforms-json "$platforms_json"'
    );
  });
});

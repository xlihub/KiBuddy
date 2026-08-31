import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  needs?: string | string[];
  env?: Record<string, string>;
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
    expect(build.needs).toBe('validate');
    expect(build.steps.indexOf(step(build, 'Download immutable validation plan'))).toBeLessThan(
      build.steps.indexOf(step(build, 'Install project dependencies'))
    );
    expect(build.steps.indexOf(step(build, 'Install project dependencies'))).toBeLessThan(
      build.steps.indexOf(step(build, 'Build macOS arm64 preview'))
    );
  });

  it('re-resolves the trusted plan and verifies the exact DMG in a fresh job', () => {
    const verify = workflow().jobs.verify;
    const verification = step(verify, 'Verify the exact DMG and packaged evidence');

    expect(verify.needs).toEqual(['validate', 'build']);
    expect(step(verify, 'Checkout exact trusted registration revision').with?.ref).toBe(
      '${{ needs.validate.outputs.registration_revision }}'
    );
    expect(step(verify, 'Re-resolve expected plan from trusted sources').run).toContain(
      'cmp "$VALIDATED_PLAN" "$EXPECTED_PLAN"'
    );
    expect(verification.run).toContain('test "$dmg_count" = 1');
    expect(verification.run).toContain('hdiutil attach "$dmg_path" -nobrowse -readonly');
    expect(verification.run).toContain('projectDistribution.js verify-unpacked');
    expect(verification.run).toContain('cmp "$standalone_evidence" "$packaged_evidence"');
    expect(verify.steps.at(-1)?.name).toBe('Upload verified preview package and immutable evidence');
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

  it('pins the approved macOS arm64 build to release Ki-Core artifacts', () => {
    const build = workflow().jobs.build;

    expect(build.env).toMatchObject({
      AIONUI_BACKEND_SOURCE_POLICY: 'release-pinned',
      KI_BUDDY_RESOLVED_BUILD_PLAN: '${{ github.workspace }}/validated/project-build-plan.json',
    });
    expect(step(workflow().jobs.validate, 'Resolve trusted preview build plan').run).toContain(
      '--platform "$PROJECT_PLATFORM"'
    );
  });
});

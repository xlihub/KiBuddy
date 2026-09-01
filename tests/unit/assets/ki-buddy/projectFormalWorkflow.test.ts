import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

type WorkflowStep = {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  if?: string;
  needs?: string | string[];
  env?: Record<string, string>;
  steps: WorkflowStep[];
};

type Workflow = {
  concurrency: { group: string; 'cancel-in-progress': boolean };
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

function formalValidationScript(): string {
  return step(workflow().jobs.formal_validate, 'Resolve protected formal build plan').run ?? '';
}

describe('project formal workflow trust boundary', () => {
  it('serializes each formal distribution version without coupling preview runs', () => {
    const config = workflow();

    expect(config.concurrency).toEqual({
      group:
        "project-${{ inputs.mode }}-${{ inputs.distribution_id }}-${{ inputs.mode == 'formal' && inputs.version || github.run_id }}",
      'cancel-in-progress': false,
    });
  });

  it('runs formal validation only for formal project builds', () => {
    expect(workflow().jobs.formal_validate.if).toBe("inputs.mode == 'formal'");
  });

  it('requires formal builds to dispatch from product/main', () => {
    expect(formalValidationScript()).toContain('test "$GITHUB_REF" = \'refs/heads/product/main\'');
  });

  it('requires a full lowercase formal source SHA', () => {
    expect(formalValidationScript()).toContain('[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]');
  });

  it('verifies the source against its registered distribution branch', () => {
    const validation = formalValidationScript();

    expect(validation).toContain('distribution/$DISTRIBUTION_ID');
    expect(validation).toContain('verify-source-reachability');
  });

  it('loads active GitHub rules for the registered distribution branch', () => {
    expect(formalValidationScript()).toContain('/rules/branches/$encoded_branch');
  });

  it('resolves delivery records through the formal build contract', () => {
    const validation = formalValidationScript();

    expect(validation).toContain('--delivery-records trusted/distributions/delivery-records.json');
    expect(validation).toContain('--mode formal');
  });

  it('downloads the trusted formal plan before executing project installation or build code', () => {
    const build = workflow().jobs.formal_build;

    expect(build.needs).toBe('formal_validate');
    expect(build.steps.indexOf(step(build, 'Download immutable formal build plan'))).toBeLessThan(
      build.steps.indexOf(step(build, 'Install project dependencies'))
    );
  });

  it('accepts only release-pinned or verified successful Ki-Core candidate provenance', () => {
    const source = workflowSource();
    const validate = workflow().jobs.formal_validate;
    const validation = step(validate, 'Resolve protected formal build plan').run ?? '';

    expect(source).toContain('- release-pinned\n          - candidate');
    expect(validation).toContain('resolve-ki-core-candidate');
    expect(validation).toContain('--run-id "$KI_CORE_CANDIDATE_RUN_ID"');
    expect(validation).toContain('--head-sha "$KI_CORE_CANDIDATE_HEAD_SHA"');
    expect(validation).not.toContain('development');
  });

  it('does not inherit repository secrets or expose project credentials to local zxjt source', () => {
    const config = workflow();
    const source = workflowSource();

    expect(config.permissions).toEqual({ contents: 'read' });
    expect(source).not.toContain('secrets: inherit');
    expect(source).not.toMatch(/secrets\.[A-Za-z_]/u);
    expect(source).toContain('persist-credentials: false');
    expect(source).not.toContain('environment:');
  });

  it('does not let workflow dispatch select project build credentials', () => {
    const source = workflowSource();
    const validation = step(workflow().jobs.formal_validate, 'Resolve protected formal build plan').run ?? '';

    expect(source).not.toContain('build_credential_names:');
    expect(validation).toContain("--build-credential-names '[]'");
  });

  it('publishes a unique candidate attempt only after independent package verification', () => {
    const config = workflow();
    const verify = config.jobs.formal_verify;
    const source = workflowSource();
    const finalUpload = step(verify, 'Upload formal candidate attempt');

    expect(verify.needs).toEqual(['formal_validate', 'formal_build']);
    expect(step(verify, 'Verify formal package and create candidate record').run).toContain(
      'projectDistribution.js create-candidate'
    );
    expect(finalUpload.with?.name).toBe(
      'ki-buddy-${{ inputs.distribution_id }}-${{ inputs.version }}-candidate-${{ github.run_id }}-${{ github.run_attempt }}'
    );
    expect(source.match(/Upload formal candidate attempt/gu)).toHaveLength(1);
    expect(finalUpload.with?.path).toContain('verified/project-candidate.json');
  });
});

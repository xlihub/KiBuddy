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
  'runs-on'?: string;
  env?: Record<string, string>;
  outputs?: Record<string, string>;
  strategy?: { 'fail-fast': boolean; matrix: string };
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
  it.each(['build', 'formal_build'])('gives %s the established 8 GiB Node heap budget', (jobName) => {
    expect(workflow().jobs[jobName].env?.NODE_OPTIONS).toBe('--max-old-space-size=8192');
  });

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
    expect(validation).not.toContain('git -C source fetch');
  });

  it('loads active GitHub rules for the registered distribution branch', () => {
    expect(formalValidationScript()).toContain('/rules/branches/$encoded_branch');
  });

  it('resolves delivery records through the formal build contract', () => {
    const validation = formalValidationScript();

    expect(validation).toContain('--delivery-records trusted/distributions/delivery-records.json');
    expect(validation).toContain('--mode formal');
  });

  it('takes the selected platform set from the manifest into one immutable resolved plan', () => {
    const validation = formalValidationScript();

    expect(validation).toContain("JSON.stringify(require('./source/distribution-manifest.json').platforms.formal)");
    expect(validation).toContain('--platforms-json "$platforms_json"');
    expect(validation).toContain('create-build-matrix');
    expect(workflow().jobs.formal_validate.outputs?.matrix).toContain('steps.resolve.outputs.matrix');
  });

  it('fans out every selected platform from the same trusted formal plan before executing project code', () => {
    const build = workflow().jobs.formal_build;

    expect(build.needs).toBe('formal_validate');
    expect(build['runs-on']).toBe('${{ matrix.os }}');
    expect(build.strategy).toEqual({
      'fail-fast': false,
      matrix: '${{ fromJSON(needs.formal_validate.outputs.matrix) }}',
    });
    expect(step(build, 'Checkout trusted project build setup').with?.ref).toBe(
      '${{ needs.formal_validate.outputs.registration_revision }}'
    );
    expect(build.steps.indexOf(step(build, 'Download immutable formal build plan'))).toBeLessThan(
      build.steps.indexOf(step(build, 'Prepare project build dependencies'))
    );
    expect(step(build, 'Prepare project build dependencies').uses).toBe(
      './trusted/.github/actions/setup-project-build'
    );
    expect(step(build, 'Build formal package').run).toBe('${{ matrix.command }}');
    expect(step(build, 'Upload unverified formal installer').with?.name).toContain('${{ matrix.platform }}');
    expect(step(build, 'Upload unverified formal installer').with?.path).not.toContain('unpacked');
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

  it('verifies every platform independently and publishes one candidate only after the entire matrix succeeds', () => {
    const config = workflow();
    const verify = config.jobs.formal_verify;
    const finalize = config.jobs.formal_finalize;
    const source = workflowSource();
    const finalUpload = step(finalize, 'Upload formal candidate attempt');

    expect(verify.needs).toEqual(['formal_validate', 'formal_build']);
    expect(verify['runs-on']).toBe('${{ matrix.os }}');
    expect(verify.strategy?.matrix).toBe('${{ fromJSON(needs.formal_validate.outputs.matrix) }}');
    expect(step(verify, 'Verify formal platform artifact').run).toContain('projectDistribution.js verify-artifact');
    expect(step(verify, 'Verify formal platform artifact').run).toContain('--artifacts-root candidate');
    expect(step(verify, 'Upload verified formal platform').with?.name).toContain('${{ matrix.platform }}');
    expect(finalize.needs).toEqual(['formal_validate', 'formal_verify']);
    expect(step(finalize, 'Create atomic formal candidate').run).toContain('projectDistribution.js create-candidate');
    expect(finalUpload.with?.name).toBe(
      'ki-buddy-${{ inputs.distribution_id }}-${{ inputs.version }}-candidate-${{ github.run_id }}-${{ github.run_attempt }}'
    );
    expect(source.match(/Upload formal candidate attempt/gu)).toHaveLength(1);
    expect(finalUpload.with?.path).toContain('verified/project-candidate.json');
  });

  it('does not finalize a candidate when any platform build or verification job fails', () => {
    const config = workflow();

    expect(config.jobs.formal_verify.needs).toEqual(['formal_validate', 'formal_build']);
    expect(config.jobs.formal_finalize.needs).toEqual(['formal_validate', 'formal_verify']);
    expect(config.jobs.formal_finalize.if).toBe("inputs.mode == 'formal'");
    expect(config.jobs.formal_finalize.if).not.toContain('always()');
  });

  it('fails a platform build when its installer artifact is missing', () => {
    const config = workflow();
    const upload = step(config.jobs.formal_build, 'Upload unverified formal installer');
    const evidenceUpload = step(config.jobs.formal_build, 'Upload unverified formal evidence');
    const download = step(config.jobs.formal_verify, 'Download unverified formal installer');

    expect(upload.with?.['if-no-files-found']).toBe('error');
    expect(upload.with?.path).toContain('source/out/*.dmg');
    expect(upload.with?.path).toContain('source/out/*.exe');
    expect(upload.with?.path).toContain('source/out/*.deb');
    expect(upload.with?.path).not.toContain('project-build-evidence.json');
    expect(evidenceUpload.with?.path).toBe('source/out/project-distribution/project-build-evidence.json');
    expect(download.with?.name).toContain('${{ matrix.platform }}');
  });

  it('retains partial platform output only as short-lived evidence when the matrix does not complete', () => {
    const verifyUpload = step(workflow().jobs.formal_verify, 'Upload verified formal platform');

    expect(verifyUpload.with?.['retention-days']).toBe(1);
    expect(verifyUpload.with?.name).toContain('${{ matrix.platform }}');
  });
});

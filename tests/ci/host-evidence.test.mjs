import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('../../scripts/ci-host-evidence.sh', import.meta.url);
function evidence(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'website-host-proof-'));
  try {
    writeFileSync(
      join(directory, 'uname'),
      `#!/bin/sh
case "$1" in
-m) echo x86_64;;
-r) echo "$TEST_KERNEL";;
-n) echo "$TEST_HOSTNAME";;
esac
`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(directory, 'docker'),
      `#!/bin/sh
case "$1" in
info)
  case "$3" in
    '{{.KernelVersion}}') echo "$TEST_DAEMON_KERNEL";;
    *) echo "daemon=x86_64 cpus=16 memory=33619058688 kernel=$TEST_DAEMON_KERNEL os=Docker Desktop";;
  esac;;
ps) [ "$TEST_INVENTORY" = present ] && echo "$RUNNER_NAME"; exit 0;;
inspect)
  [ "$TEST_INSPECT" != fail ] || exit 1
  echo "/$TEST_NAME|$TEST_CONTAINER_HOSTNAME|0123456789abcdef|linux|sha256:fixture";;
*) exit 1;;
esac
`,
      { mode: 0o755 },
    );
    return spawnSync('bash', [script.pathname], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        RUNNER_NAME: 'ciw-izi-devis-website-runner-123-abcdef01',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'quality',
        GITHUB_SHA: 'abc123',
        TEST_KERNEL: '6.6.87.2-microsoft-standard-WSL2',
        TEST_DAEMON_KERNEL: '6.6.87.2-microsoft-standard-WSL2',
        TEST_HOSTNAME: '0123456789ab',
        TEST_CONTAINER_HOSTNAME: '0123456789ab',
        TEST_INVENTORY: 'present',
        TEST_NAME: 'ciw-izi-devis-website-runner-123-abcdef01',
        ...overrides,
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('checks runs shell host evidence after checkout, before Node setup', () => {
  const source = readFileSync(
    new URL('../../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  );
  assert.match(source, /run: bash scripts\/ci-host-evidence.sh/);
  assert.ok(source.indexOf('- name: Checkout') < source.indexOf('- name: Execution architecture evidence'));
  assert.ok(source.indexOf('- name: Execution architecture evidence') < source.indexOf('- name: Setup Node'));
});

test('joined matching WSL2 runner reports durable job and daemon evidence', () => {
  const result = evidence();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /host_backend=windows-wsl2/);
  assert.match(result.stdout, /run=123 attempt=1 job=quality sha=abc123/);
  assert.match(
    result.stdout,
    /runner=ciw-izi-devis-website-runner-123-abcdef01/,
  );
  assert.match(result.stdout, /container=.*linux.*sha256:fixture/);
});

for (const [name, overrides] of [
  ['missing running inventory', { TEST_INVENTORY: 'missing' }],
  ['foreign inspected name', { TEST_NAME: 'foreign' }],
  [
    'foreign hostname',
    { TEST_HOSTNAME: 'foreign', TEST_CONTAINER_HOSTNAME: 'other' },
  ],
  ['option-like runner name', { RUNNER_NAME: '--help' }],
  ['failed inspect', { TEST_INSPECT: 'fail' }],
  [
    'daemon kernel disagrees with executing runner',
    { TEST_KERNEL: '6.10-linuxkit' },
  ],
]) {
  test(`ownership fails closed: ${name}`, () => {
    const result = evidence(overrides);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /host_backend=windows-wsl2/);
  });
}

for (const kernel of ['6.10-linuxkit', '6.8.0-generic', 'unknown', '']) {
  test(`AMD64 and Docker Desktop do not imply Windows: ${kernel || 'empty'}`, () => {
    const result = evidence({
      TEST_KERNEL: kernel,
      TEST_DAEMON_KERNEL: kernel,
    });
    if (!kernel || kernel === 'unknown') {
      assert.notEqual(result.status, 0, 'missing or unknown kernel cannot prove ownership');
      assert.doesNotMatch(result.stdout, /host_backend=/);
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /host_backend=windows-not-proven/);
    }
  });
}

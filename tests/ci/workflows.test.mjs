// Routing guard for the shared self-hosted pool (Mac ARM64 + Windows X64).
// Same-repo events run on the architecture-neutral repository label; fork PRs
// stay on GitHub-hosted runners; caches are partitioned by runner OS and ABI.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import test from 'node:test';

/* CONFIG:BEGIN */
const LABEL = 'doctor-node-hermes-ephemeral';
// file -> { dispatch: has workflow_dispatch qualification input, jobs: routed jobs, evidence: jobs with host evidence }
const ROUTED = {"ci.yml": {"dispatch": false, "jobs": ["test"], "evidence": ["test"]}};
// file -> jobs that never run for pull requests (push/tag only): static shared label.
const STATIC = {};
// file -> jobs intentionally pinned to X64 (architecture-bound toolchains).
const X64_EXCEPTIONS = {};
// Where the regression guards run.
const GUARD = {"file": "ci.yml", "job": "test"};
const ACTIONS = [];
// file -> exact top-level trigger events (unchanged by the migration).
const TRIGGERS = {"ci.yml": ["pull_request", "push"]};
/* CONFIG:END */

const root = new URL('../../', import.meta.url);
const workflowDir = new URL('.github/workflows/', root);
const trust = "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository";
const shared = ['self-hosted', 'Linux', LABEL];
const selectors = {
  dispatch: `\${{ fromJSON((${trust}) && (inputs.qualification_host == 'mac' && '${JSON.stringify([...shared, 'ci-host-tlpr-mac'])}' || inputs.qualification_host == 'x64' && '${JSON.stringify([...shared, 'X64'])}' || '${JSON.stringify(shared)}') || '"ubuntu-latest"') }}`,
  plain: `\${{ fromJSON((${trust}) && '${JSON.stringify(shared)}' || '"ubuntu-latest"') }}`,
};
const staticSelector = `[self-hosted, Linux, ${LABEL}]`;
const x64Selector = `[self-hosted, Linux, X64, ${LABEL}]`;
const evidenceStep = (workdir) => `      - name: Execution architecture evidence\n        if: \${{ ${trust} }}\n${workdir ? '        working-directory: .\n' : ''}        run: bash scripts/ci-host-evidence.sh\n`;
const guardStep = (workdir) => `      - name: CI regression guards\n${workdir ? '        working-directory: .\n' : ''}        run: node --test tests/ci/*.test.mjs\n`;
const setupPattern = /uses: (?:actions\/setup-|\.\/\.github\/actions\/)/;
const dispatchInput = /\n {2}workflow_dispatch:\n {4}inputs:\n(?: {6}[^\n]*\n| {8}[^\n]*\n)*? {6}qualification_host:\n {8}description: .+\n {8}required: false\n {8}default: shared\n {8}type: choice\n {8}options: \[shared, mac, x64\]\n/;

function readSources() {
  const files = {};
  for (const name of readdirSync(workflowDir)) if (/\.ya?ml$/.test(name)) files[name] = readFileSync(new URL(name, workflowDir), 'utf8');
  for (const path of ACTIONS) files[path] = readFileSync(new URL(path, root), 'utf8');
  return files;
}

function jobs(text) {
  const start = text.search(/^jobs:\n/m);
  assert.ok(start >= 0, 'jobs section');
  const body = text.slice(start + 'jobs:\n'.length);
  const result = {};
  const heads = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):[^\S\n]*(?:#[^\n]*)?\n/gm)];
  heads.forEach((match, index) => {
    result[match[1]] = body.slice(match.index, index + 1 < heads.length ? heads[index + 1].index : body.length);
  });
  return result;
}

function triggers(text) {
  const block = text.match(/^on:\n((?:[ \t]+[^\n]*\n|\n)*)/m);
  assert.ok(block, 'block-style on: section');
  return [...block[1].matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]).sort();
}

function hasDefaultWorkdir(jobText) {
  return /^ {4}defaults:\n {6}run:\n {8}working-directory:/m.test(jobText);
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

function runsOn(jobText) {
  const lines = jobText.match(/^ {4}runs-on:.*$/gm) ?? [];
  assert.equal(lines.length, 1, 'exactly one runs-on per job');
  return lines[0].slice('    runs-on: '.length);
}

// Every actions/cache step: key and every restore prefix scoped by runner OS and ABI.
function cacheSteps(text) {
  const steps = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*(?:-\s+)?uses:\s*['"]?actions\/cache(?:\/restore|\/save)?@/.test(lines[i])) continue;
    let s = i;
    while (s > 0 && !/^\s*-\s/.test(lines[s])) s -= 1;
    const indent = lines[s].search(/-/);
    let e = s + 1;
    while (e < lines.length && (lines[e].trim() === '' || lines[e].search(/\S/) > indent)) e += 1;
    steps.push(lines.slice(s, e).join('\n'));
  }
  return steps;
}

function validateCache(name, text) {
  assert.doesNotMatch(text, /enableCrossOsArchive/, `${name}: no cross-OS archive`);
  for (const step of cacheSteps(text)) {
    const key = step.match(/^\s*key:\s*(.+)$/m);
    assert.ok(key, `${name}: cache key`);
    assert.ok(key[1].includes('${{ runner.os }}') && key[1].includes('${{ runner.arch }}'), `${name}: key scoped by OS and ABI: ${key[1]}`);
    const restore = step.match(/^(\s*)restore-keys:(.*)$/m);
    if (restore) {
      assert.equal(restore[2].trim(), '|', `${name}: block restore-keys only`);
      const after = step.slice(restore.index + restore[0].length + 1).split('\n');
      const entries = [];
      for (const line of after) {
        if (line.trim() === '') continue;
        if (line.search(/\S/) <= restore[1].length) break;
        entries.push(line.trim());
      }
      assert.ok(entries.length > 0, `${name}: restore entries`);
      for (const entry of entries) assert.ok(entry.includes('${{ runner.os }}') && entry.includes('${{ runner.arch }}'), `${name}: restore prefix scoped by OS and ABI: ${entry}`);
    }
  }
}

function validate(files) {
  const covered = new Set();
  for (const [file, spec] of Object.entries(ROUTED)) {
    const text = files[file];
    assert.ok(text, file);
    if (spec.dispatch) assert.match(text, dispatchInput, `${file}: manual qualification input`);
    else assert.doesNotMatch(text, /qualification_host/, `${file}: no dangling input`);
    const all = jobs(text);
    for (const job of spec.jobs) {
      assert.ok(all[job], `${file}:${job}`);
      assert.equal(runsOn(all[job]), spec.dispatch ? selectors.dispatch : selectors.plain, `${file}:${job} trusted shared selector`);
      covered.add(`${file}:${job}`);
    }
    for (const job of spec.jobs) {
      if (/uses: actions\/checkout@/.test(all[job])) assert.ok(spec.evidence.includes(job), `${file}:${job} checked-out job declares evidence`);
    }
    assert.equal(count(text, 'ci-host-evidence.sh'), spec.evidence.length, `${file}: evidence helper only in declared steps`);
    for (const job of spec.evidence) {
      const body = all[job];
      const step = evidenceStep(hasDefaultWorkdir(body));
      const at = body.indexOf(step);
      assert.ok(at > 0, `${file}:${job} evidence step skips only forks, from the repository root`);
      assert.equal(count(body, step), 1, `${file}:${job} single evidence step`);
      const checkout = body.search(/uses: actions\/checkout@/);
      assert.ok(checkout >= 0 && checkout < at, `${file}:${job} evidence after checkout`);
      const setup = body.search(setupPattern);
      assert.ok(setup < 0 || at < setup, `${file}:${job} evidence before runtime setup`);
    }
    const perms = text.match(/^permissions:\n((?: {2}[^\n]*\n)+)/m);
    assert.ok(perms, `${file}: explicit top-level permissions`);
    assert.match(perms[1], /^ {2}contents: read$/m, `${file}: contents read`);
    assert.doesNotMatch(perms[1], /write/, `${file}: no write permission`);
    assert.doesNotMatch(text, /^ {4}permissions:/m, `${file}: no job-level permission escalation`);
  }
  for (const [file, list] of Object.entries(STATIC)) {
    const all = jobs(files[file]);
    for (const job of list) {
      assert.equal(runsOn(all[job]), staticSelector, `${file}:${job} push-only shared label`);
      covered.add(`${file}:${job}`);
    }
  }
  for (const [file, list] of Object.entries(X64_EXCEPTIONS)) {
    const all = jobs(files[file]);
    for (const job of list) {
      assert.equal(runsOn(all[job]), x64Selector, `${file}:${job} explicit X64 exception`);
      covered.add(`${file}:${job}`);
    }
  }
  for (const [file, text] of Object.entries(files)) {
    if (ACTIONS.includes(file)) { validateCache(file, text); continue; }
    assert.doesNotMatch(text, /pull_request_target/, `${file}: no pull_request_target on self-hosted pool`);
    assert.deepEqual(triggers(text), TRIGGERS[file], `${file}: triggers unchanged`);
    if (STATIC[file]) for (const event of triggers(text)) assert.ok(!event.startsWith('pull_request'), `${file}: static self-hosted jobs never run for PRs`);
    for (const job of Object.keys(jobs(text))) assert.ok(covered.has(`${file}:${job}`), `${file}:${job} routing is declared`);
    validateCache(file, text);
  }
  const guardJob = jobs(files[GUARD.file])[GUARD.job];
  const guard = guardStep(hasDefaultWorkdir(guardJob));
  assert.equal(count(guardJob, guard), 1, 'regression guards wired into CI from the repository root');
  const setup = guardJob.search(setupPattern);
  assert.ok(setup >= 0 && setup < guardJob.indexOf(guard), 'regression guards run after runtime setup');
  assert.ok(existsSync(new URL('scripts/ci-host-evidence.sh', root)), 'evidence helper present');
}

const sources = readSources();

test('shared pool routing, evidence and ABI cache contract', () => validate(sources));

test('selector truth table: forks hosted, same-repo PR/push/manual on the shared pool', () => {
  for (const kind of ['dispatch', 'plain']) {
    const expression = selectors[kind].slice(4, -3).replaceAll('fromJSON(', 'JSON.parse(');
    const evaluate = new Function('github', 'inputs', `return (${expression});`);
    for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
      for (const sameRepo of [true, false]) {
        for (const choice of [undefined, 'shared', 'mac', 'x64']) {
          const result = evaluate({ event_name: event, repository: 'owner/repo', event: { pull_request: { head: { repo: { full_name: sameRepo ? 'owner/repo' : 'fork/repo' } } } } }, { qualification_host: choice });
          const extra = kind === 'dispatch' ? (choice === 'mac' ? ['ci-host-tlpr-mac'] : choice === 'x64' ? ['X64'] : []) : [];
          const expected = event === 'pull_request' && !sameRepo ? 'ubuntu-latest' : [...shared, ...extra];
          assert.deepEqual(result, expected);
        }
      }
    }
    for (const event_name of ['push', 'workflow_dispatch']) assert.deepEqual(evaluate({ event_name, event: {}, repository: 'owner/repo' }, {}), shared);
  }
});

const firstRouted = Object.keys(ROUTED)[0];
const mutations = [
  ['Linux selector', firstRouted, '"Linux"', '"macOS"'],
  ['self-hosted selector', firstRouted, '"self-hosted"', '"ARM64"'],
  ['shared pool pinned to ARM64', firstRouted, `'${JSON.stringify(shared)}'`, `'${JSON.stringify([...shared, 'ARM64'])}'`],
  ['shared pool pinned to X64', firstRouted, `'${JSON.stringify(shared)}'`, `'${JSON.stringify([...shared, 'X64'])}'`],
  ['shared label', firstRouted, `"${LABEL}"`, '"wrong-pool"'],
  ['fork routing trust', firstRouted, `fromJSON((${trust})`, 'fromJSON((true)'],
  ['fork hosted fallback', firstRouted, `'"ubuntu-latest"'`, `'"self-hosted"'`],
  ['fork evidence trust', firstRouted, `if: \${{ ${trust} }}\n        run: bash`, 'if: always()\n        run: bash'],
  ['evidence helper', firstRouted, 'run: bash scripts/ci-host-evidence.sh', 'run: node scripts/ci-host-evidence.sh'],
  ['guard invocation', GUARD.file, 'run: node --test tests/ci/*.test.mjs', 'run: echo skipped'],
];
for (const [file, spec] of Object.entries(ROUTED)) {
  if (spec.dispatch) {
    mutations.push([`${file} manual choices`, file, 'options: [shared, mac, x64]', 'options: [shared, mac]']);
    mutations.push([`${file} Mac additive label`, file, '"ci-host-tlpr-mac"', '"ARM64"']);
    mutations.push([`${file} x64 ABI label`, file, `"${LABEL}","X64"`, `"${LABEL}","ci-host-windows"`]);
  }
}
for (const [file, list] of Object.entries(STATIC)) if (list.length) mutations.push([`${file} static pinned to X64`, file, staticSelector, x64Selector]);
for (const [file, text] of Object.entries(sources)) {
  if (text.includes('${{ runner.arch }}')) {
    mutations.push([`${file} cache ABI`, file, '${{ runner.arch }}', 'common']);
    mutations.push([`${file} cache OS`, file, '${{ runner.os }}', 'common']);
  }
}

for (const [name, file, before, after] of mutations) {
  test(`mutation rejected: ${name}`, () => {
    assert.ok(sources[file].includes(before), `mutation target: ${name}`);
    assert.throws(() => validate({ ...sources, [file]: sources[file].replaceAll(before, after) }));
  });
}

// Each OS/ABI cache boundary is checked in isolation, not only all at once.
for (const [file, text] of Object.entries(sources)) {
  for (const token of ['${{ runner.arch }}', '${{ runner.os }}']) {
    let at = text.indexOf(token);
    let n = 0;
    while (at >= 0) {
      const index = at;
      n += 1;
      test(`mutation rejected: ${file} ${token} occurrence ${n}`, () => {
        assert.throws(() => validate({ ...sources, [file]: text.slice(0, index) + 'common' + text.slice(index + token.length) }));
      });
      at = text.indexOf(token, at + token.length);
    }
  }
}

const guardJobText = jobs(sources[GUARD.file])[GUARD.job];
const setupLine = guardJobText.match(/^.*uses: (?:actions\/setup-node@|\.\/\.github\/actions\/)[^\n]*$/m)[0];
const extra = [
  ['static workflow gains pull_request', Object.keys(STATIC)[0], /^on:\n/m, 'on:\n  pull_request:\n'],
  ['routed workflow gains pull_request_target', firstRouted, /^on:\n/m, 'on:\n  pull_request_target:\n'],
  ['routed workflow drops a trigger', firstRouted, /^ {2}push:\n/m, '  x_removed_push:\n'],
  ['extra unconditional evidence step', firstRouted, /^ {4}steps:\n/m, '    steps:\n      - run: bash scripts/ci-host-evidence.sh\n'],
  ['guard before runtime setup', GUARD.file, setupLine, setupLine.replace(/uses: .*/, 'uses: actions/checkout@v4')],
  ['write permission', firstRouted, /^ {2}contents: read$/m, '  contents: write'],
  ['job-level permission escalation', firstRouted, /^ {4}runs-on:/m, '    permissions: write-all\n    runs-on:'],
  ['permissions removed', firstRouted, /^permissions:\n/m, 'x_permissions:\n'],
];
for (const [name, file, before, after] of extra) {
  if (!file) continue;
  test(`mutation rejected: ${name}`, () => {
    const mutated = sources[file].replace(before, after);
    assert.notEqual(mutated, sources[file], `mutation target: ${name}`);
    assert.throws(() => validate({ ...sources, [file]: mutated }));
  });
}

test('mutation rejected: undeclared new job', () => {
  const file = firstRouted;
  assert.throws(() => validate({ ...sources, [file]: `${sources[file]}\n  rogue:\n    runs-on: [self-hosted, Linux, X64, ${LABEL}]\n    steps:\n      - run: true\n` }));
});

test('mutation rejected: cache restore falls back across ABI', () => {
  const file = Object.keys(sources).find((name) => /restore-keys: \|\n/.test(sources[name]));
  if (!file) return;
  assert.throws(() => validate({ ...sources, [file]: sources[file].replace(/restore-keys: \|\n(\s+)/, 'restore-keys: |\n$1broad-\n$1') }));
});

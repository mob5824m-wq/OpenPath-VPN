import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const readWorkflow = (name:string) => parse(readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'));

// Protect both the runner-allocation fix and the release safety gates. These
// checks parse the actual workflows rather than inferring behavior from docs.
test('macOS ARM build and real Stealth handshake share one native runner', () => {
  const native = readWorkflow('native-installers.yml');
  assert.equal(native.on.push, undefined, 'native builds must not duplicate PR and tagged-release builds');
  assert.ok(Object.hasOwn(native.on, 'pull_request'));
  assert.equal(native.on.workflow_call.inputs.tag.required, true);
  assert.equal(native.on.workflow_dispatch.inputs.tag.required, false);

  const jobs = native.jobs;
  assert.equal(jobs['stealth-macos'], undefined, 'no second ARM runner for the same handshake');
  const mac = jobs.macos;
  assert.equal(mac['runs-on'], '${{ matrix.os }}');
  assert.deepEqual(mac.strategy.matrix.include.map((item:any) => [item.arch, item.os, item.python_arch]), [
    ['arm64', 'macos-15', 'arm64'], ['x64', 'macos-15-intel', 'x64'],
  ]);
  const node = mac.steps.find((step:any) => step.uses === 'actions/setup-node@v4');
  const install = mac.steps.find((step:any) => step.name === 'Install WireGuard and relay test dependencies');
  const handshake = mac.steps.find((step:any) => step.name === 'Verify a real wireguard-go handshake through TLS');
  const upload = mac.steps.findIndex((step:any) => step.uses === 'actions/upload-artifact@v4');
  for (const step of [node, install, handshake]) assert.equal(step?.if, "matrix.arch == 'arm64'");
  assert.match(install.run, /brew (?:list|install) wireguard-tools/);
  assert.match(install.run, /npm ci --prefix server/);
  assert.match(handshake.run, /python scripts\/test-stealth-macos\.py/);
  assert.ok(mac.steps.indexOf(handshake) < upload, 'relay must pass before the macOS artifact is uploaded');
  assert.notEqual(handshake['continue-on-error'], true);
  assert.notEqual(mac['continue-on-error'], true);
  assert.equal(mac.steps[upload].with.name, 'openpath-native-macos-${{ matrix.arch }}');
  assert.match(mac.steps[upload].with.path, /\.dmg/);
  assert.match(mac.steps[upload].with.path, /\.zip/);
});

test('main tag release still runs and gates every native and Android check', () => {
  const tag = readWorkflow('auto-tag.yml');
  const release = readWorkflow('release.yml');
  assert.deepEqual(tag.on.push.branches, ['main']);
  assert.deepEqual(release.on.workflow_run.workflows, ['Auto Tag (bump .1 on merge)']);
  assert.deepEqual(release.on.workflow_run.types, ['completed']);
  assert.match(release.jobs.resolve.if, /conclusion == 'success'/);
  const resolve = release.jobs.resolve.steps.find((step:any) => step.id === 'pick');
  assert.match(resolve.run, /git tag --points-at "\$AUTO_SHA"/);
  assert.equal(release.jobs.native.uses, './.github/workflows/native-installers.yml');
  assert.equal(release.jobs.native.with.tag, '${{ needs.resolve.outputs.tag }}');
  assert.equal(release.jobs.android.uses, './.github/workflows/android.yml');
  assert.equal(release.jobs.android_emulator.uses, './.github/workflows/android-emulator.yml');
  assert.deepEqual(release.jobs.publish.needs, ['resolve', 'bundles', 'native', 'android', 'android_emulator']);
  assert.equal(release.jobs.publish.if, undefined, 'publishing must retain the default success gate');
  const download = release.jobs.publish.steps.find((step:any) => step.with?.pattern === 'openpath-native-*');
  assert.equal(download?.uses, 'actions/download-artifact@v4');
});

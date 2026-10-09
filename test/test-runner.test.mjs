// The runner's own tests. Every case drives a real child process on generated fixture
// files under the OS temp directory: a passing file, a failing assertion, a hard crash
// with exit code 7 and a file that never exits. No fixture is ever written into test/,
// The runner self-test operates only on synthetic directories, so no recursion occurs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests, discoverTestFiles, SELF_TEST_BASENAMES } from "../tools/run-tests.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const PASSES = "process.stdout.write('fixture: pass\\n');\n";
const FAILS = "process.stdout.write('fixture: assertion failed\\n');\nprocess.exit(1);\n";
const CRASHES = "process.stdout.write('fixture: crash\\n');\nprocess.exit(7);\n";
const HANGS = "setTimeout(() => process.stdout.write('never\\n'), 60000);\n";

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dshrb-runner-"));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

function cleanup(dir) {
  assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(dir).startsWith('dshrb-runner-'));
  fs.rmSync(dir, { recursive: true, force: true });
}

test("runner: a directory of passing files reports ok and a zero exit summary", () => {
  const dir = fixture({ "alpha.test.mjs": PASSES, "beta.test.mjs": PASSES, "ignored.mjs": FAILS });
  try {
    const summary = runTests(dir, { timeoutMs: 30000 });
    assert.equal(summary.failed, 0);
    assert.equal(summary.passed, 2);
    assert.equal(summary.files, 2);
    assert.deepEqual(summary.results.map((entry) => entry.exitCode), [0, 0]);
    assert.deepEqual(summary.results.map((entry) => path.basename(entry.label)), ["alpha.test.mjs", "beta.test.mjs"]);
  } finally {
    cleanup(dir);
  }
});

test("runner: files run sequentially, so a later file still runs after a failure", () => {
  const dir = fixture({ "a.test.mjs": FAILS, "b.test.mjs": PASSES });
  try {
    const summary = runTests(dir, { timeoutMs: 30000 });
    assert.equal(summary.passed, 1);
    assert.equal(summary.failed, 1);
    assert.deepEqual(summary.results.map((entry) => path.basename(entry.label)), ["a.test.mjs", "b.test.mjs"]);
    assert.equal(summary.results[0].exitCode, 1, "the assertion failure is reported as exit 1");
    assert.equal(summary.results[0].ok, false);
    assert.equal(summary.results[1].ok, true);
  } finally {
    cleanup(dir);
  }
});

test("runner: a crash with exit code 7 is a failure with that exact code", () => {
  const dir = fixture({ "crash.test.mjs": CRASHES });
  try {
    const summary = runTests(dir, { timeoutMs: 30000 });
    assert.equal(summary.failed, 1);
    assert.equal(summary.results[0].exitCode, 7);
    assert.equal(summary.results[0].ok, false);
    assert.equal(summary.results[0].timedOut, false);
  } finally {
    cleanup(dir);
  }
});

test("runner: a file that never exits is killed at the timeout instead of hanging", () => {
  const dir = fixture({ "hang.test.mjs": HANGS });
  try {
    const summary = runTests(dir, { timeoutMs: 1500 });
    assert.equal(summary.failed, 1);
    assert.equal(summary.results[0].timedOut, true);
    assert.notEqual(summary.results[0].exitCode, 0);
  } finally {
    cleanup(dir);
  }
});

test("runner: explicit files are run even when discovery would skip them", () => {
  const dir = fixture({ "chosen.test.mjs": PASSES, "other.test.mjs": FAILS });
  try {
    const summary = runTests(dir, { files: [path.join(dir, "chosen.test.mjs")], timeoutMs: 30000 });
    assert.equal(summary.files, 1);
    assert.equal(summary.failed, 0);
  } finally {
    cleanup(dir);
  }
});

test("runner: default discovery includes self-tests; exclusions must be explicit", () => {
  const dir = fixture({ "real.test.mjs": PASSES, "test-runner.test.mjs": FAILS });
  try {
    assert.deepEqual(discoverTestFiles(dir).map((entry) => path.basename(entry)), ["real.test.mjs", "test-runner.test.mjs"]);
    assert.deepEqual(SELF_TEST_BASENAMES, []);
    const options = { skip: ["test-runner.test.mjs"], timeoutMs: 30000 };
    assert.deepEqual(discoverTestFiles(dir, options).map((entry) => path.basename(entry)), ["real.test.mjs"]);
    const summary = runTests(dir, options);
    assert.equal(summary.failed, 0);
    assert.equal(summary.files, 1);
  } finally {
    cleanup(dir);
  }
});

test("runner: an empty or missing directory fails instead of passing silently", () => {
  const empty = fixture({ "readme.txt": "no tests here\n" });
  try {
    const summary = runTests(empty, { timeoutMs: 30000 });
    assert.equal(summary.files, 0);
    assert.equal(summary.failed, 1);
    const missing = path.join(empty, "does-not-exist");
    const gone = runTests(missing, { timeoutMs: 30000 });
    assert.equal(gone.failed, 1);
    assert.equal(gone.results[0].ok, false);
  } finally {
    cleanup(empty);
  }
});

test("runner: the offline guard and the test marker reach the child", () => {
  const dir = fixture({
    "env.test.mjs": [
      "import fs from 'node:fs';",
      "if (process.env.DSH_ROUTE_BALANCE_TEST !== '1') { process.stderr.write('marker missing\\n'); process.exit(3); }",
      "if (typeof fs.readFileSync !== 'function') process.exit(4);",
      "process.stdout.write('env ok\\n');",
      "",
    ].join("\n"),
  });
  try {
    const guarded = runTests(dir, { timeoutMs: 30000 });
    assert.equal(guarded.failed, 0, guarded.results[0]?.label);
    const unguarded = runTests(dir, { timeoutMs: 30000, offlineGuard: false });
    assert.equal(unguarded.failed, 0);
  } finally {
    cleanup(dir);
  }
});

test("runner: this repository's own test directory is discoverable", () => {
  const discovered = discoverTestFiles(path.join(HERE), {}).map((entry) => path.basename(entry));
  assert.ok(discovered.includes("package.test.mjs"), `expected package.test.mjs in ${discovered.join(", ")}`);
  assert.ok(discovered.includes("test-runner.test.mjs"), "the runner's own regression suite must not be silently excluded");
});

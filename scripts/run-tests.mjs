// Runs both halves of the test suite and reports both.
//
// The previous script chained the halves with "&&", so a failing logic suite
// hid the database security suite completely. Here both halves always run,
// each prints its own result, and the exit code is non-zero if either failed.
import { spawnSync } from 'node:child_process';

const halves = [
  { name: 'logic tests', args: ['--experimental-strip-types', '--test', 'supabase/functions/_shared/*.test.ts'] },
  // --experimental-test-module-mocks lets the recovery integration tests load
  // the real recorder/sync modules with platform doubles (async storage, file
  // system, Supabase client) behind fault injection.
  { name: 'app tests', args: ['--experimental-strip-types', '--experimental-test-module-mocks', '--test', 'src/**/*.test.ts'] },
  { name: 'database security tests', args: ['--test', 'supabase/tests/*.test.mjs'] },
];

let failed = false;

for (const half of halves) {
  console.log(`\n===== ${half.name} =====`);
  const result = spawnSync(process.execPath, half.args, { stdio: 'inherit' });
  if (result.error) {
    failed = true;
    console.log(`${half.name}: FAILED to start (${result.error.message})`);
  } else if (result.status !== 0) {
    failed = true;
    console.log(`${half.name}: FAILED (exit ${result.status})`);
  } else {
    console.log(`${half.name}: passed`);
  }
}

console.log('');
process.exit(failed ? 1 : 0);

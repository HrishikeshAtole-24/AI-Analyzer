// Runs the k6 ingest load test in Docker (no local k6 install needed).
// Usage: npm run loadtest [-- -e STEPS=10,50,100 -e BATCH=100]
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const dir = path.resolve(__dirname, '..', 'loadtest');
const args = [
  'run', '--rm', '-i',
  // Linux needs this for host.docker.internal; Docker Desktop has it already.
  '--add-host=host.docker.internal:host-gateway',
  '-v', `${dir}:/scripts`,
  'grafana/k6:latest', 'run', '--summary-export=/scripts/last-summary.json', ...process.argv.slice(2), '/scripts/ingest.js',
];
const result = spawnSync('docker', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);

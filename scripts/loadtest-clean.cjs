// Deletes the synthetic records the load test wrote (deployment.environment = loadtest).
// They share the log indices with real service logs and slow every metrics aggregation,
// which made the detector time out after a 5,000 events/s run. Usage: npm run loadtest:clean
const url = (process.env.OPENSEARCH_URL || 'http://127.0.0.1:9200').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Millions of deletes take minutes: run as a background task and poll it.
  const res = await fetch(`${url}/logs-*/_delete_by_query?conflicts=proceed&wait_for_completion=false&refresh=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: { term: { environment: 'loadtest' } } }),
  });
  const started = await res.json();
  if (!res.ok || !started.task) {
    console.error('delete failed:', JSON.stringify(started).slice(0, 500));
    process.exit(1);
  }
  for (;;) {
    const task = await (await fetch(`${url}/_tasks/${started.task}`)).json();
    const status = task.task?.status ?? {};
    if (task.completed) {
      console.log(`deleted ${task.response?.deleted ?? status.deleted} load-test records`);
      return;
    }
    console.log(`deleting... ${status.deleted ?? 0} of ${status.total ?? '?'}`);
    await sleep(10_000);
  }
})();

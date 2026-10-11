# Memory leak

**Symptoms:** `heap usage high` warnings, `process.memory.heap_used_mb` climbing sample after sample, rising
event-loop delay and latency spikes from garbage collection, eventually out-of-memory restarts.

**Likely causes:** an in-memory cache or list without eviction, listeners added per request and never
removed, closures holding large request bodies.

**Steps:**
1. Confirm steady growth (not a one-off spike) and that it tracks request count.
2. Take two heap snapshots a few minutes apart and compare what grew.
3. Mitigate by restarting the service; schedule restarts if the fix will take time.
4. Fix: bound the cache (size limit or TTL) and add a heap alert.

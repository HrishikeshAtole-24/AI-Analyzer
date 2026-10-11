# Database connection pool exhausted

**Symptoms:** `timeout acquiring connection from pool` errors, `db.pool.active` at the pool size,
`db.pool.waiting` above zero, p95 latency close to the acquire timeout (2 s), 503 `db_unavailable`.

**Likely causes:**
- A code path that does not release its connection (early return, missing `finally`).
- Slow queries holding connections longer (see the slow-queries runbook first).
- More concurrent requests than the pool can serve.

**Steps:**
1. Compare `db.pool.active` with request rate. Active stuck at the pool size while traffic is normal points to a leak.
2. Look for the newest code path that acquires a connection, especially around error handling.
3. Mitigate by restarting the service; this returns leaked connections.
4. Fix the leak: release in `finally`. Add a pool metric alert at 80% use.

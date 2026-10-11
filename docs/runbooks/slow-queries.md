# Slow database queries

**Symptoms:** `slow query on payments-db took ...ms` warnings, higher p95 latency on the service and its
callers, few or no errors at first. If it continues, the pool fills and acquire timeouts follow.

**Likely causes:** a dropped or unused index, table bloat, a migration that changed a query plan, lock contention.

**Steps:**
1. Find which queries got slow and when; match the start with deploys and migrations.
2. Check the query plan (`EXPLAIN ANALYZE`) for sequential scans.
3. Mitigate: restore the index, or roll back the migration.
4. Add a statement timeout so slow queries fail fast instead of draining the pool.

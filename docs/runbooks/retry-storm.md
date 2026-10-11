# Retry storm

**Symptoms:** many `gateway call failed, retrying (attempt n/N)` lines per payment with no delay between
them, a dependency's request rate several times the incoming rate, the dependency hitting its
concurrency limit (`gateway at capacity`), latency rising while the error rate looks small.

**Likely causes:** a retry policy changed to many attempts without backoff, retries at several layers
multiplying each other.

**Steps:**
1. Compare the dependency's request rate with the incoming request rate.
2. Find the retry configuration and when it last changed.
3. Restore a safe policy: 2 retries, exponential backoff with jitter, only on retryable errors.
4. Add a retry budget or circuit breaker so retries cannot exceed a share of normal traffic.

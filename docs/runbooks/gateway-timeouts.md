# Payment gateway timeouts

**Symptoms:** payment-service logs `gateway call failed, retrying ... timed out after 2000ms`, payments fail
with 504 `gateway_timeout`, orders fail with 502, p95 latency jumps to several seconds. gateway-mock logs
`client closed the connection` (499) for requests the caller gave up on.

**Likely causes:** the card gateway or its acquirer is slow; network problems between us and the gateway.

**Steps:**
1. Check the gateway provider's status page.
2. Confirm the slowness is in the gateway: its own request durations are long, our services are not busy.
3. Mitigate: fail fast and queue payments for retry; do not raise timeouts while it is degraded.
4. If one acquirer is slow, route to another if the provider supports it.

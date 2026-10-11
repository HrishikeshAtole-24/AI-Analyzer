# Payment gateway errors

**Symptoms:** gateway-mock logs `acquirer connection reset by peer`, charges fail with 5xx
`acquirer_unavailable`, payment-service retries and then fails with 502 `gateway_unavailable`.

**Steps:**
1. Check the gateway provider's status page and the error rate per acquirer.
2. Make sure our retries use backoff and a small limit, so errors do not turn into a retry storm.
3. Tell customer support; card payments may need to be retried later.

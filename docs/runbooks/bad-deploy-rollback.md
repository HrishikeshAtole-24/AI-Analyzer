# Errors after a deploy: roll back first

**Symptoms:** errors start within minutes of a deploy, appear only on the new `service.version`, often as
unhandled exceptions (`TypeError`, `ReferenceError`) with a stack trace, sometimes only for some inputs
(one currency, one SKU).

**Steps:**
1. Confirm the timing: the first error is after the deploy, and the old version had none.
2. Confirm the scope: errors only on the new version. Note which inputs fail.
3. Roll back to the previous version. Do this before debugging.
4. Reproduce with the failing input, fix, add a test for it, and redeploy.

**Not this runbook if:** the errors started before the deploy, or the deployed service shows no new errors
(the deploy is a coincidence; keep investigating).

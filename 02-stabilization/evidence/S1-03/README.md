# S1-03 independent verification evidence

The independent probes in `adversarial-probes.mjs` target a repository checkout supplied as the first argument. From a Linux checkout, run:

```sh
node /path/to/evidence/S1-03/adversarial-probes.mjs /path/to/DkCompany-checkout
```

The probe process uses a fake authenticator and audit sink, synthetic tenant identities, and loopback HTTP only. It tests anonymous list denial, cross-tenant read/decide/revoke/consume denial, explicit and missing tenant scopes, public service snapshot isolation and duplicate-ID rejection, executor binding, null-requester withdrawal authorization, authorization ordering before expiry, HTTP identity/group/training spoofing, and nested input/type validation.

On `1ec0b96615bf2e4b9434bcc88a345fb12afbf563`, all seven probes pass. On the preserved failed candidate `3ea8ee48024f9f8dacb41a678412daf8d9718a27`, six pass and the null-requester withdrawal probe fails because an unrelated same-tenant human changes the internally created request from pending to withdrawn. The source commit `1ec0b96` closes that finding.

Raw command logs remain in `/home/dkcverify/logs/S1-03-1ec0b96/` and `/home/dkcverify/logs/S1-03/` in the assigned WSL2 environment. Their SHA-256 digests and exact commands are recorded in `verification.json`.

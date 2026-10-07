# S1-02 independent probes

`adversarial-probes.mjs` is the verifier's standalone probe source for the
runtime classification boundary, `ProtectedDataGuard.evaluate`, and runtime
logging observer. It imports only the repository's maintained platform source
and test fixtures. It does not modify the checkout.

Run it from the repository root and pass that root as the first argument:

```sh
node 02-stabilization/evidence/S1-02/verification-probes/adversarial-probes.mjs /path/to/DkCompany
```

It writes JSON to stdout. The committed output is
`adversarial-probes-612bca5.json`; its SHA-256 and the source script hash are
recorded in `../verification.json`.

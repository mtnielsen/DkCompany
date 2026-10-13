# Approval service trust boundary

The HTTP service authenticates every route through its configured
`authenticator`. Actor identity, tenant, roles, groups and workload kind come
from that authenticated principal; request bodies and tenant query parameters
are claims only. Tenant-scoped platform access requires an explicit matching
platform scope. Operation roles are checked before a denied actor can trigger
expiry or other state changes.

In-process callers must pass the principal produced by their trusted server
authentication middleware to public service methods. These methods enforce
the same tenant and operation rules as HTTP. They are not an authentication
adapter for caller-supplied identity objects. The runtime approval client pins
its configured workload principal; HTTP clients send a workload bearer token.

Raw persistence access is delivered only through the construction-time
`onTrustedCapability` callback to the trusted composition root. Keep that
frozen capability separate from the public service object, and pass it
explicitly to `createChangeService` as `approvalInternal`. The public service
does not expose its request map, store, audit ledger, HTTP server, or internal
capability. Public reads and writes return isolated snapshots.

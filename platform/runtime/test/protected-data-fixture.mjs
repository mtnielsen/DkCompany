import { createProtectedDataGuard } from "../../data-protection/src/registry.mjs";
import { defaultAccessPolicy } from "../../data-protection/src/policy.mjs";

// Explicit server-side test registration. Tests that use this fixture exercise
// an ordinary resource; unlisted targets remain unknown and are denied.
export const ordinaryDataFixture = createProtectedDataGuard({
  register: {
    records: [
      {
        id: "runtime-test-ordinary",
        dataClass: "ordinary",
        noAiAccess: false,
        authoritativePointer: "dummy-ok",
        tenantId: null,
      },
      {
        id: "runtime-test-remediation-resource",
        dataClass: "ordinary",
        noAiAccess: false,
        authoritativePointer: "service/checkout",
        tenantId: null,
      },
    ],
  },
  policy: defaultAccessPolicy(),
});

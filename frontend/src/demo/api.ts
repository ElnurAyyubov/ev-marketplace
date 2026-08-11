// Dev-only demo endpoints (DEMO_RUNNER_ADDENDUM.md section 7) -- 404 unless
// the gateway has ENABLE_DEV_DEMO set. Kept entirely out of
// frontend/src/api/client.ts (the product's REST client) rather than added
// there as four more untagged exports, so `rm -rf frontend/src/demo` alone
// removes every trace of this surface from the frontend, matching the
// addendum's removal recipe -- no separate edit to a shared file to find
// and undo.
import { request } from '../api/client';
import { Identity } from '../api/types';

export const demoApi = {
  enabled: (identity: Identity) => request<{ enabled: boolean }>(identity, 'GET', '/dev/demo/enabled'),

  plugin: (identity: Identity, payload: { chargerId: string; reservationId: string }) =>
    request<void>(identity, 'POST', '/dev/demo/plugin', payload),

  unplug: (identity: Identity, payload: { chargerId: string }) =>
    request<void>(identity, 'POST', '/dev/demo/unplug', payload),

  conflict: (identity: Identity, payload: { providerId: string; slotIndex: number; windowStart: number }) =>
    request<void>(identity, 'POST', '/dev/demo/conflict', payload),
};

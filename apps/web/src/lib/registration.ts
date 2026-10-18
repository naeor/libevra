import {
  registrationConfigResponseSchema,
  type RegistrationConfigResponse,
} from "@libellum/shared";

import { apiFetch } from "./api.js";

/**
 * Ask the server which registration rule is in force.
 *
 * ⚠️ **The answer comes from the server, and the register endpoint enforces the same rule.** The
 * page uses it only to decide whether to show the invite field; it never decides on its own that a
 * code is unnecessary. If this request fails, the page must not guess "open" — that would turn a
 * network error into an attempt to register under the wrong rule.
 */
export async function fetchRegistrationConfig(): Promise<RegistrationConfigResponse> {
  const response = await apiFetch<unknown>("/auth/registration-config");
  return registrationConfigResponseSchema.parse(response);
}

import type { Messages } from "../../types.js";
import type zh from "../zh-CN/errors.js";

/** `errors` (English). Must mirror zh-CN key for key. */
const errors: Messages<typeof zh> = {
  client: {
    offline: "You’re offline, so this can’t reach the server. Try again once you’re back online.",
    timeout: "The request timed out. Check your connection and try again.",
    malformed: "The service isn’t responding right now. Please try again later.",
    unavailable: "The service is temporarily unavailable. Please try again later.",
    generic: "That didn’t go through. Please try again, and contact an administrator if it keeps failing.",
    unknownServer: "That didn’t go through. Please try again, and contact an administrator if it keeps failing.",
  },
  api: {
    validation_failed: "Please check what you entered.",
  },
};

export default errors;

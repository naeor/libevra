/**
 * Copy for collectible-avatar rewards (S16 avatar rewards).
 *
 * A namespace of its own because the banner sits above the bottom navigation and
 * has nothing to do with the Profile screen; one shared name reads better than
 * guessing whether the notice belongs to `account` or `nav`.
 */
export const rewards = {
  banner: {
    singleTitle: "New avatar · {{name}}",
    singleBody: "Added to your avatar collection",
    multipleTitle: "{{count}} new collectible avatars",
    multipleBody: "All added to your avatar collection",
    cta: "View collection",
    dismiss: "Dismiss notification",
  },
};

export default rewards;

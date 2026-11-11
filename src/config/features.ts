import { featuresSchema, type FeaturesConfig } from "./schema.ts";

/**
 * ✏️ Feature switches. Turn things off here instead of deleting code.
 * PWA is off: the service worker would cache signed-in pages on shared devices.
 */
const features: FeaturesConfig = {
  themeToggle: true,
  pwa: false,
  installPrompt: { enabled: false, delaySeconds: 25, snoozeDays: 14 },
  offlineBanner: false,
};

export const featuresConfig = featuresSchema.parse(features);

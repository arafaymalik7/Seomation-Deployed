import type { IntegrationPlatform } from '@/types';

function parseViteFlag(value: unknown, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value).trim().toLowerCase());
}

export const ENABLE_INSTAGRAM_PUBLISHING = parseViteFlag(
  import.meta.env.VITE_ENABLE_INSTAGRAM_PUBLISHING,
  false
);

export function isPublishingPlatformEnabled(platform: IntegrationPlatform) {
  return platform !== 'INSTAGRAM' || ENABLE_INSTAGRAM_PUBLISHING;
}

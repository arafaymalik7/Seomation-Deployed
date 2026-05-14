import { config } from '../config/index.js';
import ApiError from './ApiError.js';

export function isIntegrationPlatformEnabled(platform) {
  const normalized = String(platform || '').toUpperCase();
  if (normalized === 'INSTAGRAM') {
    return config.integrations?.instagram?.enabled === true;
  }
  return true;
}

export function assertIntegrationPlatformEnabled(platform) {
  if (!isIntegrationPlatformEnabled(platform)) {
    throw new ApiError(
      403,
      'Instagram publishing is disabled until Meta API credentials and permissions are configured.'
    );
  }
}

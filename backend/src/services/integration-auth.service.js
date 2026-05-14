import { prisma } from '../lib/prisma.js';
import logger from '../lib/logger.js';
import { config } from '../config/index.js';
import {
  encryptIntegrationToken,
  prepareIntegrationForUse
} from './integration-token.service.js';
import { refreshInstagramToken } from './instagram-oauth.service.js';

const REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

function getExpiresAtDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function needsTokenRefresh(integration) {
  const expiresAt = getExpiresAtDate(integration?.expiresAt);
  if (!expiresAt) return false;
  return expiresAt.getTime() <= Date.now() + REFRESH_WINDOW_MS;
}

function isTokenExpired(integration) {
  const expiresAt = getExpiresAtDate(integration?.expiresAt);
  return Boolean(expiresAt && expiresAt.getTime() <= Date.now());
}

function buildReconnectError(platform, reason) {
  const label =
    platform === 'WORDPRESS'
      ? 'WordPress'
      : platform === 'LINKEDIN'
        ? 'LinkedIn'
        : platform === 'INSTAGRAM'
          ? 'Instagram'
          : 'Platform';

  return `${label} token ${reason}. Reconnect the ${label} integration before publishing.`;
}

function toExpiryDate(expiresInSeconds, fallback) {
  const seconds = Number(expiresInSeconds);
  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(Date.now() + seconds * 1000);
  }
  return fallback ?? null;
}

async function persistIntegrationTokenUpdate(integration, updates) {
  const metadata = {
    ...(integration.metadata || {}),
    ...(updates.metadata || {}),
    tokenRefreshedAt: new Date().toISOString()
  };

  const updated = await prisma.platformIntegration.update({
    where: { id: integration.id },
    data: {
      accessToken: encryptIntegrationToken(updates.accessToken),
      refreshToken: encryptIntegrationToken(updates.refreshToken ?? integration.refreshToken ?? null),
      expiresAt: updates.expiresAt ?? integration.expiresAt ?? null,
      metadata
    }
  });

  return prepareIntegrationForUse(updated);
}

async function refreshLinkedInIntegration(integration) {
  if (!integration.refreshToken) {
    return null;
  }

  const conf = config.integrations?.linkedin || {};
  if (!conf.clientId || !conf.clientSecret) {
    return null;
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: integration.refreshToken,
    client_id: conf.clientId,
    client_secret: conf.clientSecret
  });

  const resp = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LinkedIn token refresh failed (${resp.status}): ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  if (!data.access_token) {
    throw new Error('LinkedIn token refresh response did not include access_token');
  }

  return persistIntegrationTokenUpdate(integration, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || integration.refreshToken,
    expiresAt: toExpiryDate(data.expires_in, integration.expiresAt)
  });
}

async function refreshInstagramIntegration(integration) {
  if (integration.metadata?.tokenProvider === 'facebook' || integration.metadata?.instagramBusinessId) {
    const refreshed = await refreshInstagramToken(integration, config.integrations?.instagram || {});
    if (refreshed) {
      return persistIntegrationTokenUpdate(integration, refreshed);
    }
  }

  if (!integration.accessToken) {
    return null;
  }

  const refreshUrl = new URL('https://graph.instagram.com/refresh_access_token');
  refreshUrl.searchParams.set('grant_type', 'ig_refresh_token');
  refreshUrl.searchParams.set('access_token', integration.accessToken);

  const resp = await fetch(refreshUrl);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Instagram token refresh failed (${resp.status}): ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  if (!data.access_token) {
    throw new Error('Instagram token refresh response did not include access_token');
  }

  return persistIntegrationTokenUpdate(integration, {
    accessToken: data.access_token,
    expiresAt: toExpiryDate(data.expires_in, integration.expiresAt)
  });
}

async function refreshWordpressIntegration(_integration) {
  return null;
}

async function refreshIntegrationIfNeeded(integration) {
  if (!needsTokenRefresh(integration)) {
    return integration;
  }

  try {
    if (integration.platform === 'LINKEDIN') {
      return (await refreshLinkedInIntegration(integration)) || integration;
    }

    if (integration.platform === 'INSTAGRAM') {
      return (await refreshInstagramIntegration(integration)) || integration;
    }

    return (await refreshWordpressIntegration(integration)) || integration;
  } catch (error) {
    logger.warn(
      {
        integrationId: integration.id,
        platform: integration.platform,
        error: error instanceof Error ? error.message : String(error)
      },
      'Platform token refresh failed'
    );

    if (isTokenExpired(integration)) {
      throw new Error(buildReconnectError(integration.platform, 'expired and could not be refreshed automatically'));
    }

    return integration;
  }
}

export async function prepareIntegrationForPublish(integration) {
  const prepared = await prepareIntegrationForUse(integration);
  const refreshed = await refreshIntegrationIfNeeded(prepared);

  if (isTokenExpired(refreshed)) {
    throw new Error(buildReconnectError(refreshed.platform, 'expired'));
  }

  return refreshed;
}

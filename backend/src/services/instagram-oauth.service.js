import ApiError from '../utils/ApiError.js';

const DEFAULT_GRAPH_VERSION = 'v21.0';

export function normalizeInstagramGraphVersion(value) {
  const version = String(value || DEFAULT_GRAPH_VERSION).trim() || DEFAULT_GRAPH_VERSION;
  return version.startsWith('v') ? version : `v${version}`;
}

export function resolveInstagramAuthUrl(conf = {}) {
  return conf.authUrl || `https://www.facebook.com/${normalizeInstagramGraphVersion(conf.graphVersion)}/dialog/oauth`;
}

function graphUrl(conf, path) {
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  return new URL(`https://graph.facebook.com/${normalizeInstagramGraphVersion(conf.graphVersion)}/${normalizedPath}`);
}

function expiresAtFromSeconds(seconds) {
  const parsed = Number(seconds);
  return Number.isFinite(parsed) && parsed > 0 ? new Date(Date.now() + parsed * 1000) : null;
}

async function readJsonResponse(resp, label) {
  const text = await resp.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_error) {
      data = { raw: text };
    }
  }

  if (!resp.ok) {
    const message = data?.error?.message || data?.error_description || text || resp.statusText;
    throw new ApiError(400, `${label} failed: ${resp.status} ${message}`);
  }

  return data;
}

async function exchangeShortLivedToken(code, conf, redirect) {
  if (!conf.clientId || !conf.clientSecret) {
    throw new ApiError(400, 'Instagram client credentials missing');
  }

  const url = graphUrl(conf, 'oauth/access_token');
  url.searchParams.set('client_id', conf.clientId);
  url.searchParams.set('client_secret', conf.clientSecret);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('code', code);

  const data = await readJsonResponse(await fetch(url), 'Instagram code exchange');
  if (!data.access_token) {
    throw new ApiError(400, 'Instagram access token missing in response');
  }

  return {
    accessToken: data.access_token,
    expiresAt: expiresAtFromSeconds(data.expires_in)
  };
}

async function exchangeLongLivedUserToken(accessToken, conf) {
  if (!conf.clientId || !conf.clientSecret) {
    throw new ApiError(400, 'Instagram client credentials missing');
  }

  const url = graphUrl(conf, 'oauth/access_token');
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', conf.clientId);
  url.searchParams.set('client_secret', conf.clientSecret);
  url.searchParams.set('fb_exchange_token', accessToken);

  const data = await readJsonResponse(await fetch(url), 'Instagram long-lived token exchange');
  if (!data.access_token) {
    throw new ApiError(400, 'Instagram long-lived access token missing in response');
  }

  return {
    accessToken: data.access_token,
    expiresAt: expiresAtFromSeconds(data.expires_in)
  };
}

async function fetchInstagramConnection(accessToken, conf, preferred = {}) {
  const url = graphUrl(conf, 'me/accounts');
  url.searchParams.set(
    'fields',
    'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}'
  );
  url.searchParams.set('limit', '100');
  url.searchParams.set('access_token', accessToken);

  const data = await readJsonResponse(await fetch(url), 'Instagram account discovery');
  const pages = Array.isArray(data?.data) ? data.data : [];
  const candidates = pages.filter((page) => page?.instagram_business_account?.id);

  if (!candidates.length) {
    throw new ApiError(
      400,
      'No Instagram Business or Creator account was found. Connect an Instagram professional account to a Facebook Page and grant page/Instagram permissions.'
    );
  }

  const selected =
    candidates.find((page) => String(page.id) === String(preferred.facebookPageId || '')) ||
    candidates.find(
      (page) =>
        String(page.instagram_business_account?.id) === String(preferred.instagramBusinessId || '')
    ) ||
    candidates[0];

  const instagram = selected.instagram_business_account || {};

  return {
    pageAccessToken: selected.access_token || accessToken,
    metadata: {
      tokenProvider: 'facebook',
      graphVersion: normalizeInstagramGraphVersion(conf.graphVersion),
      facebookPageId: selected.id || null,
      facebookPageName: selected.name || null,
      instagramBusinessId: instagram.id || null,
      username: instagram.username || null,
      instagramAccountName: instagram.name || null,
      profilePictureUrl: instagram.profile_picture_url || null,
      availableInstagramAccounts: candidates.map((page) => ({
        facebookPageId: page.id || null,
        facebookPageName: page.name || null,
        instagramBusinessId: page.instagram_business_account?.id || null,
        username: page.instagram_business_account?.username || null
      }))
    }
  };
}

export async function exchangeInstagramToken(code, conf, redirect) {
  const shortLived = await exchangeShortLivedToken(code, conf, redirect);
  const longLived = await exchangeLongLivedUserToken(shortLived.accessToken, conf);
  const connection = await fetchInstagramConnection(longLived.accessToken, conf);

  return {
    accessToken: connection.pageAccessToken,
    refreshToken: longLived.accessToken,
    expiresAt: longLived.expiresAt || shortLived.expiresAt,
    metadata: connection.metadata
  };
}

export async function refreshInstagramToken(integration, conf) {
  const userToken = integration?.refreshToken || integration?.accessToken;
  if (!userToken) {
    return null;
  }

  const longLived = await exchangeLongLivedUserToken(userToken, conf);
  const connection = await fetchInstagramConnection(longLived.accessToken, conf, {
    facebookPageId: integration?.metadata?.facebookPageId,
    instagramBusinessId: integration?.metadata?.instagramBusinessId
  });

  return {
    accessToken: connection.pageAccessToken,
    refreshToken: longLived.accessToken,
    expiresAt: longLived.expiresAt || integration?.expiresAt || null,
    metadata: connection.metadata
  };
}

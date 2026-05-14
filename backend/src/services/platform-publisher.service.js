import { prisma } from '../lib/prisma.js';
import logger from '../lib/logger.js';
import { config } from '../config/index.js';
import { prepareIntegrationForPublish } from './integration-auth.service.js';
import { normalizeInstagramGraphVersion } from './instagram-oauth.service.js';
import { assertIntegrationPlatformEnabled } from '../utils/integration-features.js';
import { sanitizeContentHtml } from '../utils/html-content.js';
import { LINKEDIN_POST_MAX_LENGTH } from '../constants/input-limits.js';

export const SUPPORTED_PLATFORMS = ['WORDPRESS', 'LINKEDIN', 'INSTAGRAM'];

function stripTags(html = '') {
  return String(html || '').replace(/<[^>]+>/g, ' ');
}

function isReachablePublicUrl(url) {
  if (!url || url.startsWith('data:')) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return false;
    if (host.endsWith('.local')) return false;
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
      return false;
    }
    return true;
  } catch (_e) {
    return false;
  }
}

function resolveImageUrlFromRecord(image, { requirePublic = false } = {}) {
  if (!image) return null;
  const aiMeta = image.aiMeta || {};
  const candidates = [
    aiMeta?.storage?.publicUrl,
    aiMeta?.sourceDetails?.originalUrl,
    aiMeta?.originalUrl,
    image.url
  ].filter(Boolean);

  if (requirePublic) {
    return candidates.find((candidate) => isReachablePublicUrl(candidate)) || null;
  }

  return candidates[0] || null;
}

async function fetchFirstImage(contentId, options = {}) {
  const link = await prisma.contentImageLink.findFirst({
    where: { contentId },
    include: { image: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }]
  });
  return resolveImageUrlFromRecord(link?.image, options);
}

async function fetchImageUrl(contentId, imageId, options = {}) {
  if (!imageId) return null;
  const link = await prisma.contentImageLink.findFirst({
    where: {
      contentId,
      OR: [{ id: imageId }, { imageId }]
    },
    include: { image: true }
  });
  return resolveImageUrlFromRecord(link?.image, options);
}

async function fetchImageBuffer(url) {
  if (!url) return null;
  try {
    if (url.startsWith('data:')) {
      const [, base] = url.split(',');
      return Buffer.from(base, 'base64');
    }
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const arr = await resp.arrayBuffer();
    return Buffer.from(arr);
  } catch (_e) {
    return null;
  }
}

async function hydrateWordpressIntegration(integration) {
  if (!integration.accessToken) return integration;
  const confSiteId = integration.metadata?.siteId || null;
  const confSiteUrl = integration.metadata?.siteUrl || null;
  if (confSiteId && confSiteUrl) return integration;

  try {
    const infoResp = await fetch(
      `https://public-api.wordpress.com/oauth2/token-info?token=${encodeURIComponent(integration.accessToken)}`,
      { headers: { Authorization: `Bearer ${integration.accessToken}` } }
    );
    let blogId = null;
    if (infoResp.ok) {
      const info = await infoResp.json();
      blogId = info?.blog_id || null;
    }
    let siteUrl = confSiteUrl;
    let siteName = integration.metadata?.siteName || null;
    if (blogId) {
      const siteResp = await fetch(`https://public-api.wordpress.com/rest/v1.1/sites/${blogId}`, {
        headers: { Authorization: `Bearer ${integration.accessToken}` }
      });
      if (siteResp.ok) {
        const siteInfo = await siteResp.json();
        siteUrl = siteInfo.URL || siteUrl;
        siteName = siteInfo.name || siteName;
      }
    }
    const merged = {
      ...integration,
      metadata: {
        ...(integration.metadata || {}),
        siteId: blogId || confSiteId || null,
        siteUrl: siteUrl || null,
        siteName: siteName || null
      }
    };
    await prisma.platformIntegration.update({
      where: { id: integration.id },
      data: { metadata: merged.metadata }
    });
    return merged;
  } catch (_e) {
    return integration;
  }
}

function resolveWordpressUploadDetails(imgUrl) {
  let mimeType = 'image/jpeg';
  let filename = 'featured-image.jpg';

  if (imgUrl.startsWith('data:')) {
    const mimeMatch = imgUrl.match(/^data:([^;]+);/);
    if (mimeMatch) {
      mimeType = mimeMatch[1];
      const ext = mimeType.split('/')[1] || 'jpg';
      filename = `featured-image.${ext}`;
    }
  } else if (/\.png(\?|$)/i.test(imgUrl)) {
    mimeType = 'image/png';
    filename = 'featured-image.png';
  } else if (/\.webp(\?|$)/i.test(imgUrl)) {
    mimeType = 'image/webp';
    filename = 'featured-image.webp';
  }

  return { mimeType, filename };
}

async function publishWordPress(content, integration, media) {
  const integ = await hydrateWordpressIntegration(integration);
  const siteId = integ.metadata?.siteId || null;
  const siteUrl = integ.metadata?.siteUrl || null;
  if (!siteId && !siteUrl) {
    throw new Error('WordPress site URL/ID missing; reconnect integration with site selection.');
  }

  const isWpCom = Boolean(siteId);
  const baseEndpoint = isWpCom
    ? `https://public-api.wordpress.com/wp/v2/sites/${siteId}`
    : `${siteUrl.replace(/\/$/, '')}/wp-json/wp/v2`;

  const postsEndpoint = `${baseEndpoint}/posts`;
  const mediaEndpoint = `${baseEndpoint}/media`;
  const body = {
    title: content.title,
    content: sanitizeContentHtml(content.html || content.text || ''),
    status: 'publish'
  };

  if (media?.wordpressFeatured && integ.accessToken && integ.metadata?.mock !== true) {
    const imgUrl = await fetchImageUrl(content.id, media.wordpressFeatured);
    if (imgUrl) {
      const imgBuffer = await fetchImageBuffer(imgUrl);
      if (imgBuffer) {
        try {
          const { mimeType, filename } = resolveWordpressUploadDetails(imgUrl);
          const mediaResp = await fetch(mediaEndpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${integ.accessToken}`,
              'Content-Type': mimeType,
              'Content-Disposition': `attachment; filename="${filename}"`
            },
            body: imgBuffer
          });

          if (mediaResp.ok) {
            const mediaData = await mediaResp.json();
            if (mediaData.id) {
              body.featured_media = mediaData.id;
              logger.info({ mediaId: mediaData.id }, 'WordPress: featured image uploaded');
            }
          } else {
            const errText = await mediaResp.text();
            logger.warn({ status: mediaResp.status, errText }, 'WordPress: media upload failed, posting without image');
          }
        } catch (uploadErr) {
          logger.warn({ uploadErr }, 'WordPress: media upload error, posting without image');
        }
      }
    }
  }

  if (!integ.accessToken || integ.metadata?.mock === true) {
    return {
      externalId: `mock-wp-${Date.now()}`,
      response: { mock: true, endpoint: postsEndpoint, body },
      publishedAt: new Date()
    };
  }

  const resp = await fetch(postsEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${integ.accessToken}`
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`WordPress publish failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  return {
    externalId: data.id ? String(data.id) : null,
    response: data,
    publishedAt: data.date ? new Date(data.date) : new Date()
  };
}

function detectUploadMimeType(mediaUrl) {
  if (/\.png(\?|$)/i.test(mediaUrl)) return 'image/png';
  if (/\.webp(\?|$)/i.test(mediaUrl)) return 'image/webp';
  return 'image/jpeg';
}

async function publishLinkedIn(content, integration, media) {
  const socialText = content.aiMeta?.social?.linkedin?.text;
  const text = String(socialText || content.text || stripTags(content.html || '')).trim();
  if (!integration.accessToken) {
    throw new Error('LinkedIn access token missing; connect LinkedIn integration.');
  }
  if (text.length > LINKEDIN_POST_MAX_LENGTH) {
    throw new Error(
      `LinkedIn post exceeds the ${LINKEDIN_POST_MAX_LENGTH}-character limit. Edit the draft before publishing.`
    );
  }
  const meta = integration.metadata || {};
  let authorUrn =
    meta.urn ||
    (meta.profile?.id ? `urn:li:person:${meta.profile.id}` : null) ||
    (meta.profile?.oidc?.sub ? `urn:li:person:${meta.profile.oidc.sub}` : null);
  if (authorUrn && authorUrn.startsWith('urn:li:member:')) {
    authorUrn = authorUrn.replace('urn:li:member:', 'urn:li:person:');
  }
  if (!authorUrn) {
    throw new Error('LinkedIn author URN missing; reconnect integration to refresh profile data.');
  }
  if (integration.metadata?.mock === true) {
    return {
      externalId: `mock-li-${Date.now()}`,
      response: { mock: true, body: text.slice(0, 280) },
      publishedAt: new Date()
    };
  }

  const payload = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED'
  };

  let assetUrn = null;
  const mediaUrl = await fetchImageUrl(content.id, media?.linkedin);
  if (mediaUrl) {
    const buffer = await fetchImageBuffer(mediaUrl);
    if (buffer) {
      const registerResp = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${integration.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          registerUploadRequest: {
            recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
            owner: authorUrn,
            serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }]
          }
        })
      });

      if (registerResp.ok) {
        const reg = await registerResp.json();
        assetUrn = reg.value?.asset || null;
        const uploadUrl =
          reg.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
        if (assetUrn && uploadUrl) {
          const uploadResp = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': detectUploadMimeType(mediaUrl) },
            body: buffer
          });
          if (!uploadResp.ok) {
            assetUrn = null;
          }
        }
      }
    }
  }

  if (assetUrn) {
    payload.specificContent = {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text },
        shareMediaCategory: 'IMAGE',
        media: [
          {
            status: 'READY',
            media: assetUrn,
            description: { text: text.slice(0, 200) || 'Image' }
          }
        ]
      }
    };
  } else {
    payload.specificContent = {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text },
        shareMediaCategory: 'NONE'
      }
    };
  }

  payload.visibility = { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' };

  const resp = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${integration.accessToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`LinkedIn publish failed (${resp.status}): ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  return {
    externalId: data.id || null,
    response: data,
    publishedAt: new Date()
  };
}

function isPublicInstagramImageUrl(imageUrl) {
  return isReachablePublicUrl(imageUrl);
}

function getInstagramGraphVersion() {
  return normalizeInstagramGraphVersion(config.integrations?.instagram?.graphVersion);
}

async function waitForInstagramContainer(containerId, accessToken) {
  const graphVersion = getInstagramGraphVersion();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const statusResp = await fetch(
      `https://graph.facebook.com/${graphVersion}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`
    );
    if (!statusResp.ok) {
      const txt = await statusResp.text();
      throw new Error(`Instagram status check failed (${statusResp.status}): ${txt.slice(0, 200)}`);
    }
    const statusData = await statusResp.json();
    const status = statusData.status_code || statusData.status || 'UNKNOWN';

    if (status === 'FINISHED' || status === 'PUBLISHED') {
      return;
    }

    if (status === 'ERROR' || status === 'EXPIRED' || status === 'FAILED') {
      throw new Error(`Instagram media processing failed with status ${status}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error('Instagram media processing timed out before publish.');
}

async function publishInstagram(content, integration, media) {
  assertIntegrationPlatformEnabled('INSTAGRAM');
  let imageUrl = await fetchImageUrl(content.id, media?.instagram, { requirePublic: true });
  if (!imageUrl) imageUrl = await fetchFirstImage(content.id, { requirePublic: true });
  if (!imageUrl) {
    throw new Error(
      'Instagram requires an externally reachable image URL. Use a generated image from a public provider or configure PUBLIC_ASSET_BASE_URL for your backend assets.'
    );
  }
  if (!integration.accessToken || integration.metadata?.mock === true) {
    return {
      externalId: `mock-ig-${Date.now()}`,
      response: { mock: true, imageUrl, caption: content.text || stripTags(content.html || '') },
      publishedAt: new Date()
    };
  }

  if (!isPublicInstagramImageUrl(imageUrl)) {
    throw new Error(
      'Instagram requires a public image URL. Local, private-network, or data URL images cannot be published to Instagram.'
    );
  }

  const igUserId = integration.metadata?.instagramBusinessId;
  if (!igUserId) {
    throw new Error('instagramBusinessId missing for Instagram publish.');
  }

  const socialText = content.aiMeta?.social?.instagram?.text;
  const caption = socialText || content.text || stripTags(content.html || '');
  const graphVersion = getInstagramGraphVersion();
  const createUrl = `https://graph.facebook.com/${graphVersion}/${igUserId}/media`;
  const publishUrl = `https://graph.facebook.com/${graphVersion}/${igUserId}/media_publish`;

  const createResp = await fetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caption, image_url: imageUrl, access_token: integration.accessToken })
  });
  if (!createResp.ok) {
    const txt = await createResp.text();
    throw new Error(`Instagram create failed (${createResp.status}): ${txt.slice(0, 200)}`);
  }
  const created = await createResp.json();
  await waitForInstagramContainer(created.id, integration.accessToken);

  const publishResp = await fetch(publishUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: created.id, access_token: integration.accessToken })
  });
  if (!publishResp.ok) {
    const txt = await publishResp.text();
    throw new Error(`Instagram publish failed (${publishResp.status}): ${txt.slice(0, 200)}`);
  }
  const published = await publishResp.json();

  return {
    externalId: published.id || created.id || null,
    response: { create: created, publish: published },
    publishedAt: new Date()
  };
}

export async function publishToPlatform(job) {
  const { platform, content, integration } = job;
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported platform ${platform}`);
  }

  const preparedIntegration = await prepareIntegrationForPublish(integration);

  if (platform === 'WORDPRESS') return publishWordPress(content, preparedIntegration, job.media);
  if (platform === 'LINKEDIN') return publishLinkedIn(content, preparedIntegration, job.media);
  return publishInstagram(content, preparedIntegration, job.media);
}

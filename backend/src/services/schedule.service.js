import ApiError from '../utils/ApiError.js';
import { prisma } from '../lib/prisma.js';
import { sanitizeIntegrationSecrets } from './integration-token.service.js';
import { formatUtcInTimeZone, isValidTimeZone, zonedLocalDateTimeToUtc } from '../utils/datetime.js';
import { sanitizeContentRecord } from '../utils/html-content.js';
import { assertIntegrationPlatformEnabled } from '../utils/integration-features.js';

const SUPPORTED = ['WORDPRESS', 'LINKEDIN', 'INSTAGRAM'];

function normalizePlatform(value) {
  const platform = String(value || '').toUpperCase();
  if (!SUPPORTED.includes(platform)) {
    throw new ApiError(400, 'Unsupported platform');
  }
  return platform;
}

async function ownedContent(contentId, userId) {
  const content = await prisma.content.findUnique({ where: { id: contentId } });
  if (!content || content.userId !== userId) {
    throw new ApiError(404, 'Content not found');
  }
  return content;
}

async function ownedIntegration(integrationId, userId) {
  const integration = await prisma.platformIntegration.findUnique({ where: { id: integrationId } });
  if (!integration || integration.userId !== userId) {
    throw new ApiError(404, 'Integration not found');
  }
  return integration;
}

function validateMedia(platform, media) {
  if (platform === 'INSTAGRAM' && (!media || !media.instagram)) {
    throw new ApiError(400, 'Instagram requires an image. Select one before scheduling.');
  }
  return media || null;
}

function sanitizeScheduledJob(job) {
  if (!job) return job;
  return {
    ...job,
    ...(job.content ? { content: sanitizeContentRecord(job.content) } : {}),
    ...(job.integration ? { integration: sanitizeIntegrationSecrets(job.integration) } : {})
  };
}

export const ScheduleService = {
  async schedule(userId, contentId, integrationId, platform, scheduledTime, timezone, media) {
    const content = await ownedContent(contentId, userId);
    const integration = await ownedIntegration(integrationId, userId);
    const normalizedPlatform = normalizePlatform(platform || integration.platform);
    assertIntegrationPlatformEnabled(normalizedPlatform);
    if (normalizedPlatform === 'WORDPRESS' && !((integration.metadata || {}).siteUrl || (integration.metadata || {}).siteId)) {
      throw new ApiError(400, 'WordPress site is not selected. Reconnect and pick a site.');
    }

    const normalizedTimezone = String(timezone || '').trim();
    if (!isValidTimeZone(normalizedTimezone)) {
      throw new ApiError(400, 'A valid IANA timezone is required for scheduling');
    }

    let when;
    try {
      when =
        scheduledTime instanceof Date
          ? new Date(scheduledTime)
          : zonedLocalDateTimeToUtc(scheduledTime, normalizedTimezone);
    } catch {
      throw new ApiError(400, 'scheduledTime is invalid for the selected timezone');
    }
    if (Number.isNaN(when.getTime())) {
      throw new ApiError(400, 'scheduledTime is invalid for the selected timezone');
    }

    const normalizedMedia = validateMedia(normalizedPlatform, media);

    const data = {
      contentId: content.id,
      integrationId: integration.id,
      platform: normalizedPlatform,
      scheduledTime: when,
      scheduledTimezone: normalizedTimezone,
      media: normalizedMedia,
      status: 'SCHEDULED',
      attempts: 0,
      lastError: null
    };

    const job = await prisma.scheduleJob.create({
      data: {
        ...data
      },
      include: { content: true, integration: true }
    });
    return sanitizeScheduledJob(job);
  },

  async publishNow(userId, contentId, integrationId, platform, timezone, media) {
    const now = new Date();
    const normalizedTimezone = String(timezone || '').trim();
    const scheduledNow =
      isValidTimeZone(normalizedTimezone) ? formatUtcInTimeZone(now, normalizedTimezone) : now;
    return this.schedule(userId, contentId, integrationId, platform, scheduledNow, normalizedTimezone, media);
  },

  async list(userId) {
    const jobs = await prisma.scheduleJob.findMany({
      where: { content: { userId } },
      include: { content: true, integration: true, result: true },
      orderBy: { scheduledTime: 'desc' }
    });
    return jobs.map(sanitizeScheduledJob);
  },

  async cancel(userId, jobId) {
    const job = await prisma.scheduleJob.findUnique({
      where: { id: jobId },
      include: { content: true }
    });
    if (!job || job.content.userId !== userId) {
      throw new ApiError(404, 'Schedule not found');
    }
    if (['COMPLETED', 'FAILED'].includes(job.status)) {
      return job;
    }
    return prisma.scheduleJob.update({
      where: { id: jobId },
      data: { status: 'CANCELLED' }
    });
  }
};

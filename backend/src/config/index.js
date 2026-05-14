import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..', '..');
const appBaseUrl = process.env.APP_BASE_URL || '';
const assetPublicPath = process.env.ASSET_PUBLIC_PATH || '/media';

function toOrigin(value) {
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function parseOriginList(value) {
  return String(value || '')
    .split(',')
    .map((item) => toOrigin(item.trim()))
    .filter(Boolean);
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value).trim().toLowerCase());
}

const inferredCorsOrigins = [
  appBaseUrl,
  process.env.INTEGRATION_CALLBACK_BASE,
  process.env.PUBLIC_ASSET_BASE_URL
]
  .map(toOrigin)
  .filter(Boolean);

const configuredCorsOrigins = parseOriginList(process.env.CORS_ALLOWED_ORIGINS);
const devCorsOrigins =
  (process.env.NODE_ENV || 'development') === 'production'
    ? []
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:4173',
        'http://127.0.0.1:4173'
      ];
const corsAllowedOrigins = Array.from(
  new Set([...configuredCorsOrigins, ...inferredCorsOrigins, ...devCorsOrigins])
);

export const config = {
env: process.env.NODE_ENV || 'development',
port: Number(process.env.PORT || 3000),
appBaseUrl,
databaseUrl: process.env.DATABASE_URL,
jwt: {
accessSecret: process.env.JWT_ACCESS_SECRET,
refreshSecret: process.env.JWT_REFRESH_SECRET,
accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
refreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d'
},
http: {
jsonLimit: process.env.JSON_BODY_LIMIT || '15mb',
corsAllowedOrigins
},
ai: {
url: process.env.AI_SERVICE_URL || '',
mock: String(process.env.AI_MOCK).toLowerCase() === 'true',
timeouts: {
topicsMs: Number(process.env.AI_TOPIC_TIMEOUT_MS || 60000),
contentMs: Number(process.env.AI_CONTENT_TIMEOUT_MS || 360000),
imageMs: Number(process.env.AI_IMAGE_TIMEOUT_MS || 450000),
seoMs: Number(process.env.AI_SEO_TIMEOUT_MS || 30000)
}
},
integrations: {
callbackBase: process.env.INTEGRATION_CALLBACK_BASE || process.env.APP_BASE_URL || '',
tokenEncryptionKey: process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || '',
stateSecret: process.env.INTEGRATION_STATE_SECRET || process.env.JWT_ACCESS_SECRET || '',
stateTtlSeconds: Number(process.env.INTEGRATION_STATE_TTL_SECONDS || 900),
wordpress: {
authUrl: process.env.WP_AUTH_URL || '',
clientId: process.env.WP_CLIENT_ID || '',
clientSecret: process.env.WP_CLIENT_SECRET || '',
redirectUri: process.env.WP_REDIRECT_URI || '',
scope: process.env.WP_SCOPE || 'global'
},
linkedin: {
authUrl: process.env.LI_AUTH_URL || '',
clientId: process.env.LI_CLIENT_ID || '',
clientSecret: process.env.LI_CLIENT_SECRET || '',
redirectUri: process.env.LI_REDIRECT_URI || '',
 scope: process.env.LI_SCOPE || 'openid profile email w_member_social'
},
instagram: {
enabled: parseBoolean(process.env.ENABLE_INSTAGRAM_INTEGRATION, false),
authUrl: process.env.IG_AUTH_URL || '',
clientId: process.env.IG_CLIENT_ID || '',
clientSecret: process.env.IG_CLIENT_SECRET || '',
redirectUri: process.env.IG_REDIRECT_URI || '',
scope: process.env.IG_SCOPE || '',
graphVersion: process.env.IG_GRAPH_VERSION || 'v21.0'
}
},
assets: {
publicPath: assetPublicPath.startsWith('/') ? assetPublicPath : `/${assetPublicPath}`,
publicBaseUrl: process.env.PUBLIC_ASSET_BASE_URL || appBaseUrl || '',
storageDir: process.env.ASSET_STORAGE_DIR || path.resolve(backendRoot, 'storage', 'media'),
maxAge: process.env.ASSET_CACHE_MAX_AGE || '365d'
}
};

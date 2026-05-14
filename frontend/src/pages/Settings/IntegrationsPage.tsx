import { useCallback, useEffect, useState } from 'react';
import { FiCheck, FiExternalLink, FiLink, FiRefreshCw, FiTrash2 } from 'react-icons/fi';
import { useSearchParams } from 'react-router-dom';
import { IntegrationsAPI } from '@/api/integrations';
import type { IntegrationPlatform, PlatformIntegration } from '@/types';
import { extractErrorMessage } from '@/utils/error';
import { Button } from '@/components/ui/Button';
import { isPublishingPlatformEnabled } from '@/config/features';
import './integrations.css';

const providers: { label: string; value: IntegrationPlatform; description: string }[] = [
  { label: 'WordPress', value: 'WORDPRESS', description: 'Publish full blog posts with HTML.' },
  { label: 'LinkedIn', value: 'LINKEDIN', description: 'Share posts to your LinkedIn feed.' },
  { label: 'Instagram', value: 'INSTAGRAM', description: 'Publish images and captions.' }
];

const enabledProviders = providers.filter((provider) => isPublishingPlatformEnabled(provider.value));

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatPlatformLabel(platform: IntegrationPlatform) {
  return providers.find((provider) => provider.value === platform)?.label ?? platform;
}

function getExpiryNotice(expiresAt?: string | null) {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;

  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) {
    return {
      severity: 'error' as const,
      text: 'Token expired — reconnect required'
    };
  }

  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) {
    return {
      severity: 'warn' as const,
      text: `Token expires in ${diffDays} day${diffDays === 1 ? '' : 's'}`
    };
  }

  return {
    severity: 'info' as const,
    text: `Expires ${date.toLocaleDateString()}`
  };
}

function formatConnectionTitle(integration: PlatformIntegration) {
  const metadata = readRecord(integration.metadata);

  if (integration.platform === 'WORDPRESS') {
    return readString(metadata?.siteName) ?? readString(metadata?.siteUrl) ?? 'Site connected';
  }

  if (integration.platform === 'LINKEDIN') {
    const profile = readRecord(metadata?.profile);
    const oidc = readRecord(profile?.oidc);
    return readString(oidc?.name) ?? readString(oidc?.email) ?? 'LinkedIn account connected';
  }

  if (integration.platform === 'INSTAGRAM') {
    return readString(metadata?.username) ?? 'Instagram account connected';
  }

  return 'Connected';
}

function formatConnectionDetails(integration: PlatformIntegration) {
  const metadata = readRecord(integration.metadata);
  const details: string[] = [];

  if (integration.platform === 'WORDPRESS') {
    const siteUrl = readString(metadata?.siteUrl);
    const availableSites = Array.isArray(metadata?.availableSites) ? metadata.availableSites.length : 0;

    if (siteUrl) {
      details.push(siteUrl.replace(/^https?:\/\//i, ''));
    }
    if (availableSites > 1) {
      details.push(`${availableSites} available sites detected`);
    }
  }

  if (integration.platform === 'LINKEDIN') {
    const metadataRecord = readRecord(integration.metadata);
    const profile = readRecord(metadataRecord?.profile);
    const oidc = readRecord(profile?.oidc);
    const email = readString(oidc?.email);
    const urn = readString(metadataRecord?.urn);

    if (email) {
      details.push(email);
    } else if (urn) {
      details.push(urn.replace('urn:li:person:', 'Member '));
    }
  }

  if (integration.platform === 'INSTAGRAM') {
    const username = readString(metadata?.username);
    const businessId = readString(metadata?.instagramBusinessId);

    if (username) {
      details.push(`@${username.replace(/^@/, '')}`);
    } else if (businessId) {
      details.push(`Business ID ${businessId}`);
    }
  }

  details.push(`Updated ${new Date(integration.updatedAt).toLocaleString()}`);

  const expiryNotice = getExpiryNotice(integration.expiresAt);
  if (expiryNotice) {
    details.push(expiryNotice.text);
  }

  return details;
}

export function IntegrationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<PlatformIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<IntegrationPlatform | null>(null);
  const [status, setStatus] = useState('');

  const load = useCallback(async (options?: { background?: boolean }) => {
    if (!options?.background) {
      setLoading(true);
    }
    setError(null);
    try {
      const { data } = await IntegrationsAPI.list();
      setItems(data.items.filter((item) => isPublishingPlatformEnabled(item.platform)));
    } catch (err) {
      setError(extractErrorMessage(err, 'Unable to load integrations.'));
    } finally {
      if (!options?.background) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const initializePage = async () => {
      await load();
    };

    initializePage();
  }, [load]);

  useEffect(() => {
    const integrationStatus = searchParams.get('integration_status');
    const platform = searchParams.get('platform') as IntegrationPlatform | null;
    const message = searchParams.get('message');

    if (!integrationStatus || !platform) {
      return;
    }

    if (integrationStatus === 'success') {
      setStatus(message || `${formatPlatformLabel(platform)} connected successfully.`);
      load({ background: true });
    } else {
      setError(message || `Unable to connect ${formatPlatformLabel(platform)}.`);
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('integration_status');
    nextParams.delete('platform');
    nextParams.delete('message');
    setSearchParams(nextParams, { replace: true });
  }, [load, searchParams, setSearchParams]);

  const connect = async (platform: IntegrationPlatform) => {
    setError(null);
    setStatus('');
    try {
      setConnecting(platform);
      const { data } = await IntegrationsAPI.getAuthUrl(platform);
      setStatus("You'll be redirected to authenticate.");
      window.location.assign(data.url);
    } catch (err) {
      setError(extractErrorMessage(err, 'Unable to start connection.'));
      setConnecting(null);
      setStatus('');
    }
  };

  const disconnect = async (platform: IntegrationPlatform) => {
    try {
      await IntegrationsAPI.disconnect(platform);
      setItems((prev) => prev.filter((item) => item.platform !== platform));
      setError(null);
      setStatus(`${formatPlatformLabel(platform)} disconnected.`);
    } catch (err) {
      setError(extractErrorMessage(err, 'Unable to disconnect.'));
    }
  };

  const handleRefresh = () => {
    load();
  };

  return (
    <div className="integrations-page">
      <header className="integrations-header">
        <div>
          <h1>Integrations</h1>
          <p>Connect your publishing platforms to schedule or publish directly.</p>
        </div>
        <Button variant="ghost" leftIcon={<FiRefreshCw />} onClick={handleRefresh} isLoading={loading}>
          Refresh
        </Button>
      </header>

      {error && <div className="integrations-error glass-card">{error}</div>}

      <div className="integrations-grid">
        {enabledProviders.map((provider) => {
          const connected = items.find((item) => item.platform === provider.value);
          return (
            <article key={provider.value} className="integration-card glass-card">
              <div className="integration-card__header">
                <div>
                  <h3>{provider.label}</h3>
                  <p>{provider.description}</p>
                </div>
                {connected ? <FiCheck color="#52c41a" /> : <FiLink />}
              </div>
              {connected && (
                <div className="integration-card__connected">
                  <div className="integration-card__badge">Connected</div>
                  <strong>{formatConnectionTitle(connected)}</strong>
                  <div className="integration-card__meta">
                    {formatConnectionDetails(connected).map((detail) => (
                      <span key={detail}>{detail}</span>
                    ))}
                  </div>
                </div>
              )}
              {!connected && <div className="integration-card__empty">Not connected yet.</div>}
              <div className="integration-card__actions">
                {!connected && (
                  <Button
                    variant="primary"
                    onClick={() => connect(provider.value)}
                    leftIcon={<FiExternalLink />}
                    isLoading={connecting === provider.value}
                    disabled={!!connecting}
                  >
                    Connect
                  </Button>
                )}
                {connected && (
                  <Button variant="ghost" onClick={() => disconnect(provider.value)} leftIcon={<FiTrash2 />}>
                    Disconnect
                  </Button>
                )}
              </div>
              {!connected && <p className="integration-card__hint">You&apos;ll be redirected to authenticate.</p>}
            </article>
          );
        })}
      </div>

      {status && <div className="integrations-status glass-card">{status}</div>}
    </div>
  );
}

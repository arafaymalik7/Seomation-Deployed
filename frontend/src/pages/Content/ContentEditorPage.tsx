import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { FiChevronDown, FiClock, FiImage, FiLoader, FiSave, FiSend } from 'react-icons/fi';
import { ContentAPI, type GenerateImagePayload } from '@/api/content';
import { IntegrationsAPI } from '@/api/integrations';
import { ScheduleAPI, type PublishPayload, type SchedulePayload } from '@/api/schedule';
import { DraftOutputTabs } from '@/components/content/DraftOutputTabs';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/hooks/useAuth';
import type {
  ContentImageLink,
  ContentItem,
  IntegrationPlatform,
  PlatformIntegration,
  ScheduleJob,
  SeoComponentScore,
  SeoSummary
} from '@/types';
import { extractErrorMessage } from '@/utils/error';
import { IMAGE_PROMPT_MAX_LENGTH, LINKEDIN_POST_MAX_LENGTH } from '@/utils/inputLimits';
import { IMAGE_STYLE_OPTIONS, normalizeImageStyle, type ImageStylePreset } from '@/utils/imageStyles';
import { getTextSurfaceProps } from '@/utils/languagePresentation';
import { isPublishingPlatformEnabled } from '@/config/features';
import {
  formatDateTimeLocalMin,
  formatScheduledDateTime,
  isFutureScheduledInput,
  resolveScheduleTimeZone,
  scheduledLocalInputToUtc
} from '@/utils/scheduleTime';
import './contentEditor.css';

type Severity = SeoComponentScore['severity'];
type EditorSnapshot = {
  title: string;
  metaDescription: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  bodyHtml: string;
  linkedinText: string;
  instagramText: string;
};

const severityClass: Record<Severity, string> = {
  ok: 'seo-chip--ok',
  warn: 'seo-chip--warn',
  error: 'seo-chip--error'
};

const platformRoleMap: Record<'blog' | 'linkedin' | 'instagram', string> = {
  blog: 'featured',
  linkedin: 'featured',
  instagram: 'instagram_main'
};

const roleLabel: Record<string, string> = {
  featured: 'Landscape',
  inline: 'Flexible',
  instagram_main: 'Square'
};

const allPublishImageTargets: {
  key: IntegrationPlatform;
  label: string;
  description: string;
}[] = [
  { key: 'WORDPRESS', label: 'WordPress', description: 'Blog cover / featured image' },
  { key: 'LINKEDIN', label: 'LinkedIn', description: 'Social post image' },
  { key: 'INSTAGRAM', label: 'Instagram', description: 'Feed image' }
];

const publishImageTargets = allPublishImageTargets.filter((target) =>
  isPublishingPlatformEnabled(target.key)
);

const allPlatformOptions: { label: string; value: IntegrationPlatform }[] = [
  { label: 'WordPress', value: 'WORDPRESS' },
  { label: 'LinkedIn', value: 'LINKEDIN' },
  { label: 'Instagram', value: 'INSTAGRAM' }
];

const platformOptions = allPlatformOptions.filter((option) =>
  isPublishingPlatformEnabled(option.value)
);

function formatPlatformLabel(platform: IntegrationPlatform) {
  if (platform === 'WORDPRESS') return 'WordPress';
  if (platform === 'LINKEDIN') return 'LinkedIn';
  if (platform === 'INSTAGRAM') return 'Instagram';
  return platform;
}

function toSecondary(input: string): string[] {
  if (!input) return [];
  return input
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function generatedMetaDescriptionFromContent(item: ContentItem): string {
  const structure = item.aiMeta?.contentStructure;
  if (!structure || typeof structure !== 'object' || Array.isArray(structure)) return '';
  const meta = (structure as { meta?: unknown }).meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return '';
  const description = (meta as { description?: unknown }).description;
  return typeof description === 'string' ? description : '';
}

function generatedPrimaryKeywordFromContent(item: ContentItem): string {
  const focusKeyword = item.seoMeta?.focusKeyword;
  return typeof focusKeyword === 'string' ? focusKeyword : '';
}

function seoImagesFromLinks(items: ContentImageLink[]) {
  return items
    .map((item) => ({ altText: item.image.altText ?? undefined }))
    .filter((item) => Boolean(item.altText));
}

export function ContentEditorPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [content, setContent] = useState<ContentItem | null>(null);
  const [seoSummary, setSeoSummary] = useState<SeoSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [title, setTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [primaryKeyword, setPrimaryKeyword] = useState('');
  const [secondaryKeywords, setSecondaryKeywords] = useState<string[]>([]);
  const [secondaryKeywordsInput, setSecondaryKeywordsInput] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [linkedinText, setLinkedinText] = useState('');
  const [instagramText, setInstagramText] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [images, setImages] = useState<ContentImageLink[]>([]);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageLoadingMessage, setImageLoadingMessage] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageStyle, setImageStyle] = useState<ImageStylePreset>('auto');
  const [imageCount, setImageCount] = useState(1);
  const [imagePlatform, setImagePlatform] = useState<'blog' | 'linkedin' | 'instagram'>('blog');
  const [imageRole, setImageRole] = useState('featured');
  const [imageAlt, setImageAlt] = useState('');
  const [selectedInstagramImage, setSelectedInstagramImage] = useState('');
  const [selectedLinkedinImage, setSelectedLinkedinImage] = useState('');
  const [selectedWordpressImage, setSelectedWordpressImage] = useState('');
  const [integrations, setIntegrations] = useState<PlatformIntegration[]>([]);
  const [jobs, setJobs] = useState<ScheduleJob[]>([]);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<IntegrationPlatform>('WORDPRESS');
  const [scheduledTime, setScheduledTime] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [showOutputViewer, setShowOutputViewer] = useState(true);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<EditorSnapshot | null>(null);
  const scoreTimer = useRef<number | null>(null);
  const imageLongWaitTimer = useRef<number | null>(null);
  const publishLongWaitTimer = useRef<number | null>(null);
  const publishIntent = (location.state as { openPublishModal?: boolean } | null)?.openPublishModal;
  const [activeSidePanel, setActiveSidePanel] = useState<'seo' | 'images' | 'publishing' | null>(null);
  const scheduleTimeZone = resolveScheduleTimeZone(user?.timezone);
  const contentLanguage = content?.language ?? user?.language ?? 'EN';
  const textSurfaceProps = useMemo(() => getTextSurfaceProps(contentLanguage), [contentLanguage]);


  const clearImageLongWaitTimer = () => {
    if (imageLongWaitTimer.current) {
      window.clearTimeout(imageLongWaitTimer.current);
      imageLongWaitTimer.current = null;
    }
  };

  const clearPublishLongWaitTimer = () => {
    if (publishLongWaitTimer.current) {
      window.clearTimeout(publishLongWaitTimer.current);
      publishLongWaitTimer.current = null;
    }
  };

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    setErrorMessage('');
    try {
      const { data } = await ContentAPI.getById(id);
      const nextTitle = data.title ?? '';
      const nextMetaDescription = data.metaDescription ?? generatedMetaDescriptionFromContent(data) ?? '';
      const nextPrimaryKeyword = data.primaryKeyword ?? generatedPrimaryKeywordFromContent(data) ?? '';
      const nextSecondaryKeywords = data.secondaryKeywords ?? [];
      const nextBodyHtml = data.html ?? data.text ?? '';
      const social = data.aiMeta?.social ?? {};
      const nextLinkedinText = normalizeLinkedInDraftText(social.linkedin?.text || '');
      const nextInstagramText = social.instagram?.text || '';
      setContent(data);
      setTitle(nextTitle);
      setMetaDescription(nextMetaDescription);
      setPrimaryKeyword(nextPrimaryKeyword);
      setSecondaryKeywords(nextSecondaryKeywords);
      setSecondaryKeywordsInput(nextSecondaryKeywords.join(', '));
      setBodyHtml(nextBodyHtml);
      setSeoSummary(data.seoSummary ?? null);
      setImagePrompt(data.title ?? '');
      setLinkedinText(nextLinkedinText);
      setInstagramText(nextInstagramText);
      setLastSavedSnapshot(
        buildEditorSnapshot({
          title: nextTitle,
          metaDescription: nextMetaDescription,
          primaryKeyword: nextPrimaryKeyword,
          secondaryKeywords: nextSecondaryKeywords,
          bodyHtml: nextBodyHtml,
          linkedinText: nextLinkedinText,
          instagramText: nextInstagramText
        })
      );
    } catch (err) {
      setLoadError(extractErrorMessage(err, 'Unable to load this draft.'));
    } finally {
      setLoading(false);
    }
  };

  const currentSnapshot = useMemo(
    () =>
      buildEditorSnapshot({
        title,
        metaDescription,
        primaryKeyword,
        secondaryKeywords,
        bodyHtml,
        linkedinText,
        instagramText
      }),
    [title, metaDescription, primaryKeyword, secondaryKeywords, bodyHtml, linkedinText, instagramText]
  );

  const isDirty = useMemo(() => {
    if (!lastSavedSnapshot) return false;
    return JSON.stringify(currentSnapshot) !== JSON.stringify(lastSavedSnapshot);
  }, [currentSnapshot, lastSavedSnapshot]);

  const syncSelectedImages = (items: ContentImageLink[]) => {
    const featured = items.find((item) => item.role === 'featured') ?? items[0] ?? null;
    const instagram = items.find((item) => item.role === 'instagram_main') ?? items[0] ?? null;

    const hasWordpressSelection = items.some((item) => item.id === selectedWordpressImage);
    const hasLinkedinSelection = items.some((item) => item.id === selectedLinkedinImage);
    const hasInstagramSelection = items.some((item) => item.id === selectedInstagramImage);

    setSelectedWordpressImage(hasWordpressSelection ? selectedWordpressImage : featured?.id || '');
    setSelectedLinkedinImage(hasLinkedinSelection ? selectedLinkedinImage : featured?.id || '');
    setSelectedInstagramImage(hasInstagramSelection ? selectedInstagramImage : instagram?.id || '');
  };

  const loadImages = async () => {
    if (!id) return;
    try {
      const { data } = await ContentAPI.listImages(id);
      setImages(data.items);
      syncSelectedImages(data.items);
    } catch (err) {
      console.warn('Failed to load images:', err);
    }
  };

  const loadIntegrations = async () => {
    try {
      const { data } = await IntegrationsAPI.list();
      const enabledItems = data.items.filter((item) => isPublishingPlatformEnabled(item.platform));
      setIntegrations(enabledItems);
      const selectedStillAvailable = enabledItems.some((item) => item.id === selectedIntegrationId);
      if (enabledItems.length && !selectedStillAvailable) {
        const nextIntegration = enabledItems[0];
        setSelectedIntegrationId(nextIntegration.id);
        setSelectedPlatform(nextIntegration.platform);
      } else if (!enabledItems.length) {
        setSelectedIntegrationId('');
        setSelectedPlatform('WORDPRESS');
      }
    } catch (err) {
      console.warn('Failed to load integrations:', err);
      setErrorMessage('Could not load publishing integrations.');
    }
  };

  const loadJobs = async () => {
    try {
      const { data } = await ScheduleAPI.list();
      setJobs(data.items);
    } catch (err) {
      console.warn('Failed to load schedule jobs:', err);
    }
  };

  useEffect(() => {
    const initializePage = async () => {
      await Promise.all([load(), loadImages(), loadIntegrations(), loadJobs()]);
    };

    initializePage();
  }, [id]);

  useEffect(() => {
    if (publishIntent) {
      setPublishModalOpen(true);
    }
  }, [publishIntent]);

  useEffect(() => {
    setImageRole(platformRoleMap[imagePlatform]);
  }, [imagePlatform]);

  useEffect(() => {
    if (!primaryKeyword || !bodyHtml) return;
    if (scoreTimer.current) {
      window.clearTimeout(scoreTimer.current);
    }
    scoreTimer.current = window.setTimeout(async () => {
      setScoring(true);
      try {
        const { data } = await ContentAPI.scoreSeo({
          title,
          metaDescription,
          bodyHtml,
          primaryKeyword,
          secondaryKeywords,
          images: seoImagesFromLinks(images)
        });
        setSeoSummary(data);
      } catch {
        /* silent for live scoring */
      } finally {
        setScoring(false);
      }
    }, 700);
    return () => {
      if (scoreTimer.current) {
        window.clearTimeout(scoreTimer.current);
      }
    };
  }, [title, metaDescription, bodyHtml, primaryKeyword, secondaryKeywords, images]);

  useEffect(() => {
    return () => {
      clearImageLongWaitTimer();
      clearPublishLongWaitTimer();
    };
  }, []);

  const saveDraft = useCallback(async (options?: { successMessage?: string }) => {
    if (!id) return;
    setSaving(true);
    setErrorMessage('');
    try {
      const { data } = await ContentAPI.saveDraftWithSeo(id, {
        title,
        metaDescription,
        bodyHtml,
        primaryKeyword,
        secondaryKeywords,
        images: seoImagesFromLinks(images),
        linkedinText,
        instagramText
      });
      setContent(data.item);
      setSeoSummary(data.seo);
      setLastSavedSnapshot(
        buildEditorSnapshot({
          title,
          metaDescription,
          primaryKeyword,
          secondaryKeywords,
          bodyHtml,
          linkedinText,
          instagramText
        })
      );
      setStatusMessage(options?.successMessage ?? `Saved with SEO score ${Math.round(data.seo.total)}`);
      if (!options?.successMessage) {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }
      return true;
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Unable to save this draft.'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [id, title, metaDescription, primaryKeyword, secondaryKeywords, bodyHtml, images, linkedinText, instagramText]);

  const handleSave = async () => {
    setStatusMessage('');
    await saveDraft();
  };

  const handleGenerateImages = async () => {
    if (!id || !imagePrompt.trim()) return;
    if (imagePrompt.trim().length > IMAGE_PROMPT_MAX_LENGTH) {
      setErrorMessage(`Image prompt must be ${IMAGE_PROMPT_MAX_LENGTH} characters or fewer.`);
      return;
    }
    clearImageLongWaitTimer();
    imageLongWaitTimer.current = window.setTimeout(() => {
      setImageLoadingMessage('This is taking longer than expected...');
    }, 45000);
    setImageLoadingMessage(`Generating ${imageCount} image(s)...`);
    setImageLoading(true);
    setErrorMessage('');
    try {
      const normalizedImageStyle = normalizeImageStyle(imageStyle);
      const payload: GenerateImagePayload = {
        prompt: imagePrompt,
        platform: imagePlatform,
        count: imageCount,
        role: imageRole,
        altText: imageAlt,
        ...(normalizedImageStyle ? { style: normalizedImageStyle as ImageStylePreset } : {})
      };
      await ContentAPI.generateImages(id, payload);
      await loadImages();
      setStatusMessage('Images generated and attached.');
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Unable to generate images right now.'));
    } finally {
      setImageLoading(false);
      setImageLoadingMessage('');
      clearImageLongWaitTimer();
    }
  };

  const handleUploadImage = async (file?: File | null) => {
    if (!id || !file) return;
    clearImageLongWaitTimer();
    imageLongWaitTimer.current = window.setTimeout(() => {
      setImageLoadingMessage('This is taking longer than expected...');
    }, 45000);
    setImageLoadingMessage('Uploading image...');
    setImageLoading(true);
    setErrorMessage('');
    try {
      const dataUrl = await fileToDataUrl(file);
      await ContentAPI.uploadImage(id, {
        dataUrl,
        altText: imageAlt || file.name,
        role: imageRole,
        prompt: imagePrompt
      });
      await loadImages();
      setStatusMessage('Image uploaded and attached.');
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Unable to upload image.'));
    } finally {
      setImageLoading(false);
      setImageLoadingMessage('');
      clearImageLongWaitTimer();
    }
  };

  const handleDeleteImage = async (linkId: string) => {
    if (!id) return;
    clearImageLongWaitTimer();
    imageLongWaitTimer.current = window.setTimeout(() => {
      setImageLoadingMessage('This is taking longer than expected...');
    }, 45000);
    setImageLoadingMessage('Removing image...');
    setImageLoading(true);
    setErrorMessage('');
    try {
      await ContentAPI.deleteImageLink(id, linkId);
      await loadImages();
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Unable to delete image.'));
    } finally {
      setImageLoading(false);
      setImageLoadingMessage('');
      clearImageLongWaitTimer();
    }
  };

  const handlePublishNow = async () => {
    if (!id || !selectedIntegrationId || publishing) return;
    setErrorMessage('');
    if (isDirty) {
      const saved = await saveDraft({ successMessage: 'Draft saved. Publishing latest changes now.' });
      if (!saved) return;
    }
    if (selectedPlatform === 'INSTAGRAM' && !selectedInstagramImage) {
      setErrorMessage('Instagram requires selecting an image.');
      return;
    }
    clearPublishLongWaitTimer();
    publishLongWaitTimer.current = window.setTimeout(() => {
      setStatusMessage('This is taking longer than expected...');
    }, 45000);
    setPublishing(true);
    try {
      const payload: PublishPayload = {
        integrationId: selectedIntegrationId,
        platform: selectedPlatform,
        media: {
          instagram: selectedInstagramImage || undefined,
          linkedin: selectedLinkedinImage || undefined,
          wordpressFeatured: selectedWordpressImage || undefined
        }
      };
      const { data } = await ScheduleAPI.publishNow(id, payload);
      setStatusMessage(
        `Published to ${formatPlatformLabel(selectedPlatform)}. View progress in the Publishing Schedule.`
      );
      setPublishModalOpen(false);
      setJobs((prev) => [data.job, ...prev]);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Unable to publish now.'));
    } finally {
      setPublishing(false);
      clearPublishLongWaitTimer();
    }
  };

  const handleSchedule = async () => {
    if (!id || !selectedIntegrationId || !scheduledTime || publishing) return;
    setErrorMessage('');
    if (isDirty) {
      const saved = await saveDraft({ successMessage: 'Draft saved. Scheduling latest changes now.' });
      if (!saved) return;
    }
    if (selectedPlatform === 'INSTAGRAM' && !selectedInstagramImage) {
      setErrorMessage('Instagram requires selecting an image.');
      return;
    }
    try {
      if (!isFutureScheduledInput(scheduledTime, scheduleTimeZone)) {
        setErrorMessage('Pick a future time for scheduling.');
        return;
      }
    } catch {
      setErrorMessage('Pick a future time for scheduling.');
      return;
    }
    clearPublishLongWaitTimer();
    publishLongWaitTimer.current = window.setTimeout(() => {
      setStatusMessage('This is taking longer than expected...');
    }, 45000);
    setPublishing(true);
    try {
      const payload: SchedulePayload = {
        integrationId: selectedIntegrationId,
        platform: selectedPlatform,
        scheduledTime,
        media: {
          instagram: selectedInstagramImage || undefined,
          linkedin: selectedLinkedinImage || undefined,
          wordpressFeatured: selectedWordpressImage || undefined
        }
      };
      const { data } = await ScheduleAPI.schedule(id, payload);
      const formattedTime = formatScheduledDateTime(
        scheduledLocalInputToUtc(scheduledTime, scheduleTimeZone).toISOString(),
        scheduleTimeZone
      );
      setStatusMessage(`Scheduled for ${formattedTime}. View in the Publishing Schedule.`);
      setPublishModalOpen(false);
      setJobs((prev) => [data.job, ...prev]);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Unable to schedule this content.'));
    } finally {
      setPublishing(false);
      clearPublishLongWaitTimer();
    }
  };

  const seoComponents = seoSummary?.components ?? [];
  const outputImages = useMemo(
    () =>
      images.map((item) => ({
        id: item.id,
        url: item.image.url,
        caption: item.image.altText || 'AI generated image'
      })),
    [images]
  );
  const seoBreakdown = useMemo(
    () => seoComponents.map((component) => component.message).filter(Boolean),
    [seoComponents]
  );
  const lastUpdatedLabel = content?.updatedAt
    ? `Last updated ${new Date(content.updatedAt).toLocaleString()}`
    : 'Not saved yet';
  const latestJob = useMemo(() => jobs.find((job) => job.contentId === id), [jobs, id]);
  const selectedImagesByPlatform = useMemo(
    () => ({
      WORDPRESS: images.find((item) => item.id === selectedWordpressImage) ?? null,
      LINKEDIN: images.find((item) => item.id === selectedLinkedinImage) ?? null,
      INSTAGRAM: images.find((item) => item.id === selectedInstagramImage) ?? null
    }),
    [images, selectedInstagramImage, selectedLinkedinImage, selectedWordpressImage]
  );

  const assignImageToPlatform = (platform: 'WORDPRESS' | 'LINKEDIN' | 'INSTAGRAM', imageId: string) => {
    if (platform === 'WORDPRESS') {
      setSelectedWordpressImage(imageId);
      return;
    }
    if (platform === 'LINKEDIN') {
      setSelectedLinkedinImage(imageId);
      return;
    }
    setSelectedInstagramImage(imageId);
  };

  const imageAssignmentsForCard = (imageId: string) =>
    publishImageTargets.filter((target) => {
      if (target.key === 'WORDPRESS') return selectedWordpressImage === imageId;
      if (target.key === 'LINKEDIN') return selectedLinkedinImage === imageId;
      return selectedInstagramImage === imageId;
    });

  const toggleSidePanel = (panel: 'seo' | 'images' | 'publishing') => {
    setActiveSidePanel((current) => (current === panel ? null : panel));
  };

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!saving) {
          saveDraft();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveDraft, saving]);

  if (loading) {
    return (
      <div className="content-editor-page">
        <div className="content-editor-loader glass-card">
          <FiLoader className="spin" aria-hidden />
          <p>Loading draft...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="content-editor-page">
        <div className="content-editor-error glass-card">{loadError}</div>
        <Button variant="ghost" onClick={() => navigate(-1)}>
          Go back
        </Button>
      </div>
    );
  }

  return (
    <div className="content-editor-page">
      <header className="content-editor-header">
        <div>
          <h1>Edit draft</h1>
          <p>Refine copy, review SEO, attach images, and publish.</p>
        </div>
        <div className="content-editor-actions">
          <span className={`content-editor-sync ${isDirty ? 'is-dirty' : 'is-synced'}`}>
            {isDirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
          <Button variant="ghost" onClick={() => navigate('/content')}>
            Back to drafts
          </Button>
          <Button onClick={() => setPublishModalOpen(true)} leftIcon={<FiSend />}>
            Publish / Schedule
          </Button>
          <Button onClick={handleSave} leftIcon={<FiSave />} isLoading={saving}>
            Save draft
          </Button>
        </div>
      </header>

      {statusMessage && <div className="content-editor-banner glass-card">{statusMessage}</div>}
      {errorMessage && <div className="content-editor-error glass-card">{errorMessage}</div>}

      <div className="content-editor-grid">
        <section className="content-editor-main glass-card">
          <div className="content-editor-outputs">
            <div className="content-editor-outputs__header">
              <div>
                <h2>Generated outputs</h2>
                <p>Review blog, social captions, images, and SEO score in one consistent tab view.</p>
              </div>
              <Button variant="ghost" onClick={() => setShowOutputViewer((prev) => !prev)}>
                {showOutputViewer ? 'Hide outputs' : 'Show outputs'}
              </Button>
            </div>
            {showOutputViewer && (
              <DraftOutputTabs
                className="content-editor-outputs__tabs"
                title={title}
                onTitleChange={setTitle}
                primaryKeyword={primaryKeyword}
                onPrimaryKeywordChange={setPrimaryKeyword}
                metaDescription={metaDescription}
                onMetaDescriptionChange={setMetaDescription}
                secondaryKeywords={secondaryKeywordsInput}
                onSecondaryKeywordsChange={(value) => {
                  setSecondaryKeywordsInput(value);
                  setSecondaryKeywords(toSecondary(value));
                }}
                blogHtml={bodyHtml}
                onBlogHtmlChange={setBodyHtml}
                onSaveDraft={handleSave}
                onPublishSchedule={() => setPublishModalOpen(true)}
                saveBusy={saving}
                publishBusy={publishing}
                saveDisabled={!id || saving}
                publishDisabled={!id || saving || publishing}
                lastUpdatedLabel={lastUpdatedLabel}
                instagramText={instagramText}
                onInstagramTextChange={setInstagramText}
                instagramLimit={2200}
                linkedinText={linkedinText}
                onLinkedinTextChange={setLinkedinText}
                linkedinLimit={LINKEDIN_POST_MAX_LENGTH}
                images={outputImages}
                imagesLoading={imageLoading}
                imagesRegenerating={imageLoading}
                imageLoadingLabel={imageLoadingMessage || 'Generating images...'}
                imagesEmptyLabel="No images are attached to this draft yet."
                onRegenerateImages={handleGenerateImages}
                seoScore={seoSummary ? Math.round(seoSummary.total) : null}
                seoBreakdown={seoBreakdown}
                language={contentLanguage}
              />
            )}
          </div>

        </section>

        <aside className="content-editor-sidebar">
          <div className={`editor-side-panel glass-card ${activeSidePanel === 'seo' ? 'is-open' : ''}`}>
            <button
              type="button"
              className="editor-side-panel__header"
              onClick={() => toggleSidePanel('seo')}
            >
              <span>SEO</span>
              <FiChevronDown className={activeSidePanel === 'seo' ? 'rotated' : ''} aria-hidden />
            </button>
            {activeSidePanel === 'seo' && (
              <div className="editor-side-panel__body">
                <div className="seo-panel">
                  <div className="seo-panel__header">
                    <div>
                      <p>SEO Score</p>
                      <h3>{seoSummary ? Math.round(seoSummary.total) : '—'}</h3>
                    </div>
                    {scoring && <FiLoader className="spin" aria-hidden />}
                  </div>
                  <div className="seo-panel__components">
                    {seoComponents.map((comp) => (
                      <div key={comp.id} className="seo-chip glass-card">
                        <div className="seo-chip__header">
                          <span className={`seo-chip__badge ${severityClass[comp.severity]}`}>{comp.label}</span>
                          <strong>
                            {comp.score}/{comp.max}
                          </strong>
                        </div>
                        <p>{comp.message}</p>
                      </div>
                    ))}
                    {seoComponents.length === 0 && <p className="muted">Score will appear as you type.</p>}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className={`editor-side-panel glass-card ${activeSidePanel === 'images' ? 'is-open' : ''}`}>
            <button
              type="button"
              className="editor-side-panel__header"
              onClick={() => toggleSidePanel('images')}
            >
              <span>Images</span>
              <FiChevronDown className={activeSidePanel === 'images' ? 'rotated' : ''} aria-hidden />
            </button>
            {activeSidePanel === 'images' && (
              <div className="editor-side-panel__body">
                <div className="images-panel">
                  <div className="images-panel__header">
                    <h3>Images</h3>
                    <span className="images-count">{images.length} linked</span>
                  </div>
                  <div className="images-form">
                    <Input
                      label="Prompt"
                      value={imagePrompt}
                      onChange={(e) => setImagePrompt(e.target.value)}
                      placeholder="e.g. Futuristic workspace for SaaS team"
                      maxLength={IMAGE_PROMPT_MAX_LENGTH}
                      helperText={`${imagePrompt.length}/${IMAGE_PROMPT_MAX_LENGTH} characters`}
                      {...textSurfaceProps}
                    />
                    <div className="images-form-grid images-form-grid--two">
                      <Select
                        label="Style"
                        value={imageStyle}
                        onChange={(e) => setImageStyle(e.target.value as ImageStylePreset)}
                        options={IMAGE_STYLE_OPTIONS}
                      />
                      <Select
                        label="Generate for"
                        value={imagePlatform}
                        onChange={(e) => setImagePlatform(e.target.value as 'blog' | 'linkedin' | 'instagram')}
                        options={[
                          { label: 'WordPress', value: 'blog' },
                          { label: 'LinkedIn', value: 'linkedin' },
                          { label: 'Instagram', value: 'instagram' }
                        ]}
                      />
                    </div>
                    <Input
                      label="Alt text"
                      value={imageAlt}
                      onChange={(e) => setImageAlt(e.target.value)}
                      placeholder="Describe the image"
                      {...textSurfaceProps}
                    />
                    <Input
                      type="number"
                      min={1}
                      max={4}
                      label="Count"
                      value={imageCount}
                      onChange={(e) => setImageCount(Number(e.target.value))}
                    />
                    <Button
                      type="button"
                      className="images-generate-button"
                      leftIcon={<FiImage />}
                      onClick={handleGenerateImages}
                      isLoading={imageLoading}
                    >
                      Generate
                    </Button>
                    {imageLoadingMessage && <p className="muted">{imageLoadingMessage}</p>}
                    <label className="upload-link">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleUploadImage(e.target.files?.[0])}
                        disabled={imageLoading}
                      />
                      <span>Upload image</span>
                    </label>
                  </div>
                  {images.length > 0 && (
                    <div className="image-assignment-list">
                      {publishImageTargets.map((target) => {
                        const selectedImage = selectedImagesByPlatform[target.key];
                        return (
                          <div key={target.key} className="image-assignment-row">
                            <div className="image-assignment-row__meta">
                              <p>{target.label}</p>
                              <strong>{selectedImage ? selectedImage.image.altText || 'Selected image' : 'No image selected'}</strong>
                              <span>{selectedImage ? target.description : `Choose an image for ${target.label}`}</span>
                            </div>
                            {selectedImage && (
                              <img
                                src={selectedImage.image.url}
                                alt={selectedImage.image.altText ?? `${target.label} selection`}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="images-grid">
                    {images.map((item) => (
                      <figure key={item.id} className="image-card">
                        <img src={item.image.url} alt={item.image.altText ?? 'content image'} />
                        <figcaption>
                          <div className="image-card__meta">
                            <span className="image-role">{roleLabel[item.role] || 'Image'}</span>
                          </div>
                          <p className="image-card__title">{item.image.altText || 'No alt text'}</p>
                          {imageAssignmentsForCard(item.id).length > 0 && (
                            <div className="image-card__badges">
                              {imageAssignmentsForCard(item.id).map((target) => (
                                <span key={target.key} className="image-card__badge">
                                  {target.label}
                                </span>
                              ))}
                            </div>
                          )}
                          {imageAssignmentsForCard(item.id).length > 0 && (
                            <p className="image-card__hint">Selected for {imageAssignmentsForCard(item.id).map((target) => target.label).join(', ')}</p>
                          )}
                          <div className="image-selectors">
                            {publishImageTargets.map((target) => {
                              const isSelected =
                                (target.key === 'WORDPRESS' && selectedWordpressImage === item.id) ||
                                (target.key === 'LINKEDIN' && selectedLinkedinImage === item.id) ||
                                (target.key === 'INSTAGRAM' && selectedInstagramImage === item.id);

                              return (
                                <button
                                  key={target.key}
                                  type="button"
                                  className={`image-choice-button ${isSelected ? 'is-selected' : ''}`}
                                  onClick={() => assignImageToPlatform(target.key, item.id)}
                                >
                                  <span>{target.label}</span>
                                </button>
                              );
                            })}
                          </div>
                          <Button
                            variant="ghost"
                            size="md"
                            className="image-remove-link"
                            onClick={() => handleDeleteImage(item.id)}
                            disabled={imageLoading}
                          >
                            Remove
                          </Button>
                        </figcaption>
                      </figure>
                    ))}
                    {images.length === 0 && <p className="muted">No images attached yet.</p>}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className={`editor-side-panel glass-card ${activeSidePanel === 'publishing' ? 'is-open' : ''}`}>
            <button
              type="button"
              className="editor-side-panel__header"
              onClick={() => toggleSidePanel('publishing')}
            >
              <span>Publishing</span>
              <FiChevronDown className={activeSidePanel === 'publishing' ? 'rotated' : ''} aria-hidden />
            </button>
            {activeSidePanel === 'publishing' && (
              <div className="editor-side-panel__body">
                <div className="publish-panel">
                  <div className="publish-panel__row">
                    <div>
                      <p className="muted">Publishing</p>
                      <strong>{latestJob ? latestJob.status : 'Not scheduled'}</strong>
                    </div>
                    <Button variant="secondary" onClick={() => setPublishModalOpen(true)}>
                      Manage
                    </Button>
                  </div>
                  {latestJob && (
                    <p className="muted">
                      {latestJob.platform} -{' '}
                      {formatScheduledDateTime(
                        latestJob.scheduledTime,
                        latestJob.scheduledTimezone || scheduleTimeZone
                      )}{' '}
                      ({latestJob.scheduledTimezone || scheduleTimeZone})
                    </p>
                  )}
                  <Button variant="ghost" onClick={() => navigate('/schedule')}>
                    View schedule
                  </Button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      <Modal
        open={publishModalOpen}
        title="Publish or schedule"
        onClose={() => setPublishModalOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPublishModalOpen(false)}>
              Close
            </Button>
            <Button
              variant="secondary"
              onClick={handlePublishNow}
              isLoading={publishing}
              disabled={saving || publishing}
            >
              Publish now
            </Button>
            <Button
              onClick={handleSchedule}
              leftIcon={<FiClock />}
              isLoading={publishing}
              disabled={saving || publishing || !scheduledTime}
            >
              Schedule
            </Button>
          </>
        }
      >
        {integrations.length === 0 && (
          <div className="muted">
            No integrations yet. Connect one first from Settings → Integrations.
          </div>
        )}
        {integrations.length > 0 && (
          <div className="publish-form">
            {isDirty && (
              <div className="content-editor-banner">
                Unsaved edits will be saved automatically before publishing or scheduling.
              </div>
            )}
            <Select
              label="Integration"
              value={selectedIntegrationId}
              onChange={(e) => {
                const idVal = e.target.value;
                setSelectedIntegrationId(idVal);
                const found = integrations.find((i) => i.id === idVal);
                if (found) setSelectedPlatform(found.platform);
              }}
              options={integrations.map((i) => ({ label: `${i.platform} - ${i.id.slice(0, 6)}`, value: i.id }))}
            />
            <Select
              label="Platform"
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value as IntegrationPlatform)}
              options={platformOptions}
            />
            <Input
              type="datetime-local"
              label={`Schedule time (${scheduleTimeZone})`}
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
              min={formatDateTimeLocalMin(scheduleTimeZone, 5)}
            />
            <p className="muted">Times are scheduled in {scheduleTimeZone}.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function buildEditorSnapshot(input: EditorSnapshot): EditorSnapshot {
  return {
    title: normalizeSnapshotText(input.title),
    metaDescription: normalizeSnapshotText(input.metaDescription),
    primaryKeyword: normalizeSnapshotText(input.primaryKeyword),
    secondaryKeywords: [...(input.secondaryKeywords || [])].map(normalizeSnapshotText).filter(Boolean),
    bodyHtml: normalizeHtmlSnapshot(input.bodyHtml),
    linkedinText: normalizeSnapshotText(input.linkedinText),
    instagramText: normalizeSnapshotText(input.instagramText)
  };
}

function normalizeSnapshotText(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeHtmlSnapshot(value: string) {
  return String(value || '').replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
}

function normalizeLinkedInDraftText(value: string) {
  const text = String(value || '').trim();
  if (!text) return text;
  if (text.length <= LINKEDIN_POST_MAX_LENGTH) return text;
  return text.slice(0, LINKEDIN_POST_MAX_LENGTH).trimEnd();
}



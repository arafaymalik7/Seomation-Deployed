import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { FiEdit3, FiSend, FiX } from 'react-icons/fi';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { DraftOutputTabs } from '@/components/content/DraftOutputTabs';
import { useAuth } from '@/hooks/useAuth';
import { useOnboarding } from '@/hooks/useOnboarding';
import { ContentAPI, type GenerateContentPayload, type SeoHint } from '@/api/content';
import { IntegrationsAPI } from '@/api/integrations';
import { ScheduleAPI } from '@/api/schedule';
import type { ContentImageLink, IntegrationPlatform, Language, PlatformIntegration, Topic } from '@/types';
import { extractErrorMessage } from '@/utils/error';
import { LANGUAGE_OPTIONS } from '@/utils/constants';
import { CONTENT_PROMPT_MAX_LENGTH, IMAGE_PROMPT_MAX_LENGTH, LINKEDIN_POST_MAX_LENGTH } from '@/utils/inputLimits';
import { IMAGE_STYLE_OPTIONS, normalizeImageStyle, type ImageStylePreset } from '@/utils/imageStyles';
import { getTextSurfaceProps } from '@/utils/languagePresentation';
import { isPublishingPlatformEnabled } from '@/config/features';
import {
  formatScheduledDateTime,
  formatDateTimeLocalMin,
  isFutureScheduledInput,
  resolveScheduleTimeZone,
  scheduledLocalInputToUtc
} from '@/utils/scheduleTime';
import './blogWriter.css';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
};

type RequestedOutputs = {
  instagram: boolean;
  linkedin: boolean;
  images: boolean;
};

type ImageAiMeta = {
  errors?: Array<{ provider?: string; error?: string }>;
  isPlaceholder?: boolean;
};

const allPlatformOptions: { label: string; value: IntegrationPlatform }[] = [
  { label: 'WordPress', value: 'WORDPRESS' },
  { label: 'LinkedIn', value: 'LINKEDIN' },
  { label: 'Instagram', value: 'INSTAGRAM' }
];

const platformOptions = allPlatformOptions.filter((option) =>
  isPublishingPlatformEnabled(option.value)
);

function getTimestamp() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isPlaceholderImage(item: ContentImageLink) {
  const aiMeta = item.image.aiMeta as ImageAiMeta | null;
  return item.image.provider === 'placeholder' || Boolean(aiMeta?.isPlaceholder);
}

function buildImageFailureMessage(items: ContentImageLink[]) {
  const firstPlaceholder = items.find(isPlaceholderImage);
  const aiMeta = (firstPlaceholder?.image.aiMeta as ImageAiMeta | null) ?? null;
  const providerErrors = Array.isArray(aiMeta?.errors) ? aiMeta.errors : [];
  const detail = providerErrors
    .map((entry) => `${entry.provider || 'provider'}: ${entry.error || 'failed'}`)
    .join(' | ');

  if (detail) {
    return `Image generation failed and only placeholders were returned. ${detail}`;
  }

  return 'Image generation failed and only placeholders were returned. Check your image provider keys and retry.';
}

function formatPlatformLabel(platform: IntegrationPlatform) {
  if (platform === 'WORDPRESS') return 'WordPress';
  if (platform === 'LINKEDIN') return 'LinkedIn';
  if (platform === 'INSTAGRAM') return 'Instagram';
  return platform;
}

function toSecondaryKeywords(input: string) {
  if (!input) return [];
  return input
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

export function BlogWriterPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { businessProfile } = useOnboarding();
  const scheduleTimeZone = resolveScheduleTimeZone(user?.timezone);
  const initialTopic = (location.state as { topic?: Topic } | undefined)?.topic ?? null;

  const welcomeMessage = useMemo(() => {
    if (businessProfile) {
      const audience = businessProfile.targetAudience || 'your audience';
      return `I'm ready to write for your ${businessProfile.niche} brand and ${audience}. Share a prompt or tweak the focus keyword to begin.`;
    }
    return 'Tell me about the topic, keywords, tone, and any calls-to-action. I will shape an SEO-ready blog post for you.';
  }, [businessProfile]);

  const [language, setLanguage] = useState<Language>(
    initialTopic?.language ??
      businessProfile?.language ??
      user?.language ??
      'EN'
  );
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(initialTopic);
  const [prompt, setPrompt] = useState('');
  const [focusKeyword, setFocusKeyword] = useState(
    initialTopic?.targetKeyword ?? initialTopic?.title ?? ''
  );
  const [title, setTitle] = useState(initialTopic?.title ?? '');
  const [metaDescription, setMetaDescription] = useState('');
  const [secondaryKeywordsInput, setSecondaryKeywordsInput] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'assistant-welcome',
      role: 'assistant',
      content: welcomeMessage,
      timestamp: getTimestamp()
    }
  ]);
  const [blogHtml, setBlogHtml] = useState('');
  const [blogPlain, setBlogPlain] = useState('');
  const [instagramCopy, setInstagramCopy] = useState('');
  const [linkedinCopy, setLinkedinCopy] = useState('');
  const [includeInstagram, setIncludeInstagram] = useState(true);
  const [includeLinkedIn, setIncludeLinkedIn] = useState(true);
  const [includeImage, setIncludeImage] = useState(false);
  const [includeLinkedInImage, setIncludeLinkedInImage] = useState(false);
  const [includeInstagramImage, setIncludeInstagramImage] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageStyle, setImageStyle] = useState<ImageStylePreset>('auto');
  const [seoScore, setSeoScore] = useState<number | null>(null);
  const [seoHints, setSeoHints] = useState<SeoHint[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [contentId, setContentId] = useState<string | null>(null);
  const [generatedImages, setGeneratedImages] = useState<ContentImageLink[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesError, setImagesError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [clipboardFail, setClipboardFail] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<PlatformIntegration[]>([]);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<IntegrationPlatform>('WORDPRESS');
  const [scheduledTime, setScheduledTime] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [useImages, setUseImages] = useState(false);
  const [requestedOutputs, setRequestedOutputs] = useState<RequestedOutputs>({
    instagram: false,
    linkedin: false,
    images: false
  });
  const [imageRequestCount, setImageRequestCount] = useState(0);
  const clipboardFailTimer = useRef<number | null>(null);
  const generationStatusTimers = useRef<number[]>([]);
  const previousTopicIdRef = useRef<string | null>(initialTopic?.id ?? null);
  const textSurfaceProps = useMemo(() => getTextSurfaceProps(language), [language]);

  const clearGenerationStatusTimers = useCallback(() => {
    generationStatusTimers.current.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    generationStatusTimers.current = [];
  }, []);

  const queueGenerationStatusUpdates = useCallback(() => {
    clearGenerationStatusTimers();
    setGenerationStatus('Researching your topic...');
    generationStatusTimers.current = [
      window.setTimeout(() => setGenerationStatus('Writing your draft...'), 5000),
      window.setTimeout(() => setGenerationStatus('Almost done...'), 20000),
      window.setTimeout(() => setGenerationStatus('This is taking longer than expected...'), 45000)
    ];
  }, [clearGenerationStatusTimers]);

  const showClipboardFailure = useCallback(() => {
    setClipboardFail(true);
    if (clipboardFailTimer.current) {
      window.clearTimeout(clipboardFailTimer.current);
    }
    clipboardFailTimer.current = window.setTimeout(() => {
      setClipboardFail(false);
    }, 2000);
  }, []);

  const copyTextToClipboard = useCallback(
    async (value: string) => {
      if (!value) return false;
      try {
        if (!('clipboard' in navigator)) {
          showClipboardFailure();
          return false;
        }
        await navigator.clipboard.writeText(value);
        setClipboardFail(false);
        return true;
      } catch (err) {
        console.warn('Failed to copy text:', err);
        showClipboardFailure();
        return false;
      }
    },
    [showClipboardFailure]
  );

  useEffect(() => {
    return () => {
      if (clipboardFailTimer.current) {
        window.clearTimeout(clipboardFailTimer.current);
      }
      clearGenerationStatusTimers();
    };
  }, [clearGenerationStatusTimers]);

  useEffect(() => {
    setMessages((prev) => {
      if (prev.length === 1 && prev[0].id === 'assistant-welcome') {
        return [{ ...prev[0], content: welcomeMessage }];
      }
      return prev;
    });
  }, [welcomeMessage]);

  useEffect(() => {
    if (selectedTopic?.id && previousTopicIdRef.current !== selectedTopic.id) {
      setFocusKeyword(selectedTopic.targetKeyword ?? selectedTopic.title);
      if (selectedTopic.language && language !== selectedTopic.language) {
        setLanguage(selectedTopic.language);
      }
      setPrompt('');
      setTitle(selectedTopic.title);
      previousTopicIdRef.current = selectedTopic.id;
    }
    if (!selectedTopic) {
      previousTopicIdRef.current = null;
    }
  }, [selectedTopic, language]);

  useEffect(() => {
    setUseImages(generatedImages.length > 0);
  }, [generatedImages]);

  useEffect(() => {
    const initializeIntegrations = async () => {
      await loadIntegrations();
    };

    initializeIntegrations();
  }, []);

  const fetchImagesForContent = async (id: string) => {
    setImagesLoading(true);
    setImagesError(null);
    try {
      const { data } = await ContentAPI.listImages(id);
      const items = data.items ?? [];
      const successfulImages = items.filter((item) => !isPlaceholderImage(item));
      const placeholderImages = items.filter(isPlaceholderImage);
      setGeneratedImages(successfulImages);
      if (placeholderImages.length > 0 && successfulImages.length === 0) {
        setImagesError(buildImageFailureMessage(placeholderImages));
      } else if (placeholderImages.length > 0) {
        setImagesError('Some image providers failed. Showing only the images that were generated successfully.');
      }
    } catch (err) {
      setImagesError(extractErrorMessage(err, 'Unable to load generated images.'));
    } finally {
      setImagesLoading(false);
      setImageRequestCount(0);
    }
  };

  const regenerateImages = async () => {
    if (!contentId) {
      setImagesError('Generate a draft first, then regenerate images.');
      return;
    }

    const resolvedPrompt =
      imagePrompt.trim() || selectedTopic?.title || prompt.trim() || focusKeyword.trim();

    if (!resolvedPrompt) {
      setImagesError('Add an image prompt or focus keyword before regenerating images.');
      return;
    }

    const normalizedImageStyle = normalizeImageStyle(imageStyle);
    const requests: Array<{ platform: 'blog' | 'linkedin' | 'instagram'; role: string }> = [];

    if (includeImage) requests.push({ platform: 'blog', role: 'featured' });
    if (includeLinkedInImage) requests.push({ platform: 'linkedin', role: 'featured' });
    if (includeInstagramImage) requests.push({ platform: 'instagram', role: 'instagram_main' });

    if (!requests.length) {
      const existingRoles = new Set(generatedImages.map((item) => item.role));
      if (existingRoles.has('featured') || existingRoles.has('inline')) {
        requests.push({ platform: 'blog', role: 'featured' });
      }
      if (existingRoles.has('instagram_main')) {
        requests.push({ platform: 'instagram', role: 'instagram_main' });
      }
      if (!requests.length) {
        requests.push({ platform: 'blog', role: 'featured' });
      }
    }

    setImagesLoading(true);
    setImagesError(null);
    setImageRequestCount(requests.length);
    try {
      for (const request of requests) {
        await ContentAPI.generateImages(contentId, {
          prompt: resolvedPrompt,
          platform: request.platform,
          role: request.role,
          count: 1,
          ...(normalizedImageStyle ? { style: normalizedImageStyle as ImageStylePreset } : {})
        });
      }
      await fetchImagesForContent(contentId);
      setStatusMessage('Images regenerated successfully.');
    } catch (err) {
      setImagesLoading(false);
      setImagesError(extractErrorMessage(err, 'Unable to regenerate images right now.'));
    }
  };

  const loadIntegrations = async () => {
    try {
      const { data } = await IntegrationsAPI.list();
      const enabledItems = data.items.filter((item) => isPublishingPlatformEnabled(item.platform));
      setIntegrations(enabledItems);
      if (enabledItems.length) {
        setSelectedIntegrationId((prev) =>
          enabledItems.some((item) => item.id === prev) ? prev : enabledItems[0].id
        );
        setSelectedPlatform((prev) =>
          isPublishingPlatformEnabled(prev) ? prev : enabledItems[0].platform
        );
      } else {
        setSelectedIntegrationId('');
        setSelectedPlatform('WORDPRESS');
      }
    } catch (err) {
      console.warn('Failed to load integrations:', err);
    }
  };

  const handlePromptSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isGenerating) return;
    let openingEditor = false;

    const trimmedPrompt = prompt.trim();
    const trimmedKeyword = focusKeyword.trim();

    if (!selectedTopic && !trimmedPrompt) {
      setFormError('Add a prompt or pick a suggested topic to start writing.');
      return;
    }

    if (trimmedPrompt.length > CONTENT_PROMPT_MAX_LENGTH) {
      setFormError(`Prompt must be ${CONTENT_PROMPT_MAX_LENGTH} characters or fewer.`);
      return;
    }

    if (!trimmedKeyword) {
      setFormError('Provide a focus keyword so the draft can optimise around it.');
      return;
    }

    if (imagePrompt.trim().length > IMAGE_PROMPT_MAX_LENGTH) {
      setFormError(`Image prompt must be ${IMAGE_PROMPT_MAX_LENGTH} characters or fewer.`);
      return;
    }

    setFormError(null);
    setApiError(null);
    setImagesError(null);
    setStatusMessage('');
    setClipboardFail(false);

    const userContent = selectedTopic
      ? `Use the topic "${selectedTopic.title}" with focus keyword "${trimmedKeyword}".`
      : trimmedPrompt;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userContent,
      timestamp: getTimestamp()
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsGenerating(true);
    setRequestedOutputs({
      instagram: includeInstagram,
      linkedin: includeLinkedIn,
      images: includeImage || includeLinkedInImage || includeInstagramImage
    });
    const requestedImageTotal = [includeImage, includeLinkedInImage, includeInstagramImage].filter(Boolean).length;
    setImageRequestCount(requestedImageTotal);
    queueGenerationStatusUpdates();

    const normalizedImageStyle = normalizeImageStyle(imageStyle);
    const payload: GenerateContentPayload = {
      platform: 'BLOG',
      language,
      includeInstagram,
      includeLinkedIn,
      includeImage,
      includeLinkedInImage,
      includeInstagramImage,
      imagePrompt: imagePrompt || selectedTopic?.title || trimmedPrompt || focusKeyword
    };
    if (normalizedImageStyle) {
      payload.imageStyle = normalizedImageStyle as ImageStylePreset;
    }

    if (selectedTopic) {
      payload.topicId = selectedTopic.id;
    } else {
      payload.prompt = trimmedPrompt;
      payload.focusKeyword = trimmedKeyword;
    }

    try {
      const { data } = await ContentAPI.generate(payload);
      const variants = data.variants ?? {};
      setContentId(data.item.id);
      setGeneratedImages([]);
      if (includeImage || includeLinkedInImage || includeInstagramImage) {
        fetchImagesForContent(data.item.id);
      } else {
        setImagesLoading(false);
      }
      setTitle(data.item.title ?? selectedTopic?.title ?? '');
      setMetaDescription(data.item.metaDescription ?? '');
      setSecondaryKeywordsInput((data.item.secondaryKeywords ?? []).join(', '));
      setBlogHtml(data.item.html ?? '');
      setBlogPlain(data.item.text ?? '');
      setLanguage(data.item.language as Language);
      setSeoScore(data.seo?.score ?? null);
      setSeoHints(data.seo?.hints ?? []);
      setInstagramCopy(includeInstagram ? variants.instagram?.text ?? '' : '');
      setLinkedinCopy(includeLinkedIn ? variants.linkedin?.text ?? '' : '');
      setFocusKeyword(data.focusKeyword);
      setLastSavedAt(data.item.updatedAt);
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: `Draft ready! SEO score ${data.seo?.score ?? '—'}${
          variants.linkedin || variants.instagram ? ' with social captions included.' : '.'
        }`,
        timestamp: getTimestamp()
      };
      setMessages((prev) => [...prev, assistantMessage]);
      if (!selectedTopic) {
        setPrompt('');
      }
      clearGenerationStatusTimers();
      setGenerationStatus('Opening your editable draft...');
      setStatusMessage('Draft generated. Taking you to the editor now...');
      openingEditor = true;
      await new Promise((resolve) => {
        window.setTimeout(resolve, 700);
      });
      navigate(`/content/${data.item.id}`, { state: { fromWriter: true } });
      return;
    } catch (error) {
      const message = extractErrorMessage(error, 'Unable to generate the draft right now.');
      setApiError(message);
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: `I ran into an issue: ${message}`,
          timestamp: getTimestamp()
        }
      ]);
    } finally {
      clearGenerationStatusTimers();
      if (!openingEditor) {
        setGenerationStatus('');
        setIsGenerating(false);
      }
    }
  };

  const resolveMediaSelection = () => {
    if (!useImages || generatedImages.length === 0) return undefined;
    const media: {
      instagram?: string;
      linkedin?: string;
      wordpressFeatured?: string;
    } = {};
    const featured =
      generatedImages.find((img) => img.role === 'featured') ??
      generatedImages.find((img) => img.role === 'inline') ??
      generatedImages[0];
    const insta = generatedImages.find((img) => img.role === 'instagram_main');

    if (featured) {
      media.wordpressFeatured = featured.id;
      media.linkedin = featured.id;
    }
    if (insta) {
      media.instagram = insta.id;
    }

    return Object.keys(media).length ? media : undefined;
  };

  const handlePublishOpen = () => {
    if (!contentId) return;
    setPublishError(null);
    setPublishModalOpen(true);
    if (!integrations.length) {
      loadIntegrations();
    }
  };

  const persistDraftEdits = async (showSuccessMessage: boolean) => {
    if (!contentId) return true;
    try {
      const { data } = await ContentAPI.saveDraftWithSeo(contentId, {
        title: title.trim(),
        metaDescription: metaDescription.trim(),
        bodyHtml: blogHtml,
        primaryKeyword: focusKeyword.trim(),
        secondaryKeywords: toSecondaryKeywords(secondaryKeywordsInput),
        linkedinText: linkedinCopy,
        instagramText: instagramCopy
      });
      setSeoScore(Math.round(data.seo.total));
      setSeoHints(
        data.seo.components.map((component) => ({
          type: component.id,
          msg: component.message
        }))
      );
      setLastSavedAt(data.item.updatedAt);
      if (showSuccessMessage) {
        setStatusMessage('Draft saved successfully.');
      }
      return true;
    } catch (err) {
      const message = extractErrorMessage(err, 'Unable to save your latest edits.');
      if (showSuccessMessage) {
        setApiError(message);
      } else {
        setPublishError(message);
      }
      return false;
    }
  };

  const handleSaveDraft = async () => {
    if (!contentId || savingDraft) return;
    setSavingDraft(true);
    setApiError(null);
    const saved = await persistDraftEdits(true);
    if (!saved) {
      setStatusMessage('');
    }
    setSavingDraft(false);
  };

  const handlePublishNow = async () => {
    if (!contentId) return;
    if (!selectedIntegrationId) {
      setPublishError('Select an integration to publish.');
      return;
    }

    setPublishing(true);
    setPublishError(null);
    try {
      const saved = await persistDraftEdits(false);
      if (!saved) return;
      const { data } = await ScheduleAPI.publishNow(contentId, {
        integrationId: selectedIntegrationId,
        platform: selectedPlatform,
        media: resolveMediaSelection()
      });
      setStatusMessage(
        `Published to ${formatPlatformLabel(selectedPlatform)}. View progress in the Publishing Schedule.`
      );
      setPublishModalOpen(false);
      setScheduledTime('');
      // optional: surface job id or platform later
      return data.job;
    } catch (err) {
      setPublishError(extractErrorMessage(err, 'Unable to publish right now.'));
    } finally {
      setPublishing(false);
    }
  };

  const handleSchedule = async () => {
    if (!contentId) return;
    if (!selectedIntegrationId) {
      setPublishError('Select an integration to schedule.');
      return;
    }
    if (!scheduledTime) {
      setPublishError('Pick a time to schedule.');
      return;
    }
    try {
      if (!isFutureScheduledInput(scheduledTime, scheduleTimeZone)) {
        setPublishError('Pick a future time for scheduling.');
        return;
      }
    } catch {
      setPublishError('Pick a future time for scheduling.');
      return;
    }

    setPublishing(true);
    setPublishError(null);
    try {
      const saved = await persistDraftEdits(false);
      if (!saved) return;
      const { data } = await ScheduleAPI.schedule(contentId, {
        integrationId: selectedIntegrationId,
        platform: selectedPlatform,
        scheduledTime,
        media: resolveMediaSelection()
      });
      const formattedTime = formatScheduledDateTime(
        scheduledLocalInputToUtc(scheduledTime, scheduleTimeZone).toISOString(),
        scheduleTimeZone
      );
      setStatusMessage(`Scheduled for ${formattedTime}. View in the Publishing Schedule.`);
      setPublishModalOpen(false);
      setScheduledTime('');
      return data.job;
    } catch (err) {
      setPublishError(extractErrorMessage(err, 'Unable to schedule this content.'));
    } finally {
      setPublishing(false);
    }
  };

  const handleEditDraft = () => {
    if (!contentId) return;
    navigate(`/content/${contentId}`);
  };

  const handlePublishSchedule = () => {
    if (!contentId) return;
    handlePublishOpen();
  };

  const lastUpdatedLabel = lastSavedAt
    ? `Last updated ${new Date(lastSavedAt).toLocaleString()}`
    : 'Not saved yet';

  const hasBlogDraft = Boolean(blogHtml || blogPlain);

  return (
    <div className="blog-writer-page">
      <header className="blog-writer-header">
        <div>
          <h1>SEO-Based Blog Writer</h1>
          <p>
            Craft an outline, send a quick prompt, and review the SEO-friendly draft, HTML markup, and social
            captions without leaving your workspace.
          </p>
        </div>
        <div className="blog-writer-header__actions">
          <Select
            label="Language"
            value={language}
            onChange={(event) => setLanguage(event.target.value as Language)}
            options={LANGUAGE_OPTIONS}
          />
          <Button
            type="button"
            variant="ghost"
            leftIcon={<FiEdit3 />}
            onClick={handleEditDraft}
            disabled={!contentId}
            title={contentId ? 'Open this draft in the editor' : 'Generate a draft first'}
          >
            Edit draft
          </Button>
          <Button
            type="button"
            variant="secondary"
            leftIcon={<FiSend />}
            onClick={handlePublishSchedule}
            disabled={!contentId}
            title={contentId ? 'Publish or schedule this draft' : 'Generate a draft first'}
          >
            Publish / Schedule
          </Button>
        </div>
      </header>

      {statusMessage && <div className="blog-writer-banner glass-card">{statusMessage}</div>}

      {selectedTopic && (
        <div className="blog-writer-topic glass-card">
          <div className="blog-writer-topic__details">
            <span className="blog-writer-topic__label">Topic</span>
            <strong>{selectedTopic.title}</strong>
            {selectedTopic.targetKeyword && (
              <span className="blog-writer-topic__keyword">
                Focus: {selectedTopic.targetKeyword}
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            
            leftIcon={<FiX />}
            onClick={() => {
              setSelectedTopic(null);
              setFocusKeyword('');
            }}
          >
            Clear topic
          </Button>
        </div>
      )}

      <main className="blog-writer-body">
        <section className="blog-writer-output glass-card">
          {apiError && <div className="blog-writer-alert">{apiError}</div>}
          {clipboardFail && (
            <div className="blog-writer-alert">Copy failed - try selecting the text manually.</div>
          )}

          {!hasBlogDraft && (
            <div className="blog-writer-output__placeholder large">
              <p>Your SEO-ready draft will appear here after you send a prompt.</p>
            </div>
          )}

          {hasBlogDraft && (
            <DraftOutputTabs
              className="blog-writer-output__tabs"
              title={title}
              onTitleChange={setTitle}
              primaryKeyword={focusKeyword}
              onPrimaryKeywordChange={setFocusKeyword}
              metaDescription={metaDescription}
              onMetaDescriptionChange={setMetaDescription}
              secondaryKeywords={secondaryKeywordsInput}
              onSecondaryKeywordsChange={setSecondaryKeywordsInput}
              blogHtml={blogHtml}
              onBlogHtmlChange={setBlogHtml}
              onSaveDraft={handleSaveDraft}
              onPublishSchedule={handlePublishSchedule}
              saveBusy={savingDraft}
              publishBusy={publishing}
              saveDisabled={!contentId || savingDraft}
              publishDisabled={!contentId || publishing}
              lastUpdatedLabel={lastUpdatedLabel}
              instagramText={instagramCopy}
              onInstagramTextChange={setInstagramCopy}
              linkedinText={linkedinCopy}
              onLinkedinTextChange={setLinkedinCopy}
              linkedinLimit={LINKEDIN_POST_MAX_LENGTH}
              images={generatedImages.map((item) => ({
                id: item.id,
                url: item.image.url,
                caption: item.image.altText || 'AI generated image'
              }))}
              imagesLoading={imagesLoading}
              imagesRegenerating={imagesLoading}
              imageLoadingLabel={`Generating ${Math.max(imageRequestCount, 1)} image(s)...`}
              imagesError={imagesError}
              imagesEmptyLabel={
                requestedOutputs.images
                  ? 'No usable images were attached for this run. Retry after checking your image providers.'
                  : 'Images will appear here when generated.'
              }
              onRegenerateImages={regenerateImages}
              instagramEmptyLabel={
                requestedOutputs.instagram
                  ? 'Instagram caption was requested, but no caption was returned for this run.'
                  : 'Instagram caption was not requested for this run.'
              }
              linkedinEmptyLabel={
                requestedOutputs.linkedin
                  ? 'LinkedIn post was requested, but no post was returned for this run.'
                  : 'LinkedIn description was not requested for this run.'
              }
              seoScore={seoScore}
              seoBreakdown={seoHints.map((hint) => hint.msg)}
              onCopyText={copyTextToClipboard}
              onCopyFailure={showClipboardFailure}
              language={language}
            />
          )}
        </section>

        <section className="blog-writer-chat glass-card">
          <div className="blog-writer-chat__messages" role="log" aria-live="polite">
            {messages.map((message) => (
              <div
                key={message.id}
                className={clsx('blog-writer-chat__message', `blog-writer-chat__message--${message.role}`)}
              >
                <div className="blog-writer-chat__bubble">
                  <span className="blog-writer-chat__timestamp">{message.timestamp}</span>
                  <p>{message.content}</p>
                </div>
              </div>
            ))}
          </div>

          <form className="blog-writer-chat__composer" onSubmit={handlePromptSubmit}>
            <div className="blog-writer-chat__composer-scroll">
              <div className="blog-writer-chat__section">
                <Input
                  label="Focus keyword"
                  value={focusKeyword}
                  onChange={(event) => {
                    setFocusKeyword(event.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder="e.g. SaaS onboarding checklist"
                  {...textSurfaceProps}
                />
                {!selectedTopic && (
                  <Textarea
                    name="prompt"
                    value={prompt}
                    onChange={(event) => {
                      setPrompt(event.target.value);
                      if (formError) setFormError(null);
                    }}
                    placeholder="Describe the blog you need, tone, and audience..."
                    rows={3}
                    maxLength={CONTENT_PROMPT_MAX_LENGTH}
                    helperText={`${prompt.length}/${CONTENT_PROMPT_MAX_LENGTH} characters`}
                    {...textSurfaceProps}
                  />
                )}
                {formError && <p className="blog-writer-chat__error">{formError}</p>}
              </div>

              <div className="blog-writer-chat__section chat-options__group">
                <span className="chat-options__label">Social captions</span>
                <div className="chat-toggle-row">
                  <button
                    type="button"
                    className={clsx('chip-toggle', includeInstagram && 'is-active')}
                    aria-pressed={includeInstagram}
                    onClick={() => setIncludeInstagram((prev) => !prev)}
                  >
                    Instagram
                  </button>
                  <button
                    type="button"
                    className={clsx('chip-toggle', includeLinkedIn && 'is-active')}
                    aria-pressed={includeLinkedIn}
                    onClick={() => setIncludeLinkedIn((prev) => !prev)}
                  >
                    LinkedIn
                  </button>
                </div>
              </div>

              <div className="blog-writer-chat__section chat-options__group">
                <span className="chat-options__label">Images</span>
                <div className="chat-toggle-row">
                  <button
                    type="button"
                    className={clsx('chip-toggle', includeImage && 'is-active')}
                    aria-pressed={includeImage}
                    onClick={() => setIncludeImage((prev) => !prev)}
                  >
                    Blog/Featured
                  </button>
                  <button
                    type="button"
                    className={clsx('chip-toggle', includeLinkedInImage && 'is-active')}
                    aria-pressed={includeLinkedInImage}
                    onClick={() => setIncludeLinkedInImage((prev) => !prev)}
                  >
                    LinkedIn image
                  </button>
                  <button
                    type="button"
                    className={clsx('chip-toggle', includeInstagramImage && 'is-active')}
                    aria-pressed={includeInstagramImage}
                    onClick={() => setIncludeInstagramImage((prev) => !prev)}
                  >
                    Instagram image
                  </button>
                </div>
                <Input
                  label="Image prompt"
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder="Optional image direction"
                  maxLength={IMAGE_PROMPT_MAX_LENGTH}
                  helperText={`${imagePrompt.length}/${IMAGE_PROMPT_MAX_LENGTH} characters`}
                  {...textSurfaceProps}
                />
                <Select
                  label="Image style"
                  value={imageStyle}
                  onChange={(e) => setImageStyle(e.target.value as ImageStylePreset)}
                  options={IMAGE_STYLE_OPTIONS}
                />
              </div>
            </div>

            <div className="blog-writer-chat__submit">
              <Button
                type="button"
                className="blog-writer-send"
                rightIcon={<FiSend />}
                isLoading={isGenerating}
                disabled={isGenerating}
                onClick={(event) => {
                  event.currentTarget.form?.requestSubmit();
                }}
              >
                {isGenerating ? 'Generating...' : 'Send Prompt'}
              </Button>
              {isGenerating && generationStatus && (
                <p className="blog-writer-chat__status">{generationStatus}</p>
              )}
            </div>
          </form>
        </section>
      </main>

      <Modal
        open={publishModalOpen}
        title="Publish or schedule"
        onClose={() => setPublishModalOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPublishModalOpen(false)}>
              Close
            </Button>
            <Button variant="secondary" onClick={handlePublishNow} isLoading={publishing} disabled={!integrations.length}>
              Publish now
            </Button>
            <Button
              onClick={handleSchedule}
              leftIcon={<FiSend />}
              isLoading={publishing}
              disabled={!integrations.length || !scheduledTime}
            >
              Schedule
            </Button>
          </>
        }
      >
        {!integrations.length && (
          <div className="blog-writer-publish-empty">
            No integrations found. Connect one from Settings → Integrations, then come back to publish.
          </div>
        )}

        {integrations.length > 0 && (
          <div className="blog-writer-publish-form">
            <Select
              label="Integration"
              value={selectedIntegrationId}
              onChange={(e) => {
                const idVal = e.target.value;
                setSelectedIntegrationId(idVal);
                const found = integrations.find((i) => i.id === idVal);
                if (found) setSelectedPlatform(found.platform);
              }}
              options={integrations.map((i) => ({
                label: `${i.platform} • ${i.id.slice(0, 6)}`,
                value: i.id
              }))}
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
            {!scheduledTime && (
              <p className="blog-writer-publish-hint">Pick a date and time above to enable scheduling.</p>
            )}
            <p className="blog-writer-publish-hint">Times are scheduled in {scheduleTimeZone}.</p>
            <label className="blog-writer-checkbox blog-writer-checkbox--spaced">
              <input
                type="checkbox"
                checked={useImages}
                onChange={(e) => setUseImages(e.target.checked)}
                disabled={generatedImages.length === 0}
              />
              <span>{generatedImages.length === 0 ? 'No images available' : 'Publish with images'}</span>
            </label>
            {useImages && generatedImages.length > 0 && (
              <p className="blog-writer-publish-hint">
                We will attach the featured image (and Instagram image if available) automatically.
              </p>
            )}
            {publishError && <div className="blog-writer-alert">{publishError}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}


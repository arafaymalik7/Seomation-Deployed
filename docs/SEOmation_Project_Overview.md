# SEOmation Project Overview

Version: Repository-based overview  
Source of truth: Current codebase in this workspace  
Reviewed against code on: 2026-04-20

## 1. What SEOmation Is

SEOmation is an AI-assisted content operations platform built to help creators, marketers, and small businesses move from idea to published content inside one workflow. It combines:

- business-aware topic ideation
- AI content generation for blogs and social content
- SEO scoring and editorial refinement
- AI image generation and media attachment
- platform integrations for direct publishing
- timezone-aware scheduling with retry handling

In its current repository state, SEOmation is primarily a **three-service full-stack application**:

- `frontend/`: React + Vite web app
- `backend/`: Express + Prisma API and publishing/scheduling layer
- `ai/`: FastAPI-based AI service for topic generation, content generation, research, RAG, and image generation

The product goal is to reduce fragmentation in content workflows. Instead of using separate tools for ideation, drafting, SEO checks, images, and publishing, SEOmation tries to bring those steps into one system.

## 2. Executive Summary

SEOmation helps a user:

1. create an account and define a business profile
2. generate niche-relevant topic suggestions
3. turn a selected topic or prompt into AI-generated content
4. score and improve the draft for SEO
5. attach AI-generated or uploaded images
6. create LinkedIn and Instagram variants
7. connect publishing platforms
8. publish immediately or schedule content for later

The current implementation is strongest in the **web application and AI-assisted content pipeline**. The codebase already contains:

- authentication
- onboarding and business profile capture
- topic generation
- blog draft generation
- LinkedIn and Instagram text generation
- draft management and editing
- rule-based SEO scoring
- image generation with provider fallback
- WordPress, LinkedIn, and Instagram integrations
- scheduling with retry logic and timezone handling

## 3. Problem SEOmation Solves

Digital content workflows are usually fragmented:

- keyword and topic research happens in one tool
- content writing happens in another
- SEO checks happen somewhere else
- images are produced separately
- publishing is often manual or disconnected

SEOmation addresses that by making the content lifecycle continuous:

- profile-driven strategy input
- AI-assisted ideation
- AI-assisted drafting
- editing and SEO improvement in the same interface
- direct publishing and scheduling from the same workspace

This makes it especially relevant for:

- freelancers
- marketing teams
- startup founders
- small businesses
- creators managing multiple channels

## 4. Current Product Scope in This Repository

### Implemented in code

- Web app for login, onboarding, dashboard, writer, content management, integrations, and schedule
- Backend API for auth, user profile, topics, content, images, SEO, integrations, and schedule
- AI service for topic suggestions, content generation, research, RAG, and image generation
- Direct integration pathways for WordPress, LinkedIn, and Instagram
- Media persistence and serving via backend `/media/...`
- Job scheduling and publish-now execution through a backend smart scheduler

### Mentioned in the reference report but not present in this repo

The attached FYP report describes a broader scope that includes a **browser extension** and SEO auditing utilities such as:

- on-page SEO audit
- competitor comparison
- PDF export of reports
- email extraction from websites

Those browser-extension modules are **not present in the current repository structure**. There is no extension folder, browser manifest, or active audit/comparison implementation in the current codebase. For any formal presentation of the current software, the repository should be treated as the source of truth.

## 5. High-Level User Workflow

### 5.1 Account and Setup

- User registers and logs in
- User completes onboarding
- Onboarding captures business context such as niche, audience, keywords, region, cadence, and tone
- The onboarding profile is stored in `user.preferences.onboarding.businessProfile`

### 5.2 Topic Ideation

- The dashboard can automatically request topic suggestions
- Topic generation uses business profile context plus optional trend-aware research
- Suggested topics are stored in the database and shown as reusable cards

### 5.3 Content Generation

- User can generate content from a selected topic or from a direct prompt
- Main draft is created as blog content
- Optional LinkedIn and Instagram variants can be generated in the same flow
- Optional images can also be requested during generation

### 5.4 Editing and Optimization

- Generated drafts open in a dedicated editor
- User can edit title, meta description, keywords, HTML body, and social captions
- SEO score is recalculated and saved
- Images can be generated, uploaded, removed, and assigned to publishing targets

### 5.5 Publishing and Scheduling

- User connects WordPress, LinkedIn, and/or Instagram
- User chooses publish now or schedule later
- Schedule jobs are stored in UTC but created/displayed using the selected timezone
- A smart scheduler executes jobs, retries transient failures, and records results

## 6. Main Features

## 6.1 Authentication and Session Management

- Email/password registration and login
- JWT access tokens and refresh tokens
- Refresh token rotation
- Logout token revocation
- Auth middleware for protected routes
- Rate limiting on auth endpoints

Implementation notes:

- Backend uses `bcryptjs` for password hashing
- Refresh tokens are stored hashed in the database
- Access token expiry and refresh expiry are configurable

## 6.2 Business Onboarding

The onboarding flow captures strategic context that drives downstream AI behavior.

Collected profile data includes:

- business name
- niche
- primary platforms
- timezone
- language
- content goals
- tone of voice
- target audience
- publishing cadence
- preferred content types
- seed keywords
- audience pain points
- primary region
- seasonal focus
- trend preference
- additional notes

This business profile is used by:

- topic generation
- content generation
- dashboard topic refresh
- style guide construction
- research context building

## 6.3 Dashboard

The dashboard acts as the workspace summary page.

Current dashboard behavior includes:

- loading topics, content items, and schedule jobs
- showing key metrics such as total words generated, content count, and estimated time saved
- showing a writer entry point
- showing a scheduling calendar widget
- showing topic cards for quick drafting
- auto-generating topics if onboarding exists and no topics are present

## 6.4 Topic Generation

Topic generation is one of the core AI-driven flows.

Capabilities:

- uses the user's niche and persona context
- can include trend-aware research
- produces a small curated topic batch
- stores target keywords, rationales, relevance values, and AI metadata

Current behavior:

- backend sends a topic request to the FastAPI service
- FastAPI quickly seeds indexed memory for the niche
- live search can bring in fresh snippets
- Groq generates structured topic ideas in JSON
- backend saves suggested topics to PostgreSQL
- old suggested topics are replaced with the new batch

The current topic flow is limited intentionally to a small suggestion set for usability.

## 6.5 AI Content Generation

SEOmation currently supports AI generation for:

- blog content
- LinkedIn posts
- Instagram captions

Generation inputs include:

- topic or freeform prompt
- language
- focus keyword
- tone
- target length
- business profile style guidance
- optional live trend research
- optional indexed niche memory

Returned draft data includes:

- title
- HTML
- plain text
- structured content object
- meta description
- keyword metadata
- diagnostics
- readability and grammar metrics

## 6.6 Draft Management and Editing

Users can manage content as drafts after generation.

Supported draft operations:

- list drafts
- open a single draft
- update draft fields
- save and persist SEO summary
- store platform-specific social variants in `aiMeta.social`
- manage associated images

The content editor supports:

- draft saving
- publish/schedule workflow
- SEO side panel
- image side panel
- publishing side panel
- image assignment per platform

## 6.7 SEO Scoring

SEOmation includes a rule-based SEO scoring engine on the backend.

The SEO score currently checks:

- title quality and keyword inclusion
- meta description quality and keyword inclusion
- heading structure
- keyword usage and density
- content length
- image alt text coverage

The score is normalized to 100 and stored in `seoSummary`.

This is not a search-engine ranking predictor. It is a practical editorial scoring system designed to keep generated drafts aligned with basic on-page SEO best practices.

## 6.8 Image Generation and Image Management

SEOmation supports both AI-generated images and manual uploads.

Supported image capabilities:

- generate blog/featured images
- generate LinkedIn images
- generate Instagram square images
- generate alt text
- upload custom images
- persist images to backend-managed storage
- assign images to different publishing targets

Provider behavior:

- image generation tries multiple providers in configured order
- current provider chain includes Together, kie.ai, Hugging Face, and placeholder fallback
- if all providers fail, a placeholder image is still returned to keep the flow stable

Image metadata stores:

- prompt
- format
- dimensions
- provider
- storage details
- source details
- original public URL where available

## 6.9 Integrations

Current publishing integrations:

- WordPress
- LinkedIn
- Instagram

Integration capabilities include:

- OAuth URL generation
- OAuth callback handling
- encrypted token storage
- token refresh for LinkedIn and Instagram where possible
- disconnection and cleanup
- WordPress site selection support

Security note:

- OAuth tokens are encrypted before storage using AES-256-GCM through the integration token service

## 6.10 Publishing and Scheduling

Publishing is handled by the backend service layer and scheduler, not by the frontend directly.

Supported scheduling features:

- publish now
- schedule for a future local datetime
- timezone-aware normalization
- cancellation of scheduled jobs
- retry logic with exponential backoff
- persisted publish results
- reload of scheduled jobs on backend startup

The scheduler:

- uses `node-schedule`
- stores job state in the database
- retries transient failures
- marks fatal failures appropriately
- can recover scheduled jobs after restart
- handles stuck `RUNNING` jobs during reload

## 7. Current Architecture

```text
React Frontend
    ->
Express Backend API
    ->
FastAPI AI Service
    ->
LLM / Search / Image Providers

Express Backend API
    ->
PostgreSQL via Prisma

Express Backend API
    ->
Scheduler + Platform Publishers
    ->
WordPress / LinkedIn / Instagram
```

### Responsibilities by layer

#### Frontend

- authentication state
- onboarding flow
- dashboard and workspace UI
- content generation requests
- draft editing UX
- integration management UI
- schedule monitoring UI

#### Backend

- auth and authorization
- request validation
- database persistence
- AI service orchestration
- SEO scoring
- image persistence
- OAuth integration management
- scheduling and publishing execution

#### AI service

- topic ideation
- live search and content research
- RAG retrieval
- content generation
- image generation
- output normalization and diagnostics

## 8. Actual Technology Stack

### Frontend

- React 19
- TypeScript
- Vite 7
- React Router 7
- React Hook Form
- Zod
- TipTap editor
- Axios
- Recharts
- Day.js

### Backend

- Node.js
- Express
- Prisma ORM
- PostgreSQL
- Zod validation
- JWT
- bcryptjs
- node-schedule
- sanitize-html
- pino logging

### AI Service

- FastAPI
- Pydantic
- httpx
- Google Gemini for primary content generation
- Groq for topic generation and fallback
- Cohere or SBERT embeddings
- Qdrant or pgvector or in-memory vector backend
- DuckDuckGo / SerpAPI / Google News RSS / Serper-based search inputs

### External platform and media dependencies

- WordPress APIs
- LinkedIn APIs
- Instagram Graph API
- Together image API
- kie.ai image API
- Hugging Face inference API

## 9. Supported Languages and Platforms

### Languages currently modeled in the app

- English (`EN`)
- German (`DE`)
- Japanese (`JA`)
- Arabic (`AR`)
- Korean (`KO`)
- Chinese (`ZH`)
- Russian (`RU`)

### Content platforms

- BLOG
- LINKEDIN
- INSTAGRAM

### Publishing integrations

- WORDPRESS
- LINKEDIN
- INSTAGRAM

## 10. AI Pipeline Details

## 10.1 Topic Pipeline

Current topic generation pipeline:

1. Backend collects user and onboarding context
2. FastAPI creates or reuses a stable namespace
3. FastAPI performs a quick seed into vector memory
4. Background index building can continue asynchronously
5. Context is retrieved from indexed memory
6. Optional live trend snippets are collected
7. Snippets are merged and passed to Groq
8. Groq returns clustered topic ideas
9. Backend stores the resulting topic suggestions

Notable implementation detail:

- topic generation is designed to be fast enough for dashboard use while still preserving a path for richer background indexing

## 10.2 Content Research Pipeline

The content generation path is more selective.

Current behavior:

- live search is used for immediate topic research
- indexed RAG is only used when the request is judged aligned with the user's niche
- this avoids polluting content generation with irrelevant niche memory for off-topic prompts

The content research bundle includes:

- merged snippets
- keyword/angle extraction
- indexed-context policy diagnostics
- namespace info
- `ragMode` such as `live-only` or `live+indexed`

## 10.3 Content Generation Pipeline

Current generation flow:

1. Backend builds research context from onboarding and request data
2. FastAPI research service gathers live and indexed context
3. Gemini is used as the main content model
4. Groq acts as fallback when Gemini is unavailable or quota-limited
5. Output is normalized into strict JSON structure
6. HTML and plain text are rendered
7. Grammar/readability metrics are computed
8. Backend stores the content draft
9. Optional social variants are generated
10. Optional images are generated and attached
11. SEO summary is computed and stored

## 10.4 Image Pipeline

Current image pipeline:

1. User requests image generation
2. AI service chooses target resolution by platform/role
3. Prompt is enhanced with quality/style boosters
4. Provider order is evaluated
5. First successful provider returns an image result
6. Alt text is generated separately
7. Backend persists the image in local media storage
8. Image is linked to the content item

## 11. Data Model Overview

The Prisma schema currently centers around these entities:

- `User`
- `RefreshToken`
- `Topic`
- `Content`
- `ImageAsset`
- `ContentImageLink`
- `PlatformIntegration`
- `ScheduleJob`
- `PublishResult`
- `AuditLog`

### Important relationships

- One user can have many topics, contents, image assets, and integrations
- A topic can lead to many content items
- A content item can have many linked images
- A content item can have many schedule jobs
- A schedule job belongs to one integration and one content item
- A publish result belongs to one schedule job

### Important persisted business data

- user profile context
- suggested topics
- generated drafts
- SEO summaries
- social variant text
- generated/uploaded image assets
- encrypted integration tokens
- scheduling metadata
- publish responses

## 12. API Surface Overview

The backend groups its main API under `/api`.

### Authentication

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`

### User

- `GET /api/users/me`
- `PUT /api/users/me`

### Topics

- `POST /api/topics/generate`
- `GET /api/topics`

### Content

- `POST /api/content/generate`
- `GET /api/content`
- `GET /api/content/:id`
- `PUT /api/content/:id`
- `POST /api/content/:id/seo-hints`
- `POST /api/content/:id/save`

### Images

- `GET /api/content/:id/images`
- `POST /api/content/:id/images/generate`
- `POST /api/content/:id/images/upload`
- `DELETE /api/content/:id/images/:linkId`

### SEO

- `POST /api/seo/score`

### Integrations

- `GET /api/integrations`
- `GET /api/integrations/:platform/auth-url`
- `GET /api/integrations/:platform/callback`
- `DELETE /api/integrations/:platform`
- `POST /api/integrations/wordpress/site`

### Schedule

- `GET /api/schedule`
- `POST /api/schedule/content/:id/schedule`
- `POST /api/schedule/content/:id/publish-now`
- `POST /api/schedule/:jobId/cancel`
- `GET /api/schedule/stats`

## 13. Reliability, Security, and Operational Design

Current safeguards in the code include:

- hashed passwords
- hashed refresh tokens
- JWT-based auth
- route protection middleware
- request validation via Zod
- HTML sanitization for saved content
- CORS allowlist handling
- encrypted OAuth token storage
- scheduled job persistence
- retry handling for publish failures
- graceful scheduler reload on restart

Operational notes:

- backend serves persisted media through a static `/media` path
- scheduler state survives restarts because jobs are persisted in PostgreSQL
- content generation uses timeouts per AI endpoint
- image generation falls back gracefully instead of crashing the flow

## 14. Testing and Quality Posture

The repository includes substantial automated testing across backend and AI layers.

### Backend testing

- Jest
- Supertest
- endpoint coverage for auth, user, topics, content, images, SEO, scheduling, middleware, and integrations

### AI testing

- pytest
- unit tests for rendering, SEO text scoring, RAG strategy, and research helpers
- integration-style tests for content generation, image generation, topics, and LLM flows

The repo also contains:

- `docs/testing/test-report.md`
- `docs/testing/manual-checklist.md`

These show that the team has treated testing as a first-class part of the implementation, especially for core application flows.

## 15. Key Strengths of the Current Implementation

- Clear separation of concerns across frontend, backend, and AI services
- Practical business-profile-driven AI behavior
- Hybrid research strategy instead of naive single-prompt generation
- Strong end-to-end flow from ideation to publishing
- Platform-aware media handling
- Scheduler persistence and retry logic
- Secure handling of integration tokens
- Reasonable test coverage for a final-year-project-scale system

## 16. Current Limitations and Gaps

Based on the current repository snapshot, these are the main limitations:

- No browser-extension module is present despite being described in the report
- SEO scoring is rule-based rather than search-engine-aware or SERP-ranking predictive
- Publishing depends on valid live credentials and public asset accessibility
- Some external-provider behavior depends heavily on quota and API availability
- Local media URLs can be problematic for Instagram unless the backend is exposed through a public base URL
- Frontend build is the main visible validation step for UI changes; there is no frontend unit-test suite in this repo

## 17. Differences Between the Reference PDF and the Current Code

This section matters if you are presenting SEOmation honestly and accurately.

### The report describes the broader academic project vision

The PDF presents SEOmation as:

- a web application plus browser extension
- a combined content generation and SEO analysis ecosystem
- a larger functional scope including audits, comparisons, PDF exports, and email extraction

### The repository shows the currently implemented product

The codebase currently implements:

- the web application
- backend API
- AI generation/research service
- SEO scoring for content drafts
- image generation and management
- integrations and scheduling

### Specific implementation differences

- The report mentions broader extension-driven SEO analysis features, but the repo does not contain that extension
- The report mentions tech choices like Flask/Mistral/Llama in places; the current implementation uses **FastAPI**, **Gemini**, and **Groq**
- The current AI stack includes optional **Cohere**, **Qdrant**, and **pgvector**, which are more implementation-specific than the report's abstract descriptions
- The current backend includes a fairly concrete publishing scheduler with retries and token encryption, which is stronger and more production-shaped than a typical academic design section

## 18. Best One-Paragraph Description to Show Someone

SEOmation is an AI-powered content operations platform that helps a user go from business context and topic ideation to SEO-scored drafts, generated media, and direct publishing from one workspace. The current implementation includes a React web app, an Express/Prisma backend, and a FastAPI AI service that combines live research, niche-aware RAG, LLM-based writing, image generation, platform integrations, and timezone-aware scheduling for WordPress, LinkedIn, and Instagram.

## 19. Best Short Pitch

SEOmation is a full-stack AI content workflow system that turns business context into publishable, SEO-aware content across blog and social channels, with built-in research, editing, images, integrations, and scheduling.

## 20. Final Accuracy Note

If this document is used in a report, demo, viva, or presentation, the safest wording is:

- use the attached FYP report for the original project vision and academic framing
- use this markdown file for the **current implemented system**
- treat the codebase as the authoritative source for stack, modules, and delivered features


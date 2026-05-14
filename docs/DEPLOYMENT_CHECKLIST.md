# SEOmation Deployment Checklist

Use this checklist for staging first, then repeat with production values. Do not paste real secrets into tracked files.

## 1. Pre-Deploy Local Checks

Run from the repository root:

```powershell
cd "E:\SEOmation Final\SEOmation\frontend"
npm run build

cd "E:\SEOmation Final\SEOmation\backend"
node --check src/server.js
npx prisma validate

cd "E:\SEOmation Final\SEOmation\ai"
.\.venv\Scripts\python.exe -m py_compile main.py config.py routers\topics.py routers\content.py routers\image.py services\llm_service.py services\rag_service.py services\image_generation_service.py
```

Commit and push all intended deployment files before connecting Vercel or Render.

## 2. Staging Services

Create these services first:

| Service | Platform | Root directory | Build command | Start command |
| --- | --- | --- | --- | --- |
| Frontend | Vercel | `frontend` | `npm run build` | Vercel static hosting |
| Backend | Render Web Service | `backend` | `npm install --production=false && npx prisma generate` | `npm start` |
| AI | Render Web Service | `ai` | `pip install -r requirements.txt` | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Database | Render Postgres | n/a | n/a | managed |
| Vector DB | Qdrant Cloud | n/a | n/a | managed |

Backend Render settings:

- Pre-Deploy Command: `npx prisma migrate deploy`
- Instance count: `1`
- Persistent disk: enabled
- Disk mount path: `/opt/render/project/src/storage`
- Backend env `ASSET_STORAGE_DIR`: `/opt/render/project/src/storage/media`

Frontend Vercel settings:

- Output Directory: `dist`
- Framework Preset: `Vite`
- Environment Variables:
  - `VITE_API_BASE_URL=https://<staging-backend>/api`
  - `VITE_API_TIMEOUT_MS=360000`

## 3. Staging Environment Variables

Use these tracked templates as the source of truth:

- `frontend/.env.production.example`
- `backend/.env.production.example`
- `ai/.env.production.example`

For staging, use separate values:

- `QDRANT_COLLECTION=seomation_staging`
- staging Postgres database URL
- staging frontend URL in `APP_BASE_URL` and `CORS_ALLOWED_ORIGINS`
- staging backend URL in `INTEGRATION_CALLBACK_BASE`, `PUBLIC_ASSET_BASE_URL`, and OAuth redirect vars
- keep Instagram publishing disabled until Meta API access is ready:
  - frontend: `VITE_ENABLE_INSTAGRAM_PUBLISHING=false`
  - backend: `ENABLE_INSTAGRAM_INTEGRATION=false`

## 4. OAuth Callback URLs

After the staging backend URL exists, configure provider dashboards with exact callback URLs:

```text
https://<staging-backend>/api/integrations/wordpress/callback
https://<staging-backend>/api/integrations/linkedin/callback
https://<staging-backend>/api/integrations/instagram/callback
```

Repeat later with production backend URLs.

Instagram/Meta requirements:

- Leave Instagram disabled in staging/production until these requirements are complete.
- The Instagram account must be a Business or Creator account.
- The Instagram account must be linked to a Facebook Page.
- The Meta app must request the scopes in `IG_SCOPE`.
- Publishing requires `instagramBusinessId` to be discovered during OAuth.
- After Meta setup is approved, set both `VITE_ENABLE_INSTAGRAM_PUBLISHING=true` and `ENABLE_INSTAGRAM_INTEGRATION=true`, then redeploy frontend and backend.

## 5. Staging Smoke Tests

Health:

```bash
curl https://<staging-ai>/health
curl https://<staging-backend>/health
```

Frontend:

- Open `/login`, `/signup`, `/writer`, `/content`, `/settings/integrations`, and `/schedule`.
- Refresh each nested route and confirm Vercel returns the app instead of a 404.

Core app:

- Register a new user.
- Complete onboarding.
- Generate topics.
- Generate blog content.
- Generate LinkedIn and Instagram variants.
- Generate one image.
- Open the generated image URL directly.
- Restart/redeploy backend and confirm the image still loads.

Integrations:

- Connect WordPress.
- Connect LinkedIn.
- Skip Instagram while `VITE_ENABLE_INSTAGRAM_PUBLISHING=false` and `ENABLE_INSTAGRAM_INTEGRATION=false`.
- Publish now to WordPress.
- Schedule a near-future WordPress post and confirm scheduler behavior.

Failure checks:

- Stop or misconfigure AI temporarily and confirm backend returns a clean `502` or `504`, not a crash.
- Try an unsupported OAuth platform and confirm a `400`.
- Try unauthenticated API access and confirm a `401`.

## 6. Production Rollout

Create production services after staging passes.

Production differences:

- Use a separate production Postgres database.
- Use `QDRANT_COLLECTION=seomation_prod`.
- Generate new production secrets; do not reuse staging JWT or token encryption secrets.
- Set frontend env `VITE_API_BASE_URL=https://<prod-backend>/api`.
- Set backend `CORS_ALLOWED_ORIGINS=https://<prod-frontend>`.
- Update all OAuth provider dashboards with production callback URLs.

## 7. Post-Deploy Monitoring

Check after each deploy:

- Backend logs show scheduler startup without migration or Prisma errors.
- AI logs show provider config without missing required keys.
- Content generation completes within `AI_CONTENT_TIMEOUT_MS`.
- Image generation stores media under `/media`.
- Scheduled jobs do not duplicate. Keep backend instance count at `1` until scheduler locking is redesigned.

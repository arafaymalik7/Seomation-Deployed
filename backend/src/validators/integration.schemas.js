import { z } from 'zod';

const platformEnum = z.enum(['WORDPRESS', 'LINKEDIN', 'INSTAGRAM']);
const platformSchema = z
  .string()
  .transform((value) => value.toUpperCase())
  .pipe(platformEnum);

export const platformParamSchema = z.object({
  params: z.object({ platform: platformSchema })
});

export const integrationCallbackSchema = z.object({
  params: z.object({ platform: platformSchema }),
  query: z.object({
    code: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
    state: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
    expires_in: z.coerce.number().optional(),
    refreshToken: z.string().optional(),
    metadata: z.record(z.any()).optional()
  })
});

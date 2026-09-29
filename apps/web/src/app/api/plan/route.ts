import type { Fill } from '@gc/engine';
import { planBasket } from '@gc/engine/optimize';
import { platformSpecs, sanitize } from '@/lib/server/pipeline';
import { PlanSchema } from '@/lib/server/schemas';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Stateless re-solve for instant toggles — exclude an app, add a membership,
 * fix a fee — from the fills the browser already holds. Never touches a
 * platform, so it needs no rate limit beyond its size caps.
 */
export async function POST(request: Request) {
  let body;
  try {
    body = PlanSchema.parse(await request.json());
  } catch (e) {
    return Response.json({ error: 'Bad plan request', detail: e instanceof Error ? e.message.slice(0, 300) : undefined }, { status: 400 });
  }
  try {
    const result = await planBasket({
      rows: body.rows,
      platforms: platformSpecs(body.platforms, body.settings),
      fills: sanitize(body.fills as Fill[]),
      unlockedFills: sanitize(body.unlockedFills as Fill[]),
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Planning failed' }, { status: 422 });
  }
}

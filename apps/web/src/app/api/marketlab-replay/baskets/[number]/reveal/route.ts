import { bad, handler, ok, requireValue } from "@/server/api";
import { parseUtcMs } from "@/lib/marketlab-replay";
import { basketReveal, ReplayPackageError } from "@/server/marketlab-replay";

type Context = { params: Promise<{ number: string }> };

/**
 * Returns only the basket events at or before the requested cursor (after the
 * given event id), plus the exact exported account row in force at that cursor.
 * No future event, outcome or account value crosses this boundary.
 */
export const GET = handler(async (request: Request, { params }: Context) => {
  const { number } = await params;
  requireValue(/^\d+$/.test(number), "Basket number must be a positive integer.");
  const basketNumber = Number(number);
  requireValue(
    Number.isSafeInteger(basketNumber) && basketNumber > 0,
    "Basket number must be a positive integer.",
  );
  const search = new URL(request.url).searchParams;
  const cursorRaw = search.get("cursor");
  requireValue(cursorRaw !== null, '"cursor" is required.');
  const cursorMs = /^\d+$/.test(cursorRaw) ? Number(cursorRaw) : parseUtcMs(cursorRaw);
  requireValue(
    cursorMs !== null && Number.isSafeInteger(cursorMs) && cursorMs >= 0,
    '"cursor" must be epoch milliseconds or a canonical UTC timestamp.',
  );
  const afterRaw = search.get("after") ?? "0";
  requireValue(/^\d+$/.test(afterRaw), '"after" must be a non-negative integer.');
  const afterEventId = Number(afterRaw);
  requireValue(
    Number.isSafeInteger(afterEventId) && afterEventId >= 0,
    '"after" must be a non-negative integer.',
  );
  const stepRaw = search.get("step");
  requireValue(stepRaw === null || stepRaw === "1", '"step" must be 1 when supplied.');
  try {
    return ok(basketReveal(basketNumber, afterEventId, cursorMs, stepRaw === "1"));
  } catch (error) {
    if (error instanceof ReplayPackageError) return bad(error.message, 422);
    throw error;
  }
});

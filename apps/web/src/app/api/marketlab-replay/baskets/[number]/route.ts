import { bad, handler, ok, requireValue } from "@/server/api";
import {
  basketDetail,
  ReplayPackageError,
  requireNavigationSource,
} from "@/server/marketlab-replay";

type Context = { params: Promise<{ number: string }> };

/**
 * One basket's pre-cursor selector identity only: its number, anchor time and
 * authoritative replay window extent. Boundary levels arrive only with the
 * revealed `basket_anchored` event; no outcome, counts or events are returned.
 */
export const GET = handler(async (request: Request, { params }: Context) => {
  const { number } = await params;
  requireValue(/^\d+$/.test(number), "Basket number must be a positive integer.");
  const basketNumber = Number(number);
  requireValue(
    Number.isSafeInteger(basketNumber) && basketNumber > 0,
    "Basket number must be a positive integer.",
  );
  const event = new URL(request.url).searchParams.get("event");
  requireValue(
    event === null ||
      (/^\d+$/.test(event) && Number.isSafeInteger(Number(event)) && Number(event) > 0),
    "Invalid occurrence id.",
  );
  try {
    requireNavigationSource(new URL(request.url).searchParams.get("source"));
    return ok(basketDetail(basketNumber, event === null ? undefined : Number(event)));
  } catch (error) {
    if (error instanceof ReplayPackageError) return bad(error.message, 422);
    throw error;
  }
});

import { bad, handler, ok, requireValue } from "@/server/api";
import { parseUtcMs } from "@/lib/marketlab-replay";
import { basketWindow, ReplayPackageError } from "@/server/marketlab-replay";

type Context = { params: Promise<{ number: string }> };

/**
 * One bounded replay window for a basket: only derived M1 candle bars whose
 * closes fall inside the basket's authoritative window. `from` is epoch
 * milliseconds or a canonical UTC timestamp. The server clips the window to
 * the basket's authoritative event window and never interpolates a value.
 * Account state is not returned here; it is served only through the
 * cursor-bounded reveal endpoint, scoped to the selected basket.
 */
export const GET = handler(async (request: Request, { params }: Context) => {
  const { number } = await params;
  requireValue(/^\d+$/.test(number), "Basket number must be a positive integer.");
  const basketNumber = Number(number);
  requireValue(
    Number.isSafeInteger(basketNumber) && basketNumber > 0,
    "Basket number must be a positive integer.",
  );
  const raw = new URL(request.url).searchParams.get("from");
  requireValue(raw !== null, '"from" is required.');
  const fromMs = /^\d+$/.test(raw) ? Number(raw) : parseUtcMs(raw);
  requireValue(
    fromMs !== null && Number.isSafeInteger(fromMs) && fromMs >= 0,
    '"from" must be epoch milliseconds or a canonical UTC timestamp.',
  );
  try {
    return ok(basketWindow(basketNumber, fromMs));
  } catch (error) {
    if (error instanceof ReplayPackageError) return bad(error.message, 422);
    throw error;
  }
});

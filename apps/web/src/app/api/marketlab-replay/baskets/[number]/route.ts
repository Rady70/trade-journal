import { bad, handler, ok, requireValue } from "@/server/api";
import { basketDetail, ReplayPackageError } from "@/server/marketlab-replay";

type Context = { params: Promise<{ number: string }> };

/**
 * One authoritative basket: identity, boundaries and the full ordered event
 * stream for that basket, passed through unchanged from the Phase E package.
 */
export const GET = handler(async (_request: Request, { params }: Context) => {
  const { number } = await params;
  requireValue(/^\d+$/.test(number), "Basket number must be a positive integer.");
  const basketNumber = Number(number);
  requireValue(
    Number.isSafeInteger(basketNumber) && basketNumber > 0,
    "Basket number must be a positive integer.",
  );
  try {
    return ok(basketDetail(basketNumber));
  } catch (error) {
    if (error instanceof ReplayPackageError) return bad(error.message, 422);
    throw error;
  }
});

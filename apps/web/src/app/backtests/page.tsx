"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import Loading from "@/app/loading";
import { FilterBar } from "@/components/filter-bar";
import { MarketlabReplay } from "@/components/marketlab-replay";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OptionSelect } from "@/components/ui/option-select";
import { useApi } from "@/lib/use-api";
import type {
  BasketIdentity,
  ReplayRevealResponse,
  ReplayStatus,
  ReplayWindowResponse,
} from "@/lib/marketlab-replay";

const formatUtc = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");

export default function BacktestsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Backtests />
    </Suspense>
  );
}

function Backtests() {
  const { data, error, loading } = useApi<ReplayStatus>("/api/marketlab-replay");
  const [selected, setSelected] = useState("");
  const basketNumber = selected === "" ? null : Number(selected);
  const detailUrl = basketNumber === null ? null : `/api/marketlab-replay/baskets/${basketNumber}`;
  const {
    data: detail,
    error: detailError,
    loading: detailLoading,
  } = useApi<{ basket: BasketIdentity }>(detailUrl);
  const loadWindow = useCallback(
    async (fromMs: number) => {
      const response = await fetch(
        `/api/marketlab-replay/baskets/${basketNumber}/window?from=${fromMs}`,
      );
      const body = (await response.json()) as ReplayWindowResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Replay window request failed.");
      return body;
    },
    [basketNumber],
  );
  const loadReveal = useCallback(
    async (afterEventId: number, cursorMs: number) => {
      const response = await fetch(
        `/api/marketlab-replay/baskets/${basketNumber}/reveal?after=${afterEventId}&cursor=${cursorMs}`,
      );
      const body = (await response.json()) as ReplayRevealResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Replay reveal request failed.");
      return body;
    },
    [basketNumber],
  );
  const basketOptions = useMemo(
    () =>
      (data?.baskets ?? []).map((basket) => ({
        number: basket.number,
        label: `#${basket.number} · anchor ${formatUtc(basket.anchorTimeMs)}`,
      })),
    [data?.baskets],
  );

  return (
    <>
      <FilterBar title="MarketLab Backtests" />
      <div className="space-y-4 p-4">
        {loading && <p className="text-sm text-muted-foreground">Loading replay package…</p>}
        {error && (
          <Card>
            <CardHeader>
              <CardTitle>Replay package unavailable</CardTitle>
            </CardHeader>
            <CardContent>
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            </CardContent>
          </Card>
        )}
        {data && !data.configured && (
          <Card>
            <CardHeader>
              <CardTitle>MarketLab Backtests is not configured</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>{data.hint}</p>
              <p>
                Set the four MarketLab replay environment variables (`MARKETLAB_REPLAY_PACKAGE`,
                `MARKETLAB_CANDLE_CACHE`, `MARKETLAB_REPLAY_EXPECTED_PACKAGE_SHA256` and
                `MARKETLAB_EXPECTED_CANDLE_CONTENT_SHA256`), restart the app, and reload this page.
                The replay path consumes the finalized Phase E replay package directly; it never
                reconstructs events from a generic backtest result.
              </p>
            </CardContent>
          </Card>
        )}
        {data?.configured && !data.valid && (
          <Card>
            <CardHeader>
              <CardTitle>The configured replay package was rejected</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                {data.error}
              </p>
              <p className="text-sm text-muted-foreground">
                A malformed, incompatible or tampered replay package is never rendered as a valid
                replay. Fix or replace the package and reload.
              </p>
            </CardContent>
          </Card>
        )}
        {data?.valid && data.package && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Authoritative package provenance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Contract" value={data.package.contract} />
                  <Field label="Model revision" value={data.package.modelRevision} />
                  <Field label="Stop Out model" value={data.package.stopOutModel} />
                  <Field
                    label="Instrument"
                    value={`${data.package.symbol} · ${data.package.market} · ${data.package.quoteTimeZone ?? "UTC"}`}
                  />
                  <Field
                    label="Run window"
                    value={`${data.package.startUtc.slice(0, 10)} .. ${data.package.endUtc.slice(0, 10)}`}
                  />
                  <Field label="Package SHA-256" value={data.package.packageSha256} mono />
                  <Field label="Manifest SHA-256" value={data.package.manifestSha256} mono />
                  <Field
                    label="Expected package identity"
                    value={data.package.identityEnforced ? "anchored" : "not set"}
                  />
                  <Field
                    label="M1 candle cache"
                    value={
                      data.candles.valid
                        ? `${data.candles.firstMonth ?? "?"} .. ${data.candles.lastMonth ?? "?"} · ${data.candles.fileCount} monthly files`
                        : "unavailable"
                    }
                  />
                  <Field
                    label="Candle content SHA-256"
                    value={data.candles.contentSha256 ?? "—"}
                    mono
                  />
                  <Field
                    label="Expected candle identity"
                    value={data.candles.identityEnforced ? "anchored" : "not set"}
                  />
                </dl>
                <p className="text-xs text-muted-foreground">
                  LEAN determines what happened; this surface shows what happened. Events,
                  executions, risk events and account values are passed through from the Phase E
                  export. Candles are derived visualization data from the qualified Dukascopy cache,
                  not the authority for any execution decision.
                </p>
              </CardContent>
            </Card>
            {!data.candles.valid && (
              <Card>
                <CardHeader>
                  <CardTitle>Candle replay is unavailable</CardTitle>
                </CardHeader>
                <CardContent>
                  <p role="alert" className="text-sm text-destructive">
                    {data.candles.configured
                      ? data.candles.error
                      : "Set MARKETLAB_CANDLE_CACHE to the derived M1 candle cache directory."}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Without the derived candle cache the authoritative event timeline cannot be
                    replayed; nothing is substituted in its place.
                  </p>
                </CardContent>
              </Card>
            )}
            {data.candles.valid && !data.compatibility.valid && (
              <Card>
                <CardHeader>
                  <CardTitle>Replay and candle cache are incompatible</CardTitle>
                </CardHeader>
                <CardContent>
                  <p role="alert" className="text-sm text-destructive">
                    {data.compatibility.error ??
                      "The replay package and the candle cache do not declare the same source identity."}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    A replay is only rendered for the matching authoritative source; nothing is
                    substituted or normalized.
                  </p>
                </CardContent>
              </Card>
            )}
            {data.candles.valid && data.compatibility.valid && (
              <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                  <CardTitle>Select a SingleAnchor basket</CardTitle>
                  <div className="min-w-64">
                    <OptionSelect
                      aria-label="SingleAnchor basket"
                      value={selected}
                      onValueChange={setSelected}
                    >
                      <option value="" disabled>
                        Choose a basket ({basketOptions.length} available)
                      </option>
                      {basketOptions.map((option) => (
                        <option key={option.number} value={String(option.number)}>
                          {option.label}
                        </option>
                      ))}
                    </OptionSelect>
                  </div>
                </CardHeader>
                {basketNumber !== null && (
                  <CardContent>
                    {detailLoading && (
                      <p className="text-sm text-muted-foreground">Loading basket…</p>
                    )}
                    {detailError && (
                      <p role="alert" className="text-sm text-destructive">
                        {detailError}
                      </p>
                    )}
                    {detail && (
                      <MarketlabReplay
                        key={detail.basket.number}
                        basket={detail.basket}
                        loadWindow={loadWindow}
                        loadReveal={loadReveal}
                      />
                    )}
                  </CardContent>
                )}
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`truncate text-sm ${mono ? "font-mono text-xs" : ""}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

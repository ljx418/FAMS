# FAMS MarketDataService Design

## Purpose

`MarketDataService` is the application boundary for external quote, history,
fund holding, and valuation data. Business services should not call Yahoo,
Eastmoney, Sina, or `server.py` helpers directly.

## Problem

Current codebase has provider-specific logic spread across services and utils.
That makes it hard to:

- retry consistently
- mark source attribution
- compare conflicting provider results
- cache expensive calls
- decide how `server.py` fits the lifecycle

## Service Boundary

```ts
interface MarketDataService {
  getQuote(input: QuoteRequest): Promise<QuoteResult>
  getQuotes(input: BatchQuoteRequest): Promise<BatchQuoteResult>
  getHistory(input: HistoryRequest): Promise<PriceBarResult>
  getFundHoldings(input: FundHoldingRequest): Promise<FundHoldingResult>
  getValuation(input: ValuationRequest): Promise<ValuationResult>
  refreshAssetMarketData(input: RefreshMarketDataRequest): Promise<RefreshResult>
}
```

## Provider Interface

```ts
interface MarketDataProvider {
  name: string
  supports(assetType: string, capability: MarketCapability): boolean
  getQuote(input: QuoteRequest): Promise<ProviderQuote>
  getHistory?(input: HistoryRequest): Promise<ProviderPriceBar[]>
  getFundHoldings?(input: FundHoldingRequest): Promise<ProviderFundHolding[]>
  getValuation?(input: ValuationRequest): Promise<ProviderValuation>
}
```

## Initial Providers

- `YahooProvider`
- `EastmoneyProvider`
- `SinaProvider`
- `AkshareProvider`
- `ManualOverrideProvider`

## Canonical DTOs

### QuoteResult

```ts
type QuoteResult = {
  symbol: string
  assetType: string
  price: number | null
  currency: string | null
  timestamp: string | null
  source: string | null
  confidenceScore: number
  warnings: string[]
  providerComparisons?: {
    provider: string
    price: number | null
  }[]
}
```

### PriceBar

```ts
type PriceBar = {
  timestamp: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  volume: number | null
  source: string
}
```

## Resolution Flow

### Quote Resolution

1. select primary provider by asset type and market
2. fetch quote with timeout
3. if failed, fallback to next provider
4. if multiple providers succeed, compare price deviation
5. attach `warnings` and `confidenceScore`
6. cache short-lived quote result
7. optionally persist to `MarketSnapshot` and `PriceHistory`

### History Resolution

1. choose provider that supports requested range and asset type
2. normalize bars into canonical DTO
3. persist bars if refresh mode requested

## Reliability Policies

### Timeouts

- quote timeout: short
- history timeout: medium
- fund holdings / valuation timeout: medium

### Retry

- retry transient network/provider errors only
- no blind retry on malformed provider response

### Fallback

- fallback by provider priority list
- preserve original provider failure reason in warning log

### Discrepancy Warning

Emit warning when provider prices diverge above a threshold, for example:

- `abs(providerA - providerB) / providerA > threshold`

## Cache Strategy

### Short-lived Cache

Use for:

- quote results
- valuation summaries

### Persistent Storage

Use for:

- `PriceHistory`
- `MarketSnapshot`
- optional provider response audit

## Integration With Existing Code

### Current

- `priceService` contains provider logic
- `fundUtils` contains fund holdings fetch logic
- `server.py` exists outside the Node lifecycle

### Target

- `priceService` becomes orchestration facade or is folded into
  `MarketDataService`
- provider-specific code moves under `providers/`
- `fundUtils` becomes provider implementation detail
- `server.py` is either:
  - wrapped behind `AkshareProvider`, or
  - retired after equivalent Node integration

## Suggested Module Layout

```text
backend/src/modules/market-data/
  market-data.service.ts
  market-data.types.ts
  provider-registry.ts
  providers/
    yahoo.provider.ts
    eastmoney.provider.ts
    sina.provider.ts
    akshare.provider.ts
    manual-override.provider.ts
```

## Phase Scope

### V1.0

- define canonical DTOs
- stop new direct provider calls from other domains
- centralize quote and history access

### V1.5

- add retries, fallback, discrepancy warning, cache
- decide `server.py` integration path
- persist `MarketSnapshot`

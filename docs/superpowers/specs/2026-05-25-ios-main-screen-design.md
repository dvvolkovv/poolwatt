# Poolwatt iOS — Main Screen Design Spec

**Date:** 2026-05-25
**Scope:** Single-screen iOS app matching the Poolwatt website landing page
**Target:** iOS 17.0+, iPhone only, SwiftUI

---

## 1. Overview

Replace the current "coming soon" placeholder with a full-featured main screen
that mirrors the Poolwatt website landing page. The screen has two sections:
grid statistics at the top, and a searchable/filterable/sortable producer list
below.

Data comes from an API endpoint on the Poolwatt server with hardcoded mock data
as fallback when the server is unreachable.

---

## 2. Data Layer

### 2.1 Models

Three Swift structs mirroring the TypeScript types in `src/lib/producers.ts`:

**ProducerRow:**
- `id: String`, `rank: Int`, `handle: String`, `displayName: String`
- `city: String`, `country: String` (ISO 3166-1 alpha-2)
- `primarySource: RenewableSource` (enum: solar, wind, hydro, biomass, geothermal, hybrid)
- `category: ProducerCategory?` (enum: energyProducer, equipmentManufacturer)
- `capacityKwh: Double`, `inverterKw: Double`
- `stateOfChargePct: Double` (0–100)
- `availableKwh: Double`, `pricePerKwhUsd: Double`
- `delivered24hKwh: Double`, `deliveredLifetimeKwh: Double`
- `pctChange1h: Double?`, `pctChange24h: Double?`, `pctChange7d: Double?`
- `uptimePct: Double`
- `weeklyOutput: [Double]` (7 values)
- `weatherCondition: WeatherCondition` (enum: sunny, cloudy, windy, calm, rainy)
- `carbonOffsetKgCo2e: Double`
- `equipment: [String]?`, `manufactures: [String]?`

**GridSnap:**
- `totalCapacityKwh: Double`, `totalDelivered24hKwh: Double`
- `totalLifetimeKwh: Double`
- `activeProducers: Int`, `activeHubs: Int`
- `solarSharePct: Double`, `windSharePct: Double`
- `hydroSharePct: Double`, `otherSharePct: Double`
- `carbonOffset24hKgCo2e: Double`

**GreenIndex:**
- `value: Double` (0–100)
- `classification: GreenClassification` (enum: carbonHeavy, mixed, neutral, renewable, fullyRenewable)

### 2.2 Repository Pattern

```
protocol ProducerRepository {
    func fetchAll() async throws -> ProducerData
}

struct ProducerData {
    let producers: [ProducerRow]
    let gridStats: GridSnap
    let greenIndex: GreenIndex
}
```

Two implementations:

1. **APIProducerRepository** — GET `https://poolwatt.ptr.network/api/producers`
   - Timeout: 10 seconds
   - Decodes JSON matching the API response shape
   - Throws on network error or non-200 status

2. **MockProducerRepository** — returns hardcoded data matching the 100
   producers from `src/lib/producers.ts` + computed grid stats

### 2.3 Data Flow

`HomeViewModel` (ObservableObject):
- On appear: try API → on failure → fall back to mock
- Publishes `producers`, `gridStats`, `greenIndex`, `isLoading`, `dataSource` (api/mock)
- Pull-to-refresh triggers a new API attempt
- Search, filter, and sort are computed properties on the published producers

---

## 3. API Endpoint (Server Side)

New Next.js route handler at `src/app/api/producers/route.ts`:

```
GET /api/producers
Response: {
  producers: ProducerRow[],
  gridStats: GridSnap,
  greenIndex: GreenIndex
}
```

Uses existing `readTopProducers()`, `readGridStats()`, `readGreenIndex()` from
`src/lib/snapshot.ts`. Returns mock data in Phase 1, real data in Phase 2 —
no change needed on the iOS side.

---

## 4. UI Design

### 4.1 Overall Layout

Dark background (`#0c1014`). Single ScrollView containing:

1. Header bar (app name + logo)
2. GridStatsCard
3. SourceFilterBar
4. SearchBar
5. LazyVStack of ProducerCards

### 4.2 Color Palette

Exact match with website CSS variables:

| Token           | Hex       | Usage                        |
|-----------------|-----------|------------------------------|
| bg              | `#0c1014` | Main background              |
| bgTint          | `#0e131a` | Section backgrounds          |
| card            | `#131923` | Card backgrounds             |
| cardAlt         | `#1c2533` | Alternate card backgrounds   |
| hairline        | `#1f2a37` | Borders and dividers         |
| foreground      | `#f5f7fa` | Primary text                 |
| muted           | `#93a0b1` | Secondary text               |
| mutedStrong     | `#c3ccd9` | Tertiary text                |
| accent          | `#f5b400` | Sunlight amber (primary CTA) |
| green           | `#10b981` | Renewable emerald            |
| blue            | `#22d3ee` | Electric cyan                |
| up              | `#4ade80` | Positive change              |
| down            | `#f87171` | Negative change              |

### 4.3 Typography

- System font (San Francisco) as Inter equivalent
- `.monospacedDigit` modifier for all numeric values
- Font weights: regular (body), medium (labels), semibold (headings), bold (hero stats)

### 4.4 GridStatsCard

Rounded card (`#131923`, corner radius 16pt, 1px `#1f2a37` border):

- 4 stat rows:
  - Total Capacity → formatted as kWh/MWh
  - 24h Delivered → formatted as kWh/MWh
  - Active Producers → integer
  - Carbon Offset → formatted as kg/t CO₂e
- Green Index bar with value and classification label
- 3-column footer: Solar %, Wind %, Hydro %

### 4.5 SourceFilterBar

Horizontal ScrollView of pill buttons:
- All, Solar (☀), Wind (🜂), Hydro (🜄), Biomass (🌿), Geothermal (♨), Hybrid (⚡)
- Selected pill: accent background
- Unselected: card background with hairline border

### 4.6 SearchBar

Text field with magnifying glass icon. Filters producers by handle, displayName,
city, or operator name. Debounced (300ms).

### 4.7 ProducerCard

Rounded card (`#131923`, corner radius 16pt, 1px border):

- **Header row:** Rank badge (muted), display name (bold), source badge (glyph + label with color tint)
- **Subtitle:** City, Country
- **2×2 metric grid:**
  - SOC: 8-segment battery gauge + percentage (color-coded: green ≥80%, amber ≥50%, cyan ≥25%, red <25%)
  - Price: $/kWh formatted
  - Available: kWh formatted
  - 24h Change: percentage with +/- sign, green/red colored
- **Footer:** 24h delivered amount + sparkline (7-point SVG-style Shape, green if trending up, red if down)
- Equipment/manufacturers as small muted text if present

### 4.8 Custom Views

**StateOfChargeGauge:** 8 horizontal segments rendered as rounded rectangles.
Filled segments use the SOC color, empty segments use `#1f2a37`.

**SparklineShape:** SwiftUI `Shape` that draws a polyline from 7 data points.
Auto-scales Y axis. Stroke color: green if last > first, red otherwise.

**SourceBadge:** HStack with glyph Text + label Text. Background tinted per
source type.

---

## 5. Sorting

Tappable sort control (segmented or menu) with options:
- Rank (default, ascending)
- Price (ascending)
- 24h Change (descending)
- Available (descending)
- Delivered 24h (descending)
- SOC (descending)

Sort direction toggles on re-tap of same option.

---

## 6. Internationalization

All user-facing strings use `String(localized:)` with keys in an
`Localizable.xcstrings` catalog. All 28 locales from the website are included:

`en, ru, de, sk, pl, es, it, fr, uk, ja, zh, ar, ro, ka, uz, tg, tk, tr, az, kk, ce, he, fa, vi, ko, th, hi, ps, ur`

Strings are ported from `messages/*.json` — only the keys used on the main
screen (common, home, stats, listing, source, weather, greenIndex sections).

Language is determined automatically by iOS system settings.

---

## 7. File Structure

```
Sources/PoolwattIOS/
  PoolwattIOSApp.swift          — entry point, dark mode forced
  Theme.swift                   — color palette + typography constants
  Models/
    ProducerRow.swift            — ProducerRow, RenewableSource, WeatherCondition, ProducerCategory
    GridSnap.swift               — GridSnap struct
    GreenIndex.swift             — GreenIndex, GreenClassification
    ProducerData.swift           — ProducerData bundle
  Data/
    ProducerRepository.swift     — protocol + APIProducerRepository
    MockData.swift               — MockProducerRepository with hardcoded 100 producers
    Formatters.swift             — kWh, kW, pct, CO2 formatting functions
  Views/
    HomeView.swift               — top-level screen
    GridStatsCard.swift          — grid statistics card
    ProducerCard.swift           — single producer card
    SourceFilterBar.swift        — horizontal filter pills
    SearchField.swift            — search text field
    StateOfChargeGauge.swift     — battery gauge
    SparklineShape.swift         — sparkline chart shape
    SourceBadge.swift            — source type badge
    SortMenu.swift               — sort control
  ViewModels/
    HomeViewModel.swift          — data loading, search/filter/sort state
  Resources/
    Localizable.xcstrings        — all 28 locales
```

---

## 8. Testing

Existing test target `PoolwattIOSTests`. Add:
- `MockDataTests` — verify mock data has 100 producers, valid grid stats
- `FormatterTests` — verify kWh/CO2/pct formatting edge cases
- `HomeViewModelTests` — verify search/filter/sort logic with mock repository

---

## 9. Build & Deploy

No changes to the existing build pipeline:
- `mac-ios --lane build_sim` for simulator smoke test
- `mac-ios --lane release_testflight` for TestFlight upload
- XcodeGen regenerates project from `project.yml` (new files added to sources glob)

---

## 10. Out of Scope

- Producer detail screen (future iteration)
- EV charger navigator
- Authentication / sign-in
- Settings screen
- TabBar / multi-screen navigation
- Watchlist, offers, contracts
- Push notifications
- Offline caching beyond mock fallback

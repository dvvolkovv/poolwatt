# Poolwatt iOS Main Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "coming soon" placeholder with a full main screen matching the Poolwatt website landing page — grid stats card, searchable/filterable/sortable producer list, hardcoded mock data with API fetch fallback, 28 locales.

**Architecture:** SwiftUI single-screen app using MVVM. `HomeViewModel` loads data from `APIProducerRepository` (fetches JSON from the server) with `MockProducerRepository` fallback. All UI uses a shared `Theme` for colors/typography matching the website's dark palette. i18n via `.xcstrings` catalog with 28 locales ported from the website's `messages/*.json`.

**Tech Stack:** Swift 5.10, SwiftUI, iOS 17.0+, XcodeGen, Fastlane

**iOS project location:** `/Users/aleksandrswiss/poolwatt-ios/` on the Mac (accessed via `~/bin/mac-ios` reverse SSH tunnel from this server)

**Build command:** `~/bin/mac-ios --lane build_sim` (runs XcodeGen + xcodebuild test on Mac)

**How to write files to the Mac:** Use `~/bin/mac-ios` with a heredoc-based SSH command pattern:
```bash
ssh -p 2222 -o StrictHostKeyChecking=accept-new aleksandrswiss@localhost "cat > /Users/aleksandrswiss/poolwatt-ios/PATH" << 'SWIFT'
// file content here
SWIFT
```

---

## File Map

| File | Responsibility |
|------|---------------|
| `Sources/PoolwattIOS/Theme.swift` | Color palette, typography constants |
| `Sources/PoolwattIOS/Models/ProducerRow.swift` | ProducerRow struct, RenewableSource, WeatherCondition, ProducerCategory enums |
| `Sources/PoolwattIOS/Models/GridSnap.swift` | GridSnap struct |
| `Sources/PoolwattIOS/Models/GreenIndex.swift` | GreenIndex struct, GreenClassification enum |
| `Sources/PoolwattIOS/Models/ProducerData.swift` | ProducerData bundle struct |
| `Sources/PoolwattIOS/Data/Formatters.swift` | formatKwh, formatKw, formatPct, formatCo2 functions |
| `Sources/PoolwattIOS/Data/ProducerRepository.swift` | ProducerRepository protocol + APIProducerRepository |
| `Sources/PoolwattIOS/Data/MockData.swift` | MockProducerRepository with hardcoded 100 producers + grid stats |
| `Sources/PoolwattIOS/ViewModels/HomeViewModel.swift` | Data loading, search/filter/sort state |
| `Sources/PoolwattIOS/Views/HomeView.swift` | Top-level screen composing all subviews |
| `Sources/PoolwattIOS/Views/GridStatsCard.swift` | Grid statistics card |
| `Sources/PoolwattIOS/Views/ProducerCard.swift` | Single producer card |
| `Sources/PoolwattIOS/Views/SourceFilterBar.swift` | Horizontal filter pills |
| `Sources/PoolwattIOS/Views/SearchField.swift` | Search text field |
| `Sources/PoolwattIOS/Views/StateOfChargeGauge.swift` | Battery gauge |
| `Sources/PoolwattIOS/Views/SparklineShape.swift` | Sparkline chart shape |
| `Sources/PoolwattIOS/Views/SourceBadge.swift` | Source type badge |
| `Sources/PoolwattIOS/Views/SortMenu.swift` | Sort control |
| `Sources/PoolwattIOS/PoolwattIOSApp.swift` | Entry point (modified — force dark mode, use HomeView) |
| `Sources/PoolwattIOS/ContentView.swift` | Deleted (replaced by HomeView) |
| `Sources/PoolwattIOS/Resources/Localizable.xcstrings` | All 28 locales |
| `Tests/PoolwattIOSTests/PoolwattIOSTests.swift` | Updated smoke test |
| `Tests/PoolwattIOSTests/FormatterTests.swift` | Formatter unit tests |
| `Tests/PoolwattIOSTests/MockDataTests.swift` | Mock data validation tests |
| `Tests/PoolwattIOSTests/HomeViewModelTests.swift` | ViewModel search/filter/sort tests |
| `src/app/api/producers/route.ts` | Next.js API endpoint (on this server, not on Mac) |

---

### Task 1: Next.js API Endpoint

**Files:**
- Create: `src/app/api/producers/route.ts` (on this server at `/home/dv/poolwatt/`)

This is the server-side endpoint the iOS app will fetch from.

- [ ] **Step 1: Create the API route**

```typescript
import { NextResponse } from "next/server";
import { readTopProducers, readGridStats, readGreenIndex } from "@/lib/snapshot";

export const revalidate = 60;

export async function GET() {
  const [producers, gridStats, greenIndex] = await Promise.all([
    readTopProducers(),
    readGridStats(),
    readGreenIndex(),
  ]);

  return NextResponse.json({ producers, gridStats, greenIndex });
}
```

- [ ] **Step 2: Verify endpoint works**

Run: `curl -s http://localhost:3000/api/producers | head -c 200`
Expected: JSON starting with `{"producers":[{"id":"p_jinko_01"...`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/producers/route.ts
git commit -m "feat(api): add /api/producers endpoint for iOS app"
```

---

### Task 2: Theme & Color Palette

**Files:**
- Create: `Sources/PoolwattIOS/Theme.swift` (on Mac)

- [ ] **Step 1: Write Theme.swift**

```swift
import SwiftUI

enum Theme {
    // MARK: – Colors (matching website globals.css)
    static let bg           = Color(hex: 0x0C1014)
    static let bgTint       = Color(hex: 0x0E131A)
    static let card         = Color(hex: 0x131923)
    static let cardAlt      = Color(hex: 0x1C2533)
    static let hairline     = Color(hex: 0x1F2A37)
    static let foreground   = Color(hex: 0xF5F7FA)
    static let muted        = Color(hex: 0x93A0B1)
    static let mutedStrong  = Color(hex: 0xC3CCD9)
    static let accent       = Color(hex: 0xF5B400)
    static let green        = Color(hex: 0x10B981)
    static let blue         = Color(hex: 0x22D3EE)
    static let up           = Color(hex: 0x4ADE80)
    static let down         = Color(hex: 0xF87171)
}

extension Color {
    init(hex: UInt32, opacity: Double = 1.0) {
        self.init(
            .sRGB,
            red:     Double((hex >> 16) & 0xFF) / 255,
            green:   Double((hex >>  8) & 0xFF) / 255,
            blue:    Double( hex        & 0xFF) / 255,
            opacity: opacity
        )
    }
}
```

- [ ] **Step 2: Build to verify**

Run: `~/bin/mac-ios --lane build_sim`
Expected: BUILD SUCCEEDED (Theme.swift compiles, no references yet)

- [ ] **Step 3: Commit on Mac**

```bash
ssh -p 2222 aleksandrswiss@localhost "cd /Users/aleksandrswiss/poolwatt-ios && git add -A && git commit -m 'feat: add Theme color palette matching website'"
```

---

### Task 3: Data Models

**Files:**
- Create: `Sources/PoolwattIOS/Models/ProducerRow.swift`
- Create: `Sources/PoolwattIOS/Models/GridSnap.swift`
- Create: `Sources/PoolwattIOS/Models/GreenIndex.swift`
- Create: `Sources/PoolwattIOS/Models/ProducerData.swift`

- [ ] **Step 1: Create Models directory and ProducerRow.swift**

```swift
import Foundation

enum RenewableSource: String, Codable, CaseIterable, Identifiable {
    case solar = "SOLAR"
    case wind = "WIND"
    case hydro = "HYDRO"
    case biomass = "BIOMASS"
    case geothermal = "GEOTHERMAL"
    case hybrid = "HYBRID"

    var id: String { rawValue }

    var glyph: String {
        switch self {
        case .solar:      return "☀"
        case .wind:       return "🜂"
        case .hydro:      return "🜄"
        case .biomass:    return "🌿"
        case .geothermal: return "♨"
        case .hybrid:     return "⚡"
        }
    }

    var label: String {
        String(localized: String.LocalizationValue("source.\(rawValue)"))
    }
}

enum ProducerCategory: String, Codable {
    case energyProducer = "ENERGY_PRODUCER"
    case equipmentManufacturer = "EQUIPMENT_MANUFACTURER"
}

enum WeatherCondition: String, Codable {
    case sunny = "SUNNY"
    case cloudy = "CLOUDY"
    case windy = "WINDY"
    case calm = "CALM"
    case rainy = "RAINY"
}

struct ProducerRow: Codable, Identifiable {
    let id: String
    let rank: Int
    let handle: String
    let displayName: String
    let city: String
    let country: String
    let primarySource: RenewableSource
    let category: ProducerCategory?
    let capacityKwh: Double
    let inverterKw: Double
    let stateOfChargePct: Double
    let availableKwh: Double
    let pricePerKwhUsd: Double
    let delivered24hKwh: Double
    let deliveredLifetimeKwh: Double
    let pctChange1h: Double?
    let pctChange24h: Double?
    let pctChange7d: Double?
    let uptimePct: Double
    let weeklyOutput: [Double]
    let weatherCondition: WeatherCondition
    let carbonOffsetKgCo2e: Double
    let equipment: [String]?
    let manufactures: [String]?
}
```

- [ ] **Step 2: Create GridSnap.swift**

```swift
import Foundation

struct GridSnap: Codable {
    let totalCapacityKwh: Double
    let totalDelivered24hKwh: Double
    let totalLifetimeKwh: Double
    let activeProducers: Int
    let activeHubs: Int
    let solarSharePct: Double
    let windSharePct: Double
    let hydroSharePct: Double
    let otherSharePct: Double
    let carbonOffset24hKgCo2e: Double
}
```

- [ ] **Step 3: Create GreenIndex.swift**

```swift
import SwiftUI

enum GreenClassification: String, Codable {
    case carbonHeavy = "carbon-heavy"
    case mixed
    case neutral
    case renewable
    case fullyRenewable = "fully-renewable"

    var label: String {
        String(localized: String.LocalizationValue("greenIndex.\(rawValue)"))
    }

    var color: Color {
        switch self {
        case .fullyRenewable, .renewable: return Theme.up
        case .carbonHeavy:                return Theme.down
        case .mixed, .neutral:            return Theme.accent
        }
    }
}

struct GreenIndex: Codable {
    let value: Double
    let classification: GreenClassification
}
```

- [ ] **Step 4: Create ProducerData.swift**

```swift
import Foundation

struct ProducerData: Codable {
    let producers: [ProducerRow]
    let gridStats: GridSnap
    let greenIndex: GreenIndex
}
```

- [ ] **Step 5: Build to verify**

Run: `~/bin/mac-ios --lane build_sim`
Expected: BUILD SUCCEEDED

- [ ] **Step 6: Commit**

```bash
ssh -p 2222 aleksandrswiss@localhost "cd /Users/aleksandrswiss/poolwatt-ios && git add -A && git commit -m 'feat: add data models (ProducerRow, GridSnap, GreenIndex)'"
```

---

### Task 4: Formatters

**Files:**
- Create: `Sources/PoolwattIOS/Data/Formatters.swift`
- Create: `Tests/PoolwattIOSTests/FormatterTests.swift`

- [ ] **Step 1: Write FormatterTests.swift**

```swift
import XCTest
@testable import PoolwattIOS

final class FormatterTests: XCTestCase {
    func test_formatKwh_small() {
        XCTAssertEqual(formatKwh(45.7), "45.70 kWh")
    }

    func test_formatKwh_large() {
        XCTAssertEqual(formatKwh(1500), "1,500 kWh")
    }

    func test_formatKwh_megawatt() {
        XCTAssertEqual(formatKwh(1_500_000), "1.50 MWh")
    }

    func test_formatKw_small() {
        XCTAssertEqual(formatKw(5.3), "5.30 kW")
    }

    func test_formatKw_large() {
        XCTAssertEqual(formatKw(1200), "1.20 MW")
    }

    func test_formatPct_positive() {
        XCTAssertEqual(formatPct(2.5, showSign: true), "+2.50%")
    }

    func test_formatPct_negative() {
        XCTAssertEqual(formatPct(-1.3, showSign: true), "-1.30%")
    }

    func test_formatPct_nil() {
        XCTAssertEqual(formatPct(nil), "—")
    }

    func test_formatCo2_kg() {
        XCTAssertEqual(formatCo2(150), "150.0 kg CO₂e")
    }

    func test_formatCo2_tonnes() {
        XCTAssertEqual(formatCo2(1500), "1.50 t CO₂e")
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `~/bin/mac-ios --lane build_sim`
Expected: FAIL — `formatKwh` etc. not found

- [ ] **Step 3: Write Formatters.swift**

```swift
import Foundation

func formatKwh(_ kwh: Double) -> String {
    if kwh.isNaN || kwh.isInfinite { return "—" }
    if kwh >= 1_000_000 {
        return String(format: "%.2f MWh", kwh / 1_000_000)
    }
    if kwh >= 100 {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return "\(formatter.string(from: NSNumber(value: kwh)) ?? "\(Int(kwh))") kWh"
    }
    return String(format: "%.2f kWh", kwh)
}

func formatKw(_ kw: Double) -> String {
    if kw >= 1000 {
        return String(format: "%.2f MW", kw / 1000)
    }
    return String(format: "%.2f kW", kw)
}

func formatPct(_ pct: Double?, showSign: Bool = false) -> String {
    guard let pct, !pct.isNaN else { return "—" }
    let sign = showSign ? (pct > 0 ? "+" : "") : ""
    return "\(sign)\(String(format: "%.2f", pct))%"
}

func formatCo2(_ kgCo2e: Double) -> String {
    if kgCo2e >= 1000 {
        return String(format: "%.2f t CO₂e", kgCo2e / 1000)
    }
    return String(format: "%.1f kg CO₂e", kgCo2e)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `~/bin/mac-ios --lane build_sim`
Expected: All FormatterTests pass, BUILD SUCCEEDED

- [ ] **Step 5: Commit**

```bash
ssh -p 2222 aleksandrswiss@localhost "cd /Users/aleksandrswiss/poolwatt-ios && git add -A && git commit -m 'feat: add kWh/kW/pct/CO2 formatters with tests'"
```

---

### Task 5: Mock Data Repository

**Files:**
- Create: `Sources/PoolwattIOS/Data/ProducerRepository.swift`
- Create: `Sources/PoolwattIOS/Data/MockData.swift`
- Create: `Tests/PoolwattIOSTests/MockDataTests.swift`

- [ ] **Step 1: Write MockDataTests.swift**

```swift
import XCTest
@testable import PoolwattIOS

final class MockDataTests: XCTestCase {
    func test_mock_has_100_producers() async throws {
        let repo = MockProducerRepository()
        let data = try await repo.fetchAll()
        XCTAssertEqual(data.producers.count, 100)
    }

    func test_mock_ranks_are_sequential() async throws {
        let repo = MockProducerRepository()
        let data = try await repo.fetchAll()
        let ranks = data.producers.map(\.rank)
        XCTAssertEqual(ranks, Array(1...100))
    }

    func test_mock_grid_stats_valid() async throws {
        let repo = MockProducerRepository()
        let data = try await repo.fetchAll()
        XCTAssertGreaterThan(data.gridStats.totalCapacityKwh, 0)
        XCTAssertGreaterThan(data.gridStats.activeProducers, 0)
    }

    func test_mock_green_index_in_range() async throws {
        let repo = MockProducerRepository()
        let data = try await repo.fetchAll()
        XCTAssertTrue((0...100).contains(Int(data.greenIndex.value)))
    }

    func test_all_sources_represented() async throws {
        let repo = MockProducerRepository()
        let data = try await repo.fetchAll()
        let sources = Set(data.producers.map(\.primarySource))
        for source in RenewableSource.allCases {
            XCTAssertTrue(sources.contains(source), "Missing source: \(source)")
        }
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `~/bin/mac-ios --lane build_sim`
Expected: FAIL — `MockProducerRepository` not found

- [ ] **Step 3: Write ProducerRepository.swift**

```swift
import Foundation

protocol ProducerRepository {
    func fetchAll() async throws -> ProducerData
}

enum APIError: Error {
    case invalidResponse
    case httpError(Int)
}

struct APIProducerRepository: ProducerRepository {
    let baseURL: URL

    init(baseURL: URL = URL(string: "https://poolwatt.ptr.network")!) {
        self.baseURL = baseURL
    }

    func fetchAll() async throws -> ProducerData {
        let url = baseURL.appendingPathComponent("api/producers")
        var request = URLRequest(url: url)
        request.timeoutInterval = 10

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard http.statusCode == 200 else {
            throw APIError.httpError(http.statusCode)
        }

        return try JSONDecoder().decode(ProducerData.self, from: data)
    }
}
```

- [ ] **Step 4: Write MockData.swift**

This is the large file — all 100 producers hardcoded from the website's `src/lib/producers.ts`. The mock data is ported 1:1.

```swift
import Foundation

struct MockProducerRepository: ProducerRepository {
    func fetchAll() async throws -> ProducerData {
        ProducerData(
            producers: Self.producers,
            gridStats: Self.gridStats,
            greenIndex: Self.greenIndex
        )
    }

    static let greenIndex = GreenIndex(value: 84, classification: .renewable)

    static let gridStats = GridSnap(
        totalCapacityKwh: 32_180,
        totalDelivered24hKwh: 72_400,
        totalLifetimeKwh: 284_000_000,
        activeProducers: 1_247,
        activeHubs: 38,
        solarSharePct: 34.2,
        windSharePct: 28.6,
        hydroSharePct: 24.8,
        otherSharePct: 12.4,
        carbonOffset24hKgCo2e: 32_360
    )

    static let producers: [ProducerRow] = [
        // ── SOLAR ──
        ProducerRow(id: "p_jinko_01", rank: 1, handle: "jinko-solar-haining", displayName: "JinkoSolar — Haining", city: "Haining", country: "CN", primarySource: .solar, category: nil, capacityKwh: 580, inverterKw: 200, stateOfChargePct: 94, availableKwh: 545, pricePerKwhUsd: 0.038, delivered24hKwh: 1120, deliveredLifetimeKwh: 4_200_000, pctChange1h: 0.2, pctChange24h: 1.8, pctChange7d: 4.2, uptimePct: 99.8, weeklyOutput: [1100,1130,1090,1150,1120,1110,1120], weatherCondition: .sunny, carbonOffsetKgCo2e: 500, equipment: ["JinkoSolar Tiger Neo N-type modules","Huawei SUN2000 inverters","CATL EnerOne batteries"], manufactures: nil),
        ProducerRow(id: "p_trina_01", rank: 2, handle: "trina-solar-changzhou", displayName: "Trina Solar — Changzhou", city: "Changzhou", country: "CN", primarySource: .solar, category: nil, capacityKwh: 520, inverterKw: 180, stateOfChargePct: 91, availableKwh: 473, pricePerKwhUsd: 0.041, delivered24hKwh: 980, deliveredLifetimeKwh: 3_800_000, pctChange1h: 0.3, pctChange24h: 2.1, pctChange7d: 5.1, uptimePct: 99.6, weeklyOutput: [960,990,970,1010,980,975,980], weatherCondition: .sunny, carbonOffsetKgCo2e: 438, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_longi_01", rank: 3, handle: "longi-green-xian", displayName: "LONGi Green Energy — Xi'an", city: "Xi'an", country: "CN", primarySource: .solar, category: nil, capacityKwh: 640, inverterKw: 220, stateOfChargePct: 96, availableKwh: 614, pricePerKwhUsd: 0.036, delivered24hKwh: 1280, deliveredLifetimeKwh: 5_100_000, pctChange1h: 0.1, pctChange24h: 1.4, pctChange7d: 3.8, uptimePct: 99.9, weeklyOutput: [1260,1290,1270,1300,1280,1275,1280], weatherCondition: .sunny, carbonOffsetKgCo2e: 572, equipment: ["LONGi Hi-MO 7 modules","Sungrow SG250HX inverters","BYD Blade batteries","NEXTracker NX Horizon"], manufactures: nil),
        ProducerRow(id: "p_canadian_solar", rank: 4, handle: "canadian-solar-guelph", displayName: "Canadian Solar — Guelph", city: "Guelph", country: "CA", primarySource: .solar, category: nil, capacityKwh: 420, inverterKw: 150, stateOfChargePct: 82, availableKwh: 344, pricePerKwhUsd: 0.048, delivered24hKwh: 780, deliveredLifetimeKwh: 2_900_000, pctChange1h: 0.5, pctChange24h: 2.4, pctChange7d: 5.8, uptimePct: 99.3, weeklyOutput: [760,790,770,800,780,775,780], weatherCondition: .cloudy, carbonOffsetKgCo2e: 349, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_first_solar", rank: 5, handle: "first-solar-tempe", displayName: "First Solar — Tempe", city: "Tempe", country: "US", primarySource: .solar, category: nil, capacityKwh: 480, inverterKw: 170, stateOfChargePct: 98, availableKwh: 470, pricePerKwhUsd: 0.044, delivered24hKwh: 920, deliveredLifetimeKwh: 3_400_000, pctChange1h: 0.1, pctChange24h: 1.6, pctChange7d: 4.0, uptimePct: 99.7, weeklyOutput: [900,930,910,940,920,915,920], weatherCondition: .sunny, carbonOffsetKgCo2e: 411, equipment: ["First Solar Series 7 CdTe modules","Power Electronics HEC-V inverters","Array Technologies DuraTrack trackers","Fluence Gridstack BESS"], manufactures: nil),
        ProducerRow(id: "p_hanwha_qcells", rank: 6, handle: "hanwha-qcells-seoul", displayName: "Hanwha Q Cells — Seoul", city: "Seoul", country: "KR", primarySource: .solar, category: nil, capacityKwh: 390, inverterKw: 140, stateOfChargePct: 88, availableKwh: 343, pricePerKwhUsd: 0.046, delivered24hKwh: 740, deliveredLifetimeKwh: 2_600_000, pctChange1h: 0.4, pctChange24h: 2.0, pctChange7d: 4.7, uptimePct: 99.4, weeklyOutput: [720,750,730,760,740,735,740], weatherCondition: .cloudy, carbonOffsetKgCo2e: 331, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_ja_solar", rank: 7, handle: "ja-solar-beijing", displayName: "JA Solar — Beijing", city: "Beijing", country: "CN", primarySource: .solar, category: nil, capacityKwh: 510, inverterKw: 175, stateOfChargePct: 90, availableKwh: 459, pricePerKwhUsd: 0.039, delivered24hKwh: 960, deliveredLifetimeKwh: 3_500_000, pctChange1h: 0.3, pctChange24h: 1.9, pctChange7d: 4.5, uptimePct: 99.5, weeklyOutput: [940,970,950,980,960,955,960], weatherCondition: .sunny, carbonOffsetKgCo2e: 429, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_risen_energy", rank: 8, handle: "risen-energy-ninghai", displayName: "Risen Energy — Ninghai", city: "Ninghai", country: "CN", primarySource: .solar, category: nil, capacityKwh: 360, inverterKw: 130, stateOfChargePct: 85, availableKwh: 306, pricePerKwhUsd: 0.042, delivered24hKwh: 680, deliveredLifetimeKwh: 2_100_000, pctChange1h: 0.2, pctChange24h: 1.7, pctChange7d: 3.9, uptimePct: 99.2, weeklyOutput: [660,690,670,700,680,675,680], weatherCondition: .sunny, carbonOffsetKgCo2e: 304, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_sunpower_01", rank: 9, handle: "sunpower-san-jose", displayName: "SunPower — San Jose", city: "San Jose", country: "US", primarySource: .solar, category: nil, capacityKwh: 310, inverterKw: 110, stateOfChargePct: 93, availableKwh: 288, pricePerKwhUsd: 0.055, delivered24hKwh: 590, deliveredLifetimeKwh: 2_300_000, pctChange1h: 0.4, pctChange24h: 2.3, pctChange7d: 5.5, uptimePct: 99.6, weeklyOutput: [575,600,580,610,590,585,590], weatherCondition: .sunny, carbonOffsetKgCo2e: 264, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_rec_group", rank: 10, handle: "rec-group-singapore", displayName: "REC Group — Singapore", city: "Singapore", country: "SG", primarySource: .solar, category: nil, capacityKwh: 280, inverterKw: 100, stateOfChargePct: 89, availableKwh: 249, pricePerKwhUsd: 0.052, delivered24hKwh: 530, deliveredLifetimeKwh: 1_900_000, pctChange1h: 0.3, pctChange24h: 1.8, pctChange7d: 4.1, uptimePct: 99.3, weeklyOutput: [515,540,520,550,530,525,530], weatherCondition: .sunny, carbonOffsetKgCo2e: 237, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_maxeon_01", rank: 11, handle: "maxeon-solar-sg", displayName: "Maxeon Solar — Singapore", city: "Singapore", country: "SG", primarySource: .solar, category: nil, capacityKwh: 270, inverterKw: 95, stateOfChargePct: 91, availableKwh: 246, pricePerKwhUsd: 0.058, delivered24hKwh: 510, deliveredLifetimeKwh: 1_700_000, pctChange1h: 0.2, pctChange24h: 1.5, pctChange7d: 3.6, uptimePct: 99.1, weeklyOutput: [495,520,500,530,510,505,510], weatherCondition: .sunny, carbonOffsetKgCo2e: 228, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_enel_gp_solar", rank: 12, handle: "enel-green-power-rome", displayName: "Enel Green Power — Roma", city: "Roma", country: "IT", primarySource: .solar, category: nil, capacityKwh: 450, inverterKw: 160, stateOfChargePct: 87, availableKwh: 391, pricePerKwhUsd: 0.049, delivered24hKwh: 850, deliveredLifetimeKwh: 3_100_000, pctChange1h: 0.4, pctChange24h: 2.2, pctChange7d: 5.3, uptimePct: 99.5, weeklyOutput: [830,860,840,870,850,845,850], weatherCondition: .sunny, carbonOffsetKgCo2e: 380, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_adani_solar", rank: 13, handle: "adani-solar-ahmedabad", displayName: "Adani Solar — Ahmedabad", city: "Ahmedabad", country: "IN", primarySource: .solar, category: nil, capacityKwh: 600, inverterKw: 210, stateOfChargePct: 95, availableKwh: 570, pricePerKwhUsd: 0.035, delivered24hKwh: 1180, deliveredLifetimeKwh: 4_600_000, pctChange1h: 0.1, pctChange24h: 1.3, pctChange7d: 3.5, uptimePct: 99.8, weeklyOutput: [1160,1190,1170,1200,1180,1175,1180], weatherCondition: .sunny, carbonOffsetKgCo2e: 527, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_enphase_01", rank: 14, handle: "enphase-energy-fremont", displayName: "Enphase Energy — Fremont", city: "Fremont", country: "US", primarySource: .solar, category: nil, capacityKwh: 240, inverterKw: 85, stateOfChargePct: 92, availableKwh: 221, pricePerKwhUsd: 0.061, delivered24hKwh: 450, deliveredLifetimeKwh: 1_500_000, pctChange1h: 0.5, pctChange24h: 2.5, pctChange7d: 6.0, uptimePct: 99.7, weeklyOutput: [435,460,440,470,450,445,450], weatherCondition: .sunny, carbonOffsetKgCo2e: 201, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_solarEdge_01", rank: 15, handle: "solaredge-herzliya", displayName: "SolarEdge — Herzliya", city: "Herzliya", country: "IL", primarySource: .solar, category: nil, capacityKwh: 290, inverterKw: 105, stateOfChargePct: 97, availableKwh: 281, pricePerKwhUsd: 0.053, delivered24hKwh: 560, deliveredLifetimeKwh: 2_000_000, pctChange1h: 0.2, pctChange24h: 1.6, pctChange7d: 4.2, uptimePct: 99.8, weeklyOutput: [545,570,550,580,560,555,560], weatherCondition: .sunny, carbonOffsetKgCo2e: 250, equipment: nil, manufactures: nil),
        // ── WIND ──
        ProducerRow(id: "p_vestas_01", rank: 16, handle: "vestas-aarhus", displayName: "Vestas — Aarhus", city: "Aarhus", country: "DK", primarySource: .wind, category: nil, capacityKwh: 720, inverterKw: 250, stateOfChargePct: 76, availableKwh: 547, pricePerKwhUsd: 0.034, delivered24hKwh: 1580, deliveredLifetimeKwh: 6_800_000, pctChange1h: -0.3, pctChange24h: 1.5, pctChange7d: 3.2, uptimePct: 98.9, weeklyOutput: [1550,1600,1520,1610,1580,1570,1580], weatherCondition: .windy, carbonOffsetKgCo2e: 706, equipment: ["Vestas V162-6.2 MW turbines","LM Wind Power 80m blades","ZF Wind Power gearboxes","Timken main bearings","Hitachi Energy transformers"], manufactures: nil),
        ProducerRow(id: "p_siemens_gamesa", rank: 17, handle: "siemens-gamesa-bilbao", displayName: "Siemens Gamesa — Bilbao", city: "Bilbao", country: "ES", primarySource: .wind, category: nil, capacityKwh: 680, inverterKw: 240, stateOfChargePct: 72, availableKwh: 490, pricePerKwhUsd: 0.037, delivered24hKwh: 1420, deliveredLifetimeKwh: 5_900_000, pctChange1h: -0.1, pctChange24h: 1.2, pctChange7d: 2.8, uptimePct: 98.6, weeklyOutput: [1390,1440,1380,1450,1420,1410,1420], weatherCondition: .windy, carbonOffsetKgCo2e: 635, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_goldwind_01", rank: 18, handle: "goldwind-urumqi", displayName: "Goldwind — Ürümqi", city: "Ürümqi", country: "CN", primarySource: .wind, category: nil, capacityKwh: 750, inverterKw: 260, stateOfChargePct: 80, availableKwh: 600, pricePerKwhUsd: 0.032, delivered24hKwh: 1650, deliveredLifetimeKwh: 7_200_000, pctChange1h: -0.4, pctChange24h: 1.8, pctChange7d: 3.9, uptimePct: 99.1, weeklyOutput: [1620,1670,1600,1680,1650,1640,1650], weatherCondition: .windy, carbonOffsetKgCo2e: 737, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_ge_renewable", rank: 19, handle: "ge-renewable-paris", displayName: "GE Renewable Energy — Paris", city: "Paris", country: "FR", primarySource: .wind, category: nil, capacityKwh: 620, inverterKw: 220, stateOfChargePct: 68, availableKwh: 422, pricePerKwhUsd: 0.040, delivered24hKwh: 1280, deliveredLifetimeKwh: 5_200_000, pctChange1h: -0.2, pctChange24h: 1.0, pctChange7d: 2.5, uptimePct: 98.3, weeklyOutput: [1250,1300,1240,1310,1280,1270,1280], weatherCondition: .windy, carbonOffsetKgCo2e: 572, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_nordex_01", rank: 20, handle: "nordex-hamburg", displayName: "Nordex — Hamburg", city: "Hamburg", country: "DE", primarySource: .wind, category: nil, capacityKwh: 480, inverterKw: 170, stateOfChargePct: 74, availableKwh: 355, pricePerKwhUsd: 0.043, delivered24hKwh: 1020, deliveredLifetimeKwh: 3_800_000, pctChange1h: -0.5, pctChange24h: 0.9, pctChange7d: 2.2, uptimePct: 98.1, weeklyOutput: [1000,1040,980,1050,1020,1010,1020], weatherCondition: .windy, carbonOffsetKgCo2e: 456, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_enercon_01", rank: 21, handle: "enercon-aurich", displayName: "Enercon — Aurich", city: "Aurich", country: "DE", primarySource: .wind, category: nil, capacityKwh: 520, inverterKw: 185, stateOfChargePct: 77, availableKwh: 400, pricePerKwhUsd: 0.041, delivered24hKwh: 1100, deliveredLifetimeKwh: 4_200_000, pctChange1h: -0.3, pctChange24h: 1.1, pctChange7d: 2.6, uptimePct: 98.5, weeklyOutput: [1080,1120,1060,1130,1100,1090,1100], weatherCondition: .windy, carbonOffsetKgCo2e: 491, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_orsted_01", rank: 22, handle: "orsted-fredericia", displayName: "Ørsted — Fredericia", city: "Fredericia", country: "DK", primarySource: .wind, category: nil, capacityKwh: 850, inverterKw: 300, stateOfChargePct: 82, availableKwh: 697, pricePerKwhUsd: 0.033, delivered24hKwh: 1850, deliveredLifetimeKwh: 8_400_000, pctChange1h: -0.1, pctChange24h: 1.4, pctChange7d: 3.4, uptimePct: 99.2, weeklyOutput: [1820,1870,1800,1880,1850,1840,1850], weatherCondition: .windy, carbonOffsetKgCo2e: 827, equipment: ["Siemens Gamesa SG 14-236 DD turbines","Prysmian HVDC export cables","Nexans array cables","ABB PCS6000 converters","Flender offshore gearboxes"], manufactures: nil),
        ProducerRow(id: "p_suzlon_01", rank: 23, handle: "suzlon-pune", displayName: "Suzlon Energy — Pune", city: "Pune", country: "IN", primarySource: .wind, category: nil, capacityKwh: 410, inverterKw: 145, stateOfChargePct: 70, availableKwh: 287, pricePerKwhUsd: 0.038, delivered24hKwh: 860, deliveredLifetimeKwh: 3_100_000, pctChange1h: -0.6, pctChange24h: 0.7, pctChange7d: 1.9, uptimePct: 97.8, weeklyOutput: [840,880,820,890,860,850,860], weatherCondition: .windy, carbonOffsetKgCo2e: 384, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_mingyang_01", rank: 24, handle: "mingyang-zhongshan", displayName: "MingYang Smart — Zhongshan", city: "Zhongshan", country: "CN", primarySource: .wind, category: nil, capacityKwh: 560, inverterKw: 195, stateOfChargePct: 79, availableKwh: 442, pricePerKwhUsd: 0.035, delivered24hKwh: 1200, deliveredLifetimeKwh: 4_800_000, pctChange1h: -0.2, pctChange24h: 1.3, pctChange7d: 3.0, uptimePct: 98.8, weeklyOutput: [1180,1220,1160,1230,1200,1190,1200], weatherCondition: .windy, carbonOffsetKgCo2e: 536, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_envision_01", rank: 25, handle: "envision-energy-shanghai", displayName: "Envision Energy — Shanghai", city: "Shanghai", country: "CN", primarySource: .wind, category: nil, capacityKwh: 590, inverterKw: 205, stateOfChargePct: 81, availableKwh: 478, pricePerKwhUsd: 0.034, delivered24hKwh: 1300, deliveredLifetimeKwh: 5_500_000, pctChange1h: -0.3, pctChange24h: 1.6, pctChange7d: 3.5, uptimePct: 99.0, weeklyOutput: [1280,1320,1260,1330,1300,1290,1300], weatherCondition: .windy, carbonOffsetKgCo2e: 581, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_iberdrola_wind", rank: 26, handle: "iberdrola-renewables-bilbao", displayName: "Iberdrola Renewables — Bilbao", city: "Bilbao", country: "ES", primarySource: .wind, category: nil, capacityKwh: 700, inverterKw: 245, stateOfChargePct: 75, availableKwh: 525, pricePerKwhUsd: 0.036, delivered24hKwh: 1500, deliveredLifetimeKwh: 6_200_000, pctChange1h: -0.4, pctChange24h: 1.1, pctChange7d: 2.7, uptimePct: 98.7, weeklyOutput: [1470,1520,1450,1530,1500,1490,1500], weatherCondition: .windy, carbonOffsetKgCo2e: 670, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_nextera_wind", rank: 27, handle: "nextera-energy-juno", displayName: "NextEra Energy — Juno Beach", city: "Juno Beach", country: "US", primarySource: .wind, category: nil, capacityKwh: 780, inverterKw: 270, stateOfChargePct: 83, availableKwh: 647, pricePerKwhUsd: 0.031, delivered24hKwh: 1720, deliveredLifetimeKwh: 7_800_000, pctChange1h: -0.1, pctChange24h: 1.7, pctChange7d: 3.8, uptimePct: 99.3, weeklyOutput: [1690,1740,1680,1750,1720,1710,1720], weatherCondition: .windy, carbonOffsetKgCo2e: 769, equipment: nil, manufactures: nil),
        // ── HYDRO ──
        ProducerRow(id: "p_voith_hydro", rank: 28, handle: "voith-hydro-heidenheim", displayName: "Voith Hydro — Heidenheim", city: "Heidenheim", country: "DE", primarySource: .hydro, category: nil, capacityKwh: 900, inverterKw: 320, stateOfChargePct: 99, availableKwh: 891, pricePerKwhUsd: 0.028, delivered24hKwh: 2100, deliveredLifetimeKwh: 12_000_000, pctChange1h: 0.0, pctChange24h: 0.3, pctChange7d: 0.8, uptimePct: 99.9, weeklyOutput: [2080,2100,2090,2110,2100,2095,2100], weatherCondition: .rainy, carbonOffsetKgCo2e: 938, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_andritz_01", rank: 29, handle: "andritz-hydro-graz", displayName: "Andritz Hydro — Graz", city: "Graz", country: "AT", primarySource: .hydro, category: nil, capacityKwh: 820, inverterKw: 290, stateOfChargePct: 98, availableKwh: 804, pricePerKwhUsd: 0.030, delivered24hKwh: 1900, deliveredLifetimeKwh: 10_500_000, pctChange1h: 0.0, pctChange24h: 0.2, pctChange7d: 0.6, uptimePct: 99.9, weeklyOutput: [1880,1900,1890,1910,1900,1895,1900], weatherCondition: .rainy, carbonOffsetKgCo2e: 849, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_ge_hydro", rank: 30, handle: "ge-hydro-grenoble", displayName: "GE Hydro — Grenoble", city: "Grenoble", country: "FR", primarySource: .hydro, category: nil, capacityKwh: 860, inverterKw: 300, stateOfChargePct: 100, availableKwh: 860, pricePerKwhUsd: 0.029, delivered24hKwh: 2000, deliveredLifetimeKwh: 11_200_000, pctChange1h: 0.1, pctChange24h: 0.4, pctChange7d: 0.9, uptimePct: 99.9, weeklyOutput: [1980,2010,1990,2020,2000,1995,2000], weatherCondition: .rainy, carbonOffsetKgCo2e: 894, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_statkraft_01", rank: 31, handle: "statkraft-oslo", displayName: "Statkraft — Oslo", city: "Oslo", country: "NO", primarySource: .hydro, category: nil, capacityKwh: 950, inverterKw: 340, stateOfChargePct: 100, availableKwh: 950, pricePerKwhUsd: 0.026, delivered24hKwh: 2250, deliveredLifetimeKwh: 14_000_000, pctChange1h: 0.0, pctChange24h: 0.2, pctChange7d: 0.5, uptimePct: 99.9, weeklyOutput: [2230,2250,2240,2260,2250,2245,2250], weatherCondition: .rainy, carbonOffsetKgCo2e: 1006, equipment: ["Voith Francis turbines","Andritz Kaplan turbines","Siemens Energy generators","ABB power transformers","Hitachi Energy HVDC link"], manufactures: nil),
        ProducerRow(id: "p_norsk_hydro", rank: 32, handle: "norsk-hydro-bergen", displayName: "Norsk Hydro — Bergen", city: "Bergen", country: "NO", primarySource: .hydro, category: nil, capacityKwh: 880, inverterKw: 310, stateOfChargePct: 99, availableKwh: 871, pricePerKwhUsd: 0.027, delivered24hKwh: 2050, deliveredLifetimeKwh: 12_800_000, pctChange1h: 0.0, pctChange24h: 0.3, pctChange7d: 0.7, uptimePct: 99.9, weeklyOutput: [2030,2050,2040,2060,2050,2045,2050], weatherCondition: .rainy, carbonOffsetKgCo2e: 916, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_itaipu_01", rank: 33, handle: "itaipu-foz-do-iguacu", displayName: "Itaipu Binacional — Foz do Iguaçu", city: "Foz do Iguaçu", country: "BR", primarySource: .hydro, category: nil, capacityKwh: 1200, inverterKw: 420, stateOfChargePct: 100, availableKwh: 1200, pricePerKwhUsd: 0.022, delivered24hKwh: 2800, deliveredLifetimeKwh: 22_000_000, pctChange1h: 0.0, pctChange24h: 0.1, pctChange7d: 0.3, uptimePct: 99.9, weeklyOutput: [2780,2800,2790,2810,2800,2795,2800], weatherCondition: .rainy, carbonOffsetKgCo2e: 1251, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_three_gorges", rank: 34, handle: "three-gorges-yichang", displayName: "Three Gorges Corp — Yichang", city: "Yichang", country: "CN", primarySource: .hydro, category: nil, capacityKwh: 1500, inverterKw: 520, stateOfChargePct: 100, availableKwh: 1500, pricePerKwhUsd: 0.020, delivered24hKwh: 3500, deliveredLifetimeKwh: 28_000_000, pctChange1h: 0.0, pctChange24h: 0.1, pctChange7d: 0.2, uptimePct: 99.9, weeklyOutput: [3480,3500,3490,3510,3500,3495,3500], weatherCondition: .rainy, carbonOffsetKgCo2e: 1564, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_hydro_quebec", rank: 35, handle: "hydro-quebec-montreal", displayName: "Hydro-Québec — Montréal", city: "Montréal", country: "CA", primarySource: .hydro, category: nil, capacityKwh: 1100, inverterKw: 380, stateOfChargePct: 100, availableKwh: 1100, pricePerKwhUsd: 0.024, delivered24hKwh: 2600, deliveredLifetimeKwh: 18_000_000, pctChange1h: 0.0, pctChange24h: 0.2, pctChange7d: 0.4, uptimePct: 99.9, weeklyOutput: [2580,2600,2590,2610,2600,2595,2600], weatherCondition: .calm, carbonOffsetKgCo2e: 1162, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_vattenfall_hydro", rank: 36, handle: "vattenfall-stockholm", displayName: "Vattenfall — Stockholm", city: "Stockholm", country: "SE", primarySource: .hydro, category: nil, capacityKwh: 920, inverterKw: 325, stateOfChargePct: 99, availableKwh: 911, pricePerKwhUsd: 0.027, delivered24hKwh: 2150, deliveredLifetimeKwh: 13_500_000, pctChange1h: 0.0, pctChange24h: 0.2, pctChange7d: 0.5, uptimePct: 99.9, weeklyOutput: [2130,2150,2140,2160,2150,2145,2150], weatherCondition: .calm, carbonOffsetKgCo2e: 961, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_turbine_kaplan", rank: 37, handle: "toshiba-hydro-tokyo", displayName: "Toshiba Energy — Tokyo", city: "Tokyo", country: "JP", primarySource: .hydro, category: nil, capacityKwh: 760, inverterKw: 270, stateOfChargePct: 97, availableKwh: 737, pricePerKwhUsd: 0.031, delivered24hKwh: 1780, deliveredLifetimeKwh: 9_400_000, pctChange1h: 0.1, pctChange24h: 0.3, pctChange7d: 0.7, uptimePct: 99.8, weeklyOutput: [1760,1780,1770,1790,1780,1775,1780], weatherCondition: .rainy, carbonOffsetKgCo2e: 795, equipment: nil, manufactures: nil),
        // ── BIOMASS ──
        ProducerRow(id: "p_envitec_01", rank: 38, handle: "envitec-biogas-lohne", displayName: "EnviTec Biogas — Lohne", city: "Lohne", country: "DE", primarySource: .biomass, category: nil, capacityKwh: 180, inverterKw: 65, stateOfChargePct: 90, availableKwh: 162, pricePerKwhUsd: 0.072, delivered24hKwh: 340, deliveredLifetimeKwh: 1_200_000, pctChange1h: 0.1, pctChange24h: 0.8, pctChange7d: 2.0, uptimePct: 98.2, weeklyOutput: [330,345,335,350,340,338,340], weatherCondition: .calm, carbonOffsetKgCo2e: 152, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_weltec_01", rank: 39, handle: "weltec-biopower-vechta", displayName: "WELTEC BIOPOWER — Vechta", city: "Vechta", country: "DE", primarySource: .biomass, category: nil, capacityKwh: 160, inverterKw: 58, stateOfChargePct: 88, availableKwh: 141, pricePerKwhUsd: 0.075, delivered24hKwh: 300, deliveredLifetimeKwh: 980_000, pctChange1h: 0.2, pctChange24h: 0.7, pctChange7d: 1.8, uptimePct: 97.9, weeklyOutput: [290,305,295,310,300,298,300], weatherCondition: .calm, carbonOffsetKgCo2e: 134, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_biogest_01", rank: 40, handle: "biogest-vienna", displayName: "BioGest — Wien", city: "Wien", country: "AT", primarySource: .biomass, category: nil, capacityKwh: 140, inverterKw: 50, stateOfChargePct: 85, availableKwh: 119, pricePerKwhUsd: 0.078, delivered24hKwh: 260, deliveredLifetimeKwh: 820_000, pctChange1h: 0.1, pctChange24h: 0.6, pctChange7d: 1.5, uptimePct: 97.5, weeklyOutput: [250,265,255,270,260,258,260], weatherCondition: .calm, carbonOffsetKgCo2e: 116, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_natgas_01", rank: 41, handle: "nature-energy-odense", displayName: "Nature Energy — Odense", city: "Odense", country: "DK", primarySource: .biomass, category: nil, capacityKwh: 200, inverterKw: 72, stateOfChargePct: 92, availableKwh: 184, pricePerKwhUsd: 0.068, delivered24hKwh: 380, deliveredLifetimeKwh: 1_500_000, pctChange1h: 0.1, pctChange24h: 0.9, pctChange7d: 2.2, uptimePct: 98.5, weeklyOutput: [370,385,375,390,380,378,380], weatherCondition: .calm, carbonOffsetKgCo2e: 170, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_verbio_01", rank: 42, handle: "verbio-leipzig", displayName: "VERBIO — Leipzig", city: "Leipzig", country: "DE", primarySource: .biomass, category: nil, capacityKwh: 220, inverterKw: 80, stateOfChargePct: 87, availableKwh: 191, pricePerKwhUsd: 0.070, delivered24hKwh: 420, deliveredLifetimeKwh: 1_700_000, pctChange1h: 0.2, pctChange24h: 1.0, pctChange7d: 2.4, uptimePct: 98.3, weeklyOutput: [410,425,415,430,420,418,420], weatherCondition: .calm, carbonOffsetKgCo2e: 188, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_scandinavian_biogas", rank: 43, handle: "scandinavian-biogas-stockholm", displayName: "Scandinavian Biogas — Stockholm", city: "Stockholm", country: "SE", primarySource: .biomass, category: nil, capacityKwh: 170, inverterKw: 60, stateOfChargePct: 89, availableKwh: 151, pricePerKwhUsd: 0.073, delivered24hKwh: 320, deliveredLifetimeKwh: 1_100_000, pctChange1h: 0.1, pctChange24h: 0.7, pctChange7d: 1.9, uptimePct: 98.0, weeklyOutput: [310,325,315,330,320,318,320], weatherCondition: .calm, carbonOffsetKgCo2e: 143, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_drax_biomass", rank: 44, handle: "drax-group-selby", displayName: "Drax Group — Selby", city: "Selby", country: "GB", primarySource: .biomass, category: nil, capacityKwh: 450, inverterKw: 160, stateOfChargePct: 93, availableKwh: 419, pricePerKwhUsd: 0.065, delivered24hKwh: 880, deliveredLifetimeKwh: 3_600_000, pctChange1h: 0.1, pctChange24h: 0.8, pctChange7d: 2.1, uptimePct: 98.7, weeklyOutput: [860,890,870,900,880,875,880], weatherCondition: .cloudy, carbonOffsetKgCo2e: 393, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_epe_biogas", rank: 45, handle: "epe-renewables-osaka", displayName: "Japan Bio Energy — Osaka", city: "Osaka", country: "JP", primarySource: .biomass, category: nil, capacityKwh: 190, inverterKw: 68, stateOfChargePct: 86, availableKwh: 163, pricePerKwhUsd: 0.076, delivered24hKwh: 350, deliveredLifetimeKwh: 1_050_000, pctChange1h: 0.2, pctChange24h: 0.8, pctChange7d: 1.9, uptimePct: 97.8, weeklyOutput: [340,355,345,360,350,348,350], weatherCondition: .calm, carbonOffsetKgCo2e: 156, equipment: nil, manufactures: nil),
        // ── GEOTHERMAL ──
        ProducerRow(id: "p_ormat_01", rank: 46, handle: "ormat-technologies-reno", displayName: "Ormat Technologies — Reno", city: "Reno", country: "US", primarySource: .geothermal, category: nil, capacityKwh: 400, inverterKw: 140, stateOfChargePct: 100, availableKwh: 400, pricePerKwhUsd: 0.045, delivered24hKwh: 920, deliveredLifetimeKwh: 5_800_000, pctChange1h: 0.0, pctChange24h: 0.1, pctChange7d: 0.3, uptimePct: 99.8, weeklyOutput: [910,920,915,925,920,918,920], weatherCondition: .calm, carbonOffsetKgCo2e: 411, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_enel_geothermal", rank: 47, handle: "enel-geothermal-pisa", displayName: "Enel Geothermal — Pisa", city: "Pisa", country: "IT", primarySource: .geothermal, category: nil, capacityKwh: 350, inverterKw: 125, stateOfChargePct: 100, availableKwh: 350, pricePerKwhUsd: 0.048, delivered24hKwh: 810, deliveredLifetimeKwh: 4_900_000, pctChange1h: 0.0, pctChange24h: 0.2, pctChange7d: 0.4, uptimePct: 99.7, weeklyOutput: [800,810,805,815,810,808,810], weatherCondition: .calm, carbonOffsetKgCo2e: 362, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_on_reykjavik", rank: 48, handle: "on-power-reykjavik", displayName: "ON Power — Reykjavik", city: "Reykjavik", country: "IS", primarySource: .geothermal, category: nil, capacityKwh: 500, inverterKw: 175, stateOfChargePct: 100, availableKwh: 500, pricePerKwhUsd: 0.025, delivered24hKwh: 1150, deliveredLifetimeKwh: 8_200_000, pctChange1h: 0.0, pctChange24h: 0.1, pctChange7d: 0.2, uptimePct: 99.9, weeklyOutput: [1140,1150,1145,1155,1150,1148,1150], weatherCondition: .calm, carbonOffsetKgCo2e: 514, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_pertamina_geo", rank: 49, handle: "pertamina-geo-jakarta", displayName: "Pertamina Geothermal — Jakarta", city: "Jakarta", country: "ID", primarySource: .geothermal, category: nil, capacityKwh: 580, inverterKw: 200, stateOfChargePct: 100, availableKwh: 580, pricePerKwhUsd: 0.030, delivered24hKwh: 1340, deliveredLifetimeKwh: 7_400_000, pctChange1h: 0.0, pctChange24h: 0.1, pctChange7d: 0.2, uptimePct: 99.8, weeklyOutput: [1320,1340,1330,1350,1340,1335,1340], weatherCondition: .calm, carbonOffsetKgCo2e: 599, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_contact_energy", rank: 50, handle: "contact-energy-taupo", displayName: "Contact Energy — Taupō", city: "Taupō", country: "NZ", primarySource: .geothermal, category: nil, capacityKwh: 430, inverterKw: 152, stateOfChargePct: 100, availableKwh: 430, pricePerKwhUsd: 0.038, delivered24hKwh: 1000, deliveredLifetimeKwh: 6_100_000, pctChange1h: 0.0, pctChange24h: 0.1, pctChange7d: 0.3, uptimePct: 99.8, weeklyOutput: [990,1000,995,1005,1000,998,1000], weatherCondition: .calm, carbonOffsetKgCo2e: 447, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_kenya_geo", rank: 51, handle: "kengen-naivasha", displayName: "KenGen — Naivasha", city: "Naivasha", country: "KE", primarySource: .geothermal, category: nil, capacityKwh: 480, inverterKw: 170, stateOfChargePct: 100, availableKwh: 480, pricePerKwhUsd: 0.033, delivered24hKwh: 1100, deliveredLifetimeKwh: 6_800_000, pctChange1h: 0.0, pctChange24h: 0.1, pctChange7d: 0.2, uptimePct: 99.7, weeklyOutput: [1080,1100,1090,1110,1100,1095,1100], weatherCondition: .calm, carbonOffsetKgCo2e: 491, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_star_energy_geo", rank: 52, handle: "star-energy-bandung", displayName: "Star Energy Geothermal — Bandung", city: "Bandung", country: "ID", primarySource: .geothermal, category: nil, capacityKwh: 380, inverterKw: 135, stateOfChargePct: 100, availableKwh: 380, pricePerKwhUsd: 0.035, delivered24hKwh: 880, deliveredLifetimeKwh: 5_200_000, pctChange1h: 0.0, pctChange24h: 0.1, pctChange7d: 0.3, uptimePct: 99.6, weeklyOutput: [870,880,875,885,880,878,880], weatherCondition: .calm, carbonOffsetKgCo2e: 393, equipment: nil, manufactures: nil),
        // ── HYBRID ──
        ProducerRow(id: "p_tesla_energy", rank: 53, handle: "tesla-energy-austin", displayName: "Tesla Energy — Austin", city: "Austin", country: "US", primarySource: .hybrid, category: nil, capacityKwh: 500, inverterKw: 180, stateOfChargePct: 88, availableKwh: 440, pricePerKwhUsd: 0.052, delivered24hKwh: 960, deliveredLifetimeKwh: 3_800_000, pctChange1h: 0.3, pctChange24h: 1.8, pctChange7d: 4.5, uptimePct: 99.6, weeklyOutput: [940,970,950,980,960,955,960], weatherCondition: .sunny, carbonOffsetKgCo2e: 429, equipment: ["Tesla Megapack 2 XL BESS","Tesla Solar Roof tiles","Tesla Powerwall 3 batteries","Tesla Solar Inverter","Panasonic 4680 cells"], manufactures: nil),
        ProducerRow(id: "p_byd_energy", rank: 54, handle: "byd-energy-shenzhen", displayName: "BYD Energy — Shenzhen", city: "Shenzhen", country: "CN", primarySource: .hybrid, category: nil, capacityKwh: 620, inverterKw: 215, stateOfChargePct: 91, availableKwh: 564, pricePerKwhUsd: 0.040, delivered24hKwh: 1200, deliveredLifetimeKwh: 4_900_000, pctChange1h: 0.2, pctChange24h: 1.5, pctChange7d: 3.8, uptimePct: 99.5, weeklyOutput: [1180,1210,1190,1220,1200,1195,1200], weatherCondition: .sunny, carbonOffsetKgCo2e: 536, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_sonnen_01", rank: 55, handle: "sonnen-wildpoldsried", displayName: "sonnen — Wildpoldsried", city: "Wildpoldsried", country: "DE", primarySource: .hybrid, category: nil, capacityKwh: 210, inverterKw: 75, stateOfChargePct: 84, availableKwh: 176, pricePerKwhUsd: 0.068, delivered24hKwh: 400, deliveredLifetimeKwh: 1_400_000, pctChange1h: 0.4, pctChange24h: 2.0, pctChange7d: 4.8, uptimePct: 99.3, weeklyOutput: [390,405,395,410,400,398,400], weatherCondition: .cloudy, carbonOffsetKgCo2e: 179, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_fluence_01", rank: 56, handle: "fluence-energy-arlington", displayName: "Fluence Energy — Arlington", city: "Arlington", country: "US", primarySource: .hybrid, category: nil, capacityKwh: 440, inverterKw: 155, stateOfChargePct: 86, availableKwh: 378, pricePerKwhUsd: 0.055, delivered24hKwh: 840, deliveredLifetimeKwh: 3_200_000, pctChange1h: 0.3, pctChange24h: 1.6, pctChange7d: 4.0, uptimePct: 99.4, weeklyOutput: [820,850,830,860,840,835,840], weatherCondition: .sunny, carbonOffsetKgCo2e: 375, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_sungrow_01", rank: 57, handle: "sungrow-hefei", displayName: "Sungrow Power — Hefei", city: "Hefei", country: "CN", primarySource: .hybrid, category: nil, capacityKwh: 480, inverterKw: 168, stateOfChargePct: 89, availableKwh: 427, pricePerKwhUsd: 0.042, delivered24hKwh: 920, deliveredLifetimeKwh: 3_600_000, pctChange1h: 0.2, pctChange24h: 1.4, pctChange7d: 3.5, uptimePct: 99.5, weeklyOutput: [900,930,910,940,920,915,920], weatherCondition: .sunny, carbonOffsetKgCo2e: 411, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_iberdrola_hybrid", rank: 58, handle: "iberdrola-hybrid-madrid", displayName: "Iberdrola — Madrid", city: "Madrid", country: "ES", primarySource: .hybrid, category: nil, capacityKwh: 550, inverterKw: 190, stateOfChargePct: 83, availableKwh: 457, pricePerKwhUsd: 0.047, delivered24hKwh: 1050, deliveredLifetimeKwh: 4_300_000, pctChange1h: 0.3, pctChange24h: 1.7, pctChange7d: 4.2, uptimePct: 99.4, weeklyOutput: [1030,1060,1040,1070,1050,1045,1050], weatherCondition: .sunny, carbonOffsetKgCo2e: 469, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_total_energies", rank: 59, handle: "totalenergies-paris", displayName: "TotalEnergies Renewables — Paris", city: "Paris", country: "FR", primarySource: .hybrid, category: nil, capacityKwh: 600, inverterKw: 210, stateOfChargePct: 85, availableKwh: 510, pricePerKwhUsd: 0.044, delivered24hKwh: 1150, deliveredLifetimeKwh: 5_000_000, pctChange1h: 0.2, pctChange24h: 1.5, pctChange7d: 3.7, uptimePct: 99.5, weeklyOutput: [1130,1160,1140,1170,1150,1145,1150], weatherCondition: .cloudy, carbonOffsetKgCo2e: 514, equipment: nil, manufactures: nil),
        ProducerRow(id: "p_acciona_hybrid", rank: 60, handle: "acciona-energia-madrid", displayName: "Acciona Energía — Madrid", city: "Madrid", country: "ES", primarySource: .hybrid, category: nil, capacityKwh: 520, inverterKw: 182, stateOfChargePct: 87, availableKwh: 452, pricePerKwhUsd: 0.046, delivered24hKwh: 1000, deliveredLifetimeKwh: 4_100_000, pctChange1h: 0.3, pctChange24h: 1.6, pctChange7d: 4.0, uptimePct: 99.4, weeklyOutput: [980,1010,990,1020,1000,995,1000], weatherCondition: .sunny, carbonOffsetKgCo2e: 447, equipment: ["Nordex N163/5.X turbines","SMA Sunny Central inverters","CATL EnerOne batteries"], manufactures: nil),
        // ── EQUIPMENT MANUFACTURERS ──
        ProducerRow(id: "eq_sma_solar", rank: 61, handle: "sma-solar-niestetal", displayName: "SMA Solar Technology — Niestetal", city: "Niestetal", country: "DE", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 120, inverterKw: 45, stateOfChargePct: 95, availableKwh: 114, pricePerKwhUsd: 0.065, delivered24hKwh: 230, deliveredLifetimeKwh: 850_000, pctChange1h: 0.2, pctChange24h: 1.2, pctChange7d: 3.0, uptimePct: 99.5, weeklyOutput: [225,232,228,235,230,228,230], weatherCondition: .cloudy, carbonOffsetKgCo2e: 103, equipment: nil, manufactures: ["Sunny Boy residential inverters","Sunny Tripower commercial inverters","Sunny Central utility-scale inverters","SMA Energy Meter","SMA Data Manager"]),
        ProducerRow(id: "eq_fronius", rank: 62, handle: "fronius-pettenbach", displayName: "Fronius International — Pettenbach", city: "Pettenbach", country: "AT", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 95, inverterKw: 35, stateOfChargePct: 92, availableKwh: 87, pricePerKwhUsd: 0.070, delivered24hKwh: 180, deliveredLifetimeKwh: 620_000, pctChange1h: 0.3, pctChange24h: 1.4, pctChange7d: 3.5, uptimePct: 99.4, weeklyOutput: [175,182,178,185,180,178,180], weatherCondition: .cloudy, carbonOffsetKgCo2e: 80, equipment: nil, manufactures: ["Fronius Primo single-phase inverters","Fronius Symo three-phase inverters","Fronius GEN24 Plus hybrid inverters","Fronius Smart Meter","Fronius Wattpilot EV charger"]),
        ProducerRow(id: "eq_huawei_solar", rank: 63, handle: "huawei-fusionsolar-shenzhen", displayName: "Huawei FusionSolar — Shenzhen", city: "Shenzhen", country: "CN", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 350, inverterKw: 125, stateOfChargePct: 96, availableKwh: 336, pricePerKwhUsd: 0.038, delivered24hKwh: 680, deliveredLifetimeKwh: 2_800_000, pctChange1h: 0.1, pctChange24h: 1.0, pctChange7d: 2.5, uptimePct: 99.8, weeklyOutput: [665,682,672,690,680,675,680], weatherCondition: .sunny, carbonOffsetKgCo2e: 304, equipment: nil, manufactures: ["SUN2000 residential inverters","SUN2000 commercial inverters","SmartLogger data controller","LUNA2000 battery storage","Smart PV Optimizer"]),
        ProducerRow(id: "eq_goodwe", rank: 64, handle: "goodwe-suzhou", displayName: "GoodWe — Suzhou", city: "Suzhou", country: "CN", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 200, inverterKw: 72, stateOfChargePct: 90, availableKwh: 180, pricePerKwhUsd: 0.045, delivered24hKwh: 380, deliveredLifetimeKwh: 1_400_000, pctChange1h: 0.2, pctChange24h: 1.3, pctChange7d: 3.2, uptimePct: 99.3, weeklyOutput: [370,385,375,390,380,378,380], weatherCondition: .sunny, carbonOffsetKgCo2e: 170, equipment: nil, manufactures: ["GW series string inverters","ET Plus+ hybrid inverters","BT series battery inverters","Lynx Home battery storage","Smart Energy Controller"]),
        ProducerRow(id: "eq_growatt", rank: 65, handle: "growatt-shenzhen", displayName: "Growatt — Shenzhen", city: "Shenzhen", country: "CN", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 180, inverterKw: 65, stateOfChargePct: 88, availableKwh: 158, pricePerKwhUsd: 0.042, delivered24hKwh: 340, deliveredLifetimeKwh: 1_200_000, pctChange1h: 0.3, pctChange24h: 1.5, pctChange7d: 3.8, uptimePct: 99.2, weeklyOutput: [330,345,335,350,340,338,340], weatherCondition: .sunny, carbonOffsetKgCo2e: 152, equipment: nil, manufactures: ["MIN series residential inverters","MOD series commercial inverters","MID series inverters","ARK battery system","ShineLink monitoring"]),
        ProducerRow(id: "eq_delta", rank: 66, handle: "delta-electronics-taipei", displayName: "Delta Electronics — Taipei", city: "Taipei", country: "TW", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 160, inverterKw: 58, stateOfChargePct: 91, availableKwh: 146, pricePerKwhUsd: 0.050, delivered24hKwh: 310, deliveredLifetimeKwh: 1_050_000, pctChange1h: 0.2, pctChange24h: 1.1, pctChange7d: 2.8, uptimePct: 99.4, weeklyOutput: [300,315,305,320,310,308,310], weatherCondition: .sunny, carbonOffsetKgCo2e: 139, equipment: nil, manufactures: ["M-series string inverters","RPI utility-scale inverters","Flex H hybrid inverters","BX series battery storage","DeltaSolar Cloud monitoring"]),
        ProducerRow(id: "eq_power_electronics", rank: 67, handle: "power-electronics-valencia", displayName: "Power Electronics — Valencia", city: "Valencia", country: "ES", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 140, inverterKw: 50, stateOfChargePct: 89, availableKwh: 125, pricePerKwhUsd: 0.055, delivered24hKwh: 270, deliveredLifetimeKwh: 920_000, pctChange1h: 0.1, pctChange24h: 1.0, pctChange7d: 2.5, uptimePct: 99.3, weeklyOutput: [262,275,268,280,270,268,270], weatherCondition: .sunny, carbonOffsetKgCo2e: 121, equipment: nil, manufactures: ["Freemaq PV central inverters","HEC-V utility inverters","HEMK medium-voltage stations","EV chargers (Quasar)"]),
        ProducerRow(id: "eq_catl", rank: 68, handle: "catl-ningde", displayName: "CATL — Ningde", city: "Ningde", country: "CN", primarySource: .hybrid, category: .equipmentManufacturer, capacityKwh: 800, inverterKw: 280, stateOfChargePct: 93, availableKwh: 744, pricePerKwhUsd: 0.032, delivered24hKwh: 1520, deliveredLifetimeKwh: 6_400_000, pctChange1h: 0.1, pctChange24h: 0.9, pctChange7d: 2.2, uptimePct: 99.7, weeklyOutput: [1490,1530,1510,1540,1520,1515,1520], weatherCondition: .cloudy, carbonOffsetKgCo2e: 679, equipment: nil, manufactures: ["EnerOne utility battery cabinets","EnerC containerized BESS","Cell-to-Pack (CTP) LFP cells","Sodium-ion cells","Shenxing fast-charge cells"]),
        ProducerRow(id: "eq_lg_energy", rank: 69, handle: "lg-energy-solution-seoul", displayName: "LG Energy Solution — Seoul", city: "Seoul", country: "KR", primarySource: .hybrid, category: .equipmentManufacturer, capacityKwh: 600, inverterKw: 210, stateOfChargePct: 90, availableKwh: 540, pricePerKwhUsd: 0.038, delivered24hKwh: 1150, deliveredLifetimeKwh: 4_800_000, pctChange1h: 0.2, pctChange24h: 1.1, pctChange7d: 2.8, uptimePct: 99.6, weeklyOutput: [1130,1160,1140,1170,1150,1145,1150], weatherCondition: .cloudy, carbonOffsetKgCo2e: 514, equipment: nil, manufactures: ["RESU residential batteries","RESU Prime home storage","Enblock containerized ESS","NMC prismatic cells","LFP utility cells"]),
        ProducerRow(id: "eq_samsung_sdi", rank: 70, handle: "samsung-sdi-yongin", displayName: "Samsung SDI — Yongin", city: "Yongin", country: "KR", primarySource: .hybrid, category: .equipmentManufacturer, capacityKwh: 550, inverterKw: 195, stateOfChargePct: 91, availableKwh: 501, pricePerKwhUsd: 0.040, delivered24hKwh: 1050, deliveredLifetimeKwh: 4_300_000, pctChange1h: 0.1, pctChange24h: 1.0, pctChange7d: 2.5, uptimePct: 99.5, weeklyOutput: [1030,1060,1040,1070,1050,1045,1050], weatherCondition: .cloudy, carbonOffsetKgCo2e: 469, equipment: nil, manufactures: ["All-in-One ESS cabinets","SBB battery modules","NMC prismatic cells","PRiMX premium cells","Ultra-high energy density cells"]),
        ProducerRow(id: "eq_panasonic_energy", rank: 71, handle: "panasonic-energy-osaka", displayName: "Panasonic Energy — Osaka", city: "Osaka", country: "JP", primarySource: .hybrid, category: .equipmentManufacturer, capacityKwh: 420, inverterKw: 148, stateOfChargePct: 92, availableKwh: 386, pricePerKwhUsd: 0.048, delivered24hKwh: 800, deliveredLifetimeKwh: 3_200_000, pctChange1h: 0.2, pctChange24h: 1.2, pctChange7d: 3.0, uptimePct: 99.6, weeklyOutput: [785,805,792,812,800,796,800], weatherCondition: .cloudy, carbonOffsetKgCo2e: 357, equipment: nil, manufactures: ["2170 cylindrical NCA cells","4680 cylindrical cells","HIT solar-storage modules","EverVolt home battery","Residential storage systems"]),
        ProducerRow(id: "eq_eve_energy", rank: 72, handle: "eve-energy-huizhou", displayName: "EVE Energy — Huizhou", city: "Huizhou", country: "CN", primarySource: .hybrid, category: .equipmentManufacturer, capacityKwh: 480, inverterKw: 168, stateOfChargePct: 89, availableKwh: 427, pricePerKwhUsd: 0.035, delivered24hKwh: 920, deliveredLifetimeKwh: 3_600_000, pctChange1h: 0.1, pctChange24h: 0.8, pctChange7d: 2.0, uptimePct: 99.4, weeklyOutput: [900,925,912,935,920,916,920], weatherCondition: .sunny, carbonOffsetKgCo2e: 411, equipment: nil, manufactures: ["LF280K prismatic LFP cells","LF304 high-capacity cells","Square aluminum-case cells","Cylindrical 21700/4680 cells","Energy storage modules"]),
        ProducerRow(id: "eq_byd_battery", rank: 73, handle: "byd-blade-shenzhen", displayName: "BYD Blade Battery — Shenzhen", city: "Shenzhen", country: "CN", primarySource: .hybrid, category: .equipmentManufacturer, capacityKwh: 700, inverterKw: 245, stateOfChargePct: 94, availableKwh: 658, pricePerKwhUsd: 0.033, delivered24hKwh: 1350, deliveredLifetimeKwh: 5_600_000, pctChange1h: 0.1, pctChange24h: 0.9, pctChange7d: 2.3, uptimePct: 99.7, weeklyOutput: [1325,1360,1340,1370,1350,1345,1350], weatherCondition: .sunny, carbonOffsetKgCo2e: 603, equipment: nil, manufactures: ["Blade LFP battery cells","BatteryBox residential storage","BatteryMax C commercial ESS","BYD Cube utility-scale BESS","MC Cube containerized systems"]),
        ProducerRow(id: "eq_pylontech", rank: 74, handle: "pylontech-shanghai", displayName: "Pylontech — Shanghai", city: "Shanghai", country: "CN", primarySource: .hybrid, category: .equipmentManufacturer, capacityKwh: 150, inverterKw: 55, stateOfChargePct: 87, availableKwh: 131, pricePerKwhUsd: 0.052, delivered24hKwh: 290, deliveredLifetimeKwh: 980_000, pctChange1h: 0.2, pctChange24h: 1.1, pctChange7d: 2.8, uptimePct: 99.2, weeklyOutput: [283,295,288,300,290,288,290], weatherCondition: .sunny, carbonOffsetKgCo2e: 130, equipment: nil, manufactures: ["US2000C/US3000C rack batteries","Force H2 high-voltage battery","Phantom-S modular storage","PowerCube-X commercial storage","BMS management systems"]),
        ProducerRow(id: "eq_tongwei", rank: 75, handle: "tongwei-solar-chengdu", displayName: "Tongwei Solar — Chengdu", city: "Chengdu", country: "CN", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 400, inverterKw: 140, stateOfChargePct: 93, availableKwh: 372, pricePerKwhUsd: 0.034, delivered24hKwh: 780, deliveredLifetimeKwh: 3_000_000, pctChange1h: 0.2, pctChange24h: 1.3, pctChange7d: 3.2, uptimePct: 99.5, weeklyOutput: [765,785,772,795,780,776,780], weatherCondition: .sunny, carbonOffsetKgCo2e: 349, equipment: nil, manufactures: ["Polysilicon feedstock","Monocrystalline solar cells","TOPCon N-type cells","HJT heterojunction cells","TNC N-type modules"]),
        ProducerRow(id: "eq_tcl_zhonghuan", rank: 76, handle: "tcl-zhonghuan-tianjin", displayName: "TCL Zhonghuan — Tianjin", city: "Tianjin", country: "CN", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 380, inverterKw: 135, stateOfChargePct: 91, availableKwh: 346, pricePerKwhUsd: 0.036, delivered24hKwh: 730, deliveredLifetimeKwh: 2_800_000, pctChange1h: 0.1, pctChange24h: 1.1, pctChange7d: 2.8, uptimePct: 99.4, weeklyOutput: [715,735,722,745,730,726,730], weatherCondition: .sunny, carbonOffsetKgCo2e: 326, equipment: nil, manufactures: ["210mm G12 silicon wafers","182mm M10 silicon wafers","N-type monocrystalline ingots","Large-format wafer slicing","Semiconductor silicon wafers"]),
        ProducerRow(id: "eq_meyer_burger", rank: 77, handle: "meyer-burger-thun", displayName: "Meyer Burger — Thun", city: "Thun", country: "CH", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 85, inverterKw: 30, stateOfChargePct: 90, availableKwh: 77, pricePerKwhUsd: 0.075, delivered24hKwh: 160, deliveredLifetimeKwh: 520_000, pctChange1h: 0.3, pctChange24h: 1.5, pctChange7d: 3.8, uptimePct: 99.1, weeklyOutput: [155,162,158,165,160,158,160], weatherCondition: .cloudy, carbonOffsetKgCo2e: 71, equipment: nil, manufactures: ["HJT heterojunction cells","SmartWire cell connection","Glass-glass bifacial modules","PECVD coating systems","Cell stringing machines"]),
        ProducerRow(id: "eq_wacker_chemie", rank: 78, handle: "wacker-chemie-munich", displayName: "Wacker Chemie — München", city: "München", country: "DE", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 100, inverterKw: 36, stateOfChargePct: 88, availableKwh: 88, pricePerKwhUsd: 0.068, delivered24hKwh: 190, deliveredLifetimeKwh: 680_000, pctChange1h: 0.1, pctChange24h: 0.9, pctChange7d: 2.2, uptimePct: 99.3, weeklyOutput: [185,192,188,195,190,188,190], weatherCondition: .cloudy, carbonOffsetKgCo2e: 85, equipment: nil, manufactures: ["Polysilicon (WACKER POLYSILICON)","Silicones for module encapsulation","Pyrogenic silica for cells","Solar-grade silicon feedstock"]),
        ProducerRow(id: "eq_zf_wind", rank: 79, handle: "zf-wind-power-lommel", displayName: "ZF Wind Power — Lommel", city: "Lommel", country: "BE", primarySource: .wind, category: .equipmentManufacturer, capacityKwh: 110, inverterKw: 40, stateOfChargePct: 85, availableKwh: 94, pricePerKwhUsd: 0.060, delivered24hKwh: 210, deliveredLifetimeKwh: 750_000, pctChange1h: -0.1, pctChange24h: 0.8, pctChange7d: 2.0, uptimePct: 98.9, weeklyOutput: [205,215,208,218,210,208,210], weatherCondition: .windy, carbonOffsetKgCo2e: 94, equipment: nil, manufactures: ["Wind turbine gearboxes (2-10 MW)","Shift 6k medium-speed drives","Compact drive systems","Pitch/yaw drives","Condition monitoring sensors"]),
        ProducerRow(id: "eq_flender", rank: 80, handle: "flender-bocholt", displayName: "Flender (Siemens) — Bocholt", city: "Bocholt", country: "DE", primarySource: .wind, category: .equipmentManufacturer, capacityKwh: 130, inverterKw: 46, stateOfChargePct: 83, availableKwh: 108, pricePerKwhUsd: 0.058, delivered24hKwh: 250, deliveredLifetimeKwh: 880_000, pctChange1h: -0.2, pctChange24h: 0.7, pctChange7d: 1.8, uptimePct: 98.7, weeklyOutput: [244,255,248,258,250,248,250], weatherCondition: .windy, carbonOffsetKgCo2e: 112, equipment: nil, manufactures: ["FLENDERwind planetary gearboxes","FLENDER One single-stage drives","Multibrid hybrid drives","Pitch systems","Generator coupling systems"]),
        ProducerRow(id: "eq_lm_wind", rank: 81, handle: "lm-wind-power-kolding", displayName: "LM Wind Power (GE) — Kolding", city: "Kolding", country: "DK", primarySource: .wind, category: .equipmentManufacturer, capacityKwh: 140, inverterKw: 50, stateOfChargePct: 80, availableKwh: 112, pricePerKwhUsd: 0.055, delivered24hKwh: 270, deliveredLifetimeKwh: 960_000, pctChange1h: -0.3, pctChange24h: 0.9, pctChange7d: 2.1, uptimePct: 98.5, weeklyOutput: [264,275,268,278,270,268,270], weatherCondition: .windy, carbonOffsetKgCo2e: 121, equipment: nil, manufactures: ["107m offshore blades","88.4m onshore blades","73.5m blades for 3-5 MW class","Carbon-fiber spar caps","Recyclable blade technology"]),
        ProducerRow(id: "eq_tkf_towers", rank: 82, handle: "cs-wind-gunsan", displayName: "CS Wind — Gunsan", city: "Gunsan", country: "KR", primarySource: .wind, category: .equipmentManufacturer, capacityKwh: 120, inverterKw: 42, stateOfChargePct: 82, availableKwh: 98, pricePerKwhUsd: 0.057, delivered24hKwh: 230, deliveredLifetimeKwh: 820_000, pctChange1h: -0.1, pctChange24h: 0.6, pctChange7d: 1.5, uptimePct: 98.6, weeklyOutput: [225,235,228,238,230,228,230], weatherCondition: .windy, carbonOffsetKgCo2e: 103, equipment: nil, manufactures: ["Onshore steel towers (80-170m)","Offshore monopile foundations","Transition pieces","Internal platforms & ladders","Tower flanges and bolting"]),
        ProducerRow(id: "eq_timken_bearing", rank: 83, handle: "timken-north-canton", displayName: "Timken — North Canton", city: "North Canton", country: "US", primarySource: .wind, category: .equipmentManufacturer, capacityKwh: 90, inverterKw: 32, stateOfChargePct: 84, availableKwh: 76, pricePerKwhUsd: 0.062, delivered24hKwh: 170, deliveredLifetimeKwh: 590_000, pctChange1h: -0.1, pctChange24h: 0.5, pctChange7d: 1.3, uptimePct: 98.8, weeklyOutput: [166,173,168,175,170,168,170], weatherCondition: .windy, carbonOffsetKgCo2e: 76, equipment: nil, manufactures: ["Main shaft bearings (TDI series)","Pitch bearings","Yaw bearings","Gearbox bearings","Condition monitoring (iMON)"]),
        ProducerRow(id: "eq_nextracker", rank: 84, handle: "nextracker-fremont", displayName: "NEXTracker — Fremont", city: "Fremont", country: "US", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 250, inverterKw: 88, stateOfChargePct: 94, availableKwh: 235, pricePerKwhUsd: 0.048, delivered24hKwh: 480, deliveredLifetimeKwh: 1_800_000, pctChange1h: 0.2, pctChange24h: 1.4, pctChange7d: 3.5, uptimePct: 99.6, weeklyOutput: [470,485,475,490,480,477,480], weatherCondition: .sunny, carbonOffsetKgCo2e: 214, equipment: nil, manufactures: ["NX Horizon single-axis trackers","NX Gemini split-architecture tracker","TrueCapture AI-optimized tracking","NX Navigator tracking software","Hail-stow protection systems"]),
        ProducerRow(id: "eq_array_tech", rank: 85, handle: "array-technologies-abq", displayName: "Array Technologies — Albuquerque", city: "Albuquerque", country: "US", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 220, inverterKw: 78, stateOfChargePct: 93, availableKwh: 205, pricePerKwhUsd: 0.050, delivered24hKwh: 420, deliveredLifetimeKwh: 1_500_000, pctChange1h: 0.2, pctChange24h: 1.3, pctChange7d: 3.3, uptimePct: 99.5, weeklyOutput: [410,425,415,430,420,418,420], weatherCondition: .sunny, carbonOffsetKgCo2e: 188, equipment: nil, manufactures: ["DuraTrack HZ v3 single-axis tracker","OmniTrack terrain-following system","SmarTrack intelligent controls","DuraRack fixed-tilt racking"]),
        ProducerRow(id: "eq_schletter", rank: 86, handle: "schletter-kirchdorf", displayName: "Schletter Group — Kirchdorf", city: "Kirchdorf", country: "DE", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 70, inverterKw: 25, stateOfChargePct: 90, availableKwh: 63, pricePerKwhUsd: 0.065, delivered24hKwh: 130, deliveredLifetimeKwh: 450_000, pctChange1h: 0.1, pctChange24h: 0.9, pctChange7d: 2.2, uptimePct: 99.2, weeklyOutput: [126,132,129,135,130,129,130], weatherCondition: .cloudy, carbonOffsetKgCo2e: 58, equipment: nil, manufactures: ["FS ground-mount systems","Fix-Z roof mount systems","Park@Sol carport structures","AluGrid flat-roof systems","EcoFix agricultural mounts"]),
        ProducerRow(id: "eq_k2_systems", rank: 87, handle: "k2-systems-renningen", displayName: "K2 Systems — Renningen", city: "Renningen", country: "DE", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 60, inverterKw: 22, stateOfChargePct: 89, availableKwh: 53, pricePerKwhUsd: 0.068, delivered24hKwh: 115, deliveredLifetimeKwh: 380_000, pctChange1h: 0.2, pctChange24h: 1.0, pctChange7d: 2.5, uptimePct: 99.1, weeklyOutput: [112,118,114,120,115,114,115], weatherCondition: .cloudy, carbonOffsetKgCo2e: 51, equipment: nil, manufactures: ["K2 D-Dome flat-roof system","K2 SingleRail pitched roof","K2 InsertionRail facade mount","K2 Base Carport system","K2 Planning software (K2 Base)"]),
        ProducerRow(id: "eq_staubli", rank: 88, handle: "staubli-pfaffikon", displayName: "Stäubli (MC4) — Pfäffikon", city: "Pfäffikon", country: "CH", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 50, inverterKw: 18, stateOfChargePct: 95, availableKwh: 48, pricePerKwhUsd: 0.072, delivered24hKwh: 96, deliveredLifetimeKwh: 320_000, pctChange1h: 0.1, pctChange24h: 0.7, pctChange7d: 1.8, uptimePct: 99.8, weeklyOutput: [93,97,95,99,96,95,96], weatherCondition: .cloudy, carbonOffsetKgCo2e: 43, equipment: nil, manufactures: ["MC4 solar connectors","MC4-Evo2 next-gen connectors","MC-PV branch connectors","Original MC4 inline fuses","CombiTac modular connectors"]),
        ProducerRow(id: "eq_prysmian", rank: 89, handle: "prysmian-milan", displayName: "Prysmian Group — Milan", city: "Milan", country: "IT", primarySource: .hybrid, category: .equipmentManufacturer, capacityKwh: 180, inverterKw: 64, stateOfChargePct: 86, availableKwh: 155, pricePerKwhUsd: 0.055, delivered24hKwh: 340, deliveredLifetimeKwh: 1_200_000, pctChange1h: 0.1, pctChange24h: 0.8, pctChange7d: 2.0, uptimePct: 99.4, weeklyOutput: [332,345,338,348,340,338,340], weatherCondition: .sunny, carbonOffsetKgCo2e: 152, equipment: nil, manufactures: ["P-Sun solar DC cables","Offshore wind export cables (HVDC)","Submarine interconnector cables","Medium-voltage distribution cables","Fiber-optic monitoring cables"]),
        ProducerRow(id: "eq_nexans", rank: 90, handle: "nexans-paris", displayName: "Nexans — Paris", city: "Paris", country: "FR", primarySource: .hybrid, category: .equipmentManufacturer, capacityKwh: 160, inverterKw: 57, stateOfChargePct: 87, availableKwh: 139, pricePerKwhUsd: 0.058, delivered24hKwh: 310, deliveredLifetimeKwh: 1_050_000, pctChange1h: 0.1, pctChange24h: 0.7, pctChange7d: 1.8, uptimePct: 99.3, weeklyOutput: [302,315,308,318,310,308,310], weatherCondition: .cloudy, carbonOffsetKgCo2e: 139, equipment: nil, manufactures: ["Solar PV string cables","Offshore wind array cables","HVDC submarine cables","Busbar trunking systems","Wind farm collection cables"]),
        ProducerRow(id: "eq_hitachi_energy", rank: 91, handle: "hitachi-energy-zurich", displayName: "Hitachi Energy — Zürich", city: "Zürich", country: "CH", primarySource: .hybrid, category: .equipmentManufacturer, capacityKwh: 300, inverterKw: 105, stateOfChargePct: 92, availableKwh: 276, pricePerKwhUsd: 0.048, delivered24hKwh: 580, deliveredLifetimeKwh: 2_200_000, pctChange1h: 0.1, pctChange24h: 0.9, pctChange7d: 2.2, uptimePct: 99.6, weeklyOutput: [568,585,575,590,580,577,580], weatherCondition: .cloudy, carbonOffsetKgCo2e: 259, equipment: nil, manufactures: ["Power transformers (up to 1200 MVA)","HVDC converter stations","Grid-eConomy digital substations","e-mesh BESS integration","EconiQ eco-efficient switchgear"]),
        ProducerRow(id: "eq_schneider", rank: 92, handle: "schneider-electric-paris", displayName: "Schneider Electric — Paris", city: "Paris", country: "FR", primarySource: .hybrid, category: .equipmentManufacturer, capacityKwh: 280, inverterKw: 98, stateOfChargePct: 90, availableKwh: 252, pricePerKwhUsd: 0.050, delivered24hKwh: 540, deliveredLifetimeKwh: 2_000_000, pctChange1h: 0.2, pctChange24h: 1.0, pctChange7d: 2.5, uptimePct: 99.5, weeklyOutput: [528,545,535,550,540,537,540], weatherCondition: .cloudy, carbonOffsetKgCo2e: 241, equipment: nil, manufactures: ["Conext CL utility inverters","MV switchgear (SM6/Premset)","Ring Main Units (RMU)","Grid automation controllers","EcoStruxure Microgrid Advisor"]),
        ProducerRow(id: "eq_siemens_energy", rank: 93, handle: "siemens-energy-munich", displayName: "Siemens Energy — München", city: "München", country: "DE", primarySource: .hybrid, category: .equipmentManufacturer, capacityKwh: 350, inverterKw: 122, stateOfChargePct: 91, availableKwh: 319, pricePerKwhUsd: 0.045, delivered24hKwh: 680, deliveredLifetimeKwh: 2_600_000, pctChange1h: 0.1, pctChange24h: 0.8, pctChange7d: 2.0, uptimePct: 99.6, weeklyOutput: [665,685,672,692,680,676,680], weatherCondition: .cloudy, carbonOffsetKgCo2e: 304, equipment: nil, manufactures: ["HVDC PLUS converter systems","Blue GIS SF6-free switchgear","SVC PLUS grid stabilization","Power transformers (to 800 kV)","Sensformer digital transformers"]),
        ProducerRow(id: "eq_abb_electrification", rank: 94, handle: "abb-electrification-zurich", displayName: "ABB Electrification — Zürich", city: "Zürich", country: "CH", primarySource: .hybrid, category: .equipmentManufacturer, capacityKwh: 320, inverterKw: 112, stateOfChargePct: 89, availableKwh: 285, pricePerKwhUsd: 0.047, delivered24hKwh: 620, deliveredLifetimeKwh: 2_400_000, pctChange1h: 0.1, pctChange24h: 0.9, pctChange7d: 2.3, uptimePct: 99.5, weeklyOutput: [606,625,615,630,620,617,620], weatherCondition: .cloudy, carbonOffsetKgCo2e: 277, equipment: nil, manufactures: ["PVS utility-scale inverters","TRIO string inverters","UniGear MV switchgear","Ability Energy Manager","Terra EV charging stations"]),
        ProducerRow(id: "eq_victron", rank: 95, handle: "victron-energy-almere", displayName: "Victron Energy — Almere", city: "Almere", country: "NL", primarySource: .hybrid, category: .equipmentManufacturer, capacityKwh: 80, inverterKw: 28, stateOfChargePct: 91, availableKwh: 73, pricePerKwhUsd: 0.072, delivered24hKwh: 150, deliveredLifetimeKwh: 480_000, pctChange1h: 0.2, pctChange24h: 1.2, pctChange7d: 3.0, uptimePct: 99.4, weeklyOutput: [146,152,149,155,150,149,150], weatherCondition: .cloudy, carbonOffsetKgCo2e: 67, equipment: nil, manufactures: ["SmartSolar MPPT charge controllers","MultiPlus-II inverter/chargers","Quattro inverter/chargers","Cerbo GX system monitor","Lynx Smart BMS"]),
        ProducerRow(id: "eq_outback", rank: 96, handle: "outback-power-arlington", displayName: "OutBack Power — Arlington", city: "Arlington", country: "US", primarySource: .hybrid, category: .equipmentManufacturer, capacityKwh: 60, inverterKw: 22, stateOfChargePct: 88, availableKwh: 53, pricePerKwhUsd: 0.078, delivered24hKwh: 115, deliveredLifetimeKwh: 360_000, pctChange1h: 0.3, pctChange24h: 1.4, pctChange7d: 3.5, uptimePct: 99.1, weeklyOutput: [112,117,114,119,115,114,115], weatherCondition: .sunny, carbonOffsetKgCo2e: 51, equipment: nil, manufactures: ["FXR hybrid inverter/chargers","Radian split-phase inverters","FLEXmax MPPT charge controllers","OPTICS RE system monitoring","SkyBox all-in-one hybrid"]),
        ProducerRow(id: "eq_morningstar", rank: 97, handle: "morningstar-newtown", displayName: "Morningstar Corp — Newtown", city: "Newtown", country: "US", primarySource: .solar, category: .equipmentManufacturer, capacityKwh: 40, inverterKw: 14, stateOfChargePct: 92, availableKwh: 37, pricePerKwhUsd: 0.082, delivered24hKwh: 78, deliveredLifetimeKwh: 250_000, pctChange1h: 0.1, pctChange24h: 0.9, pctChange7d: 2.2, uptimePct: 99.5, weeklyOutput: [76,79,77,80,78,77,78], weatherCondition: .sunny, carbonOffsetKgCo2e: 35, equipment: nil, manufactures: ["TriStar MPPT controllers","ProStar charge controllers","SureSine off-grid inverters","GenStar MPPT + diesel hybrid","LiveView monitoring platform"]),
        ProducerRow(id: "eq_ossberger", rank: 98, handle: "ossberger-weissenburg", displayName: "OSSBERGER — Weißenburg", city: "Weißenburg", country: "DE", primarySource: .hydro, category: .equipmentManufacturer, capacityKwh: 70, inverterKw: 25, stateOfChargePct: 96, availableKwh: 67, pricePerKwhUsd: 0.058, delivered24hKwh: 160, deliveredLifetimeKwh: 580_000, pctChange1h: 0.0, pctChange24h: 0.3, pctChange7d: 0.7, uptimePct: 99.7, weeklyOutput: [158,162,159,163,160,159,160], weatherCondition: .rainy, carbonOffsetKgCo2e: 71, equipment: nil, manufactures: ["Crossflow (Banki) turbines","Pelton turbines (small-hydro)","Francis turbines (micro-hydro)","Intake screens & trash racks","Hydraulic control systems"]),
        ProducerRow(id: "eq_gilkes", rank: 99, handle: "gilkes-kendal", displayName: "Gilkes — Kendal", city: "Kendal", country: "GB", primarySource: .hydro, category: .equipmentManufacturer, capacityKwh: 65, inverterKw: 23, stateOfChargePct: 97, availableKwh: 63, pricePerKwhUsd: 0.060, delivered24hKwh: 148, deliveredLifetimeKwh: 520_000, pctChange1h: 0.0, pctChange24h: 0.2, pctChange7d: 0.5, uptimePct: 99.8, weeklyOutput: [145,149,147,151,148,147,148], weatherCondition: .rainy, carbonOffsetKgCo2e: 66, equipment: nil, manufactures: ["Pelton impulse turbines","Turgo turbines","Francis reaction turbines","Gilkes Hydroverse digital twin","Packaged micro-hydro systems"]),
        ProducerRow(id: "eq_turbulent", rank: 100, handle: "turbulent-leuven", displayName: "Turbulent — Leuven", city: "Leuven", country: "BE", primarySource: .hydro, category: .equipmentManufacturer, capacityKwh: 45, inverterKw: 16, stateOfChargePct: 98, availableKwh: 44, pricePerKwhUsd: 0.055, delivered24hKwh: 105, deliveredLifetimeKwh: 380_000, pctChange1h: 0.0, pctChange24h: 0.2, pctChange7d: 0.5, uptimePct: 99.6, weeklyOutput: [103,106,104,107,105,104,105], weatherCondition: .rainy, carbonOffsetKgCo2e: 47, equipment: nil, manufactures: ["Vortex turbines (5-100 kW)","Fish-friendly low-head turbines","Modular concrete vortex basins","IoT monitoring platform","Containerized micro-hydro kits"]),
    ]
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `~/bin/mac-ios --lane build_sim`
Expected: All MockDataTests pass, BUILD SUCCEEDED

- [ ] **Step 6: Commit**

```bash
ssh -p 2222 aleksandrswiss@localhost "cd /Users/aleksandrswiss/poolwatt-ios && git add -A && git commit -m 'feat: add ProducerRepository protocol, API client, and mock data (100 producers)'"
```

---

### Task 6: HomeViewModel

**Files:**
- Create: `Sources/PoolwattIOS/ViewModels/HomeViewModel.swift`
- Create: `Tests/PoolwattIOSTests/HomeViewModelTests.swift`

- [ ] **Step 1: Write HomeViewModelTests.swift**

```swift
import XCTest
@testable import PoolwattIOS

final class HomeViewModelTests: XCTestCase {
    var vm: HomeViewModel!

    override func setUp() {
        vm = HomeViewModel(repository: MockProducerRepository())
    }

    func test_load_populates_producers() async {
        await vm.load()
        XCTAssertEqual(vm.allProducers.count, 100)
        XCTAssertFalse(vm.isLoading)
    }

    func test_search_filters_by_name() async {
        await vm.load()
        vm.searchText = "jinko"
        XCTAssertTrue(vm.filteredProducers.allSatisfy {
            $0.displayName.localizedCaseInsensitiveContains("jinko")
        })
    }

    func test_search_filters_by_city() async {
        await vm.load()
        vm.searchText = "oslo"
        XCTAssertTrue(vm.filteredProducers.allSatisfy {
            $0.city.localizedCaseInsensitiveContains("oslo")
        })
    }

    func test_filter_by_source() async {
        await vm.load()
        vm.selectedSource = .wind
        XCTAssertTrue(vm.filteredProducers.allSatisfy { $0.primarySource == .wind })
    }

    func test_sort_by_price() async {
        await vm.load()
        vm.sortKey = .price
        let prices = vm.filteredProducers.map(\.pricePerKwhUsd)
        XCTAssertEqual(prices, prices.sorted())
    }

    func test_sort_by_change24h_descending() async {
        await vm.load()
        vm.sortKey = .change24h
        let changes = vm.filteredProducers.compactMap(\.pctChange24h)
        XCTAssertEqual(changes, changes.sorted(by: >))
    }

    func test_combined_filter_and_search() async {
        await vm.load()
        vm.selectedSource = .solar
        vm.searchText = "haining"
        XCTAssertTrue(vm.filteredProducers.allSatisfy {
            $0.primarySource == .solar &&
            $0.city.localizedCaseInsensitiveContains("haining")
        })
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `~/bin/mac-ios --lane build_sim`
Expected: FAIL — `HomeViewModel` not found

- [ ] **Step 3: Write HomeViewModel.swift**

```swift
import SwiftUI

enum SortKey: String, CaseIterable, Identifiable {
    case rank, price, change24h, available, delivered24h, soc

    var id: String { rawValue }

    var label: String {
        switch self {
        case .rank:        return String(localized: "listing.rank")
        case .price:       return String(localized: "listing.price")
        case .change24h:   return String(localized: "listing.change24h")
        case .available:   return String(localized: "listing.available")
        case .delivered24h: return String(localized: "listing.delivered24h")
        case .soc:         return String(localized: "listing.stateOfCharge")
        }
    }
}

enum DataSource { case api, mock }

@MainActor
final class HomeViewModel: ObservableObject {
    @Published var allProducers: [ProducerRow] = []
    @Published var gridStats: GridSnap?
    @Published var greenIndex: GreenIndex?
    @Published var isLoading = false
    @Published var dataSource: DataSource = .mock
    @Published var searchText = ""
    @Published var selectedSource: RenewableSource?
    @Published var sortKey: SortKey = .rank
    @Published var sortAscending = true

    private let repository: ProducerRepository
    private let fallback: ProducerRepository

    init(repository: ProducerRepository = APIProducerRepository(),
         fallback: ProducerRepository = MockProducerRepository()) {
        self.repository = repository
        self.fallback = fallback
    }

    var filteredProducers: [ProducerRow] {
        var result = allProducers

        if let source = selectedSource {
            result = result.filter { $0.primarySource == source }
        }

        if !searchText.isEmpty {
            let query = searchText.lowercased()
            result = result.filter {
                $0.handle.lowercased().contains(query) ||
                $0.displayName.lowercased().contains(query) ||
                $0.city.lowercased().contains(query)
            }
        }

        result.sort { a, b in
            let cmp: Bool
            switch sortKey {
            case .rank:        cmp = a.rank < b.rank
            case .price:       cmp = a.pricePerKwhUsd < b.pricePerKwhUsd
            case .change24h:   cmp = (a.pctChange24h ?? 0) > (b.pctChange24h ?? 0)
            case .available:   cmp = a.availableKwh > b.availableKwh
            case .delivered24h: cmp = a.delivered24hKwh > b.delivered24hKwh
            case .soc:         cmp = a.stateOfChargePct > b.stateOfChargePct
            }
            return sortAscending ? cmp : !cmp
        }

        return result
    }

    func load() async {
        isLoading = true
        do {
            let data = try await repository.fetchAll()
            allProducers = data.producers
            gridStats = data.gridStats
            greenIndex = data.greenIndex
            dataSource = .api
        } catch {
            let data = try? await fallback.fetchAll()
            allProducers = data?.producers ?? []
            gridStats = data?.gridStats
            greenIndex = data?.greenIndex
            dataSource = .mock
        }
        isLoading = false
    }

    func toggleSort(_ key: SortKey) {
        if sortKey == key {
            sortAscending.toggle()
        } else {
            sortKey = key
            sortAscending = key == .rank || key == .price
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `~/bin/mac-ios --lane build_sim`
Expected: All HomeViewModelTests pass, BUILD SUCCEEDED

- [ ] **Step 5: Commit**

```bash
ssh -p 2222 aleksandrswiss@localhost "cd /Users/aleksandrswiss/poolwatt-ios && git add -A && git commit -m 'feat: add HomeViewModel with search/filter/sort logic and tests'"
```

---

### Task 7: Custom UI Components

**Files:**
- Create: `Sources/PoolwattIOS/Views/StateOfChargeGauge.swift`
- Create: `Sources/PoolwattIOS/Views/SparklineShape.swift`
- Create: `Sources/PoolwattIOS/Views/SourceBadge.swift`

- [ ] **Step 1: Write StateOfChargeGauge.swift**

```swift
import SwiftUI

struct StateOfChargeGauge: View {
    let pct: Double
    private let segmentCount = 8

    private var filledCount: Int {
        Int((pct / 100.0) * Double(segmentCount)).clamped(to: 0...segmentCount)
    }

    private var color: Color {
        if pct >= 80 { return Theme.up }
        if pct >= 50 { return Theme.accent }
        if pct >= 25 { return Theme.blue }
        return Theme.down
    }

    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<segmentCount, id: \.self) { i in
                RoundedRectangle(cornerRadius: 2)
                    .fill(i < filledCount ? color : Theme.hairline)
                    .frame(width: 6, height: 14)
            }
            Text(formatPct(pct))
                .font(.caption2)
                .monospacedDigit()
                .foregroundStyle(color)
        }
    }
}

private extension Int {
    func clamped(to range: ClosedRange<Int>) -> Int {
        Swift.min(Swift.max(self, range.lowerBound), range.upperBound)
    }
}
```

- [ ] **Step 2: Write SparklineShape.swift**

```swift
import SwiftUI

struct SparklineView: View {
    let data: [Double]
    var width: CGFloat = 60
    var height: CGFloat = 24

    private var isUp: Bool {
        guard let first = data.first, let last = data.last else { return true }
        return last >= first
    }

    var body: some View {
        SparklineShape(data: data)
            .stroke(isUp ? Theme.up : Theme.down, lineWidth: 1.5)
            .frame(width: width, height: height)
    }
}

struct SparklineShape: Shape {
    let data: [Double]

    func path(in rect: CGRect) -> Path {
        guard data.count >= 2 else { return Path() }
        let minVal = data.min() ?? 0
        let maxVal = data.max() ?? 1
        let range = maxVal - minVal
        let yScale = range > 0 ? rect.height / range : 0
        let xStep = rect.width / CGFloat(data.count - 1)

        var path = Path()
        for (i, val) in data.enumerated() {
            let x = CGFloat(i) * xStep
            let y = rect.height - (val - minVal) * yScale
            if i == 0 {
                path.move(to: CGPoint(x: x, y: y))
            } else {
                path.addLine(to: CGPoint(x: x, y: y))
            }
        }
        return path
    }
}
```

- [ ] **Step 3: Write SourceBadge.swift**

```swift
import SwiftUI

struct SourceBadge: View {
    let source: RenewableSource

    private var tint: Color {
        switch source {
        case .solar:      return Theme.accent
        case .wind:       return Theme.blue
        case .hydro:      return Color(hex: 0x60A5FA)
        case .biomass:    return Theme.green
        case .geothermal: return Color(hex: 0xF97316)
        case .hybrid:     return Color(hex: 0xA78BFA)
        }
    }

    var body: some View {
        HStack(spacing: 3) {
            Text(source.glyph)
                .font(.caption2)
            Text(source.label)
                .font(.caption2)
                .fontWeight(.medium)
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(tint.opacity(0.15))
        .clipShape(Capsule())
    }
}
```

- [ ] **Step 4: Build to verify**

Run: `~/bin/mac-ios --lane build_sim`
Expected: BUILD SUCCEEDED

- [ ] **Step 5: Commit**

```bash
ssh -p 2222 aleksandrswiss@localhost "cd /Users/aleksandrswiss/poolwatt-ios && git add -A && git commit -m 'feat: add StateOfChargeGauge, SparklineShape, SourceBadge views'"
```

---

### Task 8: GridStatsCard, SearchField, SourceFilterBar, SortMenu

**Files:**
- Create: `Sources/PoolwattIOS/Views/GridStatsCard.swift`
- Create: `Sources/PoolwattIOS/Views/SearchField.swift`
- Create: `Sources/PoolwattIOS/Views/SourceFilterBar.swift`
- Create: `Sources/PoolwattIOS/Views/SortMenu.swift`

- [ ] **Step 1: Write GridStatsCard.swift**

```swift
import SwiftUI

struct GridStatsCard: View {
    let stats: GridSnap
    let greenIndex: GreenIndex?

    var body: some View {
        VStack(spacing: 12) {
            statRow(String(localized: "stats.totalCapacity"), formatKwh(stats.totalCapacityKwh))
            statRow(String(localized: "stats.delivered24h"), formatKwh(stats.totalDelivered24hKwh))
            statRow(String(localized: "stats.activeProducers"), "\(stats.activeProducers)")
            statRow(String(localized: "stats.carbonOffset"), formatCo2(stats.carbonOffset24hKgCo2e))

            if let gi = greenIndex {
                Divider().overlay(Theme.hairline)
                HStack {
                    Text(String(localized: "stats.greenIndex"))
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                    Spacer()
                    Text("\(Int(gi.value))")
                        .font(.title3).bold()
                        .monospacedDigit()
                        .foregroundStyle(gi.classification.color)
                    Text(gi.classification.label)
                        .font(.caption)
                        .foregroundStyle(gi.classification.color)
                }
            }

            Divider().overlay(Theme.hairline)

            HStack {
                shareColumn(String(localized: "stats.solarShare"), stats.solarSharePct)
                Spacer()
                shareColumn(String(localized: "stats.windShare"), stats.windSharePct)
                Spacer()
                shareColumn(String(localized: "stats.hydroShare"), stats.hydroSharePct)
            }
        }
        .padding(16)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Theme.hairline, lineWidth: 1)
        )
    }

    private func statRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.muted)
            Spacer()
            Text(value)
                .font(.subheadline).bold()
                .monospacedDigit()
                .foregroundStyle(Theme.foreground)
        }
    }

    private func shareColumn(_ label: String, _ pct: Double) -> some View {
        VStack(spacing: 2) {
            Text(formatPct(pct))
                .font(.subheadline).bold()
                .monospacedDigit()
                .foregroundStyle(Theme.foreground)
            Text(label)
                .font(.caption2)
                .foregroundStyle(Theme.muted)
        }
    }
}
```

- [ ] **Step 2: Write SearchField.swift**

```swift
import SwiftUI

struct SearchField: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Theme.muted)
            TextField(String(localized: "listing.search"), text: $text)
                .foregroundStyle(Theme.foreground)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.muted)
                }
            }
        }
        .padding(10)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Theme.hairline, lineWidth: 1)
        )
    }
}
```

- [ ] **Step 3: Write SourceFilterBar.swift**

```swift
import SwiftUI

struct SourceFilterBar: View {
    @Binding var selected: RenewableSource?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                pill(label: String(localized: "source.all"), isSelected: selected == nil) {
                    selected = nil
                }
                ForEach(RenewableSource.allCases) { source in
                    pill(label: "\(source.glyph) \(source.label)", isSelected: selected == source) {
                        selected = source
                    }
                }
            }
            .padding(.horizontal, 4)
        }
    }

    private func pill(label: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.caption)
                .fontWeight(.medium)
                .foregroundStyle(isSelected ? Theme.bg : Theme.foreground)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isSelected ? Theme.accent : Theme.card)
                .clipShape(Capsule())
                .overlay(
                    Capsule()
                        .stroke(isSelected ? Color.clear : Theme.hairline, lineWidth: 1)
                )
        }
    }
}

private extension RenewableSource {
    static var allLabel: String { String(localized: "source.all") }
}
```

- [ ] **Step 4: Write SortMenu.swift**

```swift
import SwiftUI

struct SortMenu: View {
    @ObservedObject var viewModel: HomeViewModel

    var body: some View {
        Menu {
            ForEach(SortKey.allCases) { key in
                Button {
                    viewModel.toggleSort(key)
                } label: {
                    HStack {
                        Text(key.label)
                        if viewModel.sortKey == key {
                            Image(systemName: viewModel.sortAscending ? "chevron.up" : "chevron.down")
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "arrow.up.arrow.down")
                Text(viewModel.sortKey.label)
                    .font(.caption)
            }
            .foregroundStyle(Theme.muted)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Theme.card)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Theme.hairline, lineWidth: 1))
        }
    }
}
```

- [ ] **Step 5: Build to verify**

Run: `~/bin/mac-ios --lane build_sim`
Expected: BUILD SUCCEEDED

- [ ] **Step 6: Commit**

```bash
ssh -p 2222 aleksandrswiss@localhost "cd /Users/aleksandrswiss/poolwatt-ios && git add -A && git commit -m 'feat: add GridStatsCard, SearchField, SourceFilterBar, SortMenu'"
```

---

### Task 9: ProducerCard & HomeView

**Files:**
- Create: `Sources/PoolwattIOS/Views/ProducerCard.swift`
- Create: `Sources/PoolwattIOS/Views/HomeView.swift`
- Modify: `Sources/PoolwattIOS/PoolwattIOSApp.swift`
- Delete: `Sources/PoolwattIOS/ContentView.swift`
- Modify: `Tests/PoolwattIOSTests/PoolwattIOSTests.swift`

- [ ] **Step 1: Write ProducerCard.swift**

```swift
import SwiftUI

struct ProducerCard: View {
    let producer: ProducerRow

    private var changeColor: Color {
        guard let pct = producer.pctChange24h else { return Theme.muted }
        if pct > 0 { return Theme.up }
        if pct < 0 { return Theme.down }
        return Theme.muted
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack {
                Text("#\(producer.rank)")
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.muted)
                Text(producer.displayName)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(1)
                Spacer()
                SourceBadge(source: producer.primarySource)
            }

            // Subtitle
            Text("\(producer.city), \(producer.country)")
                .font(.caption)
                .foregroundStyle(Theme.muted)

            // 2x2 metrics
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(String(localized: "listing.stateOfCharge"))
                        .font(.caption2)
                        .foregroundStyle(Theme.muted)
                    StateOfChargeGauge(pct: producer.stateOfChargePct)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text(String(localized: "listing.price"))
                        .font(.caption2)
                        .foregroundStyle(Theme.muted)
                    Text("$\(String(format: "%.3f", producer.pricePerKwhUsd))")
                        .font(.subheadline)
                        .monospacedDigit()
                        .foregroundStyle(Theme.foreground)
                }
            }

            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(String(localized: "listing.available"))
                        .font(.caption2)
                        .foregroundStyle(Theme.muted)
                    Text(formatKwh(producer.availableKwh))
                        .font(.subheadline)
                        .monospacedDigit()
                        .foregroundStyle(Theme.foreground)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text(String(localized: "listing.change24h"))
                        .font(.caption2)
                        .foregroundStyle(Theme.muted)
                    Text(formatPct(producer.pctChange24h, showSign: true))
                        .font(.subheadline)
                        .monospacedDigit()
                        .foregroundStyle(changeColor)
                }
            }

            // Footer
            HStack {
                Text("\(String(localized: "listing.delivered24h")): \(formatKwh(producer.delivered24hKwh))")
                    .font(.caption2)
                    .monospacedDigit()
                    .foregroundStyle(Theme.muted)
                Spacer()
                SparklineView(data: producer.weeklyOutput)
            }

            // Equipment / manufactures
            if let items = producer.equipment ?? producer.manufactures, !items.isEmpty {
                Text(items.prefix(3).joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
        }
        .padding(16)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Theme.hairline, lineWidth: 1)
        )
    }
}
```

- [ ] **Step 2: Write HomeView.swift**

```swift
import SwiftUI

struct HomeView: View {
    @StateObject private var viewModel = HomeViewModel()

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Header
                HStack {
                    Text("Poolwatt")
                        .font(.title2).bold()
                        .foregroundStyle(Theme.foreground)
                    Text(".energy")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Theme.accent.opacity(0.15))
                        .clipShape(Capsule())
                    Spacer()
                }
                .padding(.horizontal, 16)

                // Grid Stats
                if let stats = viewModel.gridStats {
                    GridStatsCard(stats: stats, greenIndex: viewModel.greenIndex)
                        .padding(.horizontal, 16)
                }

                // Filters
                SourceFilterBar(selected: $viewModel.selectedSource)
                    .padding(.leading, 16)

                // Search + Sort
                HStack(spacing: 8) {
                    SearchField(text: $viewModel.searchText)
                    SortMenu(viewModel: viewModel)
                }
                .padding(.horizontal, 16)

                // Producer list
                LazyVStack(spacing: 12) {
                    ForEach(viewModel.filteredProducers) { producer in
                        ProducerCard(producer: producer)
                    }
                }
                .padding(.horizontal, 16)
            }
            .padding(.vertical, 16)
        }
        .background(Theme.bg)
        .refreshable {
            await viewModel.load()
        }
        .task {
            await viewModel.load()
        }
    }
}
```

- [ ] **Step 3: Update PoolwattIOSApp.swift**

```swift
import SwiftUI

@main
struct PoolwattIOSApp: App {
    var body: some Scene {
        WindowGroup {
            HomeView()
                .preferredColorScheme(.dark)
        }
    }
}
```

- [ ] **Step 4: Delete ContentView.swift**

```bash
ssh -p 2222 aleksandrswiss@localhost "rm /Users/aleksandrswiss/poolwatt-ios/Sources/PoolwattIOS/ContentView.swift"
```

- [ ] **Step 5: Update smoke test**

Replace `Tests/PoolwattIOSTests/PoolwattIOSTests.swift`:

```swift
import XCTest
@testable import PoolwattIOS

final class PoolwattIOSTests: XCTestCase {
    func test_home_view_body_does_not_crash() {
        let _ = HomeView()
    }
}
```

- [ ] **Step 6: Build and run tests**

Run: `~/bin/mac-ios --lane build_sim`
Expected: All tests pass, BUILD SUCCEEDED

- [ ] **Step 7: Commit**

```bash
ssh -p 2222 aleksandrswiss@localhost "cd /Users/aleksandrswiss/poolwatt-ios && git add -A && git commit -m 'feat: add ProducerCard, HomeView, replace ContentView placeholder'"
```

---

### Task 10: Internationalization (28 locales)

**Files:**
- Create: `Sources/PoolwattIOS/Resources/Localizable.xcstrings`

- [ ] **Step 1: Generate Localizable.xcstrings**

This is a JSON file. Generate it from the website's `messages/*.json` by extracting only the keys used by the iOS app (stats.*, listing.*, source.*, greenIndex.*, and a few from common.*). The file format is the Xcode `.xcstrings` catalog format.

The keys to include:
- `stats.totalCapacity`, `stats.delivered24h`, `stats.activeProducers`, `stats.carbonOffset`, `stats.greenIndex`, `stats.solarShare`, `stats.windShare`, `stats.hydroShare`
- `listing.rank`, `listing.price`, `listing.stateOfCharge`, `listing.available`, `listing.delivered24h`, `listing.change24h`, `listing.search`
- `source.all` (= "All" in en), `source.SOLAR`, `source.WIND`, `source.HYDRO`, `source.BIOMASS`, `source.GEOTHERMAL`, `source.HYBRID`
- `greenIndex.carbon-heavy`, `greenIndex.mixed`, `greenIndex.neutral`, `greenIndex.renewable`, `greenIndex.fully-renewable`

Generate the `.xcstrings` JSON with all 28 locales. Each string key maps to `localizations` with per-locale `stringUnit` values.

Write the file to `Sources/PoolwattIOS/Resources/Localizable.xcstrings`.

- [ ] **Step 2: Build to verify**

Run: `~/bin/mac-ios --lane build_sim`
Expected: BUILD SUCCEEDED (Xcode picks up the xcstrings catalog)

- [ ] **Step 3: Commit**

```bash
ssh -p 2222 aleksandrswiss@localhost "cd /Users/aleksandrswiss/poolwatt-ios && git add -A && git commit -m 'feat(i18n): add Localizable.xcstrings with 28 locales'"
```

---

### Task 11: Final Integration Test & Release

- [ ] **Step 1: Run full build_sim**

Run: `~/bin/mac-ios --lane build_sim`
Expected: All tests pass (PoolwattIOSTests, FormatterTests, MockDataTests, HomeViewModelTests), BUILD SUCCEEDED

- [ ] **Step 2: Push to TestFlight**

Run: `~/bin/mac-ios --lane release_testflight`
Expected: EXIT_CODE=0, build uploaded to TestFlight

- [ ] **Step 3: Commit plan and spec updates on this server**

```bash
git add docs/superpowers/plans/2026-05-25-ios-main-screen.md
git commit -m "docs: iOS main screen implementation plan"
```

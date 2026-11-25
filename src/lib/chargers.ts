export type ConnectorType =
  | "CCS2"
  | "CHAdeMO"
  | "Type2"
  | "Type1"
  | "Tesla"
  | "GB/T"
  | "Schuko";

export type ChargerStatus =
  | "operational"
  | "planned"
  | "temporarily_unavailable"
  | "removed";

export type UsageType =
  | "public"
  | "membership"
  | "private"
  | "pay_at_location";

export type PowerLevel = "ac_slow" | "ac_fast" | "dc_fast" | "dc_ultra";

/**
 * §27 "свободен, занят, не работает". Only a Poolwatt point reports this;
 * an OpenStreetMap node has no idea, and says so.
 */
export type ConnectorAvailability =
  | "FREE"
  | "BUSY"
  | "OUT_OF_SERVICE"
  | "BOOKED"
  | "UNKNOWN";

export type Connection = {
  connectorType: ConnectorType;
  powerKw: number;
  voltageV: number | null;
  ampereA: number | null;
  currentType: "AC" | "DC";
  quantity: number;
  availability?: ConnectorAvailability;
};

export type OperatorInfo = {
  website: string;
  phone: string;
  email: string;
  app?: string;
  appStoreUrl?: string;
  playStoreUrl?: string;
};

export type ChargerStation = {
  id: string;
  title: string;
  operator: string;
  address: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  status: ChargerStatus;
  usageType: UsageType;
  connections: Connection[];
  totalPoints: number;
  maxPowerKw: number;
  powerLevel: PowerLevel;
  costInfo: string | null;
  openHours: string | null;
  rating: number | null;
  lastVerified: string | null;
  photoUrl: string | null;
  operatorInfo?: OperatorInfo;
  renewable?: boolean;
  // Operator-published price (Step 2): set when a verified ChargerOperator
  // has a current tariff matching this station's `operator` string. Takes
  // precedence over OCM `costInfo` because it's authoritative + real-time.
  operatorPrice?: { pricePerKwh: string; currency: string; updatedAt: string } | null;
  /**
   * Set on a point that lives in our own database (§28): it has an owner, a
   * moderated card and live occupancy, none of which an OSM node has.
   */
  poolwattPointId?: string;
  /**
   * §41 — the banner the point's network is currently showing in the
   * navigator's mini-card, if any. The id of the file, not its bytes: the
   * media route decides who may fetch it.
   */
  bannerAssetId?: string | null;
  priceTokens?: number | null;
  howToFind?: string | null;
};

export function classifyPower(kw: number): PowerLevel {
  if (kw <= 7) return "ac_slow";
  if (kw <= 22) return "ac_fast";
  if (kw <= 100) return "dc_fast";
  return "dc_ultra";
}

export function powerLevelLabel(level: PowerLevel): string {
  switch (level) {
    case "ac_slow":
      return "AC ≤ 7 kW";
    case "ac_fast":
      return "AC ≤ 22 kW";
    case "dc_fast":
      return "DC ≤ 100 kW";
    case "dc_ultra":
      return "DC 150+ kW";
  }
}

const OCM_CONNECTOR_MAP: Record<number, ConnectorType> = {
  1: "Type1",
  2: "CHAdeMO",
  3: "Schuko",
  25: "Type2",
  27: "Tesla",
  32: "CCS2",
  33: "CCS2",
};

export function mapOcmConnector(typeId: number | undefined): ConnectorType {
  if (!typeId) return "Type2";
  return OCM_CONNECTOR_MAP[typeId] ?? "Type2";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function ocmToCharger(poi: any): ChargerStation {
  const addr = poi.AddressInfo ?? {};
  const connections: Connection[] = (poi.Connections ?? []).map((c: any) => ({
    connectorType: mapOcmConnector(c.ConnectionTypeID),
    powerKw: c.PowerKW ?? 0,
    voltageV: c.Voltage ?? null,
    ampereA: c.Amps ?? null,
    currentType: c.CurrentTypeID === 30 ? "DC" : "AC",
    quantity: c.Quantity ?? 1,
  }));

  const maxPowerKw = Math.max(...connections.map((c) => c.powerKw), 0);
  const totalPoints = connections.reduce((s, c) => s + c.quantity, 0);

  const statusId = poi.StatusTypeID ?? poi.StatusType?.ID;
  let status: ChargerStatus = "operational";
  if (statusId === 0 || statusId === 210) status = "removed";
  else if (statusId === 150 || statusId === 75) status = "planned";
  else if (statusId === 100) status = "temporarily_unavailable";

  const usageId = poi.UsageTypeID ?? poi.UsageType?.ID;
  let usageType: UsageType = "public";
  if (usageId === 2 || usageId === 6) usageType = "private";
  else if (usageId === 4) usageType = "membership";
  else if (usageId === 5) usageType = "pay_at_location";

  return {
    id: String(poi.ID),
    title: addr.Title || "Charging Station",
    operator:
      poi.OperatorInfo?.Title ?? poi.OperatorInfo?.WebsiteURL ?? "Unknown",
    address: [addr.AddressLine1, addr.AddressLine2].filter(Boolean).join(", "),
    city: addr.Town ?? "",
    country: addr.Country?.ISOCode ?? "",
    lat: addr.Latitude,
    lng: addr.Longitude,
    status,
    usageType,
    connections,
    totalPoints: totalPoints || 1,
    maxPowerKw,
    powerLevel: classifyPower(maxPowerKw),
    costInfo: poi.UsageCost ?? null,
    openHours: addr.AccessComments ?? null,
    rating: poi.GeneralComments ? null : null,
    lastVerified: poi.DateLastVerified ?? poi.DateLastStatusUpdate ?? null,
    photoUrl: poi.MediaItems?.[0]?.ItemURL ?? null,
  };
}

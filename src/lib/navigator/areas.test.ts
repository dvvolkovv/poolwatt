import { describe, it, expect } from "vitest";
import {
  bboxAround,
  COUNTRY_BOXES,
  countryCentre,
  countryName,
  distanceKm,
  formatDistance,
} from "./areas";

describe("distanceKm", () => {
  it("ноль до самой себя", () => {
    expect(distanceKm({ lat: 48.15, lng: 17.1 }, { lat: 48.15, lng: 17.1 })).toBe(0);
  });

  it("Братислава — Вена это около 55 километров", () => {
    const d = distanceKm({ lat: 48.1486, lng: 17.1077 }, { lat: 48.2082, lng: 16.3738 });
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(60);
  });

  it("Вильнюс — Каунас это около 90 километров", () => {
    const d = distanceKm({ lat: 54.6872, lng: 25.2797 }, { lat: 54.8985, lng: 23.9036 });
    expect(d).toBeGreaterThan(85);
    expect(d).toBeLessThan(95);
  });
});

describe("bboxAround", () => {
  it("рамка накрывает точку", () => {
    const centre = { lat: 48.15, lng: 17.1 };
    const box = bboxAround(centre, 25);
    expect(box.south).toBeLessThan(centre.lat);
    expect(box.north).toBeGreaterThan(centre.lat);
    expect(box.west).toBeLessThan(centre.lng);
    expect(box.east).toBeGreaterThan(centre.lng);
  });

  it("радиус 25 км даёт примерно полградуса по широте", () => {
    const box = bboxAround({ lat: 48.15, lng: 17.1 }, 25);
    expect(box.north - box.south).toBeCloseTo(0.449, 2);
  });

  it("у полюса рамка по долготе не уходит в бесконечность", () => {
    const box = bboxAround({ lat: 89.9, lng: 0 }, 25);
    expect(Number.isFinite(box.east)).toBe(true);
    expect(box.east - box.west).toBeLessThan(360);
  });
});

describe("страны", () => {
  it("у каждой страны списка есть рамка, и она не вывернута", () => {
    for (const [code, box] of Object.entries(COUNTRY_BOXES)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(box.north).toBeGreaterThan(box.south);
      expect(box.east).toBeGreaterThan(box.west);
    }
  });

  it("рамка Словакии накрывает Братиславу", () => {
    const sk = COUNTRY_BOXES.SK;
    expect(48.1486).toBeGreaterThan(sk.south);
    expect(48.1486).toBeLessThan(sk.north);
    expect(17.1077).toBeGreaterThan(sk.west);
    expect(17.1077).toBeLessThan(sk.east);
  });

  it("рамка Литвы накрывает Вильнюс", () => {
    const lt = COUNTRY_BOXES.LT;
    expect(54.6872).toBeGreaterThan(lt.south);
    expect(54.6872).toBeLessThan(lt.north);
    expect(25.2797).toBeGreaterThan(lt.west);
    expect(25.2797).toBeLessThan(lt.east);
  });

  it("центр страны лежит внутри её рамки", () => {
    const centre = countryCentre("SK")!;
    expect(centre.lat).toBeGreaterThan(COUNTRY_BOXES.SK.south);
    expect(centre.lat).toBeLessThan(COUNTRY_BOXES.SK.north);
  });

  it("у незнакомой страны центра нет", () => {
    expect(countryCentre("ZZ")).toBeNull();
  });

  it("название приходит на языке страницы", () => {
    expect(countryName("SK", "ru")).toBe("Словакия");
    expect(countryName("SK", "en")).toBe("Slovakia");
  });

  it("неизвестный код не роняет страницу", () => {
    expect(countryName("ZZ", "ru")).toBeTruthy();
  });
});

describe("formatDistance", () => {
  it("меньше километра — в метрах", () => {
    expect(formatDistance(0.8)).toBe("800 m");
  });

  it("единицы километров — с десятой", () => {
    expect(formatDistance(4.25)).toBe("4.3 km");
  });

  it("десятки километров — целыми", () => {
    expect(formatDistance(41.7)).toBe("42 km");
  });
});

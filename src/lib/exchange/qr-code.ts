// Что зашито в QR на разъёме — §22.9, US-20 «старт по QR».
//
// Два вида кода, потому что наклейку печатаем мы, а камеру держит кто угодно:
// компактный `PW1:<pointId>:<connectorId>` и обычный адрес с теми же `p` и
// `c`. Чужой код не угадывается — водителю честно говорят, что это не наш QR,
// а не ведут на пустой расчёт.

export interface ConnectorCode {
  pointId: string;
  connectorId: string | null;
}

/** cuid — буквы, цифры, дефис и подчёркивание; длиннее 40 у нас не бывает. */
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export const CODE_PREFIX = "PW1";

export function buildConnectorCode(pointId: string, connectorId?: string | null): string {
  return connectorId
    ? `${CODE_PREFIX}:${pointId}:${connectorId}`
    : `${CODE_PREFIX}:${pointId}`;
}

export function parseConnectorCode(raw: string | null | undefined): ConnectorCode | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  if (text.toUpperCase().startsWith(`${CODE_PREFIX}:`)) {
    const parts = text.split(":");
    if (parts.length > 3) return null;
    return valid(parts[1] ?? null, parts[2] ?? null);
  }

  // Адрес: берём только `p` и `c`, путь не проверяем — наклейки печатаются под
  // разные локали, и ломать наклейку из-за `/ru/` в пути нельзя.
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return valid(url.searchParams.get("p"), url.searchParams.get("c"));
  } catch {
    return null;
  }
}

function valid(pointId: string | null, connectorId: string | null): ConnectorCode | null {
  if (!pointId || !ID.test(pointId)) return null;
  if (connectorId && !ID.test(connectorId)) return null;
  return { pointId, connectorId: connectorId || null };
}

// §22.8 — QR на получение перевода. Внутри ник, и ничего больше: получателя
// в переводе и так называют ником, секрета в нём нет. Поэтому этот код можно
// нарисовать без сети и показать кому угодно.

export const USER_PREFIX = "PWX";

/** Ник: буквы, цифры, точка, дефис, подчёркивание; 3…30 знаков. */
const USERNAME = /^[A-Za-z0-9._-]{3,30}$/;

export function buildUserCode(username: string): string {
  return `${USER_PREFIX}:${username}`;
}

export function parseUserCode(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  if (text.toUpperCase().startsWith(`${USER_PREFIX}:`)) {
    const nick = text.slice(USER_PREFIX.length + 1).trim();
    return USERNAME.test(nick) ? nick.toLowerCase() : null;
  }

  // Адрес с ником в параметре — так ссылку можно отправить в переписке.
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const nick = url.searchParams.get("u")?.trim() ?? "";
    return USERNAME.test(nick) ? nick.toLowerCase() : null;
  } catch {
    // Не адрес и не наш код — может быть просто ник, набранный руками.
    return USERNAME.test(text) ? text.toLowerCase() : null;
  }
}

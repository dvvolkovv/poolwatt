// Кто мы для WebAuthn.
//
// `rpId` — это домен, к которому ключ привязан навсегда: поменяешь его, и все
// привязанные устройства перестанут подходить. Поэтому он берётся из
// `NEXTAUTH_URL` — из того же места, откуда Auth.js берёт адрес обратного
// вызова, — а не пишется руками в двух файлах.
//
// Источников несколько, потому что оболочка Capacitor открывает живой сайт,
// но на iOS подставляет свою схему: `capacitor://localhost`. Подпись,
// пришедшая с чужого источника, не принимается.

export interface RelyingParty {
  rpId: string;
  rpName: string;
  origins: string[];
}

export function relyingParty(env: Record<string, string | undefined> = process.env): RelyingParty {
  const base = env.NEXTAUTH_URL?.trim() || "http://localhost:3000";
  let host = "localhost";
  try {
    host = new URL(base).hostname;
  } catch {
    // Кривой NEXTAUTH_URL — отдельная беда; WebAuthn от неё падать не должен.
  }

  const origins = [base.replace(/\/$/, "")];
  // Оболочки: iOS открывает страницу по своей схеме, Android — по https,
  // поэтому для него ничего добавлять не нужно.
  origins.push("capacitor://localhost");
  if (host === "localhost") origins.push("http://localhost:3000");

  return { rpId: host, rpName: "Poolwatt", origins };
}

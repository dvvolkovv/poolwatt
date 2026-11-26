"use client";

// §22.8 — QR на получение перевода, и §25 «офлайн».
//
// Код рисуется в браузере, а ник лежит в `localStorage`, поэтому экран
// офлайна показывает этот же QR без сети. Ника достаточно: получателя в
// переводе и так называют ником, секрета в нём нет — в отличие от баланса,
// который из кэша показывать нельзя.

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { buildUserCode } from "@/lib/exchange/qr-code";

export const NICK_CACHE_KEY = "poolwatt.myNick";

export function ReceiveQr({
  username,
  labels,
}: {
  /** null — взять ник из кэша: так рисует экран офлайна. */
  username: string | null;
  labels: { myQr: string; myQrHint: string };
}) {
  const [view, setView] = useState<{ code: string; svg: string } | null>(null);

  useEffect(() => {
    let alive = true;

    let nick = username;
    if (nick) {
      try {
        window.localStorage.setItem(NICK_CACHE_KEY, nick);
      } catch {
        // Приватный режим или старый WebView — QR просто не переживёт сеть.
      }
    } else {
      try {
        nick = window.localStorage.getItem(NICK_CACHE_KEY);
      } catch {
        nick = null;
      }
    }
    if (!nick) return;

    const code = buildUserCode(nick);
    QRCode.toString(code, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((svg) => {
        // qrcode отдаёт пролог XML; внутри HTML его быть не должно.
        if (alive) setView({ code, svg: svg.replace(/<\?xml[^>]*\?>\s*/, "") });
      })
      .catch(() => undefined);

    return () => {
      alive = false;
    };
  }, [username]);

  if (!view) return null;

  return (
    <section className="mt-4" data-testid="receive-qr">
      <h2 className="text-[12px] uppercase tracking-[0.16em] text-muted">{labels.myQr}</h2>
      <div className="mt-2 flex items-center gap-4 rounded-lg border border-hairline bg-card px-3 py-3">
        <div
          className="h-28 w-28 shrink-0 rounded bg-white p-1.5 [&>svg]:h-full [&>svg]:w-full"
          // Разметка от `qrcode`: это SVG, который мы сами и сгенерировали.
          dangerouslySetInnerHTML={{ __html: view.svg }}
        />
        <div className="min-w-0">
          <p className="num break-all text-[15px]" data-testid="receive-code">
            {view.code}
          </p>
          <p className="mt-1 text-[12px] leading-snug text-muted">{labels.myQrHint}</p>
        </div>
      </div>
    </section>
  );
}

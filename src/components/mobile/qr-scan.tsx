"use client";

// §22.9, US-20 «старт по QR». Камера через getUserMedia и разбор кадра
// `jsqr` — без нативного плагина, поэтому одинаково работает в оболочке
// Capacitor на обеих платформах и в обычном браузере.
//
// Ручной ввод кода — не костыль: у станции бывает темно, наклейка бывает
// мутной, а код под QR напечатан словами. Он же единственный путь на
// устройстве без камеры.

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { parseConnectorCode, type ConnectorCode } from "@/lib/exchange/qr-code";

export type QrScanLabels = {
  scan: string;
  scanning: string;
  manual: string;
  manualHint: string;
  submit: string;
  denied: string;
  notOurs: string;
};

/**
 * Сканер общий по виду кода: на зарядке он читает разъём, на переводе — ник
 * получателя. Разбор приходит снаружи, потому что «это не код Poolwatt»
 * зависит от того, какой код здесь ждут.
 */
export function QrScan<T>({
  labels,
  onCode,
  parse = parseConnectorCode as unknown as (raw: string) => T | null,
}: {
  labels: QrScanLabels;
  onCode: (code: T) => void;
  parse?: (raw: string) => T | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  // Обработчик держим в ref: иначе новый рендер родителя снимает камеру и
  // поднимает её заново, а это секунда черноты на каждый кадр состояния.
  const handler = useRef(onCode);
  useEffect(() => {
    handler.current = onCode;
  }, [onCode]);
  const parser = useRef(parse);
  useEffect(() => {
    parser.current = parse;
  }, [parse]);

  useEffect(() => {
    if (!scanning) return;

    let stream: MediaStream | null = null;
    let frame: number | null = null;
    let stopped = false;
    const canvas = document.createElement("canvas");

    function tick() {
      if (stopped) return;
      const video = videoRef.current;
      if (!video || video.readyState < video.HAVE_CURRENT_DATA) {
        frame = requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx || canvas.width === 0) {
        frame = requestAnimationFrame(tick);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(image.data, image.width, image.height);
      if (found) {
        const parsed = parser.current(found.data);
        if (parsed) {
          stopped = true;
          setScanning(false);
          handler.current(parsed);
          return;
        }
        // Чужой QR не ошибка камеры: говорим и продолжаем искать.
        setError(labels.notOurs);
      }
      frame = requestAnimationFrame(tick);
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        tick();
      } catch {
        setError(labels.denied);
        setScanning(false);
      }
    })();

    return () => {
      stopped = true;
      if (frame != null) cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning, labels.denied, labels.notOurs]);

  const submitManual = useCallback(() => {
    const parsed = parser.current(manual);
    if (!parsed) {
      setError(labels.notOurs);
      return;
    }
    setError(null);
    handler.current(parsed);
  }, [manual, labels.notOurs]);

  return (
    <div data-testid="qr-scan">
      {scanning ? (
        <div className="relative">
          <video
            ref={videoRef}
            playsInline
            muted
            className="aspect-square w-full rounded-lg bg-black object-cover"
          />
          <span className="absolute inset-x-0 bottom-2 text-center text-[13px] text-muted">
            {labels.scanning}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setScanning(true);
          }}
          className="w-full rounded-lg bg-accent px-4 py-4 text-[16px] font-medium text-accent-foreground"
          data-testid="qr-start"
        >
          {labels.scan}
        </button>
      )}

      <div className="mt-5">
        <label
          className="text-[12px] uppercase tracking-[0.16em] text-muted"
          htmlFor="qr-manual"
        >
          {labels.manual}
        </label>
        <p className="mt-1 text-[12px] text-muted">{labels.manualHint}</p>
        <div className="mt-2 flex gap-2">
          <input
            id="qr-manual"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-hairline bg-card px-3 py-3 text-[15px]"
            data-testid="qr-manual"
          />
          <button
            type="button"
            onClick={submitManual}
            className="rounded-lg border border-hairline px-4 py-3 text-[15px]"
            data-testid="qr-manual-submit"
          >
            {labels.submit}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-[13px] text-down" data-testid="qr-error">
          {error}
        </p>
      )}
    </div>
  );
}

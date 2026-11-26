"use client";

// §28 «Адрес и карта: … фото до 10 шт.», §29.1 — фотографии просятся на шаге
// «адрес», и там они и живут. Черновик пункта существует до первого
// заполненного поля (§29.2), поэтому загружать можно сразу.

import { useEffect, useRef, useState } from "react";

type Photo = { id: string; url: string };

export function PhotoUploader({
  pointId,
  labels,
}: {
  pointId: string;
  labels: {
    photos: string;
    add: string;
    remove: string;
    counter: string;
    hint: string;
  };
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [max, setMax] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/points/${pointId}/photos`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        setPhotos(data.photos ?? []);
        if (typeof data.max === "number") setMax(data.max);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pointId]);

  async function upload(files: FileList) {
    setBusy(true);
    setError(null);
    for (const file of Array.from(files)) {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch(`/api/v1/points/${pointId}/photos`, { method: "POST", body });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Could not upload");
        break;
      }
      const data = (await res.json()) as { photoId: string; url: string };
      setPhotos((cur) => [...cur, { id: data.photoId, url: data.url }]);
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function remove(photoId: string) {
    const res = await fetch(`/api/v1/points/${pointId}/photos/${photoId}`, {
      method: "DELETE",
    });
    if (res.ok) setPhotos((cur) => cur.filter((p) => p.id !== photoId));
  }

  const full = photos.length >= max;

  return (
    <div data-testid="photo-uploader">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-[0.18em] text-muted">
          {labels.photos}
        </span>
        <span className="num text-[11px] text-muted" data-testid="photo-counter">
          {photos.length} / {max}
        </span>
      </div>

      {photos.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {photos.map((p) => (
            <li key={p.id} className="relative">
              {/* Фотографию отдаёт маршрут, а не /public: карточка может быть
                  закрытой. Поэтому обычный img, а не next/image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt=""
                className="h-20 w-20 rounded-lg border border-hairline object-cover"
              />
              <button
                type="button"
                onClick={() => remove(p.id)}
                aria-label={labels.remove}
                className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full border border-hairline bg-card text-[12px] leading-none text-muted"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        disabled={busy || full}
        aria-label={labels.add}
        data-testid="photo-input"
        onChange={(e) => e.target.files && e.target.files.length > 0 && upload(e.target.files)}
        className="block w-full text-[13px] text-muted file:mr-3 file:rounded-full file:border file:border-hairline file:bg-card-alt file:px-4 file:py-2 file:text-[12px] file:uppercase file:tracking-[0.16em]"
      />
      <p className="mt-1 text-[11px] text-muted">{labels.hint}</p>
      {error && (
        <p className="mt-1 text-[12px] text-down" data-testid="photo-error">
          {error}
        </p>
      )}
    </div>
  );
}

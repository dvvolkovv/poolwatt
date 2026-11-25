"use client";

// US-40 — "загрузка, предпросмотр, отправка на модерацию". The form posts to
// POST /v1/partners/{id}/content so that the browser and an outside caller
// are checked by one piece of code. The preview is local: the browser shows
// the chosen file before it is anywhere near the server.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const TYPES = ["BANNER", "VIDEO", "GALLERY", "PROMO", "NEWS", "LINK"] as const;
const PLACEMENTS = ["FULL_CARD", "NAVIGATOR_MINI", "CHARGE_COMPLETE"] as const;
const AUDIENCES = ["ALL", "NEWCOMERS", "REGULARS", "COOP_MEMBERS"] as const;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

type ContentType = (typeof TYPES)[number];

export interface ContentFormLabels {
  type: string;
  title: string;
  body: string;
  linkUrl: string;
  files: string;
  filesHintImage: string;
  filesHintVideo: string;
  placements: string;
  audience: string;
  points: string;
  pointsAll: string;
  schedule: string;
  from: string;
  to: string;
  weekdays: string;
  hours: string;
  hoursUtc: string;
  preview: string;
  save: string;
  saveAndSubmit: string;
  types: Record<string, string>;
  placementNames: Record<string, string>;
  audienceNames: Record<string, string>;
  weekdayNames: Record<string, string>;
}

const takesVideo = (type: ContentType) => type === "VIDEO";
const takesText = (type: ContentType) => type === "PROMO" || type === "NEWS";
const takesLink = (type: ContentType) => type === "LINK";
const maxFiles = (type: ContentType) => (type === "GALLERY" ? 10 : 1);

export function ContentForm({
  operatorId,
  points,
  labels,
}: {
  operatorId: string;
  points: { id: string; name: string }[];
  labels: ContentFormLabels;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<ContentType>("BANNER");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [placements, setPlacements] = useState<string[]>(["FULL_CARD"]);
  const [audience, setAudience] = useState<string>("ALL");
  const [pointIds, setPointIds] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [hourFrom, setHourFrom] = useState("");
  const [hourTo, setHourTo] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (list: string[], value: string, set: (v: string[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  function send(submit: boolean) {
    setError(null);
    const form = new FormData();
    form.set(
      "content",
      JSON.stringify({
        type,
        title: title.trim(),
        body: takesText(type) ? body.trim() || null : null,
        linkUrl: takesLink(type) || linkUrl.trim() ? linkUrl.trim() || null : null,
        placements,
        audience,
        pointIds,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        weekdays,
        hourFrom: hourFrom === "" ? null : Number(hourFrom),
        hourTo: hourTo === "" ? null : Number(hourTo),
        submit,
      }),
    );
    for (const f of files) form.append("files", f);

    startTransition(async () => {
      const res = await fetch(`/api/v1/partners/${operatorId}/content`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? `Upload failed (${res.status})`);
        return;
      }
      setTitle("");
      setBody("");
      setLinkUrl("");
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    });
  }

  const previews = files.map((f) => ({ file: f, url: URL.createObjectURL(f) }));

  return (
    <form
      className="space-y-4"
      data-testid="content-form"
      onSubmit={(e) => {
        e.preventDefault();
        send(false);
      }}
    >
      <div className="flex flex-wrap gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.type}
          </span>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as ContentType);
              setFiles([]);
              if (fileInput.current) fileInput.current.value = "";
            }}
            aria-label={labels.type}
            className="rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          >
            {TYPES.map((v) => (
              <option key={v} value={v}>
                {labels.types[v]}
              </option>
            ))}
          </select>
        </label>

        <label className="block grow text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.title}
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label={labels.title}
            className="w-full rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          />
        </label>
      </div>

      {takesText(type) && (
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.body}
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            aria-label={labels.body}
            className="w-full rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          />
        </label>
      )}

      <label className="block text-sm">
        <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
          {labels.linkUrl}
        </span>
        <input
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="https://"
          aria-label={labels.linkUrl}
          className="w-full rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
        />
      </label>

      {type !== "LINK" && type !== "NEWS" && type !== "PROMO" && (
        <div>
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.files}
          </span>
          <input
            ref={fileInput}
            type="file"
            multiple={maxFiles(type) > 1}
            accept={takesVideo(type) ? "video/mp4" : "image/jpeg,image/png,image/webp"}
            aria-label={labels.files}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, maxFiles(type)))}
            className="text-sm"
          />
          <p className="mt-1 text-[12px] text-muted">
            {takesVideo(type) ? labels.filesHintVideo : labels.filesHintImage}
          </p>

          {previews.length > 0 && (
            <div className="mt-3">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
                {labels.preview}
              </span>
              <div className="flex flex-wrap gap-2" data-testid="content-preview">
                {previews.map((p) =>
                  p.file.type.startsWith("video/") ? (
                    <video
                      key={p.url}
                      src={p.url}
                      controls
                      className="h-28 rounded border border-hairline"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={p.url}
                      src={p.url}
                      alt={p.file.name}
                      className="h-28 rounded border border-hairline object-cover"
                    />
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <fieldset>
        <legend className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted">
          {labels.placements}
        </legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {PLACEMENTS.map((p) => (
            <label key={p} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={placements.includes(p)}
                onChange={() => toggle(placements, p, setPlacements)}
              />
              {labels.placementNames[p]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.audience}
          </span>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            aria-label={labels.audience}
            className="rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          >
            {AUDIENCES.map((v) => (
              <option key={v} value={v}>
                {labels.audienceNames[v]}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.points}
          </span>
          <select
            multiple
            value={pointIds}
            onChange={(e) =>
              setPointIds(Array.from(e.target.selectedOptions).map((o) => o.value))
            }
            aria-label={labels.points}
            className="min-w-[220px] rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          >
            {points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[12px] text-muted">{labels.pointsAll}</span>
        </label>
      </div>

      <fieldset>
        <legend className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted">
          {labels.schedule}
        </legend>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">{labels.from}</span>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              aria-label={labels.from}
              className="rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">{labels.to}</span>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              aria-label={labels.to}
              className="rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">{labels.hours}</span>
            <span className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={23}
                value={hourFrom}
                onChange={(e) => setHourFrom(e.target.value)}
                aria-label={`${labels.hours} ${labels.from}`}
                className="num w-16 rounded border border-hairline bg-bg px-2 py-1.5 text-sm"
              />
              <span className="text-muted">—</span>
              <input
                type="number"
                min={0}
                max={23}
                value={hourTo}
                onChange={(e) => setHourTo(e.target.value)}
                aria-label={`${labels.hours} ${labels.to}`}
                className="num w-16 rounded border border-hairline bg-bg px-2 py-1.5 text-sm"
              />
            </span>
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <span className="text-[12px] text-muted">{labels.weekdays}:</span>
          {WEEKDAYS.map((d) => (
            <label key={d} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={weekdays.includes(d)}
                onChange={() =>
                  setWeekdays(
                    weekdays.includes(d) ? weekdays.filter((v) => v !== d) : [...weekdays, d],
                  )
                }
              />
              {labels.weekdayNames[String(d)]}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[12px] text-muted">{labels.hoursUtc}</p>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || title.trim().length === 0}
          className="rounded border border-hairline px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-50"
        >
          {labels.save}
        </button>
        <button
          type="button"
          disabled={pending || title.trim().length === 0}
          onClick={() => send(true)}
          className="rounded border border-accent px-3 py-1.5 text-[13px] text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          {labels.saveAndSubmit}
        </button>
      </div>

      {error && (
        <p className="text-[13px] text-down" data-testid="content-error">
          {error}
        </p>
      )}
    </form>
  );
}

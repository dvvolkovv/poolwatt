// §41 — how a piece of partner content renders. One component for the three
// places it appears in: a full point card, the navigator's mini-card and the
// screen a driver sees when a charge ends.

import type { ContentForDisplay } from "@/lib/marketing/visibility";

function mediaUrl(assetId: string): string {
  return `/api/v1/marketing/media/${assetId}`;
}

export function ContentBlock({ content }: { content: ContentForDisplay }) {
  const images = content.assets.filter((a) => a.contentType.startsWith("image/"));
  const video = content.assets.find((a) => a.contentType.startsWith("video/"));

  return (
    <article className="space-y-2" data-testid={`marketing-${content.type.toLowerCase()}`}>
      {content.type !== "BANNER" && (
        <h3 className="text-[15px] font-semibold">{content.title}</h3>
      )}

      {video && (
        <video
          src={mediaUrl(video.id)}
          controls
          preload="metadata"
          className="w-full rounded border border-hairline"
        />
      )}

      {images.length > 0 && (
        <div className={images.length === 1 ? "" : "grid grid-cols-2 gap-2 md:grid-cols-3"}>
          {images.map((a) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={a.id}
              src={mediaUrl(a.id)}
              alt={content.title}
              className="w-full rounded border border-hairline object-cover"
            />
          ))}
        </div>
      )}

      {content.body && (
        <p className="whitespace-pre-line text-[14px] text-muted">{content.body}</p>
      )}

      {content.linkUrl && (
        <p className="text-[13px]">
          <a
            href={content.linkUrl}
            target="_blank"
            // A partner's own site: no referrer, no endorsement.
            rel="noreferrer noopener nofollow"
            className="underline hover:text-accent"
          >
            {content.title}
          </a>
        </p>
      )}
    </article>
  );
}

export function ContentSection({
  contents,
  heading,
}: {
  contents: ContentForDisplay[];
  heading: string;
}) {
  if (contents.length === 0) return null;
  return (
    <section className="mb-10" data-testid="marketing-section">
      <h2 className="mb-3 text-[11px] uppercase tracking-[0.18em] text-muted">{heading}</h2>
      <div className="space-y-6">
        {contents.map((c) => (
          <ContentBlock key={c.id} content={c} />
        ))}
      </div>
    </section>
  );
}

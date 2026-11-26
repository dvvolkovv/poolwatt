"use client";

// §27 «отзывы». Форму видит только тот, у кого есть право: он здесь
// заряжался или его бронь была исполнена. Остальным одна строка, почему
// формы нет, — молчать об этом хуже, чем сказать.

import { useState, useTransition } from "react";

export function ReviewForm({
  pointId,
  mine,
  labels,
  submit,
}: {
  pointId: string;
  mine: { rating: number; text: string | null } | null;
  labels: {
    myReview: string;
    rating: string;
    reviewText: string;
    send: string;
    sending: string;
    saved: string;
  };
  submit: (input: {
    pointId: string;
    rating: number;
    text: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [text, setText] = useState(mine?.text ?? "");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    setError(null);
    setDone(false);
    start(async () => {
      const result = await submit({ pointId, rating, text });
      if (result.ok) setDone(true);
      else setError(result.error ?? "Could not save");
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-hairline bg-card px-3 py-3" data-testid="review-form">
      <div className="text-[12px] uppercase tracking-[0.16em] text-muted">
        {labels.myReview}
      </div>

      <div className="mt-2 flex items-center gap-1" aria-label={labels.rating}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setRating(star)}
            aria-label={`${labels.rating} ${star}`}
            data-testid={`review-star-${star}`}
            className={`px-1 text-[26px] leading-none ${
              star <= rating ? "text-accent" : "text-muted"
            }`}
          >
            ★
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder={labels.reviewText}
        aria-label={labels.reviewText}
        data-testid="review-text"
        className="mt-2 w-full rounded-lg border border-hairline bg-card-alt px-3 py-2 text-[14px]"
      />

      <button
        type="button"
        onClick={send}
        disabled={pending || rating < 1}
        data-testid="review-send"
        className="mt-2 w-full rounded-full bg-accent py-3 text-[13px] font-semibold uppercase tracking-[0.18em] text-accent-foreground disabled:opacity-50"
      >
        {pending ? labels.sending : labels.send}
      </button>

      {done && (
        <p className="mt-2 text-[13px] text-up" data-testid="review-saved">
          {labels.saved}
        </p>
      )}
      {error && (
        <p className="mt-2 text-[13px] text-down" data-testid="review-error">
          {error}
        </p>
      )}
    </div>
  );
}

"use client";

// Системное приглашение «добавить на экран». Браузер даёт событие
// `beforeinstallprompt` только когда установка действительно возможна —
// Chrome на Android и на мониторе. Safari такого события не даёт вовсе,
// поэтому кнопки там не будет, и рядом на странице стоят шаги вручную.
//
// Кнопка не рисуется, пока приглашения нет: кнопка, которая ничего не делает,
// хуже её отсутствия.

import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallButton({ label }: { label: string }) {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // Поставили — приглашение больше не нужно.
    const onInstalled = () => setPrompt(null);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!prompt) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        await prompt.prompt();
        await prompt.userChoice;
        // Приглашение одноразовое: второй раз его вызвать нельзя.
        setPrompt(null);
      }}
      className="inline-flex min-h-[44px] items-center px-5 rounded-full font-semibold text-[13px] uppercase tracking-[0.16em] bg-accent text-accent-foreground glow-accent transition-all hover:brightness-110"
    >
      {label}
    </button>
  );
}

import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

import OpenAI from "openai";
import { writeFileSync } from "fs";

const report = `
Рекомендация по почтовой системе для Poolwatt.

Рекомендую использовать Resend — транзакционный API для отправки писем. Вот почему.

Первое. В проекте уже заложены переменные RESEND API KEY и RESEND FROM EMAIL. Проект изначально на это рассчитан.

Второе. Resend отлично работает с Next.js и поддерживает React Email — шаблоны писем пишутся как React-компоненты, с типизацией и переиспользованием.

Третье. Доставляемость из коробки. SPF и DKIM настраиваются одной DNS-записью. Не нужно следить за IP-репутацией.

Четвёртое. Бесплатный тариф — три тысячи писем в месяц. Этого более чем хватит на Фазу два.

Пятое. Никакой нагрузки на сервер. Ваш единственный VPS уже несёт Next.js, бот и воркер. Поднимать Postfix на нём — лишний риск и лишняя работа.

Почему не self-hosted Postfix? Один сервер, общий с приложением — дополнительная поверхность атаки. IP может попасть в спам-листы, а восстановление репутации — головная боль. Для двух задач — восстановление пароля и уведомления — это избыточно.

Для входящей почты вроде support@poolwatt.com позже можно подключить Yandex триста шестьдесят или простой форвард.

Если вы согласны — перехожу к детальному дизайну: архитектура, компоненты, шаблоны писем, интеграция с Auth.js. Конец доклада.
`.trim();

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY not set in .env.local");
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey });

  console.log("Generating audio report...");
  const res = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: report,
    response_format: "mp3",
  });

  const ab = await res.arrayBuffer();
  const outPath = "status-report.mp3";
  writeFileSync(outPath, Buffer.from(ab));
  console.log(`Audio report saved to ${outPath} (${Buffer.from(ab).length} bytes)`);
}

main();

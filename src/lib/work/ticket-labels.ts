// Подписи разговора в одном месте: четыре страницы показывают один и тот же
// чат, и расходиться словам незачем.

export interface ThreadLabelSource {
  (key: string): string;
}

export function threadLabels(t: ThreadLabelSource) {
  return {
    conversation: t("conversation"),
    placeholder: t("placeholder"),
    send: t("send"),
    sending: t("sending"),
    resolve: t("resolve"),
    closed: t("closedNote"),
    system: t("author.SYSTEM"),
    customer: t("author.CUSTOMER"),
    support: t("author.SUPPORT"),
    live: t("live"),
  };
}

// Features that stay shut until something outside the code exists: a bank that
// issues IBANs (ТЗ §19, §21), a lawyer's opinion on transfers (§24.4), a
// security token for the external price feed (§6, §16.5).

type Env = Record<string, string | undefined>;

/** The feature is not available yet; the API answers 503, not 400. */
export class FeatureClosedError extends Error {}

/**
 * §46 — a wrong *amount* on a receipt is not a wrong document, it is money the
 * driver should get back, and giving money back needs the payment provider
 * nobody has connected. Until then support can correct what a document says
 * about itself, and a claim about the amount is answered with this, not with
 * a document that says a refund happened.
 */
export function receiptRefundsOpen(env: Env = process.env): boolean {
  return env.RECEIPT_REFUNDS === "open" && env.PAYMENT_PROVIDER !== undefined;
}

export function assertReceiptRefundsOpen(): void {
  if (!receiptRefundsOpen()) {
    throw new FeatureClosedError(
      "A refund needs the payment provider, which is not connected yet: the amounts on a receipt cannot be corrected",
    );
  }
}

/**
 * IBANs are issued by the EMI. Until that integration exists the only source is
 * a local generator that invents account numbers, so it is a sandbox and never
 * runs in production: money sent to an invented IBAN is lost.
 */
export function ibansOpen(env: Env = process.env): boolean {
  return env.IBAN_PROVIDER === "sandbox" && env.NODE_ENV !== "production";
}

export function assertIbansOpen(): void {
  if (!ibansOpen()) {
    throw new FeatureClosedError("Settlement accounts are not available yet");
  }
}

/** The IBAN if it may be shown to anyone, otherwise null. */
export function publishableIban(
  iban: string | null | undefined,
  env: Env = process.env,
): string | null {
  return iban && ibansOpen(env) ? iban : null;
}

/** §24.4 — "подтвердить юридическим заключением до запуска функции". */
export function transfersOpen(env: Env = process.env): boolean {
  return env.KWH_TRANSFERS_ENABLED === "true";
}

export function assertTransfersOpen(): void {
  if (!transfersOpen()) {
    throw new FeatureClosedError("kWh transfers are not available yet");
  }
}

/**
 * §6, §16.5 — the day-ahead feed needs a security token from the ENTSO-E
 * Transparency Platform, which only the owner can obtain. Closed means zones
 * keep the price the operator set by hand; it never means "no corridor".
 */
export function spotFeedOpen(env: Env = process.env): boolean {
  return Boolean(env.ENTSOE_TOKEN?.trim());
}

export function assertSpotFeedOpen(): void {
  if (!spotFeedOpen()) {
    throw new FeatureClosedError("The external spot price feed is not configured yet");
  }
}

/**
 * §25, US-29 — push needs APNs and FCM credentials and a mobile build
 * registered with both stores. Closed means an alarm still reaches people by
 * mail and on the station console; it never means the alarm is lost.
 */
export function pushOpen(env: Env = process.env): boolean {
  return Boolean(env.APNS_KEY_ID?.trim() && env.FCM_PROJECT_ID?.trim());
}

export function assertPushOpen(): void {
  if (!pushOpen()) {
    throw new FeatureClosedError("Push notifications are not configured yet");
  }
}

/**
 * §42 "Источник финансирования: резерв с расчётного счёта партнёра или из его
 * выработки (токенов)" — and §42's "Бюджет … в деньгах".
 *
 * The money half needs the partner's settlement account, which only the EMI
 * can issue (§19), and a way to put money on it, which does not exist either
 * (US-07). A campaign funded with money we cannot hold would be a promise to
 * a driver nobody is paying for, so it stays shut. Closed never means "no
 * campaigns": a campaign funded by the partner's own generation works
 * end-to-end today.
 */
export function campaignFiatFundingOpen(env: Env = process.env): boolean {
  return env.CAMPAIGN_FIAT_FUNDING === "true";
}

export function assertCampaignFiatFundingOpen(): void {
  if (!campaignFiatFundingOpen()) {
    throw new FeatureClosedError(
      "Campaigns funded with money are not available yet; fund from your own generation",
    );
  }
}

/**
 * §53 "Карточные тарифы: выпуск и обслуживание white label карт,
 * интерчейндж."
 *
 * Interchange is not a number anybody at Poolwatt gets to choose: the card
 * scheme sets it and the EMI passes it on. Issuing and servicing fees come
 * from the same contract. Until there is one, a card tariff in this system
 * would be an invented price on a product that does not exist (§19).
 */
export function cardTariffsOpen(env: Env = process.env): boolean {
  return env.CARD_TARIFFS_ENABLED === "true";
}

export function assertCardTariffsOpen(): void {
  if (!cardTariffsOpen()) {
    throw new FeatureClosedError(
      "Card tariffs are set by the card scheme and the EMI, and there is no contract yet",
    );
  }
}

/**
 * §34 "Станция получает бронь через OCPP (ReserveNow / CancelReservation)",
 * §51 "поддержка отправляет команду через OCPP", US-20 старт по QR.
 *
 * Командовать чужой станцией можно только через мост к сети зарядок, и его
 * нет: первые сети с OCPP/OCPI — открытый вопрос к владельцу. Закрыто
 * означает, что оборудование отчитывается само — о занятости разъёмов и о
 * выданных кВт·ч, — а мы не делаем вид, что нажали кнопку на станции. Никогда
 * не означает «зарядку нельзя оплатить»: водопад §16.6 работает без моста.
 */
export function ocppOpen(env: Env = process.env): boolean {
  return Boolean(env.OCPP_BRIDGE_URL?.trim());
}

export function assertOcppOpen(env: Env = process.env): void {
  if (!ocppOpen(env)) {
    throw new FeatureClosedError("There is no bridge to a charging network yet");
  }
}

/**
 * §16.7 — "нет ликвидности на бирже — платёж исполняется через агрегатора по
 * внешней спотовой цене".
 *
 * Агрегатор — настоящая сторона с договором: кто-то продаёт нам кВт·ч вне
 * книги и отвечает за поставку. Такой стороны нет. До этого гейта расчёт уже
 * умел посчитать ступень агрегатора, а списание её не исполняло: водителю
 * показывалась цена, а потом сеанс падал с «market order could not be
 * filled». Закрыто означает, что ступени агрегатора в расчёте нет вовсе, и
 * водителю честно говорят «столько кВт·ч сейчас не из чего дать».
 */
export function aggregatorOpen(env: Env = process.env): boolean {
  return env.AGGREGATOR_FALLBACK === "true";
}

export function assertAggregatorOpen(env: Env = process.env): void {
  if (!aggregatorOpen(env)) {
    throw new FeatureClosedError("There is no aggregator to buy outside the book from");
  }
}

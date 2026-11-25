// §46 item 8 — "QR-код для проверки чека".
//
// Drawn on the server as inline SVG: a receipt has to print from a station
// terminal that may have no internet, so the code cannot be an <img> pointing
// at a generator somewhere.

import QRCode from "qrcode";

export async function qrSvg(url: string): Promise<string> {
  const svg = await QRCode.toString(url, {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
  // qrcode emits an XML prolog; inline SVG in HTML must not carry one.
  return svg.replace(/<\?xml[^>]*\?>\s*/, "");
}

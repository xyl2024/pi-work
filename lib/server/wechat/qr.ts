import QRCode from "qrcode";

export async function toDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

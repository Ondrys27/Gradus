export type Device = "mobile" | "tablet" | "desktop";
export type Browser = "chrome" | "safari" | "firefox" | "edge" | "samsung" | "opera" | "other";

/** Phone, tablet or computer from the User-Agent; only the class is kept, never the string. */
export function deviceOf(userAgent: string | null | undefined): Device {
  const ua = userAgent ?? "";
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
    return "tablet";
  }
  if (/Mobi|iPhone|iPod|Android|IEMobile|Opera Mini/i.test(ua)) return "mobile";
  return "desktop";
}

export function browserOf(userAgent: string | null | undefined): Browser {
  const ua = userAgent ?? "";
  if (/Edg(e|A|iOS)?\//.test(ua)) return "edge";
  if (/SamsungBrowser\//.test(ua)) return "samsung";
  if (/OPR\/|Opera/.test(ua)) return "opera";
  if (/Firefox\/|FxiOS\//.test(ua)) return "firefox";
  if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}

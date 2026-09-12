// AN IN-APP BROWSER CANNOT FINISH A FACEBOOK LOGIN.
//
// The connect link is sent over WhatsApp, so it opens in WhatsApp's own
// browser. Meta refuses OAuth inside embedded browsers, and on a phone with the
// Facebook app installed the dialog URL is often taken by the app instead of
// the page — either way the tab stays where it was. Measured 2026-09-12:
// Wilson tapped Connect at 10:32:01 (the server answered 200 with a valid
// authUrl), never arrived at Facebook, never came back, and his screenshot six
// minutes later still showed the button on "Opening…".
//
// A UA test cannot be exhaustive, so nothing depends on it being right: it only
// adds a line of advice. The fallback link below it works in every browser.
const PATTERNS = [
  'FBAN', 'FBAV', 'FB_IAB', 'FBIOS', 'FBDV',        // Facebook / Messenger
  'Instagram', 'Line/', 'MicroMessenger',            // Instagram, LINE, WeChat
  'WhatsApp',                                        // WhatsApp's own browser
  'GSA/',                                            // Google app
  '; wv)',                                           // Android WebView
]

export function isInAppBrowser(ua) {
  const s = String(ua || '')
  return PATTERNS.some((p) => s.toLowerCase().includes(p.toLowerCase()))
}

import { describe, it, expect } from 'vitest'
import { isInAppBrowser } from './inAppBrowser.js'

// Real user agents. The WhatsApp one is how a client opens the connect link
// Owen sends them, and it is where Facebook's login will not complete.
const UA = {
  whatsappAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/300.0.0.0;]',
  facebookIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.32.109;FBBV/6...]',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 330.0.0.40.92',
  androidWebview: 'Mozilla/5.0 (Linux; Android 12; Pixel 6 Build/SQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 Mobile Safari/537.36',
  safariIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  chromeDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

describe('isInAppBrowser', () => {
  it('spots the browsers that cannot finish a Facebook login', () => {
    expect(isInAppBrowser(UA.whatsappAndroid)).toBe(true)
    expect(isInAppBrowser(UA.facebookIOS)).toBe(true)
    expect(isInAppBrowser(UA.instagram)).toBe(true)
    expect(isInAppBrowser(UA.androidWebview)).toBe(true)
  })

  it('leaves a real browser alone — the advice must not show there', () => {
    expect(isInAppBrowser(UA.safariIOS)).toBe(false)
    expect(isInAppBrowser(UA.chromeAndroid)).toBe(false)
    expect(isInAppBrowser(UA.chromeDesktop)).toBe(false)
  })

  it('never throws on a missing or odd user agent', () => {
    expect(isInAppBrowser(undefined)).toBe(false)
    expect(isInAppBrowser('')).toBe(false)
    expect(isInAppBrowser(null)).toBe(false)
  })
})

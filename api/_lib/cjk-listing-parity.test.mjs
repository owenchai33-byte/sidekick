// THE "NO LISTING TO POST" GUARD MEASURED CHARACTERS, SO IT REFUSED CHINESE.
//
// Added 2026-09-08 to stop photos-with-no-text becoming a finished post. It
// required 60 characters of prose. The same listing — location, type, room
// count, price on request — is 91 characters in English and 22 in Chinese:
//
//     出租 古晋 公寓 两房两厅 价格面议 请私信
//
// so the English one composed and the Chinese one was refused, for no reason
// but its script. Half this market writes in Chinese, and Chinese rentals have
// already cost this codebase one silent refusal: demoParse could not read 出租,
// so every one of them was typed as a SALE and its correct caption refused.
//
// This file holds the parity, not the threshold — the number can move, but a
// listing must not pass in one script and fail in the other.
import { describe, it, expect } from 'vitest'

// The guard's own measurement, mirrored. Kept in step with api/ingest.js.
const CJK = /[　-鿿豈-﫿＀-￯]/gu
const weight = (raw) => {
  const cjk = (String(raw).match(CJK) || []).length
  return String(raw).replace(CJK, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().length + cjk * 4
}
const refused = (t) => weight(t) < 60

describe('a real listing composes in either script', () => {
  it('the same listing passes in Chinese and in English', () => {
    const zh = '出租 古晋 公寓 两房两厅 价格面议 请私信'
    const en = 'Kuching condo for rent, two bedrooms two bathrooms, price on request'
    expect(refused(zh), 'Chinese').toBe(false)
    expect(refused(en), 'English').toBe(false)
  })

  it.each([
    '出租 古晋 公寓 两房两厅 价格面议 请私信',
    '古晋 RENNA 公寓出租 全套家具 十二楼 有意请私信',
    '排屋出售 三房两厕 地点古晋 价格面议 欢迎联络',
  ])('accepts the Chinese listing: %s', (t) => { expect(refused(t)).toBe(false) })

  it.each([
    'Rumah teres untuk disewa di Kuching, tiga bilik tidur, harga boleh runding',
    'Kuching condo for rent, two bedrooms two bathrooms, price on request',
  ])('accepts the Latin-script listing: %s', (t) => { expect(refused(t)).toBe(false) })
})

describe('a message that is not a listing is still refused, in either script', () => {
  it.each([
    ['English handover', 'here you go'],
    ['English greeting', 'hi bro'],
    ['emoji only', '📸📸📸'],
    ['punctuation only', '-----'],
    ['Chinese handover', '请看照片'],
    ['Chinese greeting', '你好'],
  ])('refuses %s', (_l, t) => { expect(refused(t)).toBe(true) })
})

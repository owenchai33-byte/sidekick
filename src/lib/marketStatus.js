// Property market status — separate from the workflow status (draft/optimised/
// published). Drives the banner on the branded graphic and a matching caption:
// the "JUST SOLD / PRICE REDUCED" posts push.property auto-generates on CRM
// changes. SideKick owns the listing data, so the agent just sets it here.
import { listingLabel, formatPrice } from './format.js'

export const MARKET_STATUSES = [
  { id: 'available', label: 'Live' }, // default — normal FOR SALE / FOR RENT pill
  { id: 'new', label: 'Just listed', banner: 'JUST LISTED', color: '#1b7f4d' },
  { id: 'reduced', label: 'Price reduced', banner: 'PRICE REDUCED', color: '#c2410c' },
  { id: 'under_offer', label: 'Under offer', banner: 'UNDER OFFER', color: '#b45309' },
  { id: 'sold', label: 'Sold', banner: 'SOLD', color: '#b42318' },
  { id: 'let', label: 'Rented', banner: 'RENTED', color: '#b42318' },
]

const BY_ID = Object.fromEntries(MARKET_STATUSES.map((s) => [s.id, s]))

export function isHighlightStatus(listing) {
  const s = BY_ID[listing?.marketStatus]
  return !!(s && s.banner)
}

// { text, color } for the graphic's corner banner, or null for the normal pill.
export function statusBanner(listing) {
  const s = BY_ID[listing?.marketStatus]
  if (!s || !s.banner) return null
  return { text: s.banner, color: s.color }
}

// Native tri-language status caption (EN / 中文 / BM) built from listing data.
// Templated (no AI dependency) so it's instant and reliable; AI can refine later.
export function statusCaption(listing, lang = 'en') {
  const s = BY_ID[listing?.marketStatus]
  if (!s || !s.banner) return ''
  const name = listingLabel(listing)
  const price = formatPrice(listing.price, listing.listingType)
  const t = {
    new: {
      en: `🆕 JUST LISTED — ${name}\n${price}. Enquire now before it's gone. DM us for a viewing. 📩`,
      zh: `🆕 全新上市 — ${name}\n${price}。手快有手慢无，欢迎私讯预约看房！📩`,
      bm: `🆕 BARU DISENARAIKAN — ${name}\n${price}. Tanya sekarang sebelum terlepas. DM untuk tempahan lihat. 📩`,
    },
    reduced: {
      en: `📉 PRICE REDUCED — ${name}\nNow ${price}. Great value just got better — message us today. 📩`,
      zh: `📉 降价优惠 — ${name}\n现价 ${price}。超值好房，机不可失，立即私讯！📩`,
      bm: `📉 HARGA DITURUNKAN — ${name}\nSekarang ${price}. Nilai terbaik jadi lebih baik — mesej kami hari ini. 📩`,
    },
    under_offer: {
      en: `🤝 UNDER OFFER — ${name}\nAnother happy match! Looking for similar? Let's find yours. 📩`,
      zh: `🤝 已接受献价 — ${name}\n又成功配对一间！想找类似的？私讯我们。📩`,
      bm: `🤝 DALAM TAWARAN — ${name}\nSatu lagi padanan berjaya! Cari yang serupa? DM kami. 📩`,
    },
    sold: {
      en: `🎉 SOLD — ${name}\nAnother one closed! Thinking of selling yours? Get a free valuation — DM us. 📩`,
      zh: `🎉 已售出 — ${name}\n再成交一间！想卖房？免费估价，欢迎私讯。📩`,
      bm: `🎉 TERJUAL — ${name}\nSatu lagi berjaya dijual! Nak jual rumah anda? Penilaian percuma — DM kami. 📩`,
    },
    let: {
      en: `🎉 RENTED — ${name}\nKeys handed over! Have a property to rent out? We'll fill it fast. 📩`,
      zh: `🎉 已租出 — ${name}\n顺利交钥匙！有房要出租？我们帮你快速租出。📩`,
      bm: `🎉 DISEWA — ${name}\nKunci diserahkan! Ada hartanah untuk disewa? Kami isi dengan cepat. 📩`,
    },
  }
  return t[listing.marketStatus]?.[lang] || t[listing.marketStatus]?.en || ''
}

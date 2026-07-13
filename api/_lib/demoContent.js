// Demo-mode fallback. When no API key is configured (or a call fails), the
// content engine returns clearly-labelled sample copy built from the listing
// fields, so the full flow is demonstrable offline. Responses carry demo:true
// and the UI badges every card as sample copy — never passed off as live output.

import { PLATFORM_MAP } from '../../shared/constants.js'

function money(listing) {
  if (listing.price == null) return listing.listingType === 'rental' ? 'Price on ask' : 'Price on ask'
  const n = Number(listing.price).toLocaleString('en-MY')
  return listing.listingType === 'rental' ? `RM${n}/month` : `RM${n}`
}

function beds(listing) {
  const b = []
  if (listing.bedrooms != null) b.push(`${listing.bedrooms} bedrooms`)
  if (listing.bathrooms != null) b.push(`${listing.bathrooms} bathrooms`)
  return b.join(' · ')
}

function specsEn(l) {
  return [
    l.propertyType && `Type: ${l.propertyType}`,
    l.bedrooms != null && `Bedrooms: ${l.bedrooms}`,
    l.bathrooms != null && `Bathrooms: ${l.bathrooms}`,
    l.sqft != null && `Built-up: ${l.sqft} sq ft`,
    l.tenure && `Tenure: ${l.tenure}`,
    l.furnishing && `Furnishing: ${l.furnishing}`,
  ].filter(Boolean).join('\n')
}

const templates = {
  en: (l) => ({
    facebook_page: `✨ ${l.propertyType || 'Property'} in ${l.location || 'Kuching'} — now available\n\nLooking for a place that just feels right? This ${l.propertyType?.toLowerCase() || 'home'}${l.bedrooms != null ? ` with ${l.bedrooms} bedrooms` : ''} in ${l.location || 'Kuching'} is ready for its next owner. ${money(l)}${l.listingType === 'sale' ? '.' : ' — great value for the area.'}\n\n${beds(l)}${l.sqft != null ? ` · ${l.sqft} sq ft` : ''}\n\nDrop me a DM and I'll send over the full details and viewing times. 🏡`,
    marketplace: `${money(l)} | ${l.propertyType || 'Property'} @ ${l.location || 'Kuching'}\n${beds(l)}${l.sqft != null ? ` | ${l.sqft} sqft` : ''}${l.furnishing ? ` | ${l.furnishing}` : ''}\nMessage now to view. Kuching property for ${l.listingType === 'rental' ? 'rent' : 'sale'}.`,
    mudah: `${l.propertyType || 'Property'} for ${l.listingType === 'rental' ? 'Rent' : 'Sale'} — ${l.location || 'Kuching'}\n${money(l)}\n\n${specsEn(l)}\n\nWell-located in ${l.location || 'Kuching'}. Contact for viewing.`,
    portals: `${l.propertyType || 'Property'} For ${l.listingType === 'rental' ? 'Rent' : 'Sale'} in ${l.location || 'Kuching'}, Sarawak\n\nAsking: ${money(l)}\n\n${specsEn(l)}\n\nThis property is situated in ${l.location || 'Kuching'}, offering convenient access to local amenities. Please contact the marketing agent to arrange an inspection.`,
    tiktok: `POV: you just found a ${l.propertyType?.toLowerCase() || 'home'} in ${l.location || 'Kuching'} for ${money(l)} 👀\n\n${beds(l)}\nComment "INFO" and I'll send details 📲\n\n#kuchingproperty #sarawak #propertymalaysia #rumahkuching #${(l.location || 'kuching').toLowerCase().replace(/\s+/g, '')}`,
    instagram: `${l.propertyType || 'Property'} in ${l.location || 'Kuching'} 🏡\n${money(l)}\n\n${beds(l)}${l.sqft != null ? `\n${l.sqft} sq ft` : ''}\n\nDM to arrange a viewing.\n.\n.\n#kuchingproperty #kuchingrealestate #sarawakproperty #propertymalaysia #${l.listingType === 'rental' ? 'forrent' : 'forsale'} #rumahdijual`,
  }),
  zh: (l) => ({
    facebook_page: `✨ ${l.location || '古晋'}优质${l.propertyType ? cnType(l.propertyType) : '房产'}，诚意出${l.listingType === 'rental' ? '租' : '售'}\n\n位于${l.location || '古晋'}，${l.bedrooms != null ? `${l.bedrooms}间睡房` : '空间宽敞'}${l.bathrooms != null ? `、${l.bathrooms}间浴室` : ''}，${l.listingType === 'rental' ? '月租' : '售价'} ${money(l)}。地点方便，生活机能齐全。\n\n有兴趣欢迎私信我，我把详细资料和看房时间发给您。🏡`,
    marketplace: `${money(l)}｜${l.location || '古晋'} ${l.propertyType ? cnType(l.propertyType) : '房产'}\n${l.bedrooms != null ? `${l.bedrooms}房` : ''}${l.bathrooms != null ? `${l.bathrooms}厕` : ''}${l.sqft != null ? `｜${l.sqft}平方尺` : ''}\n古晋${l.listingType === 'rental' ? '出租' : '出售'}，私信预约看房。`,
    mudah: `${l.location || '古晋'} ${l.propertyType ? cnType(l.propertyType) : '房产'}${l.listingType === 'rental' ? '出租' : '出售'}\n${money(l)}\n\n${cnSpecs(l)}\n\n地点优越，欢迎来电安排看房。`,
    portals: `${l.location || '古晋'}${l.propertyType ? cnType(l.propertyType) : '房产'} — ${l.listingType === 'rental' ? '出租' : '出售'}\n\n${l.listingType === 'rental' ? '月租' : '售价'}：${money(l)}\n\n${cnSpecs(l)}\n\n本房产坐落于${l.location || '古晋'}，交通便利，邻近各项生活设施。有意者请联络经纪安排看房。`,
    tiktok: `古晋${l.location || ''}这间${l.propertyType ? cnType(l.propertyType) : '房子'}只要 ${money(l)}👀\n\n${l.bedrooms != null ? `${l.bedrooms}房 ` : ''}地点超方便\n留言「资料」我私你详情📲\n\n#古晋房产 #砂拉越 #kuchingproperty #买房 #租房`,
    instagram: `${l.location || '古晋'} ${l.propertyType ? cnType(l.propertyType) : '房产'} 🏡\n${money(l)}\n\n${l.bedrooms != null ? `${l.bedrooms}房` : ''}${l.bathrooms != null ? ` ${l.bathrooms}厕` : ''}${l.sqft != null ? `\n${l.sqft} 平方尺` : ''}\n\n私信预约看房。\n.\n.\n#古晋房产 #古晋买房 #砂拉越房产 #kuchingproperty #${l.listingType === 'rental' ? '出租' : '出售'}`,
  }),
  ms: (l) => ({
    facebook_page: `✨ ${l.propertyType || 'Hartanah'} di ${l.location || 'Kuching'} — untuk di${l.listingType === 'rental' ? 'sewa' : 'jual'}\n\nSedang cari rumah yang selesa untuk keluarga? ${l.propertyType || 'Rumah'} ini${l.bedrooms != null ? ` dengan ${l.bedrooms} bilik tidur` : ''} di ${l.location || 'Kuching'} sedia untuk tuan baharu. ${l.listingType === 'rental' ? 'Sewa' : 'Harga'}: ${money(l)}.\n\n${msSpecsLine(l)}\n\nPM saya untuk maklumat penuh dan masa untuk lihat rumah. 🏡`,
    marketplace: `${money(l)} | ${l.propertyType || 'Hartanah'} @ ${l.location || 'Kuching'}\n${l.bedrooms != null ? `${l.bedrooms} bilik` : ''}${l.bathrooms != null ? ` ${l.bathrooms} tandas` : ''}${l.sqft != null ? ` | ${l.sqft} kaki persegi` : ''}\nUntuk di${l.listingType === 'rental' ? 'sewa' : 'jual'} di Kuching. PM untuk tempahan lihat rumah.`,
    mudah: `${l.propertyType || 'Hartanah'} untuk Di${l.listingType === 'rental' ? 'sewa' : 'jual'} — ${l.location || 'Kuching'}\n${money(l)}\n\n${msSpecs(l)}\n\nLokasi strategik di ${l.location || 'Kuching'}. Hubungi untuk tempahan melihat.`,
    portals: `${l.propertyType || 'Hartanah'} Untuk Di${l.listingType === 'rental' ? 'sewa' : 'jual'} di ${l.location || 'Kuching'}, Sarawak\n\nHarga: ${money(l)}\n\n${msSpecs(l)}\n\nHartanah ini terletak di ${l.location || 'Kuching'} dengan akses mudah ke kemudahan setempat. Sila hubungi ejen pemasaran untuk mengatur tinjauan.`,
    tiktok: `POV: kau jumpa ${l.propertyType?.toLowerCase() || 'rumah'} di ${l.location || 'Kuching'} harga ${money(l)} 👀\n\n${l.bedrooms != null ? `${l.bedrooms} bilik ` : ''}lokasi memang best\nComment "INFO" nanti PM details 📲\n\n#hartanahkuching #sarawak #rumahdijual #propertymalaysia #kuching`,
    instagram: `${l.propertyType || 'Hartanah'} di ${l.location || 'Kuching'} 🏡\n${money(l)}\n\n${l.bedrooms != null ? `${l.bedrooms} bilik` : ''}${l.bathrooms != null ? ` ${l.bathrooms} tandas` : ''}${l.sqft != null ? `\n${l.sqft} kaki persegi` : ''}\n\nPM untuk tempahan lihat rumah.\n.\n.\n#hartanahkuching #rumahkuching #hartanahsarawak #propertymalaysia #${l.listingType === 'rental' ? 'disewa' : 'dijual'}`,
  }),
}

function cnType(t) {
  const map = { Terrace: '排屋', 'Semi-D': '半独立式洋房', Detached: '独立式洋房', Apartment: '公寓', Condo: '共管公寓', Shoplot: '店屋', Land: '地皮' }
  return map[t] || '房产'
}
function cnSpecs(l) {
  return [
    l.propertyType && `类型：${cnType(l.propertyType)}`,
    l.bedrooms != null && `睡房：${l.bedrooms}`,
    l.bathrooms != null && `浴室：${l.bathrooms}`,
    l.sqft != null && `建筑面积：${l.sqft} 平方尺`,
    l.tenure && `地契：${l.tenure === 'Freehold' ? '永久地契' : '租赁地契'}`,
    l.furnishing && `家具：${msFurnishCn(l.furnishing)}`,
  ].filter(Boolean).join('\n')
}
function msFurnishCn(f) {
  return { Unfurnished: '无家具', 'Partially Furnished': '部分家具', 'Fully Furnished': '全套家具' }[f] || f
}
function msSpecs(l) {
  return [
    l.propertyType && `Jenis: ${l.propertyType}`,
    l.bedrooms != null && `Bilik tidur: ${l.bedrooms}`,
    l.bathrooms != null && `Bilik air: ${l.bathrooms}`,
    l.sqft != null && `Keluasan: ${l.sqft} kaki persegi`,
    l.tenure && `Pegangan: ${l.tenure === 'Freehold' ? 'Pegangan Bebas' : 'Pajakan'}`,
    l.furnishing && `Perabot: ${l.furnishing}`,
  ].filter(Boolean).join('\n')
}
function msSpecsLine(l) {
  return [l.bedrooms != null && `${l.bedrooms} bilik`, l.bathrooms != null && `${l.bathrooms} tandas`, l.sqft != null && `${l.sqft} kps`].filter(Boolean).join(' · ')
}

export function demoContent(listing, platformIds, languageIds) {
  const out = {}
  for (const pid of platformIds) {
    if (!PLATFORM_MAP[pid]) continue
    out[pid] = {}
    for (const lid of languageIds) {
      const build = templates[lid]
      if (!build) continue
      out[pid][lid] = build(listing)[pid] || ''
    }
  }
  return out
}

/** Demo parse: light heuristics so paste-to-parse works offline too. */
export function demoParse(rawText) {
  const t = (rawText || '').toLowerCase()
  const rental = /(rent|sewa|month|bulan|\/mo|monthly)/.test(t)
  // Price: prefer money-flagged figures (RM prefix, or k/juta/mil suffix) over
  // bare small numbers like bed/bath counts.
  let price = null
  const priceCandidates = []
  const re = /(?:rm|myr)\s*([\d.,]+)\s*(k|juta|mil|jt)?|([\d.,]+)\s*(k|juta|mil|jt|ribu)\b/gi
  let mm
  while ((mm = re.exec(t)) !== null) {
    const digits = (mm[1] || mm[3] || '').replace(/,/g, '')
    let n = parseFloat(digits)
    if (Number.isNaN(n)) continue
    const unit = (mm[2] || mm[4] || '').toLowerCase()
    if (unit === 'k' || unit === 'ribu') n *= 1000
    if (unit === 'juta' || unit === 'mil' || unit === 'jt') n *= 1000000
    priceCandidates.push(Math.round(n))
  }
  if (priceCandidates.length) {
    // A rental price is the smallest sensible monthly figure; a sale, the largest.
    price = rental ? Math.min(...priceCandidates) : Math.max(...priceCandidates)
  }

  const bedM = t.match(/(\d+)\s*(?:bed|bilik|room|房|r\b)/)
  const bathM = t.match(/(\d+)\s*(?:bath|tandas|toilet|厕|b\b)/)
  const sqftM = t.match(/([\d,]{3,})\s*(?:sq\s?ft|sqft|sf|kaki)/)
  const typeM = ['Terrace', 'Semi-D', 'Detached', 'Apartment', 'Condo', 'Shoplot', 'Land'].find((x) => t.includes(x.toLowerCase().split('-')[0]))
  // Location: capture the words after at/@/in, preserving original casing.
  const locM = (rawText || '').match(/(?:\bat\b|@|\bin\b)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/)

  return {
    listingType: rental ? 'rental' : 'sale',
    price,
    location: locM ? locM[1].trim() : null,
    bedrooms: bedM ? Number(bedM[1]) : null,
    bathrooms: bathM ? Number(bathM[1]) : null,
    propertyType: typeM || null,
    sqft: sqftM ? Number(sqftM[1].replace(/,/g, '')) : null,
    tenure: /freehold/.test(t) ? 'Freehold' : /leasehold/.test(t) ? 'Leasehold' : null,
    furnishing: /fully furnished/.test(t) ? 'Fully Furnished' : /partial/.test(t) ? 'Partially Furnished' : /unfurnished/.test(t) ? 'Unfurnished' : null,
    title: null,
  }
}

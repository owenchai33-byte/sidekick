// Demo-mode fallback. When no API key is configured (or a call fails), the
// content engine returns clearly-labelled sample copy built from the listing
// fields, so the full flow is demonstrable offline. Responses carry demo:true
// and the UI badges every card as sample copy — never passed off as live output.

import { PLATFORM_MAP } from './constants.js'

// A TRANSACTION NOBODY STATED IS NOT A SALE.
//
// Every template here read `listingType === 'rental' ? rent : sale`, so a
// listing whose type the parser could not determine was advertised as FOR SALE
// in 12 of 18 outputs — "Property For Sale", "untuk Dijual", "出售" — about a
// unit whose owner may be letting it. api/ingest.js already refuses to guess
// this (`listingType: fields.listingType || null`, with a comment saying a wrong
// type turns a correct caption into a contradiction), and then handed the null
// straight to a renderer that guessed anyway.
//
// It matters most HERE, of all places: this file is the fallback, so it runs
// exactly when the parse was too weak to read the type in the first place.
//
// Third branch is silence, never a hedge. "For sale or rent" would be a second
// invented claim, not a smaller one.
const txn = (l, rent, sale, unknown = '') => (
  l.listingType === 'rental' ? rent : l.listingType === 'sale' ? sale : unknown)

// TWO CLAIMS THIS TEMPLATE USED TO MAKE ON THE AGENT'S BEHALF.
//
// "ready for its next OWNER" was printed for a RENTAL — a tenant does not
// become the owner, and the Malay half said the same thing more strongly
// ("tuan baharu", a new master). Both now follow the stated transaction.
//
// "— great value for the area" was appended to every non-sale caption. That is
// a market judgement about someone else's property, and no listing this system
// has ever received contained it. The fallback exists to be the SAFE answer;
// inventing a valuation is the opposite. Removed, not softened.

function money(listing) {
  if (listing.price == null) return 'Price on ask'
  const n = Number(listing.price).toLocaleString('en-MY')
  // "/month" is itself a claim about the transaction, so it needs the same
  // evidence the words do.
  return txn(listing, `RM${n}/month`, `RM${n}`, `RM${n}`)
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

// A PLACE PHRASE, OR NOTHING. Every template used to read `l.location ||
// 'Kuching'` (or `|| '古晋'`), and three of them stated the town in prose or
// hardcoded it into hashtags whatever the listing said — the zh tiktok template
// literally produced "古晋Miri这间公寓". This is the same substitution that was
// removed from the reel script, the TikTok title and the price card, surviving
// in the fallback captions; and these captions are NOT unreachable — the web-app
// path (/api/social-post, /api/social-broadcast) gates on looksLikeDemoCaption
// alone, which only recognises the English facebook_page shape.
//
// A caption that omits the area reads as a caption about a property. One that
// names the wrong area is a false claim about a real address.
const loc = (l) => (l.location ? String(l.location) : '')
const inEn = (l) => (loc(l) ? ` in ${loc(l)}` : '')
const atEn = (l) => (loc(l) ? ` @ ${loc(l)}` : '')
const diMs = (l) => (loc(l) ? ` di ${loc(l)}` : '')
// Geo hashtags derived from the listing's own location, exactly as ingest.js
// geoTags() does. #kuchingproperty / #sarawak / #古晋房产 / #hartanahkuching /
// #rumahkuching were hardcoded onto every caption. A hashtag is a claim.
const slug = (l) => loc(l).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
const geoEn = (l) => (slug(l) ? `#${slug(l)}property ` : '')
const geoZh = (l) => (loc(l) ? `#${loc(l)}房产 ` : '')
const geoMs = (l) => (slug(l) ? `#hartanah${slug(l)} ` : '')

const templates = {
  en: (l) => ({
    facebook_page: `✨ ${l.propertyType || 'Property'}${inEn(l)} — now available\n\nLooking for a place that just feels right? This ${l.propertyType?.toLowerCase() || 'home'}${l.bedrooms != null ? ` with ${l.bedrooms} bedrooms` : ''}${inEn(l)} ${txn(l, 'is ready for its next tenant', 'is ready for its next owner', 'is available now')}. ${money(l)}.\n\n${beds(l)}${l.sqft != null ? ` · ${l.sqft} sq ft` : ''}\n\nDrop me a DM and I'll send over the full details and viewing times. 🏡`,
    marketplace: `${money(l)} | ${l.propertyType || 'Property'}${atEn(l)}\n${beds(l)}${l.sqft != null ? ` | ${l.sqft} sqft` : ''}${l.furnishing ? ` | ${l.furnishing}` : ''}\nMessage now to view. ${loc(l) ? `${loc(l)} property` : 'Property'}${txn(l, ' for rent', ' for sale', '')}.`,
    mudah: `${l.propertyType || 'Property'}${txn(l, ' for Rent', ' for Sale', '')}${loc(l) ? ` — ${loc(l)}` : ''}\n${money(l)}\n\n${specsEn(l)}\n\n${loc(l) ? `Well-located in ${loc(l)}. ` : ''}Contact for viewing.`,
    portals: `${l.propertyType || 'Property'}${txn(l, ' For Rent', ' For Sale', '')}${inEn(l)}\n\nAsking: ${money(l)}\n\n${specsEn(l)}\n\n${loc(l) ? `This property is situated in ${loc(l)}, offering convenient access to local amenities. ` : ''}Please contact the marketing agent to arrange an inspection.`,
    tiktok: `POV: you just found a ${l.propertyType?.toLowerCase() || 'home'}${inEn(l)} for ${money(l)} 👀\n\n${beds(l)}\nComment "INFO" and I'll send details 📲\n\n${geoEn(l)}#propertymalaysia`,
    instagram: `${l.propertyType || 'Property'}${inEn(l)} 🏡\n${money(l)}\n\n${beds(l)}${l.sqft != null ? `\n${l.sqft} sq ft` : ''}\n\nDM to arrange a viewing.\n.\n.\n${geoEn(l)}#propertymalaysia${txn(l, ' #forrent', ' #forsale', '')}`,
  }),
  zh: (l) => ({
    facebook_page: `✨ ${loc(l)}优质${l.propertyType ? cnType(l.propertyType) : '房产'}，诚意出${txn(l, '租', '售', '让')}\n\n${loc(l) ? `位于${loc(l)}，` : ''}${l.bedrooms != null ? `${l.bedrooms}间睡房` : '空间宽敞'}${l.bathrooms != null ? `、${l.bathrooms}间浴室` : ''}，${txn(l, '月租', '售价', '价格')} ${money(l)}。${loc(l) ? '地点方便，生活机能齐全。' : ''}\n\n有兴趣欢迎私信我，我把详细资料和看房时间发给您。🏡`,
    marketplace: `${money(l)}｜${loc(l) ? `${loc(l)} ` : ''}${l.propertyType ? cnType(l.propertyType) : '房产'}\n${l.bedrooms != null ? `${l.bedrooms}房` : ''}${l.bathrooms != null ? `${l.bathrooms}厕` : ''}${l.sqft != null ? `｜${l.sqft}平方尺` : ''}\n${loc(l)}${txn(l, '出租', '出售', '')}，私信预约看房。`,
    mudah: `${loc(l) ? `${loc(l)} ` : ''}${l.propertyType ? cnType(l.propertyType) : '房产'}${txn(l, '出租', '出售', '')}\n${money(l)}\n\n${cnSpecs(l)}\n\n${loc(l) ? '地点优越，' : ''}欢迎来电安排看房。`,
    portals: `${loc(l)}${l.propertyType ? cnType(l.propertyType) : '房产'}${txn(l, ' — 出租', ' — 出售', '')}\n\n${txn(l, '月租', '售价', '价格')}：${money(l)}\n\n${cnSpecs(l)}\n\n${loc(l) ? `本房产坐落于${loc(l)}，交通便利，邻近各项生活设施。` : ''}有意者请联络经纪安排看房。`,
    tiktok: `${loc(l)}这间${l.propertyType ? cnType(l.propertyType) : '房子'}只要 ${money(l)}👀\n\n${l.bedrooms != null ? `${l.bedrooms}房 ` : ''}${loc(l) ? '地点超方便' : ''}\n留言「资料」我私你详情📲\n\n${geoZh(l)}#马来西亚房产${txn(l, ' #租房', ' #买房', '')}`,
    instagram: `${loc(l) ? `${loc(l)} ` : ''}${l.propertyType ? cnType(l.propertyType) : '房产'} 🏡\n${money(l)}\n\n${l.bedrooms != null ? `${l.bedrooms}房` : ''}${l.bathrooms != null ? ` ${l.bathrooms}厕` : ''}${l.sqft != null ? `\n${l.sqft} 平方尺` : ''}\n\n私信预约看房。\n.\n.\n${geoZh(l)}#马来西亚房产${txn(l, ' #出租', ' #出售', '')}`,
  }),
  ms: (l) => ({
    facebook_page: `✨ ${l.propertyType || 'Hartanah'}${diMs(l)}${txn(l, ' — untuk disewa', ' — untuk dijual', '')}\n\nSedang cari rumah yang selesa untuk keluarga? ${l.propertyType || 'Rumah'} ini${l.bedrooms != null ? ` dengan ${l.bedrooms} bilik tidur` : ''}${diMs(l)} ${txn(l, 'sedia untuk penyewa baharu', 'sedia untuk tuan baharu', 'kini tersedia')}. ${txn(l, 'Sewa', 'Harga', 'Harga')}: ${money(l)}.\n\n${msSpecsLine(l)}\n\nPM saya untuk maklumat penuh dan masa untuk lihat rumah. 🏡`,
    marketplace: `${money(l)} | ${l.propertyType || 'Hartanah'}${loc(l) ? ` @ ${loc(l)}` : ''}\n${l.bedrooms != null ? `${l.bedrooms} bilik` : ''}${l.bathrooms != null ? ` ${l.bathrooms} tandas` : ''}${l.sqft != null ? ` | ${l.sqft} kaki persegi` : ''}\n${txn(l, 'Untuk disewa', 'Untuk dijual', 'Tersedia')}${diMs(l)}. PM untuk tempahan lihat rumah.`,
    mudah: `${l.propertyType || 'Hartanah'}${txn(l, ' untuk Disewa', ' untuk Dijual', '')}${loc(l) ? ` — ${loc(l)}` : ''}\n${money(l)}\n\n${msSpecs(l)}\n\n${loc(l) ? `Lokasi strategik di ${loc(l)}. ` : ''}Hubungi untuk tempahan melihat.`,
    portals: `${l.propertyType || 'Hartanah'}${txn(l, ' Untuk Disewa', ' Untuk Dijual', '')}${diMs(l)}\n\nHarga: ${money(l)}\n\n${msSpecs(l)}\n\n${loc(l) ? `Hartanah ini terletak di ${loc(l)} dengan akses mudah ke kemudahan setempat. ` : ''}Sila hubungi ejen pemasaran untuk mengatur tinjauan.`,
    tiktok: `POV: kau jumpa ${l.propertyType?.toLowerCase() || 'rumah'}${diMs(l)} harga ${money(l)} 👀\n\n${l.bedrooms != null ? `${l.bedrooms} bilik ` : ''}${loc(l) ? 'lokasi memang best' : ''}\nComment "INFO" nanti PM details 📲\n\n${geoMs(l)}#propertymalaysia`,
    instagram: `${l.propertyType || 'Hartanah'}${diMs(l)} 🏡\n${money(l)}\n\n${l.bedrooms != null ? `${l.bedrooms} bilik` : ''}${l.bathrooms != null ? ` ${l.bathrooms} tandas` : ''}${l.sqft != null ? `\n${l.sqft} kaki persegi` : ''}\n\nPM untuk tempahan lihat rumah.\n.\n.\n${geoMs(l)}#propertymalaysia${txn(l, ' #disewa', ' #dijual', '')}`,
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

/** Demo content plan: sample non-listing posts so the planner works offline. */
export function demoPlan(count = 6, languageIds = ['en', 'zh', 'ms']) {
  const posts = [
    { category: 'market_tip', headline: 'Know your MOT fees', captions: {
      en: '💡 Buying in Kuching? Budget for the Memorandum of Transfer (MOT) and legal fees on top of your deposit — first-timers often forget these. Ask me for a full cost breakdown before you commit. 📩 #KuchingProperty #HomeBuyingTips',
      zh: '💡 在古晋买房，除了首付，别忘了转名费（MOT）和律师费也要预算——很多首次购房者都会漏掉。买之前私讯我，帮你算清全部费用。📩 #古晋房产 #买房贴士',
      ms: '💡 Beli rumah di Kuching? Bajet kos Memorandum Pindah Milik (MOT) & guaman selain deposit — ramai pembeli kali pertama terlupa. PM saya untuk pecahan kos penuh sebelum komit. 📩 #HartanahKuching #TipBeliRumah' } },
    { category: 'area_spotlight', headline: 'Why BDC?', captions: {
      en: '📍 BDC keeps topping wishlists — cafés, groceries, schools and the hospital within reach, plus easy access to town. Great for families and rental demand alike. Buying or renting here? Let\'s talk. 📩 #BDC #KuchingArea',
      zh: '📍 BDC 一直是热门之选——咖啡馆、超市、学校、医院样样齐全，进城也方便。自住或出租都抢手。想在这一带买或租？私讯聊聊。📩 #BDC #古晋房产',
      ms: '📍 BDC sentiasa jadi pilihan — kafe, kedai, sekolah & hospital semua dekat, mudah ke bandar. Sesuai untuk keluarga & permintaan sewa tinggi. Nak beli atau sewa di sini? Jom borak. 📩 #BDC #Kuching' } },
    { category: 'engagement', headline: 'Rent or buy in 2026?', captions: {
      en: '🤔 Renting or buying in 2026 — which team are you? Drop a 🏠 for buy or 🔑 for rent, and tell me what\'s holding you back. Happy to point you the right way. #KuchingProperty',
      zh: '🤔 2026年，你是买房派还是租房派？买房留 🏠，租房留 🔑，也说说是什么让你还在犹豫。很乐意帮你理清方向。#古晋房产',
      ms: '🤔 2026 — sewa atau beli? Taip 🏠 untuk beli, 🔑 untuk sewa, dan kongsi apa yang buat anda teragak-agak. Saya bantu tunjuk arah. #HartanahKuching' } },
    { category: 'seller_tip', headline: 'Sell? Declutter first', captions: {
      en: '🏡 Selling your home? Before the photos: declutter, deep-clean, let the light in. A tidy, bright space photographs better and sells faster — no renovation needed. Want a free listing review? 📩 #SellerTips',
      zh: '🏡 打算卖房？拍照前先做三件事：清杂物、深度清洁、让光线进来。整洁明亮的空间照片更好看，也卖得更快——不用装修。想免费帮你看看房源？私讯我。📩 #卖房贴士',
      ms: '🏡 Nak jual rumah? Sebelum ambil gambar: kemas, cuci bersih & biar cahaya masuk. Ruang kemas & terang bergambar lebih cantik, laku lebih cepat. Nak semakan senarai percuma? 📩 #TipPenjual' } },
    { category: 'festive', headline: 'Selamat Hari Gawai', captions: {
      en: '🌾 Selamat Hari Gawai to everyone celebrating across Sarawak! Wishing you togetherness, a good harvest and new beginnings — maybe even a new home. From our family to yours. 🏡 #Gawai #Kuching',
      zh: '🌾 祝砂拉越所有欢庆的朋友 Gawai 节快乐！愿这个丰收季节团圆美满、万事顺心——也许还有个新家等着你。🏡 #Gawai节 #古晋',
      ms: '🌾 Selamat Hari Gawai kepada semua yang menyambut di Sarawak! Semoga musim ini penuh kemesraan, tuaian baik & permulaan baharu — mungkin juga rumah baharu. 🏡 #Gawai #Kuching' } },
    { category: 'credibility', headline: 'Local agent, real edge', captions: {
      en: '🤝 A local agent knows more than listings — which streets flood, which areas are quietly growing, what a fair price really is. That\'s the difference between a house and the right home. Here to help, no pressure. 📩 #KuchingProperty',
      zh: '🤝 本地经纪懂的不只是房源——哪条街会淹水、哪一区在悄悄升值、什么才是合理价。这就是「一间房」和「对的家」的差别。随时帮你，绝不催促。📩 #古晋房产',
      ms: '🤝 Ejen tempatan tahu lebih daripada senarai — jalan mana banjir, kawasan mana sedang membangun, harga berpatutan sebenar. Itu beza antara rumah biasa & rumah yang betul. Sedia bantu, tanpa tekanan. 📩 #HartanahKuching' } },
  ]
  return { posts: posts.slice(0, count).map((p) => ({ ...p, captions: Object.fromEntries(languageIds.map((l) => [l, p.captions[l] || p.captions.en])) })) }
}

/** Demo parse: light heuristics so paste-to-parse works offline too. */
export function demoParse(rawText) {
  const t = (rawText || '').toLowerCase()
  // NO CHINESE, and this is the fallback parser — the one used every time the
  // free tier rate-limits the real one. 出租, 招租 and 月租 are how a Chinese
  // listing says "for rent", and without them every one of them was typed as a
  // SALE. The transaction guard then read the agent's own correct rental caption
  // as a contradiction and refused it, telling them the caption engine had
  // failed. `t` is lowercased ASCII-safe; CJK is unaffected by case.
  // A SALE IS ALSO SOMETHING THE TEXT HAS TO SAY. `rental ? 'rental' : 'sale'`
  // meant every listing that mentioned neither was typed a SALE — a guess, and
  // one that travels: it picks the FOR SALE pill burned onto the price card, it
  // picks whether the price reads "RM1,800" or "RM1,800/month", and it is what
  // the transaction guard measures a caption against. A wrong type turns a
  // correct caption into a contradiction; an absent one just makes the guard
  // silent. So an unsignalled listing is now `null`, and every reader below
  // already treats null as "not a rental" without asserting a sale.
  const sale = /(for\s+sale|on\s+sale|selling|sale\s+price|dijual|untuk\s+dijual|harga\s+jual|出售|待售|售价|售價|出讓|出让)/.test(t)
  const rental = /(rent|sewa|month|bulan|\/mo|monthly|出租|招租|月租|租金|房屋出租|disewa|\/月|每月|个月|個月|per\s*bulan)/.test(t)
  // Price: prefer money-flagged figures (RM prefix, or k/juta/mil suffix) over
  // bare small numbers like bed/bath counts.
  let price = null
  const priceCandidates = []
  // "RM520,000 Kuching" IS NOT RM520 MILLION.
  //
  // Measured on production 2026-09-09: 12 of 42 runs fell back to demoParse, and
  // every one of them read the standard Malaysian sale line as a thousandfold of
  // itself. The unit group `(k|juta|mil|jt)?` had no right-hand boundary, so the
  // optional "k" matched the FIRST LETTER OF THE NEXT WORD - and the next word
  // in a Kuching listing is Kuching. A full stop does not save it either
  // ("RM338,000. Kuching"), because `[\d.,]+` swallows the stop. Kota Samarahan
  // and Kenyalang Park do it too. Every agent in this cohort sells in Kuching.
  //
  // Nothing downstream catches it: postguard adds listing.price to the set of
  // amounts a caption is ALLOWED to carry, so the inflated figure is whitelisted
  // rather than challenged, then brandcard.js burns it onto the cover JPEG and
  // the reel speaks it into the MP4.
  //
  // THE LOOKAHEAD MUST SIT INSIDE THE OPTIONAL GROUP. Writing it as
  // `(k|juta|mil|jt)?(?![a-z])` looks equivalent and is not: when the lookahead
  // fails the engine backtracks into `[\d.,]+` and truncates the number instead,
  // turning "rm338,000nego" into 33800 and "rm450knego" into 45. That trades a
  // 1000x inflation for a fresh set of wrong numbers. Inside the group, a failed
  // unit match skips the group and leaves the digits alone.
  //
  // `ribu` joins the RM branch here; it was only ever on the bare-number branch,
  // so "RM250 ribu" read as 250.
  const re = /(?:rm|myr)\s*([\d.,]+)(?:\s*(k|juta|mil|jt|ribu)(?![a-z]))?|([\d.,]+)\s*(k|juta|mil|jt|ribu)\b/gi
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
    // THE ASKING FIGURE, NOT THE SMALLEST ONE.
    //
    // This was `rental ? min : max`, keyed off the raw rent-word test. Two ways
    // it picked the wrong number, both measured on ordinary listings:
    //   - "For sale … RM450,000. Maintenance fee RM250/month" matched `month`,
    //     so the listing was typed a RENTAL and priced at RM250.
    //   - "Shoplot for rent RM3,500/month plus RM300 service charge" is a real
    //     rental, and min picked the RM300 charge as the rent.
    // A wrong price is not cosmetic here: the guard measures the agent's caption
    // against it, so the caption states the true price and gets refused for
    // "inventing" it.
    //
    // A monthly rent is the LARGEST figure that could plausibly be one. The
    // ceiling separates a rent from an asking price mentioned in the same ad,
    // and is deliberately far above any real Malaysian residential rent.
    // The rent is the figure the listing ATTACHES A MONTH TO. A deposit is
    // larger than the rent it is computed from ("RM1,200/month. Deposit
    // RM2,400"), so neither the smallest nor the largest figure finds it —
    // only the one wearing "/month".
    const RENT_CEILING = 50000
    const type = sale ? 'sale' : (rental ? 'rental' : null)
    if (type === 'rental') {
      const perMonth = []
      // Two word orders. English and Malay put the marker AFTER the figure
      // ("RM1,200/month", "RM800 sebulan"); Chinese puts it BEFORE
      // ("月租 RM1,800"). Reading only the first form picked the deposit on
      // every Chinese rental — 押金 RM3,600 instead of 月租 RM1,800.
      // The floor under a monthly rent. Its only job is to separate money from a
      // COUNT of months, so it sits far below any real Malaysian rent.
      const RENT_FLOOR = 100
      const AFTER = /(rm\s*)?([\d][\d,]*(?:\.\d+)?)\s*(k|ribu)?\s*(?:\/\s*|per\s*|a\s+|se)?(?:mo\b|month|monthly|bulan|月)/gi
      const BEFORE = /(?:月租|租金|每月|月付)\s*[:：]?\s*(rm\s*)?([\d][\d,]*(?:\.\d+)?)\s*(k|ribu)?/gi
      for (const RE of [AFTER, BEFORE]) {
        let m
        while ((m = RE.exec(t)) !== null) {
          let n = parseFloat(String(m[2]).replace(/,/g, ''))
          if (Number.isNaN(n)) continue
          if ((m[3] || '').toLowerCase()) n *= 1000
          // A COUNT OF MONTHS IS NOT A RENT.
          //
          // Measured 2026-09-08 on Owen's RENNA listing. Every Malaysian rental
          // states its terms in months:
          //     Security Deposit: 2 months
          //     Advance Rental: 1 month
          //     Utilities Deposit: 1 month
          //     Comm: 1 month + 8% SST
          // Each matches "<figure> month", so this loop collected 1 and 2 as
          // monthly rents and Math.max picked one. The real figure - RM2.5k -
          // carries no "/month" and was never a candidate, so the fallback
          // parser answered RM1/month. The reel burns the price into the MP4 and
          // the feed card draws it, so a wrong one travels.
          //
          // The tell is not the label. A new one turns up in every third listing
          // ("Tenancy stamping fee: 1 month") and a list of labels would be
          // beaten by the next. It is that a rent is MONEY: it carries RM, or it
          // is too large to be a count of months. Malaysia's cheapest room is in
          // the hundreds; no rent is RM2.
          if (!(m[1] || '') && n < RENT_FLOOR) continue
          perMonth.push(Math.round(n))
        }
      }
      const plausible = priceCandidates.filter((n) => n <= RENT_CEILING)
      price = perMonth.length ? Math.max(...perMonth)
        : (plausible.length ? Math.max(...plausible) : Math.min(...priceCandidates))
    } else {
      price = Math.max(...priceCandidates)
    }
  }

  const bedM = t.match(/(\d+)\s*(?:bed|bilik|room|房|r\b)/)
  const bathM = t.match(/(\d+)\s*(?:bath|tandas|toilet|厕|b\b)/)
  // LAND IS NOT BUILT-UP, AND THIS PARSER HAD ONE FIELD FOR BOTH.
  //
  // `sqft` took the FIRST area figure in the text and there was no landSqft key
  // at all, so the standard Malaysian terrace line
  //     "Land area 4,800 sqft, built-up 2,200 sqft"
  // parsed as sqft = 4800 and threw the agent's real built-up away. The facts
  // block then states "Built-up area: 4800 sq ft" — more than double the truth,
  // on the number a buyer uses to work out price per square foot — and
  // prompts.js's counterweight line, the one that says "this is LAND, not
  // built-up", could never fire because the field did not exist.
  //
  // ONLY AN EXPLICIT AREA LABEL BINDS, AND ONLY IMMEDIATELY IN FRONT. An earlier
  // attempt matched bare "land" and "tanah" with a twelve-character reach, and
  // measurement killed it: "Freehold land, 1,500 sqft built up" came out as a
  // LAND area with the real built-up gone, and "individual land title, 1,450
  // sqft" — a TENURE phrase, not an area — did the same, with whether it fired
  // decided by character count. "Landed property, 2,200 sqft" and "hartanah"
  // were the same trap. So the label has to carry an area word of its own:
  // "land area", "land size", "luas tanah", never bare "land".
  //
  // Anything unlabelled still goes to `sqft` exactly as it does today, so no
  // size is lost and nothing new is refused. A land-only listing now leaves
  // sqft null and every renderer omits its built-up line rather than printing
  // the land figure under a false label — an omission in place of a wrong number.
  const AREA_RE = /([\d,]{3,})\s*(?:sq\s?ft|sqft|sf|kaki)/g
  const LAND_LABEL = /(?:land|lot)\s*(?:area|size)|luas\s*tanah|keluasan\s*tanah|(?:地皮|土地)\s*面积$/
  const BUILT_LABEL = /built[\s-]?up(?:\s*area)?|build[\s-]?up|luas\s*binaan|floor\s*area|建筑面积$/
  let landSqft = null, bareSqft = null, builtSqft = null, am
  while ((am = AREA_RE.exec(t)) !== null) {
    const n = Number(am[1].replace(/,/g, ''))
    if (!Number.isFinite(n) || n <= 0) continue
    // Look only at the few characters immediately before the figure. A gap can
    // never span a digit, so a label only ever claims the figure next to it.
    const head = t.slice(0, am.index).replace(/[^\w一-鿿]+$/, '')
    if (LAND_LABEL.test(head.slice(-16))) { if (landSqft == null) landSqft = n }
    else if (BUILT_LABEL.test(head.slice(-16))) { if (builtSqft == null) builtSqft = n }
    else if (bareSqft == null) bareSqft = n
  }
  const sqftValue = builtSqft != null ? builtSqft : bareSqft
  const typeM = ['Terrace', 'Semi-D', 'Detached', 'Apartment', 'Condo', 'Shoplot', 'Land'].find((x) => t.includes(x.toLowerCase().split('-')[0]))
  // Location: capture the words after at/@/in, preserving original casing.
  //
  // A CAPTURED NAME MUST NOT CROSS A LINE. The separators INSIDE the capture
  // were \s+, which matches a newline, so the name ran on into the next line
  // whenever that line began with a capital — which is how a WhatsApp listing is
  // always written. Measured on four ordinary listings:
  //   "for rent at Vivacity\nFully Furnished"    -> "Vivacity Fully Furnished"
  //   "for sale @ Batu Kawa\nLand area 6,000"    -> "Batu Kawa Land"
  //   "for sale in Stutong\nBuilt-up 2,400 sqft" -> "Stutong Built"
  //   "for rent @ Riverine\nLevel 12"            -> "Riverine Level"
  // The reel speaks that name into an MP4, shortCaption titles the TikTok with
  // it and geoTags makes a hashtag of it, and there is no model anywhere on the
  // fallback path to catch it.
  //
  // ONLY THE INNER SEPARATORS CHANGE. The gap between the anchor and the name
  // stays \s+ on purpose: tightening that one too makes the match FAIL at this
  // anchor and fall through to a LATER "at"/"in" in the message, which answers
  // with a DIFFERENT PLACE instead of a shorter one —
  //   "for sale at\nBatu Kawa\nOwner now staying in Miri"    -> "Miri"
  //   "for rent in\nVivacity, viewing at Kuching office"     -> "Kuching"
  //   "at\nRiverine Resort\n5 minutes to school in Padungan" -> "Padungan"
  // all three of which this file reads correctly today. A garbled name is
  // obviously garbled; a substituted one is a lie that looks like a fact.
  //
  // [^\S\n] is "whitespace that is not a newline", so a name written on one line
  // is unchanged, a name on the line after the anchor is still found whole, and
  // a run-on stops at the end of its line.
  // 📍 IS AN ANCHOR. Half the listings this system receives write the area as
  // "📍The Northbank, Kuching" with no at/in/@ anywhere, so the fallback parser
  // returned null and the poster rendered with no area on it at all — the one
  // line a buyer scans for. The pin is a stronger anchor than the prepositions,
  // not a weaker one: nobody puts 📍 in front of anything but a place.
  // No trailing \s+ after the pin, because it is usually written flush.
  const locM = (rawText || '').match(/📍\s*([A-Z][A-Za-z]+(?:[^\S\n]+[A-Z][A-Za-z]+){0,2})/)
    || (rawText || '').match(/(?:\bat\b|@|\bin\b)\s+([A-Z][A-Za-z]+(?:[^\S\n]+[A-Z][A-Za-z]+){0,2})/)

  return {
    // AN EXPLICIT SALE OUTRANKS A RENT-SHAPED WORD. `rental` matches "month",
    // which appears in "Maintenance fee RM250/month" on a listing whose first
    // words are "For sale". Testing rental first typed that listing a RENTAL —
    // and `price` below then took the MINIMUM figure, so a RM450,000 condo was
    // priced at RM250. The caption stated the real price, the guard measured it
    // against RM250, and the post was refused. Measured: 4 of 6 realistic
    // second-figure listings flipped from publish to refuse.
    listingType: sale ? 'sale' : (rental ? 'rental' : null),
    price,
    location: locM ? locM[1].trim() : null,
    bedrooms: bedM ? Number(bedM[1]) : null,
    bathrooms: bathM ? Number(bathM[1]) : null,
    propertyType: typeM || null,
    sqft: sqftValue,
    landSqft,
    tenure: /freehold/.test(t) ? 'Freehold' : /leasehold/.test(t) ? 'Leasehold' : null,
    furnishing: /fully furnished/.test(t) ? 'Fully Furnished' : /partial/.test(t) ? 'Partially Furnished' : /unfurnished/.test(t) ? 'Unfurnished' : null,
    title: null,
  }
}

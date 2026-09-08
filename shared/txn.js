// WHAT THE ASSETS ARE ALLOWED TO SAY ABOUT THE DEAL.
//
// One source of truth for the FOR SALE / FOR RENT pill, because there are four
// renderers and they disagreed. api/_lib/brandcard.js (the server card) was
// fixed on 2026-09-05 to print NO pill when the listing never said which kind
// of transaction it is. src/lib/graphics.js (the browser card and the carousel)
// and src/components/PropertyVideo.jsx (the reel) were not, and they are the
// ones the app actually exports: PropertyGraphic, the carousel and the
// "download whole kit" bundler all go through graphics.js.
//
// Measured 2026-09-06 on the shipped drawCard(), listingType = null:
//     ["FOR SALE","WP","Wilson Property","Apartment · Miri","3 bed","RM1,800"]
// and on the shipped introScene():
//     ["FOR SALE","RM1,800","Apartment   ·   Miri"]
//
// demoParse() was deliberately changed to return null rather than guess between
// sale and rental — `rental ? 'rental' : 'sale'` typed a listing that mentioned
// neither as a SALE. That fix is undone here if the renderer then stamps FOR
// SALE anyway, and this is the worst place for it to happen: burned into a JPEG
// or an MP4, on a client's public page, with no model in the loop, so no
// caption guard ever sees it and nothing can repair it after the encode.
//
// An absent pill reads as a plain photo of a property. A wrong one is a claim
// about how somebody's home is being sold.

/**
 * The transaction pill for a listing, or '' when the listing never said.
 * Never guesses. Accepts the words the parsers actually emit in all three
 * languages, so a `listingType` of 'sewa' or '出租' is still a rental.
 */
export function transactionTag(listing) {
  const lt = String(listing?.listingType || '').toLowerCase()
  if (/rent|sewa|租/.test(lt)) return 'FOR RENT'
  if (/sale|sell|jual|售/.test(lt)) return 'FOR SALE'
  return ''
}

/** True when the listing states it is a rental. `null`/unknown is not a rental. */
export function isRental(listing) {
  return transactionTag(listing) === 'FOR RENT'
}

/**
 * True when a bare listingType VALUE (not a listing) says rental.
 *
 * formatPrice() took `listingType === 'rental'` while transactionTag() accepts
 * sewa / 出租 / RENTAL, so a card could print FOR RENT above an
 * asking-price-shaped figure: RM1,800/month rendered as "RM1,800". Two readers
 * of one field must not disagree about what it says.
 */
export function isRentalType(listingType) {
  return transactionTag({ listingType }) === 'FOR RENT'
}

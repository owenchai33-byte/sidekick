// Builds a click-to-WhatsApp enquiry link for a listing. The prefilled message
// names the listing and the platform it was seen on, so when a buyer taps it
// the agent instantly knows which post drove the enquiry — attribution without
// any backend or tracking pixel.

// Normalise a Malaysian number to wa.me's international, digits-only form.
export function waNumber(phone) {
  if (!phone) return null
  let d = String(phone).replace(/[^\d]/g, '')
  if (!d) return null
  if (d.startsWith('0')) d = '60' + d.slice(1)        // 012-345 6789 -> 60123456789
  else if (!d.startsWith('60')) d = '60' + d           // 12-345 6789 -> 6012...
  return d
}

export function listingName(listing) {
  return (
    listing?.title ||
    [listing?.propertyType, listing?.location].filter(Boolean).join(' @ ') ||
    'your listing'
  )
}

export function waEnquiryLink(phone, listing, platformName) {
  const num = waNumber(phone)
  if (!num) return null
  const msg = `Hi! I'm interested in ${listingName(listing)}${platformName ? ` (saw it on ${platformName})` : ''}. Is it still available?`
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`
}

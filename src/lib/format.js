// Price is the hero data (§9) — format it consistently, with tabular numerals.

export function formatPrice(value, listingType) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '—'
  const n = Number(value)
  const formatted = 'RM' + n.toLocaleString('en-MY')
  return listingType === 'rental' ? `${formatted}/mo` : formatted
}

export function formatPriceParts(value, listingType) {
  if (value == null || value === '' || Number.isNaN(Number(value))) {
    return { currency: 'RM', amount: '—', suffix: '' }
  }
  return {
    currency: 'RM',
    amount: Number(value).toLocaleString('en-MY'),
    suffix: listingType === 'rental' ? '/mo' : '',
  }
}

export function relativeTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })
}

export function listingLabel(listing) {
  if (listing.title) return listing.title
  const parts = []
  if (listing.bedrooms != null) parts.push(`${listing.bedrooms}-room`)
  parts.push(listing.propertyType || 'property')
  if (listing.location) parts.push(`@ ${listing.location}`)
  return parts.join(' ')
}

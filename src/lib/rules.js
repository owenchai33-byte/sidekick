// Rules-based filtering (§7). Flags high-value listings for drafting. Filtering
// NEVER publishes on its own — it only surfaces a badge/recommendation.

export function evaluateRules(listing, rules) {
  if (!listing || listing.price == null) return { flagged: false, reason: null }
  const price = Number(listing.price)
  if (listing.listingType === 'sale' && price > rules.saleThreshold) {
    return {
      flagged: true,
      reason: `Sale above RM${rules.saleThreshold.toLocaleString('en-MY')} — worth drafting`,
    }
  }
  if (listing.listingType === 'rental' && price > rules.rentalThreshold) {
    return {
      flagged: true,
      reason: `Rental above RM${rules.rentalThreshold.toLocaleString('en-MY')}/mo — worth drafting`,
    }
  }
  return { flagged: false, reason: null }
}

import { formatPriceParts } from '../lib/format.js'

// Price is the hero data — big, tabular, confident.
export default function PriceTag({ value, listingType, size = 'md' }) {
  const { currency, amount, suffix } = formatPriceParts(value, listingType)
  return (
    <span className={`pricetag pricetag-${size}`}>
      <span className="pricetag-cur">{currency}</span>
      <span className="pricetag-amt num">{amount}</span>
      {suffix && <span className="pricetag-suf">{suffix}</span>}
      <style>{`
        .pricetag { display: inline-flex; align-items: baseline; gap: 2px; color: var(--green-700); font-weight: 800; letter-spacing: -0.02em; }
        @media (prefers-color-scheme: dark) { .pricetag { color: var(--green-400); } }
        .pricetag-cur { font-size: 0.6em; font-weight: 700; opacity: 0.8; }
        .pricetag-suf { font-size: 0.5em; font-weight: 600; opacity: 0.65; margin-left: 1px; }
        .pricetag-sm { font-size: 18px; }
        .pricetag-md { font-size: 26px; }
        .pricetag-lg { font-size: 38px; }
      `}</style>
    </span>
  )
}

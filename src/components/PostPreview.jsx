import { formatPrice, listingLabel } from '../lib/format.js'
import { coverPhoto } from '../lib/photos.js'

// Renders the generated copy as it will actually look on each platform, so an
// agent (and a prospect) sees the finished post, not text in a box. Four visual
// archetypes cover the six platforms: Facebook feed, Instagram, TikTok video,
// and a portal/listing card (Marketplace / Mudah / property portals).

function PhotoBlock({ listing, ratio, videoUrl, videoMode }) {
  const style = ratio ? { aspectRatio: ratio } : undefined
  if (videoUrl) {
    return videoMode === 'cover'
      ? <video className="pv-photo" src={videoUrl} style={style} autoPlay muted loop playsInline />
      : <video className="pv-photo" src={videoUrl} style={style} controls muted playsInline />
  }
  const src = coverPhoto(listing)
  if (src) return <img className="pv-photo" src={src} alt="" style={style} />
  const emoji = listing.listingType === 'rental' ? '🔑' : '🏠'
  return (
    <div className="pv-photo pv-photo-ph" style={style}>
      <span className="pv-ph-emoji">{emoji}</span>
      <span className="pv-ph-label">{[listing.propertyType, listing.location].filter(Boolean).join(' · ') || 'Property photo'}</span>
    </div>
  )
}

function FacebookPost({ listing, text, videoUrl }) {
  return (
    <div className="pv pv-fb">
      <div className="pv-fb-head">
        <div className="pv-avatar">🏡</div>
        <div className="pv-fb-meta">
          <div className="pv-name">SideKick Property</div>
          <div className="pv-sub">Just now · 🌐</div>
        </div>
        <div className="pv-more">⋯</div>
      </div>
      <pre className="pv-text">{text}</pre>
      <PhotoBlock listing={listing} ratio="1.91 / 1" videoUrl={videoUrl} />
      <div className="pv-fb-actions">
        <span>👍 Like</span><span>💬 Comment</span><span>↗ Share</span>
      </div>
    </div>
  )
}

function InstagramPost({ listing, text, videoUrl }) {
  return (
    <div className="pv pv-ig">
      <div className="pv-ig-head">
        <div className="pv-avatar sm">🏡</div>
        <div className="pv-name">sidekick.property</div>
        <div className="pv-more">⋯</div>
      </div>
      <PhotoBlock listing={listing} ratio="1 / 1" videoUrl={videoUrl} />
      <div className="pv-ig-actions">
        <span>♥</span><span>💬</span><span>➤</span><span className="pv-ig-save">🔖</span>
      </div>
      <div className="pv-ig-likes">Liked by <b>agents.kuching</b> and others</div>
      <div className="pv-ig-caption"><b>sidekick.property</b> <span className="pv-text-inline">{text}</span></div>
    </div>
  )
}

function TikTokPost({ listing, text, videoUrl }) {
  return (
    <div className="pv pv-tt">
      <PhotoBlock listing={listing} ratio="9 / 16" videoUrl={videoUrl} videoMode="cover" />
      <div className="pv-tt-shade" />
      <div className="pv-tt-rail">
        <span className="pv-tt-ava">🏡</span>
        <span>♥<b>2.4k</b></span><span>💬<b>88</b></span><span>↗<b>Share</b></span>
      </div>
      <div className="pv-tt-overlay">
        <div className="pv-tt-user">@sidekick.property</div>
        <div className="pv-text pv-tt-cap">{text}</div>
        <div className="pv-tt-music">♫ original sound — SideKick</div>
      </div>
    </div>
  )
}

function ListingCard({ listing, text, platform, videoUrl }) {
  const specs = [
    listing.bedrooms != null && `🛏 ${listing.bedrooms}`,
    listing.bathrooms != null && `🛁 ${listing.bathrooms}`,
    listing.sqft != null && `📐 ${listing.sqft} sqft`,
  ].filter(Boolean)
  return (
    <div className="pv pv-listing">
      <div className="pv-listing-src">{platform.name}</div>
      <PhotoBlock listing={listing} ratio="1.6 / 1" videoUrl={videoUrl} />
      <div className="pv-listing-body">
        <div className="pv-listing-price">{formatPrice(listing.price, listing.listingType)}</div>
        <div className="pv-listing-title">{listingLabel(listing)}</div>
        <div className="pv-listing-loc">📍 {listing.location || 'Kuching'}, Sarawak</div>
        {specs.length > 0 && <div className="pv-listing-specs">{specs.map((s, i) => <span key={i}>{s}</span>)}</div>}
        <pre className="pv-text pv-listing-desc">{text}</pre>
      </div>
    </div>
  )
}

export default function PostPreview({ platform, listing, text, videoUrl }) {
  const body = !text
    ? <div className="pv-empty">No copy yet.</div>
    : platform.id === 'facebook_page' ? <FacebookPost listing={listing} text={text} videoUrl={videoUrl} />
    : platform.id === 'instagram' ? <InstagramPost listing={listing} text={text} videoUrl={videoUrl} />
    : platform.id === 'tiktok' ? <TikTokPost listing={listing} text={text} videoUrl={videoUrl} />
    : <ListingCard listing={listing} text={text} platform={platform} videoUrl={videoUrl} />

  return (
    <div className="pv-wrap">
      {body}
      <style>{`
        .pv-wrap { display: flex; justify-content: center; padding: 4px 0; }
        .pv { width: 100%; max-width: 360px; font-size: 13px; color: #1c1c1c; }
        .pv-empty { color: var(--ink-500); padding: 24px; text-align: center; }
        .pv-text { margin: 0; font-family: inherit; white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
        .pv-text-inline { white-space: pre-wrap; }
        .pv-avatar { width: 38px; height: 38px; border-radius: 50%; background: var(--green-600); display: grid; place-items: center; font-size: 18px; flex: none; }
        .pv-avatar.sm { width: 30px; height: 30px; font-size: 15px; }
        .pv-name { font-weight: 700; font-size: 13px; }
        .pv-more { margin-left: auto; color: #90949c; font-size: 16px; }
        .pv-photo { width: 100%; object-fit: cover; display: block; background: #e9e4d8; }
        .pv-photo-ph { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
          background: linear-gradient(135deg, var(--green-700), var(--timber-600)); color: #fff; }
        .pv-ph-emoji { font-size: 34px; }
        .pv-ph-label { font-size: 11px; font-weight: 600; opacity: 0.92; text-align: center; padding: 0 10px; }

        /* Facebook */
        .pv-fb { background: #fff; border: 1px solid #dcdfe4; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .pv-fb-head { display: flex; align-items: center; gap: 9px; padding: 11px 12px 8px; }
        .pv-fb-meta { line-height: 1.2; }
        .pv-sub { font-size: 11px; color: #65676b; }
        .pv-fb .pv-text { padding: 2px 12px 10px; font-size: 13px; }
        .pv-fb-actions { display: flex; justify-content: space-around; border-top: 1px solid #eceef1; padding: 8px 0; color: #65676b; font-size: 12.5px; font-weight: 600; }

        /* Instagram */
        .pv-ig { background: #fff; border: 1px solid #dbdbdb; border-radius: 8px; overflow: hidden; }
        .pv-ig-head { display: flex; align-items: center; gap: 9px; padding: 9px 12px; }
        .pv-ig-actions { display: flex; gap: 14px; padding: 9px 12px 4px; font-size: 18px; }
        .pv-ig-save { margin-left: auto; }
        .pv-ig-likes { padding: 2px 12px; font-size: 12.5px; font-weight: 600; }
        .pv-ig-caption { padding: 3px 12px 12px; font-size: 12.5px; line-height: 1.5; max-height: 150px; overflow: auto; }

        /* TikTok */
        .pv-tt { position: relative; max-width: 240px; margin: 0 auto; border-radius: 12px; overflow: hidden; background: #000; }
        .pv-tt .pv-photo { border-radius: 12px; }
        .pv-tt-shade { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 45%); }
        .pv-tt-overlay { position: absolute; left: 10px; right: 52px; bottom: 12px; color: #fff; }
        .pv-tt-user { font-weight: 800; font-size: 13px; margin-bottom: 4px; }
        .pv-tt-cap { color: #fff; font-size: 11.5px; max-height: 108px; overflow: hidden; }
        .pv-tt-music { font-size: 11px; margin-top: 6px; opacity: 0.95; }
        .pv-tt-rail { position: absolute; right: 8px; bottom: 14px; display: flex; flex-direction: column; align-items: center; gap: 14px; color: #fff; font-size: 11px; font-weight: 700; z-index: 2; text-align: center; }
        .pv-tt-rail span { display: flex; flex-direction: column; align-items: center; font-size: 20px; }
        .pv-tt-rail span b { font-size: 10px; font-weight: 700; margin-top: 1px; }
        .pv-tt-ava { width: 34px; height: 34px; border-radius: 50%; background: var(--green-600); display: grid; place-items: center; font-size: 16px; margin-bottom: 4px; }

        /* Listing / portal card */
        .pv-listing { background: #fff; border: 1px solid #dcdfe4; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.07); }
        .pv-listing-src { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #65676b; padding: 8px 12px 0; }
        .pv-listing-body { padding: 10px 12px 12px; }
        .pv-listing-price { font-size: 21px; font-weight: 800; color: #111; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
        .pv-listing-title { font-weight: 700; font-size: 13.5px; margin-top: 2px; }
        .pv-listing-loc { font-size: 12px; color: #65676b; margin-top: 3px; }
        .pv-listing-specs { display: flex; gap: 12px; font-size: 12px; color: #333; margin-top: 7px; padding-top: 7px; border-top: 1px solid #eceef1; }
        .pv-listing-desc { font-size: 12.5px; color: #333; margin-top: 9px; max-height: 160px; overflow: auto; }

        @media (prefers-color-scheme: dark) {
          /* Mockups intentionally keep their real (light) platform chrome in both themes. */
          .pv-sub, .pv-fb-actions, .pv-listing-src, .pv-listing-loc { color: #65676b; }
        }
      `}</style>
    </div>
  )
}

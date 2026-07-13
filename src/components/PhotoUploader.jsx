import { useRef } from 'react'

// Photos are carried through to the posts (§3). Stored as data URLs for now;
// swaps to Supabase Storage later with no change to callers.
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function PhotoUploader({ photos, onChange }) {
  const inputRef = useRef(null)

  async function handleFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'))
    const urls = await Promise.all(files.map(fileToDataUrl))
    onChange([...photos, ...urls])
  }

  function removeAt(i) {
    onChange(photos.filter((_, idx) => idx !== i))
  }

  return (
    <div className="pu">
      <div className="pu-grid">
        {photos.map((src, i) => (
          <div key={i} className="pu-thumb">
            <img src={src} alt={`Listing photo ${i + 1}`} />
            <button type="button" className="pu-remove" onClick={() => removeAt(i)} aria-label={`Remove photo ${i + 1}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
            {i === 0 && <span className="pu-cover">Cover</span>}
          </div>
        ))}
        <button
          type="button"
          className="pu-add"
          onClick={() => inputRef.current?.click()}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          <span>Add photos</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <style>{`
        .pu-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; }
        .pu-thumb { position: relative; aspect-ratio: 4/3; border-radius: var(--r-md); overflow: hidden; border: 1px solid var(--line); }
        .pu-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .pu-remove { position: absolute; top: 5px; right: 5px; width: 24px; height: 24px; border-radius: 50%;
          border: none; background: rgba(20,18,12,0.68); color: #fff; display: grid; place-items: center; cursor: pointer; }
        .pu-remove:hover { background: var(--danger); }
        .pu-cover { position: absolute; bottom: 5px; left: 5px; font-size: 10px; font-weight: 700; letter-spacing: 0.04em;
          text-transform: uppercase; background: var(--green-700); color: #fff; padding: 2px 7px; border-radius: 999px; }
        .pu-add { aspect-ratio: 4/3; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
          border: 1.5px dashed var(--line-strong); border-radius: var(--r-md); background: var(--surface-sunk);
          color: var(--ink-500); font-size: 12.5px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
        .pu-add:hover { border-color: var(--green-500); color: var(--green-700); }
      `}</style>
    </div>
  )
}

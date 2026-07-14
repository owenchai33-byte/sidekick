import { useRef, useEffect, useState } from 'react'
import { putVideo, getVideoUrl, deleteVideo } from '../lib/media.js'

// Photos + videos, carried through to previews and publish. Photos are stored
// as data URLs; videos go to IndexedDB (see media.js) and are referenced by id.
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Resolve { id } video refs to playable object URLs.
export function useVideoUrls(videos = []) {
  const [urls, setUrls] = useState({})
  const key = videos.map((v) => v.id).join(',')
  useEffect(() => {
    let alive = true
    Promise.all(videos.map((v) => getVideoUrl(v.id).then((u) => [v.id, u]))).then((pairs) => {
      if (!alive) return
      setUrls(Object.fromEntries(pairs.filter(([, u]) => u)))
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return urls
}

export default function MediaUploader({ photos = [], videos = [], onChangePhotos, onChangeVideos }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const videoUrls = useVideoUrls(videos)

  async function handleFiles(fileList) {
    const files = Array.from(fileList)
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    const vids = files.filter((f) => f.type.startsWith('video/'))
    setBusy(true)
    try {
      if (imgs.length) {
        const urls = await Promise.all(imgs.map(fileToDataUrl))
        onChangePhotos([...photos, ...urls])
      }
      if (vids.length) {
        const added = []
        for (const f of vids) {
          const id = await putVideo(f)
          added.push({ id, name: f.name })
        }
        onChangeVideos([...videos, ...added])
      }
    } finally {
      setBusy(false)
    }
  }

  function removePhoto(i) {
    onChangePhotos(photos.filter((_, idx) => idx !== i))
  }
  function removeVideo(id) {
    deleteVideo(id)
    onChangeVideos(videos.filter((v) => v.id !== id))
  }

  return (
    <div className="mu">
      <div className="mu-grid">
        {photos.map((src, i) => (
          <div key={'p' + i} className="mu-thumb">
            <img src={src} alt={`Photo ${i + 1}`} />
            <button type="button" className="mu-remove" onClick={() => removePhoto(i)} aria-label={`Remove photo ${i + 1}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
            {i === 0 && videos.length === 0 && <span className="mu-tag">Cover</span>}
          </div>
        ))}
        {videos.map((v) => (
          <div key={v.id} className="mu-thumb mu-thumb-video">
            {videoUrls[v.id] ? (
              <video src={videoUrls[v.id]} muted playsInline preload="metadata" />
            ) : (
              <div className="mu-video-ph">🎬</div>
            )}
            <span className="mu-play" aria-hidden="true">▶</span>
            <button type="button" className="mu-remove" onClick={() => removeVideo(v.id)} aria-label="Remove video">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
            <span className="mu-tag mu-tag-video">Video</span>
          </div>
        ))}
        <button type="button" className="mu-add" onClick={() => inputRef.current?.click()} disabled={busy}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          <span>{busy ? 'Adding…' : 'Add photos / video'}</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="sr-only"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
      />
      <style>{`
        .mu-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 10px; }
        .mu-thumb { position: relative; aspect-ratio: 4/3; border-radius: var(--r-md); overflow: hidden; border: 1px solid var(--line); background: var(--surface-sunk); }
        .mu-thumb img, .mu-thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
        .mu-video-ph { width: 100%; height: 100%; display: grid; place-items: center; font-size: 28px; background: #1c1c1c; }
        .mu-play { position: absolute; inset: 0; margin: auto; width: 30px; height: 30px; display: grid; place-items: center;
          background: rgba(0,0,0,0.5); color: #fff; border-radius: 50%; font-size: 12px; pointer-events: none; }
        .mu-remove { position: absolute; top: 5px; right: 5px; width: 24px; height: 24px; border-radius: 50%;
          border: none; background: rgba(20,18,12,0.68); color: #fff; display: grid; place-items: center; cursor: pointer; z-index: 2; }
        .mu-remove:hover { background: var(--danger); }
        .mu-tag { position: absolute; bottom: 5px; left: 5px; font-size: 10px; font-weight: 700; letter-spacing: 0.04em;
          text-transform: uppercase; background: var(--green-700); color: #fff; padding: 2px 7px; border-radius: 999px; }
        .mu-tag-video { background: #1c1c1c; }
        .mu-add { aspect-ratio: 4/3; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
          border: 1.5px dashed var(--line-strong); border-radius: var(--r-md); background: var(--surface-sunk);
          color: var(--ink-500); font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; text-align: center; padding: 6px; }
        .mu-add:hover:not(:disabled) { border-color: var(--green-500); color: var(--green-700); }
        .mu-add:disabled { opacity: 0.6; cursor: default; }
      `}</style>
    </div>
  )
}

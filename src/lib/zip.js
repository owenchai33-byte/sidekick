// Tiny dependency-free ZIP writer (STORE method — no compression). Enough to
// bundle a "content kit" (PNGs, an mp4, text files) into one download. Files
// are already compressed formats, so storing them uncompressed is fine.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const enc = new TextEncoder()

// Approximate the DOS time/date fields from `now` (good enough for archives).
function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31)
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
  return { time: time & 0xffff, date: date & 0xffff }
}

/**
 * @param {{name: string, data: Uint8Array}[]} files
 * @returns {Blob} a valid .zip
 */
export function makeZip(files) {
  const { time, date } = dosDateTime()
  const chunks = []
  const central = []
  let offset = 0

  for (const f of files) {
    const nameBytes = enc.encode(f.name)
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data)
    const crc = crc32(data)

    // Local file header
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true)
    lh.setUint16(4, 20, true)          // version needed
    lh.setUint16(6, 0, true)           // flags
    lh.setUint16(8, 0, true)           // method 0 = store
    lh.setUint16(10, time, true)
    lh.setUint16(12, date, true)
    lh.setUint32(14, crc, true)
    lh.setUint32(18, data.length, true)
    lh.setUint32(22, data.length, true)
    lh.setUint16(26, nameBytes.length, true)
    lh.setUint16(28, 0, true)          // extra length
    chunks.push(new Uint8Array(lh.buffer), nameBytes, data)

    // Central directory record
    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true)
    ch.setUint16(4, 20, true)          // version made by
    ch.setUint16(6, 20, true)          // version needed
    ch.setUint16(8, 0, true)
    ch.setUint16(10, 0, true)
    ch.setUint16(12, time, true)
    ch.setUint16(14, date, true)
    ch.setUint32(16, crc, true)
    ch.setUint32(20, data.length, true)
    ch.setUint32(24, data.length, true)
    ch.setUint16(28, nameBytes.length, true)
    ch.setUint16(30, 0, true)          // extra
    ch.setUint16(32, 0, true)          // comment
    ch.setUint16(34, 0, true)          // disk
    ch.setUint16(36, 0, true)          // internal attrs
    ch.setUint32(38, 0, true)          // external attrs
    ch.setUint32(42, offset, true)     // local header offset
    central.push(new Uint8Array(ch.buffer), nameBytes)

    offset += 30 + nameBytes.length + data.length
  }

  const centralStart = offset
  let centralSize = 0
  for (const c of central) centralSize += c.length

  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(4, 0, true)
  end.setUint16(6, 0, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, centralStart, true)
  end.setUint16(20, 0, true)

  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' })
}

export async function canvasToBytes(canvas, type = 'image/png', quality) {
  const blob = await new Promise((res) => canvas.toBlob(res, type, quality))
  return new Uint8Array(await blob.arrayBuffer())
}

export function textBytes(str) {
  return enc.encode(str)
}

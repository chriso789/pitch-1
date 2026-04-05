// Mapbox Terrain-RGB Elevation Fetcher
// Fetches elevation data from Mapbox Terrain-RGB tiles
// Decodes RGB → elevation using: height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
// Used for independent pitch calculation when Solar API is unavailable

type LngLat = [number, number]; // [lng, lat]

export interface TerrainElevationResult {
  available: boolean;
  elevations: ElevationSample[];
  ridgeElevation?: number;
  eaveElevation?: number;
  estimatedPitchDegrees?: number;
  estimatedPitchRatio?: string;
  confidence: number;
  source: 'mapbox_terrain_rgb';
  error?: string;
}

export interface ElevationSample {
  lng: number;
  lat: number;
  elevationMeters: number;
  label?: string;
}

// Convert lat/lng to tile coordinates at a given zoom
function lngLatToTile(lng: number, lat: number, zoom: number): { x: number; y: number; px: number; py: number } {
  const n = Math.pow(2, zoom);
  const xTile = Math.floor(((lng + 180) / 360) * n);
  const latRad = lat * Math.PI / 180;
  const yTile = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);

  // Pixel position within the 256x256 tile
  const xFrac = (((lng + 180) / 360) * n) - xTile;
  const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n) - yTile;
  const px = Math.floor(xFrac * 256);
  const py = Math.floor(yFrac * 256);

  return { x: xTile, y: yTile, px, py };
}

// Decode Mapbox Terrain-RGB pixel to elevation
function decodeTerrainRGB(r: number, g: number, b: number): number {
  return -10000 + ((r * 256 * 256 + g * 256 + b) * 0.1);
}

/**
 * Fetch elevation at a single point from Mapbox Terrain-RGB tiles.
 * Uses zoom 15 for ~5m resolution (good enough for building-scale pitch).
 */
async function fetchElevationAtPoint(
  lng: number,
  lat: number,
  accessToken: string,
  zoom: number = 15
): Promise<number | null> {
  const { x, y, px, py } = lngLatToTile(lng, lat, zoom);

  const url = `https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1/${zoom}/${x}/${y}.pngraw?access_token=${accessToken}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Terrain tile fetch failed: ${response.status}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Parse raw PNG to get pixel data
    // pngraw returns raw RGBA data in a simplified format
    // For Mapbox terrain tiles, we need to decode the PNG
    const pixelData = await decodePNGPixels(bytes);
    if (!pixelData) return null;

    const idx = (py * 256 + px) * 4; // RGBA
    if (idx + 2 >= pixelData.length) return null;

    const r = pixelData[idx];
    const g = pixelData[idx + 1];
    const b = pixelData[idx + 2];

    return decodeTerrainRGB(r, g, b);
  } catch (err) {
    console.warn(`Terrain elevation fetch error: ${err}`);
    return null;
  }
}

/**
 * Minimal PNG decoder for raw RGBA pixel data.
 * Handles the specific format returned by Mapbox terrain tiles.
 */
async function decodePNGPixels(pngBytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    // Use the DecompressionStream API available in Deno
    // PNG structure: signature (8) + chunks
    // We need to find IDAT chunks and decompress them

    // Verify PNG signature
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) {
      if (pngBytes[i] !== sig[i]) return null;
    }

    // Read IHDR
    let offset = 8;
    const ihdrLength = readUint32(pngBytes, offset);
    offset += 4;
    // Skip "IHDR" type
    offset += 4;
    const width = readUint32(pngBytes, offset); offset += 4;
    const height = readUint32(pngBytes, offset); offset += 4;
    const bitDepth = pngBytes[offset++];
    const colorType = pngBytes[offset++];
    offset += 3; // compression, filter, interlace
    offset += 4; // CRC

    if (width !== 256 || height !== 256 || bitDepth !== 8) {
      console.warn(`Unexpected tile format: ${width}x${height} bd=${bitDepth} ct=${colorType}`);
    }

    // Collect all IDAT chunk data
    const idatChunks: Uint8Array[] = [];
    while (offset < pngBytes.length) {
      const chunkLen = readUint32(pngBytes, offset); offset += 4;
      const chunkType = String.fromCharCode(pngBytes[offset], pngBytes[offset+1], pngBytes[offset+2], pngBytes[offset+3]);
      offset += 4;

      if (chunkType === 'IDAT') {
        idatChunks.push(pngBytes.slice(offset, offset + chunkLen));
      }

      offset += chunkLen + 4; // data + CRC

      if (chunkType === 'IEND') break;
    }

    if (idatChunks.length === 0) return null;

    // Concatenate IDAT data
    const totalLen = idatChunks.reduce((s, c) => s + c.length, 0);
    const compressed = new Uint8Array(totalLen);
    let pos = 0;
    for (const chunk of idatChunks) {
      compressed.set(chunk, pos);
      pos += chunk.length;
    }

    // Decompress using DecompressionStream (zlib/deflate)
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    // Strip zlib header (2 bytes) if present
    const dataToDecompress = compressed[0] === 0x78 ? compressed.slice(2) : compressed;

    writer.write(dataToDecompress);
    writer.close();

    const decompressedChunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      decompressedChunks.push(value);
    }

    const rawLen = decompressedChunks.reduce((s, c) => s + c.length, 0);
    const raw = new Uint8Array(rawLen);
    let rawPos = 0;
    for (const chunk of decompressedChunks) {
      raw.set(chunk, rawPos);
      rawPos += chunk.length;
    }

    // Channels per pixel
    const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 4;
    const bpp = channels; // bytes per pixel at 8-bit depth
    const scanlineBytes = width * channels;
    const pixels = new Uint8Array(width * height * 4);

    // De-filter scanlines
    const prevRow = new Uint8Array(scanlineBytes);
    let rawOffset = 0;

    for (let y = 0; y < height; y++) {
      const filterType = raw[rawOffset++];
      const curRow = new Uint8Array(scanlineBytes);

      for (let x = 0; x < scanlineBytes; x++) {
        const rawByte = raw[rawOffset++] || 0;
        const a = x >= bpp ? curRow[x - bpp] : 0;
        const b = prevRow[x];
        const c = x >= bpp ? prevRow[x - bpp] : 0;

        switch (filterType) {
          case 0: curRow[x] = rawByte; break;
          case 1: curRow[x] = (rawByte + a) & 0xFF; break;
          case 2: curRow[x] = (rawByte + b) & 0xFF; break;
          case 3: curRow[x] = (rawByte + Math.floor((a + b) / 2)) & 0xFF; break;
          case 4: curRow[x] = (rawByte + paethPredictor(a, b, c)) & 0xFF; break;
          default: curRow[x] = rawByte;
        }
      }

      // Copy to output pixels (always RGBA)
      for (let x = 0; x < width; x++) {
        const srcIdx = x * channels;
        const dstIdx = (y * width + x) * 4;
        pixels[dstIdx] = curRow[srcIdx];       // R
        pixels[dstIdx + 1] = curRow[srcIdx + 1]; // G
        pixels[dstIdx + 2] = curRow[srcIdx + 2]; // B
        pixels[dstIdx + 3] = channels === 4 ? curRow[srcIdx + 3] : 255; // A
      }

      prevRow.set(curRow);
    }

    return pixels;
  } catch (err) {
    console.warn(`PNG decode error: ${err}`);
    return null;
  }
}

function readUint32(buf: Uint8Array, offset: number): number {
  return (buf[offset] << 24) | (buf[offset+1] << 16) | (buf[offset+2] << 8) | buf[offset+3];
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Sample elevations at multiple points on a building footprint.
 * Estimates ridge/eave heights and computes pitch.
 */
export async function fetchTerrainElevation(
  footprintVertices: LngLat[],
  ridgePoints: LngLat[],
  accessToken: string
): Promise<TerrainElevationResult> {
  if (!accessToken) {
    return { available: false, elevations: [], confidence: 0, source: 'mapbox_terrain_rgb', error: 'No Mapbox token' };
  }

  if (footprintVertices.length < 3) {
    return { available: false, elevations: [], confidence: 0, source: 'mapbox_terrain_rgb', error: 'Insufficient vertices' };
  }

  try {
    console.log(`🏔️ Fetching terrain elevation for ${footprintVertices.length} eave points, ${ridgePoints.length} ridge points`);

    // Sample eave (perimeter) elevations
    const eavePromises = footprintVertices.map((v, i) =>
      fetchElevationAtPoint(v[0], v[1], accessToken).then(elev => ({
        lng: v[0], lat: v[1],
        elevationMeters: elev ?? 0,
        label: `eave_${i}`,
      }))
    );

    // Sample ridge elevations
    const ridgePromises = ridgePoints.map((v, i) =>
      fetchElevationAtPoint(v[0], v[1], accessToken).then(elev => ({
        lng: v[0], lat: v[1],
        elevationMeters: elev ?? 0,
        label: `ridge_${i}`,
      }))
    );

    const allSamples = await Promise.all([...eavePromises, ...ridgePromises]);
    const eaveSamples = allSamples.filter(s => s.label?.startsWith('eave_'));
    const ridgeSamples = allSamples.filter(s => s.label?.startsWith('ridge_'));

    // Calculate average eave and ridge elevations
    const avgEaveElev = eaveSamples.length > 0
      ? eaveSamples.reduce((s, e) => s + e.elevationMeters, 0) / eaveSamples.length
      : 0;
    const avgRidgeElev = ridgeSamples.length > 0
      ? ridgeSamples.reduce((s, e) => s + e.elevationMeters, 0) / ridgeSamples.length
      : 0;

    // Estimate pitch from elevation delta
    let estimatedPitchDegrees: number | undefined;
    let estimatedPitchRatio: string | undefined;
    let confidence = 0.3; // base

    if (ridgeSamples.length > 0 && eaveSamples.length > 0) {
      const riseMeters = avgRidgeElev - avgEaveElev;

      if (riseMeters > 0.3) { // Minimum detectable rise
        // Estimate horizontal run as half the average building width
        const lngs = footprintVertices.map(v => v[0]);
        const lats = footprintVertices.map(v => v[1]);
        const avgLat = (Math.min(...lats) + Math.max(...lats)) / 2;
        const metersPerDegLng = 111320 * Math.cos(avgLat * Math.PI / 180);
        const metersPerDegLat = 111320;
        const widthM = (Math.max(...lngs) - Math.min(...lngs)) * metersPerDegLng;
        const heightM = (Math.max(...lats) - Math.min(...lats)) * metersPerDegLat;
        const halfSpanM = Math.min(widthM, heightM) / 2;

        if (halfSpanM > 1) {
          estimatedPitchDegrees = Math.atan(riseMeters / halfSpanM) * (180 / Math.PI);
          const rise12 = Math.round(Math.tan(estimatedPitchDegrees * Math.PI / 180) * 12);
          estimatedPitchRatio = `${Math.max(1, Math.min(24, rise12))}/12`;
          confidence = estimatedPitchDegrees > 5 && estimatedPitchDegrees < 60 ? 0.6 : 0.35;
        }
      } else {
        // Flat or near-flat roof
        estimatedPitchDegrees = 0;
        estimatedPitchRatio = 'flat';
        confidence = 0.5;
      }
    }

    console.log(`✅ Terrain: eave=${avgEaveElev.toFixed(1)}m, ridge=${avgRidgeElev.toFixed(1)}m, pitch=${estimatedPitchRatio || 'N/A'} (conf=${confidence.toFixed(2)})`);

    return {
      available: true,
      elevations: allSamples,
      ridgeElevation: avgRidgeElev,
      eaveElevation: avgEaveElev,
      estimatedPitchDegrees,
      estimatedPitchRatio,
      confidence,
      source: 'mapbox_terrain_rgb',
    };
  } catch (err) {
    console.error('Terrain elevation error:', err);
    return { available: false, elevations: [], confidence: 0, source: 'mapbox_terrain_rgb', error: String(err) };
  }
}

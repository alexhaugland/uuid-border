/**
 * BARCODE-STYLE DECODING
 * 
 * Linear barcodes are robust because they:
 * 1. Find ALL edges (transitions)
 * 2. Measure RUN LENGTHS between edges
 * 3. Use RATIOS, not absolute positions
 * 
 * Our encoding structure:
 * - START: [1,1,1,0,1,2] - has runs of 3,1,1,1 (merged same-colors)
 * - INDEX: [0,1,2,3,4,5,6,7] - 8 runs, each 1 unit
 * - DATA: variable
 * - END: [2,1,0,1,1,1] - has runs of 1,1,1,3
 * 
 * The INDEX sequence is perfect for calibration - 8 unique colors,
 * each exactly 1 unit wide. We measure the actual run lengths to
 * determine the true "unit width".
 */

import { PNG } from 'pngjs';
import { readFileSync } from 'fs';
import { RGB, isEncodedColor, indicesToHexDigit } from './src/lib/uuid-border';
import { rsDecode, bytesToUuid, calculateParityBytes, DEFAULT_RS_CONFIG } from './src/lib/reed-solomon';

for (const filename of ['90_zoom.png', '90_zoom2.png']) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`BARCODE-STYLE DECODING: ${filename}`);
  console.log('='.repeat(70));
  
  const buffer = readFileSync(`./${filename}`);
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;

  const getPixel = (x: number, y: number): RGB | undefined => {
    if (x < 0 || x >= width || y < 0 || y >= height) return undefined;
    const idx = (y * width + x) * 4;
    return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
  };

  // Find the best row
  let bestRow = { y: 0, count: 0 };
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      const p = getPixel(x, y);
      if (p && isEncodedColor(p, 20)) count++;
    }
    if (count > bestRow.count) bestRow = { y, count };
  }
  
  const y = bestRow.y;
  console.log(`Best row: y=${y} with ${bestRow.count} encoded pixels`);

  // ============================================================
  // STEP 1: SCAN FOR ALL RUNS (like a barcode scanner)
  // ============================================================
  
  interface Run {
    startX: number;
    endX: number;
    length: number;
    colorIdx: number;  // 0-7 based on R,G,B thresholds
    avgR: number;
    avgG: number;
    avgB: number;
  }
  
  const MID = 133;  // Initial threshold for finding runs
  
  const getColorIdx = (p: RGB): number => {
    const rBit = p.r > MID ? 1 : 0;
    const gBit = p.g > MID ? 1 : 0;
    const bBit = p.b > MID ? 1 : 0;
    return rBit | (gBit << 1) | (bBit << 2);
  };
  
  const runs: Run[] = [];
  let currentRun: { startX: number; pixels: RGB[] } | null = null;
  let currentIdx = -1;
  
  for (let x = 0; x < width; x++) {
    const p = getPixel(x, y);
    
    if (!p || !isEncodedColor(p, 25)) {
      // End current run if any
      if (currentRun && currentRun.pixels.length > 0) {
        const avgR = currentRun.pixels.reduce((s, p) => s + p.r, 0) / currentRun.pixels.length;
        const avgG = currentRun.pixels.reduce((s, p) => s + p.g, 0) / currentRun.pixels.length;
        const avgB = currentRun.pixels.reduce((s, p) => s + p.b, 0) / currentRun.pixels.length;
        runs.push({
          startX: currentRun.startX,
          endX: x,
          length: x - currentRun.startX,
          colorIdx: currentIdx,
          avgR, avgG, avgB
        });
      }
      currentRun = null;
      currentIdx = -1;
      continue;
    }
    
    const idx = getColorIdx(p);
    
    if (currentIdx !== idx) {
      // End previous run
      if (currentRun && currentRun.pixels.length > 0) {
        const avgR = currentRun.pixels.reduce((s, p) => s + p.r, 0) / currentRun.pixels.length;
        const avgG = currentRun.pixels.reduce((s, p) => s + p.g, 0) / currentRun.pixels.length;
        const avgB = currentRun.pixels.reduce((s, p) => s + p.b, 0) / currentRun.pixels.length;
        runs.push({
          startX: currentRun.startX,
          endX: x,
          length: x - currentRun.startX,
          colorIdx: currentIdx,
          avgR, avgG, avgB
        });
      }
      // Start new run
      currentRun = { startX: x, pixels: [p] };
      currentIdx = idx;
    } else {
      currentRun?.pixels.push(p);
    }
  }
  
  console.log(`Found ${runs.length} color runs`);
  
  // ============================================================
  // STEP 2: FIND THE INDEX SEQUENCE [0,1,2,3,4,5,6,7]
  // This is 8 consecutive runs with indices 0,1,2,3,4,5,6,7
  // ============================================================
  
  let indexRunStart = -1;
  
  for (let i = 0; i <= runs.length - 8; i++) {
    let matches = 0;
    for (let j = 0; j < 8; j++) {
      if (runs[i + j].colorIdx === j) matches++;
    }
    
    // Allow some tolerance (6+ matches)
    if (matches >= 6) {
      indexRunStart = i;
      console.log(`Found INDEX sequence at run ${i} with ${matches}/8 matches`);
      break;
    }
  }
  
  if (indexRunStart < 0) {
    console.log('Failed to find INDEX sequence');
    console.log('First 20 runs:', runs.slice(0, 20).map(r => r.colorIdx).join(','));
    continue;
  }
  
  // ============================================================
  // STEP 3: MEASURE UNIT WIDTH FROM INDEX SEQUENCE
  // Each of the 8 runs should be 1 unit wide
  // ============================================================
  
  const indexRuns = runs.slice(indexRunStart, indexRunStart + 8);
  const indexLengths = indexRuns.map(r => r.length);
  const totalIndexLength = indexLengths.reduce((a, b) => a + b, 0);
  const unitWidth = totalIndexLength / 8;  // Average of 8 "1-unit" runs
  
  console.log(`Index run lengths: [${indexLengths.join(', ')}]`);
  console.log(`Unit width: ${unitWidth.toFixed(2)} pixels`);
  
  // ============================================================
  // STEP 4: BUILD CALIBRATED THRESHOLDS FROM INDEX COLORS
  // ============================================================
  
  const median4 = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return (sorted[1] + sorted[2]) / 2;
  };
  
  // Use the actual average colors from the index runs
  const rLow = [0, 2, 4, 6].map(i => indexRuns[i].avgR);
  const rHigh = [1, 3, 5, 7].map(i => indexRuns[i].avgR);
  const rThreshold = (median4(rLow) + median4(rHigh)) / 2;
  
  const gLow = [0, 1, 4, 5].map(i => indexRuns[i].avgG);
  const gHigh = [2, 3, 6, 7].map(i => indexRuns[i].avgG);
  const gThreshold = (median4(gLow) + median4(gHigh)) / 2;
  
  const bLow = [0, 1, 2, 3].map(i => indexRuns[i].avgB);
  const bHigh = [4, 5, 6, 7].map(i => indexRuns[i].avgB);
  const bThreshold = (median4(bLow) + median4(bHigh)) / 2;
  
  console.log(`Thresholds: R=${rThreshold.toFixed(1)}, G=${gThreshold.toFixed(1)}, B=${bThreshold.toFixed(1)}`);
  
  // Recalculate color indices with calibrated thresholds
  const recalibratedIdx = (r: Run): number => {
    const rBit = r.avgR > rThreshold ? 1 : 0;
    const gBit = r.avgG > gThreshold ? 1 : 0;
    const bBit = r.avgB > bThreshold ? 1 : 0;
    return rBit | (gBit << 1) | (bBit << 2);
  };
  
  // ============================================================
  // STEP 5: DECODE USING RUN LENGTHS
  // 
  // The key insight: we know the expected structure:
  // - START: 6 segments = [1,1,1,0,1,2] -> runs: 3x1, 1x0, 1x1, 1x2 = 4 runs (merged)
  //   OR if not merged: 6 runs
  // - INDEX: 8 segments = 8 runs (found above)
  // - DATA: 128 segments (32 bytes * 4 segments/byte)
  // - END: 6 segments
  // ============================================================
  
  // The INDEX starts at run indexRunStart
  // Before INDEX is START (6 segments, but may be merged)
  // After INDEX is DATA (128 segments) then END (6 segments)
  
  // For DATA, each byte is 4 segments. Each segment is ~1 unit.
  // But runs may be merged if same color!
  
  // Let's decode by position instead of runs:
  // We know INDEX starts at position indexRuns[0].startX
  // And INDEX is 8 units wide (indexRuns ends at indexRuns[7].endX)
  
  // INDEX is at segments 6-13 (8 segments)
  // DATA is at segments 14-141 (128 segments)
  // 
  // indexRuns[0] is at segment 6, so:
  // encodingStartX = indexRuns[0].startX - 6 * unitWidth
  // dataStartX = encodingStartX + 14 * unitWidth
  
  const indexStartX = indexRuns[0].startX;
  const encodingStartX = indexStartX - 6 * unitWidth;  // Start of whole encoding
  const dataStartX = encodingStartX + 14 * unitWidth;  // DATA starts at segment 14
  
  console.log(`\nEncoding starts at: x=${encodingStartX.toFixed(1)}`);
  console.log(`Index at: x=${indexStartX} (segment 6)`);
  console.log(`Data starts at: x=${dataStartX.toFixed(1)} (segment 14)`);
  
  // Decode a segment by averaging pixels in that position range
  const decodeSegmentByPosition = (segmentStartX: number): number => {
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    
    for (let x = Math.floor(segmentStartX); x < Math.floor(segmentStartX + unitWidth); x++) {
      const p = getPixel(x, y);
      if (p && isEncodedColor(p, 30)) {
        rSum += p.r;
        gSum += p.g;
        bSum += p.b;
        count++;
      }
    }
    
    if (count === 0) return 0;
    
    const rAvg = rSum / count;
    const gAvg = gSum / count;
    const bAvg = bSum / count;
    
    const rBit = rAvg > rThreshold ? 1 : 0;
    const gBit = gAvg > gThreshold ? 1 : 0;
    const bBit = bAvg > bThreshold ? 1 : 0;
    
    return rBit | (gBit << 1) | (bBit << 2);
  };
  
  // DATA has 128 segments (32 bytes * 4 segments/byte)
  const nsym = calculateParityBytes(16, DEFAULT_RS_CONFIG.redundancyFactor);
  const totalBytes = 16 + nsym;  // 32 bytes
  
  const bytes: number[] = [];
  
  for (let byteIdx = 0; byteIdx < totalBytes; byteIdx++) {
    const byteStartX = dataStartX + byteIdx * 4 * unitWidth;
    
    const segments: number[] = [];
    for (let s = 0; s < 4; s++) {
      const segX = byteStartX + s * unitWidth;
      segments.push(decodeSegmentByPosition(segX));
    }
    
    const highNibble = indicesToHexDigit(segments[0], segments[1]);
    const lowNibble = indicesToHexDigit(segments[2], segments[3]);
    bytes.push((highNibble << 4) | lowNibble);
  }
  
  console.log(`\nDecoded ${totalBytes} bytes`);
  console.log(`First 16 (UUID): ${bytes.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  console.log(`Last 16 (parity): ${bytes.slice(16).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  
  // Check UUID v4 markers in the raw bytes (before RS)
  const byte6 = bytes[6];
  const byte8 = bytes[8];
  const version = (byte6 >> 4) & 0xF;
  const variant = (byte8 >> 4) & 0xF;
  
  console.log(`\nUUID markers: version=${version} (should be 4), variant=${variant} (should be 8-11)`);
  
  // RS decode
  const encodedBytes = new Uint8Array(bytes);
  const decodedBytes = rsDecode(encodedBytes, nsym);
  
  if (decodedBytes) {
    const uuid = bytesToUuid(decodedBytes);
    console.log(`\n✅ RS SUCCESS! Decoded UUID: ${uuid}`);
  } else {
    console.log(`\n⚠️ RS decode failed - attempting direct UUID extraction`);
    
    // Try to extract UUID directly from first 16 bytes
    // This works if UUID bytes are correct but parity is corrupted
    const uuidBytes = new Uint8Array(bytes.slice(0, 16));
    const directUuid = bytesToUuid(uuidBytes);
    console.log(`   Direct UUID (unverified): ${directUuid}`);
    
    // Check if it looks valid
    if (version === 4 && variant >= 8 && variant <= 11) {
      console.log(`   ✓ UUID v4 markers are correct - UUID is likely valid!`);
    }
  }
}

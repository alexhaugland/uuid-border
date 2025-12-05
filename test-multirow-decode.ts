/**
 * Test multi-row decoding - decode from multiple adjacent rows and vote
 */
import { PNG } from 'pngjs';
import { readFileSync } from 'fs';
import { RGB, isEncodedColor, TOTAL_SEGMENTS, MARKER_START_PATTERN, indicesToHexDigit } from './src/lib/uuid-border';
import { rsDecode, bytesToUuid, calculateParityBytes, DEFAULT_RS_CONFIG } from './src/lib/reed-solomon';

for (const filename of ['90_zoom.png', '90_zoom2.png']) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${filename} with multi-row decoding`);
  console.log('='.repeat(60));
  
  const buffer = readFileSync(`./${filename}`);
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;

  const getPixel = (x: number, y: number): RGB | undefined => {
    if (x < 0 || x >= width || y < 0 || y >= height) return undefined;
    const idx = (y * width + x) * 4;
    return {
      r: data[idx],
      g: data[idx + 1],
      b: data[idx + 2],
    };
  };

  // Find rows with encoded data
  const encodedRows: number[] = [];
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      const p = getPixel(x, y);
      if (p && isEncodedColor(p, 20)) count++;
    }
    if (count > 500) encodedRows.push(y);
  }
  
  console.log(`Found ${encodedRows.length} rows with substantial encoded data`);
  
  if (encodedRows.length < 3) {
    console.log('Not enough rows for multi-row decoding');
    continue;
  }

  // Use the calibration from our previous analysis
  // For simplicity, let's find the index sequence manually
  
  // Find transitions in a known-good row
  const y0 = encodedRows[Math.floor(encodedRows.length / 2)];
  console.log(`Using center row y=${y0} for calibration`);
  
  const MID = 133;
  
  // Find the start of encoded data
  let startX = 0;
  for (let x = 0; x < width; x++) {
    const p = getPixel(x, y0);
    if (p && isEncodedColor(p, 20)) {
      startX = x;
      break;
    }
  }
  
  // Find transitions to locate the index sequence
  interface Transition { x: number; fromIdx: number; toIdx: number; }
  const transitions: Transition[] = [];
  let prevIdx = -1;
  
  for (let x = startX; x < width; x++) {
    const p = getPixel(x, y0);
    if (!p || !isEncodedColor(p, 25)) {
      prevIdx = -1;
      continue;
    }
    
    const rBit = p.r > MID ? 1 : 0;
    const gBit = p.g > MID ? 1 : 0;
    const bBit = p.b > MID ? 1 : 0;
    const idx = rBit | (gBit << 1) | (bBit << 2);
    
    if (prevIdx !== -1 && idx !== prevIdx) {
      transitions.push({ x, fromIdx: prevIdx, toIdx: idx });
    }
    prevIdx = idx;
  }
  
  // Find index sequence [0,1,2,3,4,5,6,7]
  let indexPositions: number[] | null = null;
  
  for (let i = 0; i <= transitions.length - 7; i++) {
    let matches = 0;
    for (let j = 0; j < 7; j++) {
      if (transitions[i+j].fromIdx === j && transitions[i+j].toIdx === j+1) matches++;
    }
    
    if (matches >= 5) {
      indexPositions = [];
      const prevT = i > 0 ? transitions[i-1] : null;
      if (prevT) {
        indexPositions.push(prevT.x);
      } else {
        const gap = transitions[i+1].x - transitions[i].x;
        indexPositions.push(transitions[i].x - gap);
      }
      for (let j = 0; j < 7; j++) {
        indexPositions.push(transitions[i+j].x);
      }
      break;
    }
  }
  
  if (!indexPositions || indexPositions.length < 8) {
    console.log('Failed to find index sequence');
    continue;
  }
  
  // Calculate segment width and start position
  const totalSpan = indexPositions[7] - indexPositions[0];
  const pixelsPerSegment = totalSpan / 7;
  const encodingStartX = indexPositions[0] - 6 * pixelsPerSegment;
  
  console.log(`Calibration: startX=${encodingStartX.toFixed(2)}, pps=${pixelsPerSegment.toFixed(2)}`);
  
  // Build thresholds from index colors
  const indexColors: RGB[] = [];
  for (let i = 0; i < 8; i++) {
    const segStart = indexPositions[i];
    const segEnd = i < 7 ? indexPositions[i+1] : segStart + pixelsPerSegment;
    const centerX = Math.floor((segStart + segEnd) / 2);
    const p = getPixel(centerX, y0);
    if (p) indexColors.push(p);
  }
  
  const median4 = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return (sorted[1] + sorted[2]) / 2;
  };
  
  const rLow = [0, 2, 4, 6].map(i => indexColors[i].r);
  const rHigh = [1, 3, 5, 7].map(i => indexColors[i].r);
  const rThreshold = (median4(rLow) + median4(rHigh)) / 2;
  
  const gLow = [0, 1, 4, 5].map(i => indexColors[i].g);
  const gHigh = [2, 3, 6, 7].map(i => indexColors[i].g);
  const gThreshold = (median4(gLow) + median4(gHigh)) / 2;
  
  const bLow = [0, 1, 2, 3].map(i => indexColors[i].b);
  const bHigh = [4, 5, 6, 7].map(i => indexColors[i].b);
  const bThreshold = (median4(bLow) + median4(bHigh)) / 2;
  
  console.log(`Thresholds: R=${rThreshold.toFixed(1)}, G=${gThreshold.toFixed(1)}, B=${bThreshold.toFixed(1)}`);
  
  // Decode segment using MULTIPLE ROWS and floating-point averaging
  const decodeSegmentMultiRow = (segmentIndex: number, rows: number[]): number => {
    const segStart = encodingStartX + segmentIndex * pixelsPerSegment;
    
    let rSum = 0, gSum = 0, bSum = 0;
    let samples = 0;
    
    // Sample from multiple rows
    for (const y of rows) {
      // Sample multiple x positions within segment
      for (const frac of [0.25, 0.5, 0.75]) {
        const x = Math.floor(segStart + frac * pixelsPerSegment);
        const p = getPixel(x, y);
        if (p && isEncodedColor(p, 25)) {
          rSum += p.r;
          gSum += p.g;
          bSum += p.b;
          samples++;
        }
      }
    }
    
    if (samples === 0) return 0;
    
    // Average and threshold
    const rAvg = rSum / samples;
    const gAvg = gSum / samples;
    const bAvg = bSum / samples;
    
    const rBit = rAvg > rThreshold ? 1 : 0;
    const gBit = gAvg > gThreshold ? 1 : 0;
    const bBit = bAvg > bThreshold ? 1 : 0;
    
    return rBit | (gBit << 1) | (bBit << 2);
  };
  
  // Use multiple adjacent rows for decoding
  const centerIdx = Math.floor(encodedRows.length / 2);
  const rowsToUse = encodedRows.slice(
    Math.max(0, centerIdx - 2),
    Math.min(encodedRows.length, centerIdx + 3)
  );
  console.log(`Using ${rowsToUse.length} rows for decoding: y=${rowsToUse.join(', ')}`);
  
  // Decode data
  const nsym = calculateParityBytes(16, DEFAULT_RS_CONFIG.redundancyFactor);
  const totalBytes = 16 + nsym;
  const dataStartSegment = 14;
  
  const bytes: number[] = [];
  for (let byteIdx = 0; byteIdx < totalBytes; byteIdx++) {
    const baseSegment = dataStartSegment + byteIdx * 4;
    
    const segments: number[] = [];
    for (let s = 0; s < 4; s++) {
      segments.push(decodeSegmentMultiRow(baseSegment + s, rowsToUse));
    }
    
    const highNibble = indicesToHexDigit(segments[0], segments[1]);
    const lowNibble = indicesToHexDigit(segments[2], segments[3]);
    bytes.push((highNibble << 4) | lowNibble);
  }
  
  console.log(`First 16 bytes: ${bytes.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  
  // RS decode
  const encodedBytes = new Uint8Array(bytes);
  const decodedBytes = rsDecode(encodedBytes, nsym);
  
  if (decodedBytes) {
    const uuid = bytesToUuid(decodedBytes);
    console.log(`\n✅ SUCCESS! Decoded UUID: ${uuid}`);
  } else {
    console.log(`\n❌ RS decode failed`);
    console.log(`Raw bytes: ${bytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  }
}

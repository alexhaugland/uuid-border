// UUID Border Encoding/Decoding
// Uses a self-calibrating 8-color index followed by data
// Marker pattern uses index colors: BBBABC (start) and CBABBB (end)
// Now with Reed-Solomon error correction for robustness

import {
  rsEncode,
  rsDecode,
  DEFAULT_RS_CONFIG,
  calculateParityBytes,
  uuidToBytes,
  bytesToUuid,
} from './reed-solomon';
import type { RSConfig } from './reed-solomon';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

// Re-export RS config types for external use
export type { RSConfig };
export { DEFAULT_RS_CONFIG };

// Generate 8 distinct colors for the index (0-7)
// Using all three channels (R, G, B) for better differentiation
// Each bit of the index controls one channel: bit0=R, bit1=G, bit2=B
// This gives minimum 20-unit distance between any two colors
const BASE = 133;
const OFFSET = 10;

function generateIndexColors(): RGB[] {
  const colors: RGB[] = [];
  for (let i = 0; i < 8; i++) {
    colors.push({
      r: BASE + ((i & 1) ? OFFSET : -OFFSET),       // bit 0
      g: BASE + ((i & 2) ? OFFSET : -OFFSET),       // bit 1
      b: BASE + ((i & 4) ? OFFSET : -OFFSET),       // bit 2
    });
  }
  return colors;
  // Results in:
  // 0: (123, 123, 123) - all low
  // 1: (143, 123, 123) - R high
  // 2: (123, 143, 123) - G high
  // 3: (143, 143, 123) - R,G high
  // 4: (123, 123, 143) - B high
  // 5: (143, 123, 143) - R,B high
  // 6: (123, 143, 143) - G,B high
  // 7: (143, 143, 143) - all high
}

export const INDEX_COLORS = generateIndexColors();

// Marker patterns using index colors
// Start: BBBABC = [1,1,1,0,1,2]
// End: CBABBB = [2,1,0,1,1,1]
export const MARKER_START_PATTERN = [1, 1, 1, 0, 1, 2];
export const MARKER_END_PATTERN = [2, 1, 0, 1, 1, 1];

/**
 * Convert a hex digit (0-15) to two index colors
 * First color: digit >> 3 (0-1)
 * Second color: digit & 7 (0-7)
 */
export function hexDigitToColors(digit: number): [RGB, RGB] {
  const high = (digit >> 3) & 1;
  const low = digit & 7;
  return [INDEX_COLORS[high], INDEX_COLORS[low]];
}

/**
 * Convert two color indices back to a hex digit
 */
export function indicesToHexDigit(high: number, low: number): number {
  return ((high & 1) << 3) | (low & 7);
}

/**
 * Generate the color sequence for a UUID with Reed-Solomon error correction
 * Format: [START: BBBABC] [INDEX: 8 colors] [DATA: 2*(16+nsym)*2 colors] [END: CBABBB]
 * With default 2x redundancy: 6 + 8 + 128 + 6 = 148 segments
 */
export function uuidToColorSequence(uuid: string, rsConfig: RSConfig = DEFAULT_RS_CONFIG): RGB[] {
  const cleanUuid = uuid.replace(/-/g, '').toLowerCase();
  
  if (cleanUuid.length !== 32) {
    throw new Error('Invalid UUID format');
  }
  
  // Convert UUID to bytes and apply RS encoding
  const uuidBytes = uuidToBytes(uuid);
  const nsym = calculateParityBytes(16, rsConfig.redundancyFactor);
  const rsEncoded = rsEncode(uuidBytes, nsym);
  
  const colors: RGB[] = [];
  
  // Add start marker: BBBABC
  for (const idx of MARKER_START_PATTERN) {
    colors.push(INDEX_COLORS[idx]);
  }
  
  // Add the 8 index colors (0-7)
  for (let i = 0; i < 8; i++) {
    colors.push(INDEX_COLORS[i]);
  }
  
  // Add the RS-encoded data colors (2 colors per byte = 4 colors per hex byte)
  // Each byte is encoded as 2 hex digits, each digit as 2 colors
  for (const byte of rsEncoded) {
    const highNibble = (byte >> 4) & 0xF;
    const lowNibble = byte & 0xF;
    
    const [highHigh, highLow] = hexDigitToColors(highNibble);
    const [lowHigh, lowLow] = hexDigitToColors(lowNibble);
    
    colors.push(highHigh);
    colors.push(highLow);
    colors.push(lowHigh);
    colors.push(lowLow);
  }
  
  // Add end marker: CBABBB
  for (const idx of MARKER_END_PATTERN) {
    colors.push(INDEX_COLORS[idx]);
  }
  
  return colors;
}

/**
 * Calculate total segments for a given RS config
 */
export function calculateTotalSegments(rsConfig: RSConfig = DEFAULT_RS_CONFIG): number {
  const nsym = calculateParityBytes(16, rsConfig.redundancyFactor);
  const totalBytes = 16 + nsym;
  const dataSegments = totalBytes * 4; // 4 color segments per byte
  return 6 + 8 + dataSegments + 6; // markers + index + data + markers
}

/**
 * Find the closest index color to a given color
 * Returns the hex digit (0-15)
 */
export function findClosestIndexColor(color: RGB, indexColors: RGB[]): number {
  let minDist = Infinity;
  let closest = 0;
  
  for (let i = 0; i < indexColors.length; i++) {
    const ic = indexColors[i];
    // Euclidean distance in RGB space
    const dist = Math.sqrt(
      Math.pow(color.r - ic.r, 2) +
      Math.pow(color.g - ic.g, 2) +
      Math.pow(color.b - ic.b, 2)
    );
    
    if (dist < minDist) {
      minDist = dist;
      closest = i;
    }
  }
  
  return closest;
}

/**
 * Generate a random UUID v4
 */
export function generateUuid(): string {
  const hex = '0123456789abcdef';
  let uuid = '';
  
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-';
    } else if (i === 14) {
      uuid += '4'; // Version 4
    } else if (i === 19) {
      uuid += hex[(Math.random() * 4 + 8) | 0]; // Variant bits
    } else {
      uuid += hex[(Math.random() * 16) | 0];
    }
  }
  
  return uuid;
}

// Default total segments with 2x redundancy: 6 + 8 + 128 + 6 = 148
export const TOTAL_SEGMENTS = calculateTotalSegments(DEFAULT_RS_CONFIG);

/**
 * Draw encoded border on a canvas context
 * Layout with RS: START(6) + INDEX(8) + DATA(4*totalBytes) + END(6)
 * With default 2x redundancy: 6 + 8 + 128 + 6 = 148 segments
 * 
 * @param borderRadius - Radius for rounded corners (default 0)
 * @param rsConfig - Reed-Solomon configuration
 * @returns Object with offset information for positioning content inside the border
 */
export function drawEncodedBorder(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  uuid: string,
  borderWidth: number = 3,
  borderRadius: number = 0,
  rsConfig: RSConfig = DEFAULT_RS_CONFIG
): { offsetX: number; offsetY: number } {
  const colors = uuidToColorSequence(uuid, rsConfig);
  const neutralGray = 'rgb(133, 133, 133)';
  
  // The offset needed for content to clear the rounded corners
  const offset = borderRadius > 0 ? borderRadius : 0;
  
  if (borderRadius > 0) {
    // Draw rounded border frame
    
    // First, draw the full rounded rectangle outline in gray
    ctx.fillStyle = neutralGray;
    
    // Draw outer rounded rectangle
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, borderRadius);
    ctx.fill();
    
    // Cut out inner area (creating the border frame)
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    const innerRadius = Math.max(0, borderRadius - borderWidth);
    ctx.roundRect(
      borderWidth,
      borderWidth,
      width - borderWidth * 2,
      height - borderWidth * 2,
      innerRadius
    );
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    
    // Now draw encoded colors on the straight portion of the top border
    // The straight portion starts after the corner radius and ends before the other corner
    const straightStartX = borderRadius;
    const straightEndX = width - borderRadius;
    const straightWidth = straightEndX - straightStartX;
    
    if (straightWidth > 0) {
      const pixelsPerSegment = Math.floor(straightWidth / colors.length);
      
      let x = straightStartX;
      for (let colorIdx = 0; colorIdx < colors.length && x < straightEndX; colorIdx++) {
        const color = colors[colorIdx];
        ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
        
        const segmentWidth = pixelsPerSegment;
        ctx.fillRect(x, 0, segmentWidth, borderWidth);
        x += segmentWidth;
      }
      
      // Fill remaining with last color
      if (x < straightEndX) {
        const lastColor = colors[colors.length - 1];
        ctx.fillStyle = `rgb(${lastColor.r}, ${lastColor.g}, ${lastColor.b})`;
        ctx.fillRect(x, 0, straightEndX - x, borderWidth);
      }
    }
  } else {
    // Original rectangular border implementation
    const pixelsPerSegment = Math.floor(width / colors.length);
    
    // Draw top border with encoded colors
    let x = 0;
    for (let colorIdx = 0; colorIdx < colors.length && x < width; colorIdx++) {
      const color = colors[colorIdx];
      ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
      
      const segmentWidth = pixelsPerSegment;
      ctx.fillRect(x, 0, segmentWidth, borderWidth);
      x += segmentWidth;
    }
    
    // Fill remaining top border with last color if needed
    if (x < width) {
      const lastColor = colors[colors.length - 1];
      ctx.fillStyle = `rgb(${lastColor.r}, ${lastColor.g}, ${lastColor.b})`;
      ctx.fillRect(x, 0, width - x, borderWidth);
    }
    
    // Draw other borders with neutral gray
    ctx.fillStyle = neutralGray;
    
    // Right border
    ctx.fillRect(width - borderWidth, borderWidth, borderWidth, height - borderWidth * 2);
    
    // Bottom border
    ctx.fillRect(0, height - borderWidth, width, borderWidth);
    
    // Left border
    ctx.fillRect(0, borderWidth, borderWidth, height - borderWidth * 2);
  }
  
  return { offsetX: offset, offsetY: offset };
}

/**
 * Decode a UUID from a row of pixels with Reed-Solomon error correction
 * @param getPixel - Function to get pixel color at x position
 * @param startX - Starting x position of the encoded border
 * @param width - Width of the encoded border (not the entire image)
 * @param rsConfig - Reed-Solomon configuration
 * @returns Decoded UUID or null if decoding fails
 */
export function decodeFromPixelRow(
  getPixel: (x: number) => RGB,
  startX: number,
  width: number,
  rsConfig: RSConfig = DEFAULT_RS_CONFIG
): { uuid: string; endMarkerMatch: boolean; errorsCorrected: boolean } | null {
  const totalSegments = calculateTotalSegments(rsConfig);
  const pixelsPerSegment = Math.floor(width / totalSegments);
  
  if (pixelsPerSegment < 1) return null;
  
  // Read 8 index colors (positions 6-13)
  const indexColors: RGB[] = [];
  for (let i = 0; i < 8; i++) {
    const segmentCenterX = startX + (6 + i) * pixelsPerSegment + Math.floor(pixelsPerSegment / 2);
    indexColors.push(getPixel(segmentCenterX));
  }
  
  // Verify index colors have expected pattern:
  // Colors use R,G,B bits: color[i] should have R high if i&1, G high if i&2, B high if i&4
  // Check that we see variation in all three channels
  const rValues = indexColors.map(c => c.r);
  const gValues = indexColors.map(c => c.g);
  const bValues = indexColors.map(c => c.b);
  
  const rRange = Math.max(...rValues) - Math.min(...rValues);
  const gRange = Math.max(...gValues) - Math.min(...gValues);
  const bRange = Math.max(...bValues) - Math.min(...bValues);
  
  // Each channel should have at least 10 units of variation
  if (rRange < 10 || gRange < 10 || bRange < 10) {
    return null; // Not enough color variation - probably not the encoded border
  }
  
  // Verify start marker pattern: [1,1,1,0,1,2]
  const startPattern: number[] = [];
  for (let i = 0; i < 6; i++) {
    const segmentCenterX = startX + i * pixelsPerSegment + Math.floor(pixelsPerSegment / 2);
    startPattern.push(findClosestIndexColor(getPixel(segmentCenterX), indexColors));
  }
  
  // Allow ±1 tolerance
  const startMatches = MARKER_START_PATTERN.every((val, i) => Math.abs(startPattern[i] - val) <= 1);
  if (!startMatches) return null;
  
  // Calculate data size
  const nsym = calculateParityBytes(16, rsConfig.redundancyFactor);
  const totalBytes = 16 + nsym;
  const dataStartSegment = 14; // After start marker (6) and index (8)
  
  // Read RS-encoded data (4 color segments per byte)
  const bytes: number[] = [];
  for (let byteIdx = 0; byteIdx < totalBytes; byteIdx++) {
    const baseSegment = dataStartSegment + byteIdx * 4;
    
    // Read 4 segments: highHigh, highLow, lowHigh, lowLow
    const segments: number[] = [];
    for (let s = 0; s < 4; s++) {
      const segmentCenterX = startX + (baseSegment + s) * pixelsPerSegment + Math.floor(pixelsPerSegment / 2);
      segments.push(findClosestIndexColor(getPixel(segmentCenterX), indexColors));
    }
    
    // Convert to byte
    const highNibble = indicesToHexDigit(segments[0], segments[1]);
    const lowNibble = indicesToHexDigit(segments[2], segments[3]);
    bytes.push((highNibble << 4) | lowNibble);
  }
  
  // Verify end marker pattern: [2,1,0,1,1,1]
  const endMarkerStart = dataStartSegment + totalBytes * 4;
  const endPattern: number[] = [];
  for (let i = 0; i < 6; i++) {
    const segmentCenterX = startX + (endMarkerStart + i) * pixelsPerSegment + Math.floor(pixelsPerSegment / 2);
    endPattern.push(findClosestIndexColor(getPixel(segmentCenterX), indexColors));
  }
  const endMarkerMatch = MARKER_END_PATTERN.every((val, i) => Math.abs(endPattern[i] - val) <= 1);
  
  // Apply Reed-Solomon error correction
  const encodedBytes = new Uint8Array(bytes);
  const decodedBytes = rsDecode(encodedBytes, nsym);
  
  if (!decodedBytes) {
    return null; // Too many errors to correct
  }
  
  // Check if any errors were corrected
  const errorsCorrected = !bytes.slice(0, 16).every((b, i) => b === decodedBytes[i]);
  
  // Convert decoded bytes to UUID
  const uuid = bytesToUuid(decodedBytes);
  
  return { uuid, endMarkerMatch, errorsCorrected };
}

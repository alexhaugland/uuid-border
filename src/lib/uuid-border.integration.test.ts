import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { PNG } from 'pngjs';
import { join } from 'path';
import { RGB, TOTAL_SEGMENTS, INDEX_COLORS, decodeFromPixelRow } from './uuid-border';

describe('uuid-border integration tests', () => {
  it.skip('should decode UUID from real screenshot (needs new screenshot with RGB encoding)', () => {
    // NOTE: This test is skipped because the test screenshot was taken with the old R-only encoding
    // Take a new screenshot after the encoder has been updated to use RGB encoding
    const expectedUuid = '38071834-49fb-450b-ac4a-be89070143d5';
    
    // Load the test screenshot
    const imagePath = join(__dirname, '../../test-fixtures/test-screenshot.png');
    const imageData = readFileSync(imagePath);
    const png = PNG.sync.read(imageData);
    
    const width = png.width;
    const height = png.height;
    const data = png.data;
    
    console.log(`Image dimensions: ${width}x${height}`);
    console.log('Expected INDEX_COLORS:');
    INDEX_COLORS.forEach((c, i) => console.log(`  ${i}: RGB(${c.r}, ${c.g}, ${c.b})`));
    
    const getPixel = (x: number, y: number): RGB => {
      const idx = (y * width + x) * 4;
      return {
        r: data[idx],
        g: data[idx + 1],
        b: data[idx + 2],
      };
    };
    
    // Look at several rows to understand the image structure
    console.log('\nSampling rows to find the encoded border:');
    for (let y = 140; y <= 160; y += 2) {
      // Sample every 50 pixels across the width
      const samples: string[] = [];
      for (let x = 100; x < 1200; x += 50) {
        const p = getPixel(x, y);
        samples.push(`${p.r}`);
      }
      console.log(`y=${y}: R values at x=100,150,200,...: [${samples.join(', ')}]`);
    }
    
    // Look specifically at the border region (around y=146 based on previous test)
    console.log('\nDetailed border analysis at y=146 (full scan):');
    const borderY = 146;
    // Find where the encoded colors actually are
    let inEncodedRegion = false;
    let encodedStart = -1;
    let encodedEnd = -1;
    for (let x = 100; x < 1200; x++) {
      const p = getPixel(x, borderY);
      // INDEX_COLORS have R from 115-157 and G=B=133
      const looksLikeIndexColor = p.r >= 110 && p.r <= 165 && Math.abs(p.g - 133) <= 5 && Math.abs(p.b - 133) <= 5;
      
      if (looksLikeIndexColor && !inEncodedRegion) {
        // Check if R varies (not uniform)
        const nextP = getPixel(x + 10, borderY);
        if (Math.abs(p.r - nextP.r) > 2 || p.r <= 120 || p.r >= 140) {
          inEncodedRegion = true;
          encodedStart = x;
          console.log(`  Encoded region starts at x=${x}: RGB(${p.r}, ${p.g}, ${p.b})`);
        }
      }
      if (inEncodedRegion && (p.r > 200 || p.g > 200)) {
        encodedEnd = x;
        console.log(`  Encoded region ends at x=${x}: RGB(${p.r}, ${p.g}, ${p.b})`);
        break;
      }
    }
    
    // Find where R values actually start varying (the encoded canvas area)
    console.log('\nScanning for R value variation:');
    let canvasStart = -1;
    for (let x = 114; x < 200; x++) {
      const p = getPixel(x, borderY);
      const prevP = getPixel(x - 1, borderY);
      if (Math.abs(p.r - prevP.r) >= 3) {
        canvasStart = x;
        console.log(`R value jump at x=${x}: ${prevP.r} -> ${p.r}`);
        break;
      }
    }
    
    // Print R values from the canvas start
    if (canvasStart > 0) {
      console.log(`\nCanvas appears to start at x=${canvasStart}`);
      console.log('R values from canvas start (first 100):');
      const rValues = Array.from({ length: 100 }, (_, i) => getPixel(canvasStart + i, borderY).r);
      console.log(rValues.join(', '));
      
      // Try decoding directly from canvas start
      const canvasWidth = 1090 - canvasStart;
      console.log(`\nAttempting decode from x=${canvasStart}, width=${canvasWidth}`);
      const directResult = decodeFromPixelRow(
        (px) => getPixel(px, borderY),
        canvasStart,
        canvasWidth
      );
      if (directResult) {
        console.log(`Direct decode result: ${directResult.uuid}, endMarker=${directResult.endMarkerMatch}`);
      } else {
        console.log('Direct decode failed');
      }
    }
    
    // Check if a color looks like a border color (grayish)
    const isBorderColor = (c: RGB): boolean => {
      const avg = (c.r + c.g + c.b) / 3;
      return avg > 100 && avg < 180 && Math.abs(c.g - c.b) < 30;
    };
    
    // Scan for encoded borders
    let foundUuid: string | null = null;
    
    for (let y = 0; y < height && !foundUuid; y++) {
      for (let x = 0; x < width - 100; x++) {
        const pixel = getPixel(x, y);
        
        if (!isBorderColor(pixel)) continue;
        
        // Find border extent
        let borderEnd = x;
        while (borderEnd < width && isBorderColor(getPixel(borderEnd, y))) {
          borderEnd++;
        }
        const borderWidth = borderEnd - x;
        
        if (borderWidth < TOTAL_SEGMENTS) {
          x = borderEnd;
          continue;
        }
        
        // Try different widths and offsets
        const possibleWidths = [
          borderWidth,
          Math.floor(borderWidth * 0.95),
          Math.floor(borderWidth * 0.90),
          Math.floor(borderWidth * 0.85),
          Math.floor(borderWidth * 0.80),
        ].filter(w => w >= TOTAL_SEGMENTS);
        
        const possibleOffsets = [0, 5, 10, 15, 20, 25, 30, 40, 50];
        
        for (const encodedWidth of possibleWidths) {
          if (foundUuid) break;
          for (const offset of possibleOffsets) {
            if (foundUuid) break;
            
            const startX = x + offset;
            if (startX + encodedWidth > width) continue;
            
            const result = decodeFromPixelRow(
              (px) => getPixel(px, y),
              startX,
              encodedWidth
            );
            
            if (result) {
              console.log(`\nDecoded UUID: ${result.uuid} at y=${y}, offset=${offset}, width=${encodedWidth}, endMarker=${result.endMarkerMatch}`);
              foundUuid = result.uuid;
              break;
            }
          }
        }
        
        x = borderEnd;
      }
    }
    
    expect(foundUuid).toBe(expectedUuid);
  });
});


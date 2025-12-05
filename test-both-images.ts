/**
 * Test decoding both zoom images
 */
import { PNG } from 'pngjs';
import { readFileSync } from 'fs';
import { RGB, decodeFromPixelRow, isEncodedColor } from './src/lib/uuid-border';

for (const filename of ['90_zoom.png', '90_zoom2.png']) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${filename}`);
  console.log('='.repeat(60));
  
  const buffer = readFileSync(`./${filename}`);
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  
  console.log(`Dimensions: ${width}x${height}`);

  const getPixel = (x: number, y: number): RGB => {
    const idx = (y * width + x) * 4;
    return {
      r: data[idx],
      g: data[idx + 1],
      b: data[idx + 2],
    };
  };

  // Find the best row
  let bestRow = { y: 0, count: 0, startX: 0, endX: 0 };
  
  for (let y = 0; y < height; y++) {
    let count = 0;
    let firstX = -1;
    let lastX = -1;
    
    for (let x = 0; x < width; x++) {
      const p = getPixel(x, y);
      if (isEncodedColor(p, 20)) {
        count++;
        if (firstX < 0) firstX = x;
        lastX = x;
      }
    }
    
    if (count > bestRow.count) {
      bestRow = { y, count, startX: firstX, endX: lastX };
    }
  }
  
  console.log(`Best row: y=${bestRow.y}, ${bestRow.count} pixels (x=${bestRow.startX}-${bestRow.endX})`);
  
  // Try to decode
  const getPixelAtY = (x: number) => getPixel(x, bestRow.y);
  const result = decodeFromPixelRow(
    getPixelAtY,
    bestRow.startX,
    bestRow.endX - bestRow.startX
  );
  
  if (result) {
    console.log(`\n✅ SUCCESS!`);
    console.log(`   UUID: ${result.uuid}`);
    console.log(`   End marker match: ${result.endMarkerMatch}`);
    console.log(`   Errors corrected: ${result.errorsCorrected}`);
  } else {
    console.log(`\n❌ Failed to decode`);
  }
}

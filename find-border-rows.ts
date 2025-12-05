/**
 * Find rows with encoded border data
 */
import { PNG } from 'pngjs';
import { readFileSync } from 'fs';
import { RGB, isEncodedColor } from './src/lib/uuid-border';

for (const filename of ['90_zoom.png', '90_zoom2.png']) {
  console.log(`\n=== ${filename} ===`);
  
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

  // Find rows with most encoded pixels
  const rowCounts: Array<{y: number, count: number, startX: number, endX: number}> = [];
  
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
    
    if (count > 50) {
      rowCounts.push({ y, count, startX: firstX, endX: lastX });
    }
  }
  
  // Sort by count
  rowCounts.sort((a, b) => b.count - a.count);
  
  console.log(`Top 10 rows with encoded pixels:`);
  for (const row of rowCounts.slice(0, 10)) {
    console.log(`  y=${row.y}: ${row.count} pixels (x=${row.startX}-${row.endX})`);
  }
}

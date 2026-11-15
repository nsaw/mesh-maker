/** Independent finite-kernel oracles, flatness and the supported wide-kernel workload. */
import assert from 'node:assert/strict';
import { gaussianSmooth, gridMinMax } from '../src/geometry';
import { DEFAULTS, STATE } from '../src/state';
import { generateNoiseMesh } from '../src/mesh';

function directLine(values: number[], pitch: number, sigma: number): number[] {
  const radius = Math.min(values.length - 1, Math.ceil(3 * sigma / pitch));
  return values.map((_, i) => {
    let sum = 0, norm = 0;
    for (let q = Math.max(0, i - radius); q <= Math.min(values.length - 1, i + radius); q++) {
      const distance = (q - i) * pitch;
      const weight = Math.exp(-distance * distance / (2 * sigma * sigma)) * (q === 0 || q === values.length - 1 ? 0.5 : 1);
      sum += values[q] * weight; norm += weight;
    }
    return sum / norm;
  });
}
function direct(grid: number[][], width: number, height: number, sigma: number): number[][] {
  const rows = grid.length, cols = grid[0].length;
  const x = grid.map(row => directLine(row, width / (cols - 1), sigma));
  const y = Array.from({length: cols}, (_, i) => directLine(x.map(row => row[i]), height / (rows - 1), sigma));
  return Array.from({length: rows}, (_, j) => y.map(column => column[j]));
}
function maximumError(a: number[][], b: number[][]): number {
  let max = 0;
  for (let j = 0; j < a.length; j++) for (let i = 0; i < a[0].length; i++) max = Math.max(max, Math.abs(a[j][i] - b[j][i]));
  return max;
}
for (const [rows,cols,width,height,sigma,impulse] of [
  [65,71,1,4,0.7,0], [64,66,3,1,0.5,0], [5,75,1,2,0.2,1], [75,5,2,1,0.2,2], [11,9,4,10,0.7,0],
]) {
  const grid = Array.from({length: rows}, (_, j) => Array.from({length: cols}, (_, i) => impulse
    ? Number(impulse === 1 ? i === 0 && j === 0 : i === Math.floor(cols/2) && j === Math.floor(rows/2))
    : Math.sin(i*1.13+j*0.29)+Math.cos(i*j*0.17)));
  const result = gaussianSmooth(grid,rows,cols,width,height,sigma), expected = direct(grid,width,height,sigma);
  const error = maximumError(result,expected);
  assert(error < 1e-12, `Gaussian direct oracle ${rows}x${cols}: ${error}`);
  assert.equal(gaussianSmooth(grid,rows,cols,width,height,0),grid,'zero sigma is identity');
  process.stdout.write(`Gaussian ${rows}x${cols} direct oracle max error ${error}\n`);
}
for (const constant of [0,7,1e12,-1e12]) {
  const grid = Array.from({length:65},()=>Array.from({length:67},()=>constant));
  const result = gaussianSmooth(grid,65,67,1,3,1);
  assert(result.every(row=>row.every(z=>z===constant)),'constant signal remains exact');
  assert.equal(gridMinMax(result,65,67)[1]-gridMinMax(result,65,67)[0],0,'no scalar normalization range from roundoff');
}
{
  Object.assign(STATE,DEFAULTS,{meshX:1,meshY:24,resolution:60,noiseType:'voronoi',frequency:0,
    octaves:1,noiseExp:1,peakExp:1,valleyExp:1,contrast:1,sharpness:0,distortion:0,smoothRadiusIn:1});
  generateNoiseMesh();
  const flatZ = STATE.baseThickness-Math.min(STATE.amplitude,STATE.baseThickness);
  assert(STATE.vertices!.every(row=>row.every(z=>z===flatZ)),'constant nonzero scalar field stays flat through depth mapping');
  Object.assign(STATE,DEFAULTS);
}
{
  const rows = 9600, cols = 400, width = 1, height = 24, sigma = 1;
  const grid = Array.from({length:rows},(_,j)=>Array.from({length:cols},(_,i)=>Math.sin(i*0.31)+Math.cos(j*0.071)));
  const start = performance.now(), result = gaussianSmooth(grid,rows,cols,width,height,sigma), ms = performance.now()-start;
  const x = directLine(Array.from({length:cols},(_,i)=>Math.sin(i*0.31)),width/(cols-1),sigma);
  const y = directLine(Array.from({length:rows},(_,j)=>Math.cos(j*0.071)),height/(rows-1),sigma);
  let error = 0;
  for (let j=0;j<rows;j++) for (let i=0;i<cols;i++) error = Math.max(error,Math.abs(result[j][i]-x[i]-y[j]));
  assert(error<1e-12,`wide Gaussian every-node factorized direct oracle: ${error}`);
  assert(ms<5000,`wide Gaussian exceeds 5-second regression budget: ${ms} ms`);
  process.stdout.write(`Gaussian 400x9600 full-grid ${ms} ms, every-node max error ${error}\n`);
}

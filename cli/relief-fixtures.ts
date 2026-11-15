/** Frozen source layouts keep geometric regressions independent of later seed kernels. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { GridSite } from '../src/noise/site-grid';

const root=new URL('./fixtures/relief-geometry-bb9/',import.meta.url);
const provenance=JSON.parse(readFileSync(new URL('provenance.json',root),'utf8')) as {
  fixtures: Record<string,{count:number;sha256Groups:string[]}>;
};
export function frozenReliefSites(name: 'rank-switch'|'mixed-crest'|'outer-membership'): readonly GridSite[] {
  const expected=provenance.fixtures[name],bytes=readFileSync(new URL(name+'.f64',root));
  assert.equal(bytes.length,expected.count*16);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.sha256Groups.join(''));
  return Object.freeze(Array.from({length:expected.count},(_,i)=>{
    const x=bytes.readDoubleLE(i*16),y=bytes.readDoubleLE(i*16+8);
    assert(Number.isFinite(x)&&Number.isFinite(y));
    return Object.freeze({x,y});
  }));
}

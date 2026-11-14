import type { CellGraph } from './graph';

/** ASCII DXF R12 uses POLYLINE/VERTEX, since LWPOLYLINE is not an R12 entity.
 * The cell network is intentionally open. Only the board outline carries closure flag 1. */
export function cellGraphDxf(graph: CellGraph, currentRevision = graph.revision): string {
  if (currentRevision !== graph.revision) throw new Error('Cannot export a stale cell graph');
  if (!(graph.certificate.errorIn < 0.005)) throw new Error('Cell graph exceeds DXF geometric error budget');
  const lines: string[] = [];
  const pair = (code: number, value: string | number): void => { lines.push(String(code), String(value)); };
  pair(0,'SECTION'); pair(2,'HEADER');
  pair(9,'$ACADVER'); pair(1,'AC1009');
  pair(9,'$INSUNITS'); pair(70,1);
  pair(9,'$MEASUREMENT'); pair(70,0);
  pair(9,'$LUNITS'); pair(70,2);
  pair(9,'$EXTMIN'); pair(10,0); pair(20,0); pair(30,0);
  pair(9,'$EXTMAX'); pair(10,graph.width); pair(20,graph.height); pair(30,0);
  pair(0,'ENDSEC'); pair(0,'SECTION'); pair(2,'TABLES');
  pair(0,'TABLE'); pair(2,'LAYER'); pair(70,2);
  for (const [name,color] of [['CUT_INNER',7],['CUT_OUTER',1]] as const) {
    pair(0,'LAYER'); pair(2,name); pair(70,0); pair(62,color); pair(6,'CONTINUOUS');
  }
  pair(0,'ENDTAB'); pair(0,'ENDSEC'); pair(0,'SECTION'); pair(2,'ENTITIES');
  const nodes = new Map(graph.nodes.map(node => [node.id,node]));
  for (const path of [...graph.inner,graph.outer]) {
    const layer = path.closed ? 'CUT_OUTER' : 'CUT_INNER';
    if (path.nodes.length < (path.closed ? 3 : 2)) throw new Error('DXF path has insufficient vertices');
    pair(0,'POLYLINE'); pair(8,layer); pair(66,1); pair(10,0); pair(20,0); pair(30,0); pair(70,path.closed ? 1 : 0);
    for (const id of path.nodes) {
      const node = nodes.get(id);
      if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) throw new Error('DXF path references an invalid graph node');
      pair(0,'VERTEX'); pair(8,layer); pair(10,node.x); pair(20,node.y); pair(30,0); pair(70,0);
    }
    pair(0,'SEQEND'); pair(8,layer);
  }
  pair(0,'ENDSEC'); pair(0,'EOF');
  return `${lines.join('\n')}\n`;
}

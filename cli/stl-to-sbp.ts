import { readFileSync, writeFileSync } from 'fs';
import { resolve, basename, dirname } from 'path';
import { parseSTLBinary } from '../src/sbp/stl-parser';
import { meshToHeightmap } from '../src/sbp/heightmap';
import { generateSBP } from '../src/sbp/generate';
import { getDefaultConfig, getEmbeddedTools, findToolByName } from '../src/sbp/tools';
import { readToolDatabase } from './vtdb-reader';
import type { ToolDef, MaterialProfile, SbpConfig } from '../src/sbp/types';

function usage(): never {
  process.stderr.write(`
Usage: stl-to-sbp <input.stl> [options]

Options:
  -o, --output <file>          Output .sbp (default: <input>.sbp)
  --vtdb <file>                Tool database (default: sourceTruth/stl-to-sbp/tool-libraries/tooldb-general.vtdb)
  --roughing-tool <pattern>    Match by name substring
  --finishing-tool <pattern>   Match by name substring
  --roughing-atc <N>           Override ATC position
  --finishing-atc <N>          Override ATC position
  --resolution <N>             Heightmap cells/inch (default: 200)
  --material-thickness <N>     Material Z (default: STL Z max)
  --material <profile>         general | mdf | hardwood (default: general)
  --offset-x <N>               Workpiece X offset (default: 2.0)
  --offset-y <N>               Workpiece Y offset (default: 2.0)
  --safe-z <N>                 (default: 1.6)
  --home-z <N>                 (default: 2.3)
  --stock-allowance <N>        (default: 0.02)
  --finish-angle <N>           (default: 45)
  --roughing-only              Skip finishing pass
  --finishing-only             Skip roughing pass
  --dry-run                    Print stats without writing file
`);
  process.exit(1);
}

function parseArgs(args: string[]): {
  input: string;
  output: string;
  vtdbPath: string | null;
  roughingPattern: string | null;
  finishingPattern: string | null;
  roughingAtc: number | null;
  finishingAtc: number | null;
  resolution: number;
  materialThickness: number | null;
  materialProfile: MaterialProfile;
  offsetX: number;
  offsetY: number;
  safeZ: number;
  homeZ: number;
  stockAllowance: number;
  finishAngle: number;
  roughingOnly: boolean;
  finishingOnly: boolean;
  dryRun: boolean;
} {
  if (args.length === 0) usage();

  const input = args[0];
  let output = input.replace(/\.stl$/i, '.sbp');
  let vtdbPath: string | null = null;
  let roughingPattern: string | null = null;
  let finishingPattern: string | null = null;
  let roughingAtc: number | null = null;
  let finishingAtc: number | null = null;
  let resolution = 200;
  let materialThickness: number | null = null;
  let materialProfile: MaterialProfile = 'general';
  let offsetX = 2.0;
  let offsetY = 2.0;
  let safeZ = 1.6;
  let homeZ = 2.3;
  let stockAllowance = 0.02;
  let finishAngle = 45;
  let roughingOnly = false;
  let finishingOnly = false;
  let dryRun = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const next = () => {
      if (i + 1 >= args.length) {
        process.stderr.write(`Missing value for ${arg}\n`);
        process.exit(1);
      }
      return args[++i];
    };

    switch (arg) {
      case '-o': case '--output': output = next(); break;
      case '--vtdb': vtdbPath = next(); break;
      case '--roughing-tool': roughingPattern = next(); break;
      case '--finishing-tool': finishingPattern = next(); break;
      case '--roughing-atc': roughingAtc = parseInt(next(), 10); break;
      case '--finishing-atc': finishingAtc = parseInt(next(), 10); break;
      case '--resolution': resolution = parseInt(next(), 10); break;
      case '--material-thickness': materialThickness = parseFloat(next()); break;
      case '--material': materialProfile = next() as MaterialProfile; break;
      case '--offset-x': offsetX = parseFloat(next()); break;
      case '--offset-y': offsetY = parseFloat(next()); break;
      case '--safe-z': safeZ = parseFloat(next()); break;
      case '--home-z': homeZ = parseFloat(next()); break;
      case '--stock-allowance': stockAllowance = parseFloat(next()); break;
      case '--finish-angle': finishAngle = parseFloat(next()); break;
      case '--roughing-only': roughingOnly = true; break;
      case '--finishing-only': finishingOnly = true; break;
      case '--dry-run': dryRun = true; break;
      default:
        process.stderr.write(`Unknown option: ${arg}\n`);
        usage();
    }
  }

  return {
    input, output, vtdbPath, roughingPattern, finishingPattern,
    roughingAtc, finishingAtc, resolution, materialThickness,
    materialProfile, offsetX, offsetY, safeZ, homeZ, stockAllowance,
    finishAngle, roughingOnly, finishingOnly, dryRun,
  };
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  // Read STL
  process.stderr.write(`Reading STL: ${opts.input}\n`);
  const buffer = readFileSync(resolve(opts.input));
  const stl = parseSTLBinary(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const { bounds, count } = stl;

  process.stderr.write(
    `  ${count.toLocaleString()} triangles, ` +
    `${(bounds.maxX - bounds.minX).toFixed(3)}" x ${(bounds.maxY - bounds.minY).toFixed(3)}" x ${(bounds.maxZ - bounds.minZ).toFixed(3)}"\n`,
  );

  // Load tools: vtdb or embedded
  let tools: ToolDef[];
  if (opts.vtdbPath) {
    process.stderr.write(`Reading vtdb: ${opts.vtdbPath}\n`);
    tools = readToolDatabase(resolve(opts.vtdbPath));
    process.stderr.write(`  ${tools.length} tools loaded\n`);
  } else {
    // Try default vtdb in sourceTruth
    const scriptDir = dirname(resolve(process.argv[1]));
    const defaultVtdb = resolve(scriptDir, '../sourceTruth/stl-to-sbp/tool-libraries/tooldb-general.vtdb');
    try {
      tools = readToolDatabase(defaultVtdb);
      process.stderr.write(`Using default vtdb: ${defaultVtdb} (${tools.length} tools)\n`);
    } catch {
      process.stderr.write('No vtdb found, using embedded tool data\n');
      tools = getEmbeddedTools(opts.materialProfile);
    }
  }

  // Resolve roughing tool
  const config: SbpConfig = getDefaultConfig(opts.materialProfile);
  config.offsetX = opts.offsetX;
  config.offsetY = opts.offsetY;
  config.safeZ = opts.safeZ;
  config.homeZ = opts.homeZ;
  config.leaveStock = opts.stockAllowance;
  config.finishRasterAngle = opts.finishAngle;
  config.roughingEnabled = !opts.finishingOnly;
  config.finishingEnabled = !opts.roughingOnly;

  if (opts.roughingPattern) {
    const found = findToolByName(tools, opts.roughingPattern);
    if (!found) {
      process.stderr.write(`Roughing tool not found: "${opts.roughingPattern}"\n`);
      process.stderr.write(`Available: ${tools.map(t => t.name).join(', ')}\n`);
      process.exit(1);
    }
    config.roughingTool = found;
  }
  if (opts.roughingAtc !== null) {
    config.roughingTool = { ...config.roughingTool, atcSlot: opts.roughingAtc };
  }

  if (opts.finishingPattern) {
    const found = findToolByName(tools, opts.finishingPattern);
    if (!found) {
      process.stderr.write(`Finishing tool not found: "${opts.finishingPattern}"\n`);
      process.stderr.write(`Available: ${tools.map(t => t.name).join(', ')}\n`);
      process.exit(1);
    }
    config.finishingTool = found;
  }
  if (opts.finishingAtc !== null) {
    config.finishingTool = { ...config.finishingTool, atcSlot: opts.finishingAtc };
  }

  // Rasterize heightmap
  process.stderr.write(`Rasterizing heightmap at ${opts.resolution} cells/inch...\n`);
  const heightmap = meshToHeightmap(stl.data, stl.count, stl.bounds, opts.resolution);
  process.stderr.write(`  Grid: ${heightmap.cols} x ${heightmap.rows} (${(heightmap.cols * heightmap.rows).toLocaleString()} cells)\n`);

  // Set material dimensions from STL + offsets
  config.materialX = heightmap.meshX;
  config.materialY = heightmap.meshY;
  config.materialZ = opts.materialThickness ?? bounds.maxZ;

  // Generate SBP
  process.stderr.write('Generating toolpaths...\n');
  const t0 = performance.now();
  const result = generateSBP(heightmap, config);
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

  // Print summary
  process.stderr.write(`\n--- Summary ---\n`);
  process.stderr.write(`  STL: ${basename(opts.input)} (${count.toLocaleString()} tris)\n`);
  process.stderr.write(`  Grid: ${result.stats.heightmapCols} x ${result.stats.heightmapRows}\n`);
  if (result.stats.zShifted > 0) {
    process.stderr.write(`  Z shifted up by ${result.stats.zShifted.toFixed(6)}" (negative Z normalized)\n`);
  }
  process.stderr.write(`  Roughing: ${config.roughingEnabled ? `${result.stats.roughingMoves.toLocaleString()} moves (${config.roughingTool.name}, ATC ${config.roughingTool.atcSlot})` : 'disabled'}\n`);
  process.stderr.write(`  Finishing: ${config.finishingEnabled ? `${result.stats.finishingMoves.toLocaleString()} moves (${config.finishingTool.name}, ATC ${config.finishingTool.atcSlot})` : 'disabled'}\n`);
  process.stderr.write(`  Output: ${result.stats.totalLines.toLocaleString()} lines (${(result.sbp.length / 1024 / 1024).toFixed(1)} MB)\n`);
  process.stderr.write(`  Generated in ${elapsed}s\n`);

  if (opts.dryRun) {
    process.stderr.write('\n[dry run -- no file written]\n');
    return;
  }

  // Write output
  const outPath = resolve(opts.output);
  writeFileSync(outPath, result.sbp, 'utf-8');
  process.stderr.write(`  Written: ${outPath}\n`);
}

main();

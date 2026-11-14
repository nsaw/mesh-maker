/** Observe matrices used by the actual production draw, independent of STATE and Fit arithmetic. */
export function installFrameProbe() {
  const locations = new WeakMap(), programs = new WeakMap();
  let currentProgram, sequence = 0;
  const prototype = WebGL2RenderingContext.prototype;
  const getLocation = prototype.getUniformLocation;
  prototype.getUniformLocation = function(program, name) {
    const location = getLocation.call(this, program, name);
    if (location) locations.set(location, { program, name });
    return location;
  };
  const useProgram = prototype.useProgram;
  prototype.useProgram = function(program) { currentProgram = program; return useProgram.call(this, program); };
  const matrix = prototype.uniformMatrix4fv;
  prototype.uniformMatrix4fv = function(location, transpose, value, ...rest) {
    const uniform = locations.get(location);
    if (uniform && ['modelViewMatrix', 'projectionMatrix'].includes(uniform.name)) {
      let program = programs.get(uniform.program);
      if (!program) { program = {}; programs.set(uniform.program, program); }
      program[uniform.name] = Array.from(value);
    }
    return matrix.call(this, location, transpose, value, ...rest);
  };
  const draw = prototype.drawElements;
  prototype.drawElements = function(mode, count, ...rest) {
    const program = programs.get(currentProgram);
    if (count >= 24 && program?.modelViewMatrix && program?.projectionMatrix) window.fitProbe = { ...program, sequence: ++sequence };
    return draw.call(this, mode, count, ...rest);
  };
}

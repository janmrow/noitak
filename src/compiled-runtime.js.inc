// Inlined after the host boundary in each standalone artifact.
function inRange(value, max) {
  if (value < 0 || value > max) throw new RangeFault();
  return value;
}

function nested(index, target, flags, args) {
  if (!target.pre(args,flags)) {
    if (index !== undefined) return {tag:'rejected',value:index};
    throw new CallFault('CALL_PRECONDITION');
  }
  const value = target.body(args,flags);
  if (!target.post(args,flags,value)) throw new CallFault('CALL_POSTCONDITION');
  return index === undefined ? value : {tag:'committed',value};
}

function runCompiled(entry, values, flags) {
  let phase = 'requires';
  try {
    let state = values[0];
    const count = entry.capacity ? values[1].length : 1;
    if (entry.capacity && !entry.pre(values,flags)) return error('PRECONDITION',phase);
    for (let i=0; i<count; i++) {
      const args = entry.capacity ? [state,values[1][i]] : values;
      phase = 'requires';
      if (!entry.pre(args,flags)) return error('PRECONDITION',phase);
      phase = 'body';
      state = entry.body(args,flags);
      phase = 'ensures';
      if (!entry.post(args,flags,state)) return error('POSTCONDITION',phase);
    }
    return {ok:true,value:state};
  } catch (e) {
    if (e instanceof RangeFault) return error('ARITHMETIC',phase);
    if (e instanceof CallFault) return error(e.code,phase);
    throw e;
  }
}

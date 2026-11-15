import { buildNetlist, netOfPin } from '../circuit/graph';
import { RED_LED } from '../circuit/componentDefs';
import type { CircuitDesign } from '../circuit/types';

/**
 * Translate the student's circuit graph into a SPICE netlist.
 *
 * This is shared by the ngspice adapter and by the "view netlist" panel, so the
 * student can see exactly what would be handed to a real simulator. Generating
 * the netlist does NOT mean SPICE ran — the UI only shows SPICE *results* when
 * the ngspice adapter actually executed.
 */
export function toSpiceNetlist(design: CircuitDesign, title = 'BoardMaster export'): string {
  const netlist = buildNetlist(design);

  // SPICE needs node 0 as ground. Use the supply negative net.
  const source = design.components.find((c) => c.kind === 'dc_source');
  const groundNetId = source ? netOfPin(netlist, source.id, 'neg')?.id : undefined;

  const nodeNames = new Map<string, string>();
  let index = 1;
  for (const net of netlist.nets) {
    if (net.id === groundNetId) {
      nodeNames.set(net.id, '0');
    } else {
      nodeNames.set(net.id, net.name.startsWith('RAIL_') ? net.name : `n${index++}`);
    }
  }

  const nodeOf = (componentId: string, pinId: string): string => {
    const net = netOfPin(netlist, componentId, pinId);
    if (!net) return 'nc';
    return nodeNames.get(net.id) ?? 'nc';
  };

  const lines: string[] = [`* ${title}`, `* Generated ${new Date().toISOString()}`, ''];

  for (const c of design.components) {
    switch (c.kind) {
      case 'dc_source':
        lines.push(`V${c.label.replace(/^V/, '')} ${nodeOf(c.id, 'pos')} ${nodeOf(c.id, 'neg')} DC ${c.value}`);
        break;
      case 'resistor':
        lines.push(`R${c.label.replace(/^R/, '')} ${nodeOf(c.id, '1')} ${nodeOf(c.id, '2')} ${c.value}`);
        break;
      case 'capacitor':
        lines.push(`C${c.label.replace(/^C/, '')} ${nodeOf(c.id, 'p')} ${nodeOf(c.id, 'n')} ${c.value}`);
        break;
      case 'led':
        lines.push(`D${c.label.replace(/^D/, '')} ${nodeOf(c.id, 'a')} ${nodeOf(c.id, 'k')} DLED`);
        break;
      case 'breadboard':
        break;
      default:
        break;
    }
  }

  lines.push('');
  lines.push('* Red LED: diode model fitted to Vf = ' + RED_LED.vfNominal + ' V at ' + RED_LED.iRated * 1000 + ' mA');
  lines.push(`.model DLED D(IS=1e-20 N=1.9 RS=${RED_LED.rSeries} BV=${RED_LED.vReverseMax} IBV=1e-5)`);
  lines.push('');
  lines.push('.op');
  lines.push('.end');

  return lines.join('\n');
}

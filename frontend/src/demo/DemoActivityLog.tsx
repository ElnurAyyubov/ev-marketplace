import { DemoEvent } from './types';

interface Props {
  events: DemoEvent[];
}

function formatT(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * DEMO_RUNNER_ADDENDUM.md section 4: the credibility layer. Every line is
 * tagged sim (the animation narrating itself) or ledger (read back from
 * GET /sessions/:id and GET /sessions/:id/readings -- never the runner's
 * own intentions), rendered in different colors so a viewer can tell
 * theatre from settlement without anyone explaining it.
 */
export function DemoActivityLog({ events }: Props) {
  return (
    <div
      style={{
        marginTop: 10,
        maxHeight: 220,
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: 12,
        background: '#1a1a1a',
        color: '#ddd',
        padding: 10,
        borderRadius: 6,
      }}
    >
      {events.length === 0 && <div style={{ color: '#888' }}>No activity yet.</div>}
      {events.map((e, i) => (
        <div key={i} style={{ color: e.source === 'ledger' ? '#6fcf97' : '#8ab4f8' }}>
          {formatT(e.t)} {e.source === 'ledger' ? 'ledger' : 'sim   '} {e.text}
        </div>
      ))}
    </div>
  );
}

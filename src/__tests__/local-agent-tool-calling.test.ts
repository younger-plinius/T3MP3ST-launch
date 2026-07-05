/**
 * REGRESSION (keyless-path bug): the local-agent / codex text-CLI backbones must surface `toolCalls`
 * parsed from the agent's reply. If they don't, the ReAct loop takes its "final answer" branch on
 * turn 0 and every operator abstains without ever running the Arsenal — which broke the headline
 * keyless path ("hunt with the agent you already run"). These tests pin the fix in place.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseTextToolCalls, LLMBackbone } from '../llm/index.js';

// Mock the CLI bridge so the "agent" returns whatever text we choose.
vi.mock('../agent/local-agents.js', () => ({ localAgentChat: vi.fn() }));
import { localAgentChat } from '../agent/local-agents.js';
const cli = vi.mocked(localAgentChat);

const TOOLS = [{
  name: 'nmap_scan',
  description: 'port scan a host',
  parameters: { type: 'object' as const, properties: { target: { type: 'string' } }, required: ['target'] },
}];
const backbone = () => new LLMBackbone({ provider: 'local-agent', model: 'codex' } as never);

describe('parseTextToolCalls', () => {
  it('parses a contracted fenced tool_calls block', () => {
    const r = parseTextToolCalls('reasoning...\n```json\n{"tool_calls":[{"name":"nmap_scan","arguments":{"target":"10.0.0.5"}}]}\n```');
    expect(r).toHaveLength(1);
    expect(r![0]).toMatchObject({ name: 'nmap_scan', arguments: { target: '10.0.0.5' } });
    expect(r![0].id).toBeTruthy();
  });
  it('treats a prose-only debrief as the final answer (no tool calls)', () => {
    expect(parseTextToolCalls('Attack surface exhausted; no exploitable findings. Abstaining.')).toBeUndefined();
  });
});

describe('local-agent backbone surfaces toolCalls (the keyless-path fix)', () => {
  it('returns toolCalls + finishReason=tool_calls when the agent requests a tool', async () => {
    cli.mockResolvedValueOnce('```json\n{"tool_calls":[{"name":"nmap_scan","arguments":{"target":"10.0.0.5"}}]}\n```');
    const res = await backbone().chatWithTools([{ role: 'user', content: 'scan it' }], TOOLS as never);
    expect(res.toolCalls?.length).toBe(1);
    expect(res.toolCalls![0].name).toBe('nmap_scan');
    expect(res.finishReason).toBe('tool_calls');
  });
  it('returns NO toolCalls (final answer) when the agent debriefs in prose', async () => {
    cli.mockResolvedValueOnce('Final debrief: surface exhausted, nothing to exploit.');
    const res = await backbone().chatWithTools([{ role: 'user', content: 'scan it' }], TOOLS as never);
    expect(res.toolCalls).toBeUndefined();
    expect(res.finishReason).toBe('stop');
  });
});

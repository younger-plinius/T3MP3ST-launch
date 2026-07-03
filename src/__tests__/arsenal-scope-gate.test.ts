/**
 * Egress scope gate — Phase-0 pack-hunt safety primitive.
 * arsenal.execute() must refuse a networked tool call whose target is outside the authorized
 * scope BEFORE the handler runs, so an LLM-supplied target can never reach an off-target host.
 * Pins: scopeViolation host math, and that execute() denies out-of-scope without invoking the handler.
 */
import { describe, it, expect } from 'vitest';
import { Arsenal, scopeViolation, hostFromTargetValue, type ArsenalScope } from '../arsenal/index.js';
import type { CustomTool, ToolContext } from '../types/index.js';

const scope: ArsenalScope = { allowedHosts: ['target.example.com'], allowLoopback: true, allowPrivate: true };
const ctx = (parameters: Record<string, unknown>, target?: string): ToolContext =>
  ({ parameters, ...(target ? { target: { id: 't', name: 't', type: 'web_application', address: target } as never } : {}) });

describe('egress scope gate', () => {
  it('extracts a bare host from urls / user@host:port / brackets', () => {
    expect(hostFromTargetValue('https://EVIL.com/admin?x=1')).toBe('evil.com');
    expect(hostFromTargetValue('root@10.0.0.5:22')).toBe('10.0.0.5');
    expect(hostFromTargetValue('scanme.example.com:443')).toBe('scanme.example.com');
    expect(hostFromTargetValue('not a host, just text')).toBe('not a host, just text'); // still lowered; scope decides
    expect(hostFromTargetValue(42)).toBeNull();
  });

  it('allows authorized host + its subdomains, loopback, and private ranges', () => {
    expect(scopeViolation(scope, ctx({ url: 'https://target.example.com/x' }))).toBeNull();
    expect(scopeViolation(scope, ctx({ url: 'https://api.target.example.com/x' }))).toBeNull(); // subdomain
    expect(scopeViolation(scope, ctx({ host: '127.0.0.1' }))).toBeNull();
    expect(scopeViolation(scope, ctx({ target: '10.1.2.3' }))).toBeNull();
    expect(scopeViolation(scope, ctx({ domain: 'localhost' }))).toBeNull();
  });

  it('blocks an out-of-scope host and reports it', () => {
    expect(scopeViolation(scope, ctx({ url: 'https://evil.com/x' }))).toBe('evil.com');
    expect(scopeViolation(scope, ctx({ target: '8.8.8.8' }))).toBe('8.8.8.8');
    // checks context.target.address too
    expect(scopeViolation(scope, ctx({}, 'http://attacker.net'))).toBe('attacker.net');
  });

  it('no scope set = enforcement off (backward-compat)', () => {
    expect(scopeViolation(null, ctx({ url: 'https://evil.com' }))).toBeNull();
  });

  it('a tool with no target-like param is never gated', () => {
    expect(scopeViolation(scope, ctx({ hash: 'deadbeef', text: 'hello' }))).toBeNull();
  });

  it('execute() refuses an out-of-scope call WITHOUT running the handler', async () => {
    const ars = new Arsenal();
    let ran = false;
    const probe: CustomTool = {
      name: 'probe', description: 'x', category: 'web', parameters: [],
      handler: async () => { ran = true; return { success: true, output: 'hit' }; },
    };
    ars.register(probe);
    ars.setScope(scope);
    const denied = await ars.execute('probe', ctx({ url: 'https://evil.com' }));
    expect(ran).toBe(false);
    expect(denied.success).toBe(false);
    expect(denied.error).toMatch(/SCOPE DENIED/);
    // in-scope call runs the handler
    const ok = await ars.execute('probe', ctx({ url: 'https://target.example.com' }));
    expect(ran).toBe(true);
    expect(ok.success).toBe(true);
  });
});

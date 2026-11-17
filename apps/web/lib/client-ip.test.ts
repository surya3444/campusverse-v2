import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

describe('clientIp', () => {
  it('takes the address the load balancer appended, not one the client sent', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 49.36.1.2' }))).toBe('49.36.1.2');
    expect(clientIp(new Headers({ 'x-forwarded-for': '49.36.1.2' }))).toBe('49.36.1.2');
    expect(clientIp(new Headers())).toBeNull();
  });
});

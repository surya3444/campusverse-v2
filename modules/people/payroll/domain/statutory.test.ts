import { payrollRules } from '@campusverse/rules';
import { describe, expect, it } from 'vitest';
import { ecrMember, ecrName, wageRuleShortfall } from './statutory.js';

const pf = payrollRules('KA').pf;
const R = 100;

describe('ECR lines', () => {
  it('caps wages at the ceiling and splits the employer share into EPS and the difference', () => {
    const m = ecrMember(
      {
        uan: '100200300400',
        name: 'Synthetic Teacher',
        basicPaise: 20_000 * R,
        daPaise: 5_000 * R,
        grossPaise: 40_000 * R,
        pfPaise: 1_800 * R,
        employerPfPaise: 1_800 * R,
        lopHalves: 3,
      },
      pf,
    );
    expect(m.epsPaise).toBe(1_250 * R);
    expect(m.differencePaise).toBe(550 * R);
    expect(m.line).toBe(
      '100200300400#~#SYNTHETIC TEACHER#~#40000#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#2#~#0',
    );
  });

  it('below the ceiling uses the actual wage', () => {
    const m = ecrMember(
      {
        uan: '100200300401',
        name: 'Synthetic Peon',
        basicPaise: 9_000 * R,
        daPaise: 1_000 * R,
        grossPaise: 12_000 * R,
        pfPaise: 1_200 * R,
        employerPfPaise: 1_200 * R,
        lopHalves: 0,
      },
      pf,
    );
    expect(m.line.split('#~#').slice(2, 9)).toEqual([
      '12000',
      '10000',
      '10000',
      '10000',
      '1200',
      '833',
      '367',
    ]);
  });

  it('names are plain capitals', () => {
    expect(ecrName("  Anjali  D'Souza ")).toBe('ANJALI DSOUZA');
  });
});

describe('the Labour Codes wage rule', () => {
  it('flags basic + DA below half of gross', () => {
    expect(wageRuleShortfall({ basicPaise: 30 * R, daPaise: 0, grossPaise: 100 * R })).toBe(20 * R);
    expect(wageRuleShortfall({ basicPaise: 40 * R, daPaise: 10 * R, grossPaise: 100 * R })).toBe(0);
  });
});

describe('ESI monthly contribution file', () => {
  it('writes IP number, name, whole days paid and wages in rupees', async () => {
    const { esiMember, ESI_HEADER } = await import('./statutory.js');
    expect(ESI_HEADER[0]).toBe('IP Number');
    expect(
      esiMember({
        ipNumber: '1234567890',
        name: 'Synthetic Asha',
        calendarDays: 30,
        lopHalves: 3,
        grossPaise: 1_500_050,
      }),
    ).toBe('1234567890,SYNTHETIC ASHA,28,15001,,');
    expect(
      esiMember({
        ipNumber: '1234567890',
        name: 'Synthetic Asha',
        calendarDays: 30,
        lopHalves: 60,
        grossPaise: 0,
      }),
    ).toBe('1234567890,SYNTHETIC ASHA,0,0,0,');
  });
});

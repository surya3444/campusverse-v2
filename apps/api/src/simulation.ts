// Simulated SMS for sign-in codes: while no SMS provider is connected, the code is handed back to
// the screen that asked for it instead of being sent. Used only when simulation is on
// (SIMULATE_PROVIDERS; see packages/config). Codes are kept in memory for one minute.
import type { OtpSender } from '@campusverse/platform-identity';

export type SimulatedMessage = { channel: 'sms'; to: string; text: string };

export type SmsSimulator = {
  sender: OtpSender;
  /** The message just "sent" to this number, once; null if none was sent. */
  take(phone: string): SimulatedMessage | null;
};

const KEEP_MS = 60_000;

export function createSmsSimulator(
  log: (line: string) => void = console.log,
  /** The message text for a code: sign-in by default. */
  text: (code: string) => string = (code) =>
    `${code} is your Campusverse sign-in code. It expires in 10 minutes. Don't share it.`,
): SmsSimulator {
  const sent = new Map<string, { message: SimulatedMessage; at: number }>();
  return {
    sender: {
      send: async (phone, code) => {
        const masked = `…${phone.slice(-4)}`;
        sent.set(phone, {
          at: Date.now(),
          message: {
            channel: 'sms',
            to: masked,
            text: text(code),
          },
        });
        log(`[simulated sms] ${masked}: ${code}`);
      },
    },
    take(phone) {
      const hit = sent.get(phone);
      sent.delete(phone);
      for (const [k, v] of sent) if (Date.now() - v.at > KEEP_MS) sent.delete(k);
      return hit && Date.now() - hit.at <= KEEP_MS ? hit.message : null;
    },
  };
}

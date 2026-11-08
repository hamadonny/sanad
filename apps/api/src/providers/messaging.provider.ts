/** SmsProvider and PushProvider (spec §11, §12). Mocks record messages instead of sending them. */
export interface SmsProvider {
  readonly name: string;
  send(phone: string, text: string): Promise<void>;
}

export interface PushProvider {
  readonly name: string;
  send(tokens: string[], title: string, body: string, data?: Record<string, string>): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  readonly outbox: { phone: string; text: string; at: Date }[] = [];
  async send(phone: string, text: string): Promise<void> {
    this.outbox.push({ phone, text, at: new Date() });
    if (this.outbox.length > 500) this.outbox.shift();
  }
  /** Dev/test helper: last message sent to a phone. */
  lastTo(phone: string): string | undefined {
    return [...this.outbox].reverse().find((m) => m.phone === phone)?.text;
  }
}

export class MockPushProvider implements PushProvider {
  readonly name = 'mock';
  readonly sent: { tokens: string[]; title: string; body: string }[] = [];
  async send(tokens: string[], title: string, body: string): Promise<void> {
    this.sent.push({ tokens, title, body });
    if (this.sent.length > 500) this.sent.shift();
  }
}

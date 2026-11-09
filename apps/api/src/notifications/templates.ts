/**
 * Default notification templates (spec §11), Arabic + English. Seeded into
 * `notification_templates`, where admins can edit them (Phase 4). `{{name}}` placeholders.
 */
export type Channel = 'push' | 'sms' | 'email';

export interface TemplateDef {
  channels: Channel[];
  ar: { title: string; body: string };
  en: { title: string; body: string };
}

export const DEFAULT_TEMPLATES: Record<string, TemplateDef> = {
  'auth.otp': {
    channels: ['sms'],
    ar: { title: 'رمز التحقق', body: 'رمز التحقق الخاص بك في سند: {{code}}. لا تشاركه مع أحد.' },
    en: { title: 'Verification code', body: 'Your Sanad code is {{code}}. Do not share it.' },
  },
  'contract.sign_otp': {
    channels: ['sms'],
    ar: {
      title: 'رمز توقيع العقد',
      body: 'رمز توقيع عقد عضوية سند: {{code}}. إدخاله يعني موافقتك على العقد. لا تشاركه.',
    },
    en: {
      title: 'Signing code',
      body: 'Your Sanad agreement signing code is {{code}}. Entering it means you sign. Do not share it.',
    },
  },
  'kyc.approved': {
    channels: ['push'],
    ar: { title: 'تم التحقق من هويتك', body: 'يمكنك الآن الانضمام إلى جمعية.' },
    en: { title: 'Identity verified', body: 'You can now join a circle.' },
  },
  'kyc.rejected': {
    channels: ['push', 'sms'],
    ar: { title: 'تعذّر التحقق من هويتك', body: 'السبب: {{reason}}. يرجى المحاولة مرة أخرى.' },
    en: { title: 'Identity not verified', body: 'Reason: {{reason}}. Please try again.' },
  },
  'circle.joined': {
    channels: ['push'],
    ar: { title: 'انضممت إلى الجمعية', body: 'انضم {{count}} من أصل {{total}} أعضاء.' },
    en: { title: 'You joined a circle', body: '{{count}} of {{total}} members have joined.' },
  },
  'circle.filled': {
    channels: ['push'],
    ar: { title: 'اكتملت الجمعية', body: 'بدأ مزاد الأدوار المميزة لمدة {{hours}} ساعة.' },
    en: {
      title: 'Your circle is full',
      body: 'The priority-spot auction is open for {{hours}} hours.',
    },
  },
  'circle.cancelled': {
    channels: ['push', 'sms'],
    ar: {
      title: 'أُلغيت الجمعية',
      body: 'لم تكتمل الجمعية في الوقت المحدد. أُعيد إليك رسم التنظيم بالكامل.',
    },
    en: {
      title: 'Circle cancelled',
      body: 'The circle did not fill in time. Your organising fee was refunded in full.',
    },
  },
  'auction.outbid': {
    channels: ['push'],
    ar: { title: 'تمت المزايدة عليك', body: 'عرض أعلى على الدور {{spot}}: {{amount}} د.ك.' },
    en: { title: 'You were outbid', body: 'Higher bid on spot {{spot}}: {{amount}} KWD.' },
  },
  'auction.won': {
    channels: ['push'],
    ar: { title: 'فزت بالدور {{spot}}', body: 'سيُخصم {{amount}} د.ك من مبلغ استلامك.' },
    en: {
      title: 'You won spot {{spot}}',
      body: '{{amount}} KWD will be deducted from your payout.',
    },
  },
  'draw.complete': {
    channels: ['push'],
    ar: { title: 'تمت القرعة', body: 'دورك هو {{spot}} — تستلم في {{payoutDate}}.' },
    en: { title: 'Draw complete', body: 'Your spot is {{spot}} — you receive on {{payoutDate}}.' },
  },
  'payment.due_3d': {
    channels: ['push'],
    ar: { title: 'قسط قادم', body: 'قسط الشهر {{month}} ({{amount}} د.ك) مستحق بعد 3 أيام.' },
    en: { title: 'Payment coming up', body: 'Month {{month}} ({{amount}} KWD) is due in 3 days.' },
  },
  'payment.due_today': {
    channels: ['push'],
    ar: { title: 'القسط مستحق اليوم', body: 'قسط الشهر {{month}}: {{amount}} د.ك.' },
    en: { title: 'Payment due today', body: 'Month {{month}}: {{amount}} KWD.' },
  },
  'payment.late': {
    channels: ['push', 'sms'],
    ar: { title: 'قسط متأخر', body: 'قسط الشهر {{month}} متأخر. يرجى السداد لتجنّب التعثّر.' },
    en: { title: 'Payment late', body: 'Month {{month}} is late. Please pay to avoid default.' },
  },
  'payment.final_warning': {
    channels: ['push', 'sms'],
    ar: {
      title: 'إنذار أخير',
      body: 'إذا لم يُسدَّد قسط الشهر {{month}} قبل {{date}} سيُعتبر حسابك متعثّرًا.',
    },
    en: {
      title: 'Final warning',
      body: 'If month {{month}} is not paid before {{date}} your account will be in default.',
    },
  },
  'payment.received': {
    channels: ['push'],
    ar: { title: 'تم استلام دفعتك', body: '{{amount}} د.ك — شكرًا لك.' },
    en: { title: 'Payment received', body: '{{amount}} KWD — thank you.' },
  },
  'payout.sent': {
    channels: ['push', 'sms'],
    ar: { title: 'تم تحويل مبلغ الجمعية', body: 'حُوّل إليك {{amount}} د.ك.' },
    en: { title: 'Payout sent', body: '{{amount}} KWD has been sent to you.' },
  },
  'payout.held': {
    channels: ['push', 'sms'],
    ar: { title: 'مبلغك بانتظار قسطك', body: 'سدّد قسط الشهر {{month}} ليُحوَّل إليك المبلغ.' },
    en: {
      title: 'Payout waiting for your payment',
      body: 'Pay month {{month}} to receive your payout.',
    },
  },
  'payout.topup': {
    channels: ['push'],
    ar: {
      title: 'وصلك مبلغ إضافي',
      body: 'وصلت دفعة متأخرة لشهر {{month}}، وحُوّل إليك {{amount}} د.ك.',
    },
    en: {
      title: 'More money for your month',
      body: 'A late payment for month {{month}} arrived: {{amount}} KWD has been sent to you.',
    },
  },
  'holdback.released': {
    channels: ['push'],
    ar: { title: 'أُفرج عن المبلغ المحتجز', body: 'حُوّل إليك {{amount}} د.ك.' },
    en: { title: 'Holdback released', body: '{{amount}} KWD has been sent to you.' },
  },
  'refund.sent': {
    channels: ['push'],
    ar: { title: 'تم تحويل الاسترداد', body: 'حُوّل إليك {{amount}} د.ك.' },
    en: { title: 'Refund sent', body: '{{amount}} KWD has been sent to you.' },
  },
  'circle.closed': {
    channels: ['push'],
    ar: { title: 'انتهت الجمعية', body: 'شكرًا لالتزامك. يمكنك الانضمام إلى جمعية جديدة.' },
    en: {
      title: 'Circle completed',
      body: 'Thank you for completing the circle. You can join a new one.',
    },
  },
  'tier.upgraded': {
    channels: ['push'],
    ar: { title: 'ترقية مستوى الثقة', body: 'أصبح مستواك {{tier}}.' },
    en: { title: 'Trust tier upgraded', body: 'You are now tier {{tier}}.' },
  },
  'account.banned': {
    channels: ['push', 'sms'],
    ar: {
      title: 'تم إيقاف الحساب',
      body: 'تم إيقاف حسابك بسبب التعثّر في السداد. تواصل مع الدعم.',
    },
    en: {
      title: 'Account suspended',
      body: 'Your account was suspended because of a payment default. Contact support.',
    },
  },
};

export function render(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(params[k] ?? ''));
}

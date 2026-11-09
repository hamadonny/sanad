/**
 * Public pages the App Store and Google Play require (privacy policy, terms, account deletion,
 * support). DRAFTS for the founder's lawyer to review [LEGAL] — wording describes what the app
 * actually does today. Section lists keep Arabic and English side by side.
 */
export interface PublicPage {
  titleAr: string;
  titleEn: string;
  draft: boolean;
  sections: { ar: [string, string]; en: [string, string] }[];
}

const SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? '+965 9930 2447';
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@sanad.kw';

export const PAGES: Record<'privacy' | 'terms' | 'delete-account' | 'support', PublicPage> = {
  privacy: {
    titleAr: 'سياسة الخصوصية',
    titleEn: 'Privacy policy',
    draft: true,
    sections: [
      {
        ar: [
          'من نحن',
          'سند تطبيق ينظّم الجمعيات الرقمية في الكويت. هذه السياسة تشرح البيانات التي نجمعها ولماذا.',
        ],
        en: [
          'Who we are',
          'Sanad is an app that organises digital jamiyas (savings circles) in Kuwait. This policy explains what data we collect and why.',
        ],
      },
      {
        ar: [
          'البيانات التي نجمعها',
          'رقم الهاتف لتسجيل الدخول؛ بيانات الهوية (الاسم، الرقم المدني، الجنسية، تاريخ الميلاد، تاريخ انتهاء البطاقة، العنوان، وصور البطاقة وصورة شخصية) للتحقق من الهوية؛ سجل المدفوعات والاستلام داخل الجمعيات؛ رمز الإشعارات للجهاز؛ وبيانات التوقيع الإلكتروني (الوقت، عنوان IP، نوع الجهاز).',
        ],
        en: [
          'Data we collect',
          'Your phone number to sign in; identity data (name, Civil ID number, nationality, date of birth, card expiry, address, Civil ID photos and a selfie) to verify who you are; your payments and payouts within circles; your device push token; and e-signature records (time, IP address, device type).',
        ],
      },
      {
        ar: [
          'لماذا نستخدمها',
          'لتشغيل الجمعيات وتحصيل الأقساط وصرفها، والتحقق من الهوية ومنع الاحتيال وتكرار الحسابات، وإرسال التذكيرات، والوفاء بالالتزامات القانونية والتنظيمية، ومتابعة حالات التعثر قانونيًا عند الحاجة.',
        ],
        en: [
          'Why we use it',
          'To run circles and collect and pay out contributions, verify identity and prevent fraud and duplicate accounts, send reminders, meet legal and regulatory obligations, and pursue defaults legally when needed.',
        ],
      },
      {
        ar: [
          'الحماية',
          'الرقم المدني والمستندات مشفّرة. لا يرى الأعضاء الآخرون رقم هاتفك أو رقمك المدني أو اسم عائلتك الكامل. كل اطلاع للموظفين على بيانات الهوية مسجّل.',
        ],
        en: [
          'Protection',
          'Civil ID numbers and documents are encrypted. Other members never see your phone number, Civil ID or full surname. Every staff access to identity data is logged.',
        ],
      },
      {
        ar: [
          'الإحصاءات والأخطاء',
          'نعدّ استخدامًا مجهولًا (مثل عدد مرات فتح التطبيق) دون أي معرّف شخصي، ويمكنك إيقافه من الإعدادات. تقارير الأعطال تُنقّى من البيانات الشخصية. لا نستخدم أدوات تتبّع أو إعلانات من جهات خارجية ولا نبيع البيانات.',
        ],
        en: [
          'Analytics and errors',
          'We count anonymous usage (such as how often the app is opened) without any personal identifier, and you can switch it off in settings. Crash reports are stripped of personal data. We use no third-party trackers or ads and never sell data.',
        ],
      },
      {
        ar: [
          'المشاركة',
          'نشارك البيانات فقط مع بوابة الدفع المرخّصة ومزوّد التحقق من الهوية ومزوّد الرسائل النصية بالقدر اللازم، ومع الجهات الرسمية أو المحامين عند وجود التزام قانوني أو قضية تعثر.',
        ],
        en: [
          'Sharing',
          'We share data only with the licensed payment gateway, the identity verification provider and the SMS provider as needed, and with authorities or lawyers where the law requires or in a default case.',
        ],
      },
      {
        ar: [
          'الاحتفاظ والحذف',
          'يمكنك حذف حسابك من التطبيق عندما لا تكون في جمعية نشطة. نحتفظ بالسجلات المالية والتوقيعات للمدة التي يفرضها القانون.',
        ],
        en: [
          'Retention and deletion',
          'You can delete your account in the app when you are not in an active circle. Financial records and signatures are kept for as long as the law requires.',
        ],
      },
      {
        ar: ['تواصل معنا', `${SUPPORT_PHONE} — ${SUPPORT_EMAIL}`],
        en: ['Contact', `${SUPPORT_PHONE} — ${SUPPORT_EMAIL}`],
      },
    ],
  },
  terms: {
    titleAr: 'شروط الاستخدام',
    titleEn: 'Terms of use',
    draft: true,
    sections: [
      {
        ar: [
          'الجمعية',
          'تلتزم بدفع القسط الشهري كاملًا في موعده طوال مدة الجمعية، بما في ذلك شهر استلامك والأشهر التالية. يُدفع رسم التنظيم (3٪ من مبلغ الجمعية) مرة واحدة عند الانضمام، ويُعاد كاملًا إذا لم تبدأ الجمعية.',
        ],
        en: [
          'The circle',
          'You agree to pay the full monthly contribution on time for the whole circle, including the month you receive the pot and the months after. The organising fee (3% of the pot) is paid once on joining and refunded in full if the circle never starts.',
        ],
      },
      {
        ar: [
          'دور سند',
          'سند تنظّم الجمعية ولا تضمنها. يستلم صاحب كل دور ما جُمع فعلًا لذلك الشهر بعد خصم مبلغ المزايدة والمبلغ المحتجز، وما يصل متأخرًا يُحوَّل إليه. المتعثر بعد الاستلام يُحظر، ويُستخدم مبلغه المحتجز ثم ما يُحصَّل منه قانونيًا لتعويض الأعضاء المتضررين بعد خصم رسم تحصيل 10٪، وقد لا يُعوَّض النقص كاملًا.',
        ],
        en: [
          'Sanad’s role',
          'Sanad organises the circle and does not guarantee it. Each month’s recipient receives what was actually collected for that month, minus their bid and holdback; money that arrives late is forwarded to them. A member who defaults after receiving is banned; their holdback and then anything recovered from them legally go to the affected members, minus a 10% recovery fee, and a shortfall may not be fully recovered.',
        ],
      },
      {
        ar: [
          'العقد',
          'عقد العضوية الموقّع إلكترونيًا في التطبيق هو المرجع، والنص العربي هو المعتمد.',
        ],
        en: [
          'The agreement',
          'The membership agreement you e-sign in the app governs; the Arabic text prevails.',
        ],
      },
    ],
  },
  'delete-account': {
    titleAr: 'حذف الحساب',
    titleEn: 'Delete your account',
    draft: false,
    sections: [
      {
        ar: [
          'من التطبيق',
          'افتح سند ← حسابي ← حذف الحساب. يتم الحذف فورًا إذا لم تكن في جمعية نشطة.',
        ],
        en: [
          'In the app',
          'Open Sanad → Profile → Delete account. Deletion is immediate if you are not in an active circle.',
        ],
      },
      {
        ar: [
          'بدون التطبيق',
          `راسلنا على واتساب أو اتصل بنا على ${SUPPORT_PHONE} أو ${SUPPORT_EMAIL} من رقمك المسجّل، وسنحذف الحساب خلال 30 يومًا.`,
        ],
        en: [
          'Without the app',
          `Message us on WhatsApp or call ${SUPPORT_PHONE}, or email ${SUPPORT_EMAIL}, from your registered number and we will delete the account within 30 days.`,
        ],
      },
      {
        ar: [
          'ما الذي يُحتفظ به',
          'إذا كنت في جمعية نشطة، يجب إكمالها أولًا. نحتفظ بالسجلات المالية والتوقيعات للمدة التي يفرضها القانون، ثم تُحذف.',
        ],
        en: [
          'What is kept',
          'If you are in an active circle you must finish it first. Financial records and signatures are kept for as long as the law requires, then deleted.',
        ],
      },
    ],
  },
  support: {
    titleAr: 'الدعم',
    titleEn: 'Support',
    draft: false,
    sections: [
      {
        ar: [
          'تواصل معنا',
          `واتساب واتصال: ${SUPPORT_PHONE}. البريد: ${SUPPORT_EMAIL}. أو من داخل التطبيق: حسابي ← الدعم.`,
        ],
        en: [
          'Contact us',
          `WhatsApp and phone: ${SUPPORT_PHONE}. Email: ${SUPPORT_EMAIL}. Or in the app: Profile → Support.`,
        ],
      },
    ],
  },
};

# Google Play — Data safety answers

- Does the app collect or share user data? **Collects: yes. Shares: only with service providers
  acting for Sanad (payment gateway, identity check, SMS) — Google counts these as "not shared".**
- Is all data encrypted in transit? **Yes** (HTTPS only).
- Can users request deletion? **Yes** — in the app (Profile → Delete account) and at
  `/p/delete-account`.
- Committed to the Play Families policy? **No** (adults only).

| Category / type                                                                                       | Collected                                  | Optional?                | Purpose                                          |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------ | ------------------------------------------------ |
| Personal info → Name, Address, Phone number, Other info (Civil ID number, nationality, date of birth) | Yes                                        | Required                 | Account management, fraud prevention, compliance |
| Financial info → Purchase history / Other financial info                                              | Yes                                        | Required                 | App functionality                                |
| Photos and videos → Photos                                                                            | Yes                                        | Required                 | Identity verification                            |
| Messages → Other in-app messages (support tickets)                                                    | Yes                                        | Optional                 | Customer support                                 |
| App activity → App interactions                                                                       | Yes (anonymous counts)                     | Optional (switch in app) | Analytics                                        |
| App info and performance → Crash logs, Diagnostics                                                    | Yes (no personal data)                     | Required                 | App functionality                                |
| Device or other IDs                                                                                   | No (only the push token for notifications) | —                        | —                                                |
| Location                                                                                              | No                                         | —                        | —                                                |

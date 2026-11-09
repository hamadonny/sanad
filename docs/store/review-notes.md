# Notes for App Review (App Store and Google Play)

Paste into App Store Connect → App Review Information → Notes, and Play Console → App access.

**Sign-in (review account)** — set on the production API before submitting:
`REVIEW_PHONE=<a Kuwaiti number you own>` and `REVIEW_CODE=<random 6 digits>`.

> Sanad signs in with a Kuwaiti mobile number and an SMS code. For review, please use
> phone **<REVIEW_PHONE without +965>** and code **<REVIEW_CODE>** — no SMS is sent to this
> number. The same code is used when the app asks to sign the membership agreement.
> Identity verification for this account is pre-approved. Sanad is available in Kuwait only;
> the default language is Arabic (switch to English in Profile → Language).

Before submitting, in the dashboard: approve the review account's identity (Identity checks)
or create it with the seed tools, so the reviewer can see a circle.

**Payments** — Apple and Google reject simulated payments, so submission happens after the
licensed Kuwaiti payment gateway is connected (Phase 7). Until then use TestFlight / Play
internal testing.

**Account deletion** — Profile → Delete account (blocked only while the member is in an active
circle, because they owe or are owed money; explained in the app). Web: `/p/delete-account`.

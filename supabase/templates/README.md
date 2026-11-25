# BenchMark authentication emails

These templates match the app's forest green, cream background and pale-green panels, using a text-based BenchMark wordmark. They use inline styles, single-column table layouts and system fonts, so no hosted images, external font downloads, JavaScript or website stylesheet is required. Each includes an inbox preview, action button, copyable fallback link and security guidance. Actual rendering varies by email client; test a delivery in the inboxes you use.

## Install in your hosted Supabase project

Local files do not automatically update the templates used by Supabase's hosted email service. No SQL migration, SMTP change or app restart is required for this update.

1. Open your Supabase project and go to **Authentication → Email → Templates** (some dashboard layouts label the section **Email Templates**).
2. Open **Confirm signup**.
3. Set the subject to **Confirm your email | BenchMark**.
4. Switch to the template's **Source** / HTML editor. Replace its entire body with the full contents of `confirm-signup.html` (not this README, and no Markdown code fences). Save the changes.
5. Open **Reset password**.
6. Set the subject to **Reset your password | BenchMark**.
7. Replace its entire HTML body with the full contents of `reset-password.html` and save.
8. From BenchMark, request a new signup confirmation and a password reset, then check their appearance and buttons on your phone. Emails already delivered retain their old design.

Keep your existing custom SMTP credentials and sender email. If desired, set the sender display name to **BenchMark** in the existing SMTP settings; do not create a new SMTP configuration just to edit HTML.

## Links must remain unchanged

Both button and fallback link intentionally use the app's existing callback flow:

- Confirmation: `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=signup`
- Password reset: `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=recovery`

Preserve the braces, variable names and token types exactly. `&amp;` is HTML encoding for `&`; it is correct in these files. Do not substitute the default `{{ .ConfirmationURL }}` link, hard-code localhost, or add click-tracking wrappers.

The app supplies an absolute redirect ending in `/auth/confirm`. It must be allowed in your Supabase redirect settings. For use on a phone or a different computer, request the email from your deployed HTTPS app rather than localhost. These templates only change presentation, not the link destination, expiration, email-delivery configuration, or account permissions.

You may open the HTML files locally to preview their appearance. The template variables are placeholders until Supabase sends a real email, so buttons in local previews are not usable verification links. Do not share screenshots containing real token links.

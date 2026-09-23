# Family Tutor promotion site

The public promotion site is a dependency-free static site in [`site/`](../site/). It explains the product boundary, the family learning loop, the child privacy model, the founding-family pilot hypothesis, and the enquiry path. Cloudflare Pages metadata in `site/_headers`, `site/robots.txt`, and `site/sitemap.xml` adds baseline browser hardening and crawl discoverability without JavaScript or third-party tracking.

## Local preview

From the repository root:

```bash
npx serve site
```

The site intentionally has no analytics SDK, cookies, child forms, or third-party fonts. The enquiry CTA uses `mailto:hello@qili2.com`. Setup/product feedback is a separate multipart form at [`site/feedback.html`](../site/feedback.html), intended to POST to the hosted `/v1/feedback` Relay-compatible intake when that route is deployed. It stores a durable feedback record before any later triage or implementation task and warns testers not to submit child content or credentials.

## Cloudflare Pages deployment

The intended public hostname is `family-tutor.qili2.com`, subject to DNS and account availability. Deployment requires an authenticated Cloudflare account with permission to create or update the Pages project and configure the custom domain; no credentials are stored in this repository.

```bash
npx wrangler pages project create family-tutor
npx wrangler pages deploy site --project-name family-tutor --branch main
```

After the first deployment, configure `family-tutor.qili2.com` as a custom domain in Cloudflare Pages. If the zone is not already managed by Cloudflare, complete the DNS delegation first. Verify both the Pages preview URL and the custom hostname over HTTPS before calling the site live.

## Release checklist

- [ ] Confirm the owner has approved positioning, pilot scope, pricing hypothesis, and contact address.
- [ ] Review public privacy/consent wording and replace pilot notes with approved legal copy when available.
- [ ] Run an accessibility pass at mobile width, keyboard-only navigation, and a reduced-motion preference.
- [ ] Deploy with `wrangler` using an existing authenticated session; never put an API token in shell history, source, or docs.
- [ ] Verify `https://family-tutor.qili2.com/`, the privacy page, anchor links, and the mailto CTA.
- [ ] Verify response headers include `Content-Security-Policy`, `Referrer-Policy`, and `X-Content-Type-Options`.
- [ ] Verify `/robots.txt` and `/sitemap.xml` resolve from the custom hostname.
- [ ] Verify `/feedback.html` accepts text plus an image and returns the public confirmation page through the deployed `/v1/feedback` intake.
- [ ] Record the Pages project and deployment URL in the private launch record, not in tracked learner/family data.
- [ ] If measurement is added later, use aggregate, privacy-conscious analytics only; do not collect child content or message text.

Deployment was not claimed by this change: it requires the owner’s Cloudflare account access and final domain/business approval.

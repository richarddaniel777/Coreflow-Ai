# CoreFlow AI

Static, mobile-first sales and customer management for small businesses. The frontend uses plain HTML, CSS and vanilla JavaScript modules; Supabase provides Auth, Postgres, RLS and Edge Functions.

## Setup

1. Create a Supabase project and copy its project URL and publishable/anon key into `js/config.js` (`SUPABASE_URL` and `SUPABASE_ANON_KEY`). These browser credentials are public; never put a service-role key or AI key in frontend files.
2. In Supabase SQL Editor, run every file in `supabase/migrations` in numeric order: `001_init.sql`, `002_fixes.sql`, `003_more_channels.sql`, `004_dashboard_views.sql`, `005_ai_usage.sql`, `006_harden_ai_quota.sql`, then `007_company_logos.sql`. Review each migration before running it; `006_harden_ai_quota.sql` caps each supported AI function at 50 successful calls per user per database day.
3. Install/link the Supabase CLI for deployment:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```

4. In Supabase Authentication settings, set the site URL and allowed redirect URLs for the production site and local development. Configure email confirmation as desired. Password recovery must allow the production and local `/reset-password.html` paths.
5. Set Edge Function secrets (PowerShell):

   ```powershell
   npx supabase secrets set GROQ_API_KEY="your-groq-key" LLM_CHAIN="groq:openai/gpt-oss-120b,groq:openai/gpt-oss-20b" ALLOWED_ORIGINS="https://your-production-domain.example,http://localhost:5500,http://localhost:8000"
   ```

   `ALLOWED_ORIGINS` is a comma-separated list of exact origins, with no trailing path. Include only origins you operate. Local defaults are available when the secret is unset.
6. Deploy each function with JWT verification enabled:

   ```powershell
   npx supabase functions deploy score-lead --use-api
   npx supabase functions deploy draft-message --use-api
   ```

7. Serve the site locally from the repository root. With Python installed:

   ```powershell
   python -m http.server 5500
   ```

   Open `http://localhost:5500/login.html`. Do not open HTML files directly from disk. The sample CSV, style guide, and no-framework test pages are for local development and are excluded from Vercel deployment.
8. Deploy the repository as a static Vercel project with the repository root as the project root and no build command. `vercel.json` configures clean URLs and security headers. Verify that the deployed hostname is included in `ALLOWED_ORIGINS` and Supabase Auth redirect URLs.

## Local checks

- `styleguide.html` previews the design system.
- `js/lib/leadStatus.test.html`, `js/lib/csv.test.html`, and `js/lib/dates.test.html` run standalone helper checks in a browser.
- Test login, password reset, lead CRUD/import, follow-ups, dashboard, AI scoring, and AI message drafting against a non-production Supabase project before launch.

## Secrets and local files

`.env.example` documents secret names only. `.gitignore` excludes environment files and Supabase local state. Never commit API keys, user tokens, or service-role credentials. The frontend config contains only the public Supabase URL and publishable key.

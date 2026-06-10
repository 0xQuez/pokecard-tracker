# Pokémon Card Cost Tracker — Project Context

## Project Overview
A shared web app for tracking Pokémon card costs (raw price, grading fees, shipping, insurance) between two users (Quez + Stevie). Simple, direct UX — "glorified spreadsheet" with real-time sync, auto-calculated cost basis, and settlement view showing who owes whom.

## Current State
- **Scaffolded**: Next.js 16 + TypeScript + Tailwind at `~/pokecards`
- **Components built**:
  - `AddCard.tsx` — Collapsible form with live total cost calculation
  - `CardList.tsx` — Filterable list with inline costs, owner tags, delete confirmation
  - `Settlement.tsx` — Balance calculation (who paid what, split %, who owes whom)
  - `PasswordGate.tsx` — Simple shared password gate (sessionStorage)
  - `page.tsx` — Main layout with tabs (Cards | Settlement)
- **Supabase client**: `src/lib/supabaseClient.ts` using `@supabase/supabase-js`
- **Dependencies installed**: `@supabase/supabase-js`, `@supabase/ssr`

## Database Schema (run once in Supabase SQL Editor)
```sql
CREATE TABLE IF NOT EXISTS cards (
  id bigserial PRIMARY KEY,
  created_at timestamptz DEFAULT now() NOT NULL,
  card_name text NOT NULL,
  card_id text,
  purchase_price numeric NOT NULL,
  grading_fee numeric DEFAULT 0,
  shipping_to_grader numeric DEFAULT 0,
  shipping_from_grader numeric DEFAULT 0,
  insurance numeric DEFAULT 0,
  other_costs numeric DEFAULT 0,
  notes text DEFAULT '',
  paid_by text NOT NULL DEFAULT 'Quez',
  split_percent int NOT NULL DEFAULT 100,
  date_acquired date,
  grade_received text,
  sale_price numeric,
  date_sold date
);

ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON cards FOR ALL USING (true);
```

## Required Environment File
Create `~/pokecards/.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://uavvgewguecxjocewwlo.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from Supabase dashboard → Settings → API>
NEXT_PUBLIC_APP_PASSWORD=<shared password for you and Stevie>
```

## Key Design Decisions
- **Auth**: Password gate only (no OAuth, no email). Both users share one password.
- **Split logic**: Each card has `paid_by` (Quez/Stevie/Both) + `split_percent` (0-100). Settlement calculates each person's fair share vs what they actually paid.
- **Entry flow**: One card at a time, collapsible advanced fields (grading/shipping/insurance/other), live total at bottom.
- **Future extensibility**: Schema includes `grade_received`, `sale_price`, `date_sold` for profit tracking later.
- **No separate "users" table** — hardcoded Quez/Stevie for simplicity.

## Supabase Credentials Source
Reused from SpotFinder project:
- URL: `https://uavvgewguecxjocewwlo.supabase.co`
- Anon key: In `~/spotfinder/SpotFinder/Utilities/Constants.swift` (line 18)
- Project already has Supabase Swift package configured

## To Complete & Deploy
1. **Run the SQL** in Supabase dashboard → SQL Editor
2. **Create `.env.local`** with the three values above
3. **Test locally**: `cd ~/pokecards && npm run dev`
4. **Deploy to Vercel**:
   - Connect GitHub repo
   - Add same env vars in Vercel project settings
   - Deploy
5. **Share URL** with Stevie

## Next Features (when needed)
- **Profit tracking**: Use `sale_price` + `date_sold` fields already in schema
- **Barcode scan**: Add camera input → UPC lookup → auto-fill card_name/card_id
- **CSV export**: Settlement view → download
- **PSA cert tracking**: Add `cert_number` field
- **Multi-card batch entry**: For card show hauls

## File Structure
```
~/pokecards/
├── .env.local                    # Create this
├── src/
│   ├── app/
│   │   ├── page.tsx              # Main entry (tabs, auth, state)
│   │   └── layout.tsx
│   ├── components/
│   │   ├── AddCard.tsx           # Form with live total
│   │   ├── CardList.tsx          # List + filters + delete
│   │   ├── Settlement.tsx        # Who owes whom calculation
│   │   └── PasswordGate.tsx      # Simple pw gate
│   └── lib/
│       └── supabaseClient.ts     # Browser Supabase client
├── package.json
└── tsconfig.json
```

## Commands
```bash
cd ~/pokecards
npm run dev      # Local dev (port 3000)
npm run build    # Production build
npm run start    # Run built version
```

## Important Notes
- RLS policy is wide open (`true`) — fine for 2 trusted users, change if you share more broadly
- `paid_by: "Both"` means each paid their own split share (no transfer needed)
- Split percent = Quez's share (so 70 = Quez 70%, Stevie 30%)
- Settlement math:
  - For each card: total_cost × split% = Quez_share, total_cost × (100-split%) = Stevie_share
  - Sum what each person actually paid vs their fair share
  - Difference = who owes whom

## Related Projects
- SpotFinder (main iOS app) — same Supabase project
- AI Engineering Portfolio (separate) — learning curriculum
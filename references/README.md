# UI references

AI builds much better interfaces when it has a reference to follow. Each folder here is one style
pack. The planner picks the pack that fits a project, the orchestrator copies it into the project
as `docs/design-reference/`, and the frontend agent and the reviewer work from it.

## Included packs

| Pack | For |
|---|---|
| `precision-saas` | SaaS and developer-tool marketing sites, pricing pages |
| `calm-dashboard` | Admin panels, analytics, CRM, internal tools |
| `bold-launch` | Launch and campaign landing pages, waitlists |
| `warm-hospitality` | Restaurants, cafes, hotels, food brands |
| `immersive-webgl` | 3D product reveals and award-style showcase sites |
| `kinetic-studio` | Portfolios, studios, agencies, case studies |
| `editorial-luxury-motion` | Premium ecommerce and luxury brands |

They are written from common design patterns, not copied from any site. New packs should follow the
same rule.

[CRAFT.md](CRAFT.md) goes into every project along with the chosen pack, including your own packs.
It lists what makes a site look generic and AI-built (stock gradients, emoji icons, filler copy, the
same three cards on every page) and what to do instead. The reviewer reports anything from its
"Never ship these" list as a defect.

## A pack

```text
my-pack/
  reference.json   title, suited_for, summary, optional url
  DESIGN.md        colors, type, layout, motion, rules, checklist
  screens/         optional screenshots
```

## Add a site you like

Take screenshots of the site (full page, plus any section you love) and put them in a folder:

```powershell
npm run bridge -- reference-add my-style "D:\shots\my-site" --url https://example.com --for "restaurant, landing page"
npm run bridge -- references
```

Your packs live in `references/custom/` and are never committed. Then either let the planner choose,
or force one with `npm run bridge -- start spec.json --reference my-style`.

A reference is for style only. Agents are told not to copy its text, images, logos, or code.

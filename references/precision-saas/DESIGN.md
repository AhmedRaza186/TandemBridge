# Precision SaaS

A style reference for frontend agents. Apply it to this project's own product, copy, and screens.

## The feeling

A tool built by careful engineers. Quiet surfaces, sharp edges, nothing decorative that does not
explain the product. The product itself is the hero: real screens, not illustrations of people
pointing at laptops.

## Color

Pick dark or light as the base and keep it consistent across the site.

| Role | Dark base | Light base | Use |
|---|---|---|---|
| Canvas | `#0a0a0b` | `#fbfbfa` | Page background |
| Surface | `#141416` | `#ffffff` | Cards and frames |
| Border | `#26262b` | `#e7e6e3` | 1px hairlines everywhere |
| Text | `#ededef` | `#16161a` | Headings and body |
| Muted | `#8b8b93` | `#6b6b73` | Secondary text |
| Accent | `#6e8bff` | `#4f5dff` | One accent: links, focus, primary button |

A single soft radial glow of the accent behind the hero product shot is allowed, at under 20%
opacity. No rainbow gradients.

## Type

- One grotesque family, such as Geist, Inter, or Manrope. Mono for code and numbers, such as
  JetBrains Mono or Geist Mono.
- Headline 48 to 72px on desktop, weight 600, letter spacing `-0.03em`, line height 1.05.
- Body 15 to 17px, line height 1.6, muted color for long paragraphs.
- Small caps-style labels: 12px, uppercase, `0.08em` tracking, above each section heading.

## Layout

- Max content width 1120 to 1200px, generous vertical rhythm (96 to 128px between sections).
- A faint grid or dotted background pattern is allowed in the hero only.
- Radius 10 to 14px on cards, 8px on buttons and inputs. Same values everywhere.
- Product screenshots sit in a frame: surface color, 1px border, slight inner padding, and a soft
  shadow on light bases only.

## Signature sections

1. **Hero:** one-line promise, one-sentence explanation, two buttons (primary and secondary), and
   the real product screen below, slightly tilted or perfectly flat.
2. **Logo strip:** customer or integration logos in muted monochrome. Only real ones.
3. **Bento features:** a grid of 4 to 6 cards of different sizes. Each card shows the feature
   working (a small UI snippet, a chart, a code block), not an icon and a paragraph.
4. **How it works:** three numbered steps, each with a short visual.
5. **Pricing:** two or three tiers, the recommended one outlined in the accent. Monthly and yearly
   toggle. A comparison table below for detail.
6. **FAQ and final call to action.**

## Motion

- Subtle and fast: 150 to 250ms, `cubic-bezier(0.2, 0, 0, 1)`.
- Sections fade up 12px once as they enter. Bento cards may show a looping micro-demo.
- Buttons and cards lift 1 to 2px on hover with a border-color change. No bouncing.

## Hard rules

- Every visual shows the real product or real data from this project.
- Contrast meets WCAG AA, including muted text on surface in both themes.
- Visible focus rings in the accent color on every interactive element.
- Pricing and forms work without JavaScript animation.
- Honor `prefers-reduced-motion`: no movement, content fully visible.
- No stock photos of people, no 3D blobs, no more than one accent color.

## Before calling it done

- [ ] The product screen is visible above the fold on a 1366x768 laptop
- [ ] One type family plus one mono, at most
- [ ] All cards and buttons share the same radius and border
- [ ] Works and reads well at 360px width
- [ ] Light or dark choice is consistent on every page

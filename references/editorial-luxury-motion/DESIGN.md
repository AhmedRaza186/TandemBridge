# Editorial luxury with cinematic scroll

A style reference for frontend agents. Build the project's own brand, copy, and images in this
style. Do not reuse names, wording, or images from any site this style was drawn from.

## The feeling

A printed magazine that moves. The page is calm and generous until the visitor scrolls, then one
object takes over the screen. Restraint is the point: few colors, few type sizes, lots of air, and
every animation tied to the visitor's scroll or hand.

## Color

Use this structure. Adjust the hues to the brand, but keep one accent only.

| Role | Default | Use |
|---|---|---|
| Page | `#f4efe3` | Main background, warm cream, never pure white |
| Page deep | `#e6e0cd` | Alternate sections |
| Paper | `#faf7ef` | Cards and raised surfaces |
| Ink | `#0f2a22` | Text and dark bands, a deep green-black, never pure black |
| Ink soft | `#3c4e45` | Body text |
| Mute | `#7c877e` | Labels and metadata |
| Line | `#d3d0bd` | 1px rules, used instead of shadows |
| Accent | `#a97c34` | One metallic accent, for emphasis words and small marks only |
| Night | `#08140f` | Hero and footer |

Text selection inverts: ink background with page-colored text.

## Type

- Display: a high-contrast serif at weight 400, such as Instrument Serif. Letter spacing `-0.02em`,
  line height `0.9`. Go very large: 6rem on phones, up to 12rem or more on desktop.
- One emphasis device: italic in the accent color, for one or two words per headline.
- Body: a tight grotesque, such as Inter Tight. Small, 14 to 16px, relaxed line height.
- Eyebrow labels: `0.7rem`, uppercase, `0.22em` tracking, weight 500, above most headlines.
- Numbers are shown as `01`, `02` in eyebrow style to give sections an index.

## Layout

- Full-bleed sections with side padding of about 20px on phones and 48px on desktop.
- Thin rules and borders separate content. No drop shadows and no rounded card stacks.
- Asymmetry: a large headline on one side, a small paragraph on the other.
- Product photos on white backgrounds use `mix-blend-mode: multiply`, so they rest on the page.
  Transformed parents isolate blending, so apply it on the wrapper in that case.
- A fixed film-grain layer at about 6% opacity, with `pointer-events: none`, stops flat color
  looking digital.

## Motion system

Stack: GSAP with ScrollTrigger for scroll scenes, Lenis for smooth scrolling, CSS transitions for
simple reveals. Pin exact versions.

- One easing everywhere: `cubic-bezier(0.22, 1, 0.36, 1)`.
- Lenis `lerp: 0.12`, driven from `gsap.ticker`, with `lagSmoothing(0)`, calling
  `ScrollTrigger.update()` on scroll. Destroy it on unmount.
- Reveal on enter: opacity 0 and `translateY(28px)` to rest over about 1.1s, once only, threshold
  about 0.18.
- Headlines: each line slides up out of an `overflow: hidden` mask, 110ms stagger, about 1.2s.
- Scrub amounts: 0.6 to 0.8 for scenes, so they trail the scroll slightly.
- Velocity lean: product cards skew up to 6 degrees with scroll speed and settle to 0. Write the
  variable only on those cards, not on `<html>`.

## Signature sections

Use three or four of these on a home page, not all of them.

1. **Pinned hero story.** One hero object stays on screen for several viewport heights while short
   text blocks pass over it. It rotates, moves between sides, and changes finish. Text blocks use
   `position: sticky` in sections of 90 to 150vh. Finish by brightening from Night into the page.
2. **Horizontal track.** A section pins and its panels slide sideways, each panel 50 to 70vw, with
   the product rotating gently. On phones it becomes a normal vertical stack.
3. **Ink-fill statement.** A large sentence whose words go from 14% opacity to full as it scrolls.
4. **Marquee band.** An ink band with oversized italic words and small accent marks, looping.
5. **Sticky product beside stories.** The image stays while three short stories scroll past.
6. **Magnetic buttons and a custom cursor** that labels links ("Shop", "View"). Desktop only.

## Hard rules

- Honor `prefers-reduced-motion` with `gsap.matchMedia()`: no pinning, no smooth scroll, no scrub,
  content fully visible.
- On screens under 768px, do not pin horizontal tracks. Stack them.
- Wrap anything GSAP pins in a plain outer element owned by React. Pinning inserts a spacer, and
  without the wrapper a route change throws in `removeChild` and blanks the app.
- Revert every GSAP context or `matchMedia` on unmount.
- Lazy-load 3D or canvas work, and pause it when off screen with `IntersectionObserver`.
- Do not animate large masks or filters on many elements. They are expensive to rasterize.
- Use `100svh`, not `100vh`, for full-screen mobile sections.
- All links and buttons stay keyboard reachable with a visible focus style, and contrast meets
  WCAG AA, including the Mute and Accent colors on Page.

## Before calling it done

- [ ] One accent color, and at most two font families
- [ ] Headlines are genuinely oversized on desktop and do not overflow at 360px width
- [ ] No layout shift when the scroll scenes load
- [ ] Works with reduced motion turned on
- [ ] Route changes in and out of pinned pages do not crash
- [ ] Real project content, with no placeholder or copied text

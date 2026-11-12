# Bold launch landing

A style reference for frontend agents. Built to convert in one scroll.

## The feeling

A poster that sells. Big words, blunt shapes, strong color, a little playful. It should feel made
by people, not generated, so it uses hard edges and real personality instead of soft gradients.

## Color

- A light paper base (`#fffaf0`) and pure ink (`#111111`).
- Two loud accents, chosen for the brand, for example `#ff5a1f` and `#3a5bff`, plus one pale
  highlight such as `#ffe45c`.
- Color comes in solid blocks: full-width bands and cards. No gradients.

## Type

- Display: a heavy, characterful grotesque, such as Bricolage Grotesque, Syne, or Space Grotesk,
  weight 700 to 800.
- Headlines span the viewport: `clamp(3rem, 11vw, 10rem)`, line height 0.9, tight tracking.
- One word per headline may switch to the accent color or an outlined stroke.
- Body: a plain sans at 16 to 18px.

## Layout

- Neobrutalist cards: 2 to 3px ink border, radius 0 to 12px, and a hard shadow offset 6px right
  and down in ink, no blur.
- Buttons use the same treatment and press down on click, by moving 4px and losing the shadow.
- Sections alternate background blocks to make the scroll rhythm obvious.
- Stickers and badges ("New", "Free", "v2") are rotated a few degrees and overlap edges.

## Signature sections

1. **Hero:** the promise as a giant headline, one sentence under it, the main button, and a
   product image or phone mockup breaking out of its card.
2. **Marquee band:** an ink band with large repeating words or proof points.
3. **Three reasons:** three bordered cards with a number, a short title, and one line.
4. **Proof:** testimonials or numbers as big as headlines.
5. **How to get it:** steps or store badges.
6. **Final block:** the headline restated and the same button, on a full accent band.

## Motion

- Snappy: 200 to 300ms with a slight overshoot, `cubic-bezier(0.34, 1.56, 0.64, 1)`.
- Headlines reveal word by word on load. Cards tilt slightly toward the cursor on desktop.
- The marquee loops slowly and pauses on hover.

## Hard rules

- One primary call to action, the same text and destination everywhere on the page.
- Huge headlines never overflow or break mid-word at 360px width.
- Accent colors on the paper base meet WCAG AA for any text they carry.
- Honor `prefers-reduced-motion`: no marquee movement, no tilt, no reveal.
- The page is fast: no video or 3D above the fold unless it is the product itself.

## Before calling it done

- [ ] The promise and the button are visible without scrolling on a phone
- [ ] Borders and shadows use the same thickness and offset everywhere
- [ ] At most two loud accents plus one highlight
- [ ] The call to action works and its text is identical in every section

# Kinetic studio portfolio

A style reference for frontend agents building a site that shows off creative work.

## The feeling

Confident and crafted. The typography performs, the work is shown big, and every transition feels
deliberate. Restraint in color lets the projects bring their own.

## Color

- Two base colors only, for example off-black `#0e0e0e` and bone `#ece8e1`. The site may invert
  between them per section.
- No interface accent. Color comes from the project images.

## Type

- Display: a wide or condensed grotesque, such as Syne, Unbounded, or Space Grotesk, at `clamp(3rem, 12vw, 14rem)`.
- Body: a neutral sans at 16px, or a mono for metadata (year, role, client).
- Headlines split into lines and letters for animation, while the full text stays in the DOM for
  screen readers.

## Layout

- Home: a name or statement as a giant kinetic headline, then a selected-work list.
- Work list: either a large grid of case-study cards or a text list where hovering a project
  shows a floating preview image that follows the cursor.
- Case study page: full-width hero image, a short facts row (client, year, role, services), then
  alternating full-bleed images and short paragraphs, and a large "Next project" link at the end.
- About and contact: short, with one large email link.

## Motion

- Headline letters rise from a mask with 20 to 40ms stagger on load and on section enter.
- Text scrubs horizontally a little with scroll on large headlines.
- Page transitions: a color panel wipes across in about 600ms, or the clicked card expands into
  the case-study hero.
- Custom cursor: a small circle that grows and shows "View" over projects. Desktop only.
- Easing: `cubic-bezier(0.76, 0, 0.24, 1)` for transitions, `cubic-bezier(0.22, 1, 0.36, 1)` for
  reveals.

## Hard rules

- The native cursor stays available for text fields, and the custom cursor never hides links.
- Page transitions never block the back button or break deep links to a case study.
- Images are large but optimized: modern formats, responsive sizes, lazy-loaded after the first
  screen.
- Honor `prefers-reduced-motion`: no letter animation, no scrubbing, instant page changes.
- Keyboard users can reach every project and see where focus is.

## Before calling it done

- [ ] Headlines never overflow at 360px width
- [ ] Back and forward work through page transitions
- [ ] Each case study loads its hero image fast
- [ ] Two base colors only, no stray accents

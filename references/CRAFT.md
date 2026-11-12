# Craft rules

These rules apply to every interface, whatever the style pack. The pack decides the look. This file
keeps the result from looking like a generic AI-generated site: the kind where every page has the
same purple gradient, the same three cards, and the same "Unlock your potential" headline.

If the pack and this file disagree, the pack wins. Everything below that the pack does not mention
still applies.

## Never ship these

### Color
- A purple-to-blue or pink-to-orange gradient as the main background or on the hero headline text.
- Gradient text anywhere, unless the pack asks for it.
- A dark page with random neon glows, blurred color blobs, or "aurora" backgrounds.
- More than one accent color competing on one screen.
- Pure `#000` text on pure `#fff`, or gray text too light to read (check contrast, 4.5:1 for body).

### Type
- Inter or the system font for everything, at default weights, because nothing was chosen.
- Every heading the same size and weight. A page needs a real scale with clear steps.
- Headlines in Title Case With Every Word Capitalized.
- Body text wider than about 75 characters per line, or smaller than 16px.

### Layout
- The default landing page: centered hero, two buttons, a row of three icon cards, a testimonial
  carousel, a pricing table, and a footer. Build only the sections this product needs, in the order
  that tells its story.
- Every section the same height, the same padding, and the same centered alignment.
- Cards inside cards, or a card around content that does not need a border.
- Glassmorphism (frosted blurred panels) used as decoration everywhere.
- Huge rounded corners (24px or more) on every element, or a different radius on each component.
- Drop shadows on everything. Use one or two shadow levels with a clear purpose.
- Empty space filled with decorative blobs, grids of dots, or floating 3D shapes that mean nothing.

### Icons and images
- Emoji used as icons in the interface (🚀 ✨ 💡 🔥).
- A random mix of icon sets. Pick one set, one stroke width, and one size scale.
- A sparkle or magic-wand icon next to anything called "AI".
- Generic stock photos of people smiling at laptops, or fake product screenshots made of gray boxes.
- Images stretched, squashed, or without `width` and `height`, so the layout jumps while loading.

### Copy
- Filler marketing lines: "Unlock your potential", "Supercharge your workflow", "Revolutionize",
  "Seamless", "Next-generation", "Elevate", "Empower", "Game-changer", "In today's fast-paced world".
- Lorem ipsum, "John Doe", "Acme Inc", or `example@email.com` left in the finished product.
- Made-up numbers presented as real ("10,000+ happy customers", "99.9% uptime") without a source.
  Use clearly marked placeholders the owner can replace.
- Buttons that say "Get Started", "Learn More", or "Click Here" when a specific verb fits better
  ("Book a table", "Start free trial", "See the menu").

### Motion
- Every element fading up on scroll with the same delay and duration.
- Bounce or elastic easing on interface elements.
- Hover effects that scale cards up, tilt them, or make them glow, on every card.
- Animation that delays content: the visitor never waits for a reveal to read the first screen.
- Typewriter headlines, particle backgrounds, and cursor trails, unless the pack asks for them.

### Behavior
- Buttons and links that do nothing, or link to `#`.
- Forms with no validation, no error message, and no success state.
- A screen with data and no loading, empty, or error state.
- A mobile menu that does not close, or a layout that scrolls sideways on a phone.
- Focus outlines removed with no replacement.

## Do this instead

1. **Start from the content.** Write the real headline, the real sections, and the real calls to
   action for this product before styling anything. If the brief does not give the copy, write
   plain, specific copy about what the product actually does.
2. **Set the system first.** Define color, type scale, spacing scale (for example 4, 8, 12, 16, 24,
   32, 48, 64, 96), radius, and shadow as tokens (CSS variables or the theme config). Every component
   uses the tokens. No one-off values.
3. **Make one decision memorable.** Each page needs one thing a visitor will remember: an unusual
   layout, a strong type choice, a striking image treatment, or one well-made interaction. Keep the
   rest quiet so that one thing stands out.
4. **Vary the rhythm.** Alternate dense and open sections, left and right alignment, and full-bleed
   and contained widths, so the page does not feel stamped from one template.
5. **Use hierarchy, not decoration.** Size, weight, space, and position should tell the visitor what
   matters. If a section only works because of a border or a glow, rework the layout.
6. **Motion with a reason.** Animate to show a change of state, guide attention to one thing, or
   connect two screens. Keep durations short (150 to 300ms for interface, up to 800ms for a hero
   reveal) and honor `prefers-reduced-motion`.
7. **Finish the details.** Real favicon and page titles, hover, focus, active and disabled states on
   every control, aligned baselines, consistent icon sizes, and no orphaned single words in headlines
   where it can be avoided.

## Before calling it done

- [ ] Nothing from "Never ship these" is on any page
- [ ] Every color, size, radius, and shadow comes from a token
- [ ] Copy is specific to this product, with no filler phrases and no leftover placeholders
- [ ] Every button and link works, and every form has error and success states
- [ ] Works at 360px, 768px, and 1440px wide with no sideways scroll
- [ ] Keyboard focus is visible, and contrast passes
- [ ] Ask honestly: if this were next to ten other AI-built sites, would anyone know it apart? If
      not, change the one memorable decision until they would.

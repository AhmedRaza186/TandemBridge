# Warm hospitality

A style reference for frontend agents building for places people eat, drink, or stay.

## The feeling

Walking in from the cold. Warm light, real food, a friendly voice. Most visitors are on a phone
and want three things: the menu, the hours and location, and a way to book or order. Beauty serves
those three.

## Color

| Role | Default | Use |
|---|---|---|
| Base | `#f7f1e8` | Warm cream background |
| Deep | `#2b1d16` | Text and dark bands, a coffee brown |
| Accent | `#c0502e` | Terracotta: buttons and highlights |
| Herb | `#5f6f3a` | Secondary accent: tags such as vegetarian |
| Line | `#e2d6c4` | Dividers in the menu |

Photography carries most of the color. Keep the interface warm and quiet around it.

## Type

- Display: a soft, characterful serif, such as Fraunces or Playfair Display, sometimes italic.
- Body and menu: a friendly sans, such as DM Sans, at 16 to 17px.
- Menu item names in the serif, prices aligned right in the sans with tabular numbers.

## Layout

- Full-bleed hero photograph or short muted video loop, with the name, one line, and two buttons:
  "Book a table" (or "Order now") and "See the menu".
- A sticky bar on phones with three actions: Call, Directions, Book or Order.
- Menu as sections (Starters, Mains, Desserts, Drinks) with a sticky section switcher. Each item:
  name, short description, price, and small dietary tags. Photos only for signature dishes.
- Story section: the people and the kitchen, with candid photography.
- Hours, address, map, and contact always in the footer and on their own section.

## Motion

- Gentle and slow: 400 to 700ms fades, light parallax on large photos (at most 10%).
- Images zoom very slightly on hover. Nothing spins or bounces.

## Hard rules

- Hours, address, and phone are real text, not inside an image, so they can be searched and copied.
- Opening hours show "Open now" or "Closed, opens at 6 pm" using the venue's time zone.
- Images are compressed, sized for the screen, and lazy-loaded below the fold.
- The menu is readable without zooming on a 360px phone.
- Booking and ordering forms ask only for what is needed, with clear confirmation.
- Honor `prefers-reduced-motion`: no parallax or video autoplay.

## Before calling it done

- [ ] Menu, hours, location, and booking each reachable in one tap from the first screen
- [ ] Prices aligned and consistent in format
- [ ] Dietary tags have text labels, not only colored dots
- [ ] The page loads fast on a mobile connection

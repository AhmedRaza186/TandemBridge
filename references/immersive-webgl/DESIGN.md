# Immersive WebGL

A style reference for frontend agents building a site where a 3D scene is the experience.

## The feeling

Stepping inside the product. One continuous world that the visitor moves through by scrolling,
with the interface as a thin layer of light text on top. Cinematic, but never at the cost of
loading time or readability.

## Stack

Three.js through React Three Fiber, with drei helpers. GSAP ScrollTrigger or the scroll controls
from drei to map scroll to the camera. Lenis for smooth scrolling. Pin exact versions.

## Color and light

- Dark scene background (`#05060a` to `#101218`) so emissive and rim light read well.
- One key light, one rim light, and an environment map for reflections. Soft shadows on one
  ground plane only.
- Interface text in near-white (`#f2f2f2`) with a muted secondary (`#9a9aa6`), and one accent
  taken from the 3D model's own materials.

## Type

- Interface type is small and precise over the canvas: a grotesque such as Space Grotesk or
  Inter, 14 to 16px, plus large chapter titles at 56 to 96px.
- Text sits in a fixed overlay above the canvas, never inside the 3D scene, so it stays sharp,
  selectable, and accessible.

## Structure

1. **Loader:** a real progress value from the asset loader, under 3 seconds on a good connection.
2. **Chapters:** 4 to 6 scroll sections. Each one moves the camera to a new pose and shows one
   short block of text. Hold each pose for part of the scroll so the text can be read.
3. **Interaction:** the model reacts gently to the pointer (a few degrees), and a hotspot or two
   may open detail cards.
4. **Exit:** the scene settles and the page continues as normal HTML with the call to action,
   details, and footer.

## Performance budget

- Models in glTF with Draco or Meshopt compression, textures in KTX2. Total 3D payload under
  8 MB, hero model under 3 MB.
- Device pixel ratio capped at 2 (1.5 on phones). Target 60 fps on a mid-range laptop.
- Pause rendering when the canvas is off screen or the tab is hidden.
- Post-processing is optional and light: bloom at low strength, maybe vignette. No stacking of
  effects.
- Load the 3D bundle lazily, after the first paint of the HTML.

## Fallbacks

- No WebGL, a low-power device, or `prefers-reduced-motion`: show a high-quality still render per
  chapter with the same text, and normal scrolling.
- Phones get a simpler scene: fewer lights, no shadows, smaller textures.

## Hard rules

- All content and links exist in HTML, so the site works for screen readers and search engines.
- Scroll is never hijacked so hard that the visitor cannot reach the footer quickly.
- Dispose geometries, materials, and textures when components unmount.
- Test on a real phone, not only a desktop browser.

## Before calling it done

- [ ] First text visible within 2 seconds, even before the 3D finishes loading
- [ ] Steady frame rate on a mid-range laptop and acceptable on a phone
- [ ] The fallback still tells the whole story
- [ ] Every chapter's text readable over the scene, with enough contrast

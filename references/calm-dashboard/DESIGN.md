# Calm operations dashboard

A style reference for frontend agents building software people use all day.

## The feeling

A well-run control room. Lots of information, no noise. The user always knows where they are,
what changed, and what to do next. Color means something; it is never decoration.

## Color

| Role | Light | Dark | Use |
|---|---|---|---|
| Canvas | `#f6f7f9` | `#0f1115` | App background |
| Surface | `#ffffff` | `#171a20` | Panels, tables, cards |
| Border | `#e3e6eb` | `#272b33` | Dividers and outlines |
| Text | `#1b1f24` | `#e6e8eb` | Main text |
| Muted | `#626a75` | `#9aa3ad` | Labels and metadata |
| Primary | `#2f6fed` | `#5b8cff` | Primary actions and selection |
| Success | `#1f8a4c` | `#3fb871` | Positive states only |
| Warning | `#b26b00` | `#e0a03a` | Needs attention |
| Danger | `#c9372c` | `#ef6a5e` | Errors and destructive actions |

Status color always comes with an icon or label, never color alone. Support both themes.

## Type

- One readable sans, such as Inter or IBM Plex Sans, with tabular numbers turned on for every
  table, metric, and amount.
- Page title 20 to 24px weight 600. Section titles 15 to 16px weight 600. Body 13 to 14px.
- Numbers right-aligned in tables, with consistent decimals and units.

## Layout

- Left sidebar (collapsible, 240px open, 64px collapsed) and a slim top bar with search, alerts,
  and the user menu.
- Content in a 12-column grid with 16 to 24px gutters. Spacing scale of 4px.
- Page structure: title and primary action, then filters, then the main content.
- Metric cards in one row at the top: label, value, change against the previous period.
- Detail views open in a side drawer when the user should keep their place in a list.

## Components

- **Tables:** sticky header, sortable columns, row hover, selectable rows with bulk actions,
  pagination or virtual scrolling, and column density that stays compact.
- **Filters:** visible chips for active filters, with one action to clear them all.
- **Charts:** a line or bar chart with labelled axes, tooltips, and a legend only when there is
  more than one series. No 3D charts, no pie charts with more than five slices.
- **Forms:** labels above fields, inline validation, errors next to the field, a sticky save bar
  on long forms.
- **Command palette** on Ctrl/Cmd+K for navigation and common actions.

## Every view has four states

1. Loading: skeletons in the shape of the content, not a spinner on a blank page.
2. Empty: what this view is for, and the one action that fills it.
3. Error: what went wrong in plain words, and a Retry button. Never a fake empty state.
4. Populated.

## Motion

Functional only: 120 to 200ms for hovers, drawers, and toasts. Nothing moves on its own.

## Hard rules

- Every action reachable by keyboard, with a visible focus style.
- Destructive actions ask for confirmation and say exactly what will be removed.
- Times shown in the user's time zone, relative in lists ("5 min ago") with the exact time on hover.
- Toasts confirm saves, and errors stay until dismissed.
- Contrast meets WCAG AA in both themes.

## Before calling it done

- [ ] Every list and detail view has loading, empty, error, and populated states
- [ ] Tables use tabular numbers and right-aligned amounts
- [ ] Works at 1280px wide and stays usable at 768px
- [ ] Ctrl/Cmd+K opens the command palette
- [ ] No color-only status indicators

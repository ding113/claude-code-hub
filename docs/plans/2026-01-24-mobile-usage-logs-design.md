# Mobile Usage Logs Card Layout Design

## Overview

Optimize the usage logs display on mobile devices (< 768px) by replacing the table layout with a card-based layout that shows all essential information without truncation.

## Problem

Current table layout on mobile:
- 11 columns squeezed into narrow screen
- Content truncated with `...` everywhere
- Users cannot see complete information
- Poor mobile browsing experience

## Solution

Switch to card-based layout on mobile while keeping desktop table unchanged.

## Card Structure

```
+-------------------------------------+
| [Header] Time + Status Badge        |
|   Left: Relative time (3s ago)      |
|   Right: Status badge (OK 200)      |
+-------------------------------------+
| [Identity] User + Provider + Model  |
|   Username - Provider name          |
|   Model name (with redirect arrow)  |
+-------------------------------------+
| [Data] Tokens + Cache + Cost        |
|   Col1: Input/Output tokens         |
|   Col2: Cache write/read            |
|   Col3: Cost amount                 |
+-------------------------------------+
| [Performance] Duration + TTFB + Rate|
|   Total time - TTFB - Output rate   |
+-------------------------------------+
```

## Visual Design

### Card Base Style
- Border radius: `rounded-lg`
- Border: `border`
- Gap between cards: `gap-3` (12px)
- Padding: `p-3` (12px)
- Click feedback: slight press effect

### Status Badges

| Status | Style | Example |
|--------|-------|---------|
| Success (200) | Green background | `OK 200` |
| Client error (4xx) | Orange background | `! 429` |
| Server error (5xx) | Red background | `X 500` |
| Blocked | Orange outline | `Blocked` |

### Special States
- **Session resume**: Small tag after provider name
- **Model redirect**: Arrow display `gpt-4 -> claude-sonnet`
- **Cost multiplier**: Badge next to cost `x1.50`
- **Non-billing request**: Muted card background `bg-muted/60`

### Data Section Layout
```
+-----------+-----------+---------+
|  Tokens   |   Cache   |  Cost   |
|  In: 1.2K |  W: 500   | $0.0234 |
| Out: 856  |  R: 2.1K  |         |
+-----------+-----------+---------+
```
- Three equal-width columns
- Numbers right-aligned
- Labels left-aligned

## Implementation

### File Structure
```
src/app/[locale]/dashboard/logs/_components/
├── virtualized-logs-table.tsx      # Add responsive detection
├── mobile-log-card.tsx             # New: Single card component
└── mobile-logs-list.tsx            # New: Mobile card list with virtual scroll
```

### Changes

1. **virtualized-logs-table.tsx**
   - Import `useIsMobile()` hook
   - Render `MobileLogsList` when `isMobile`
   - Keep existing table for desktop

2. **mobile-log-card.tsx**
   - Accept single log data
   - Render four sections (header/identity/data/performance)
   - Click triggers `onCardClick` to open detail dialog

3. **mobile-logs-list.tsx**
   - Reuse existing `useInfiniteQuery` logic
   - Reuse existing `useVirtualizer` for virtual scrolling
   - Adjust `ROW_HEIGHT` to card height (~140px)

### Reused Components
- Data fetching: `getUsageLogsBatch`
- Detail dialog: `ErrorDetailsDialog`
- Time format: `RelativeTime`
- Currency format: `formatCurrency`
- Token format: `formatTokenAmount`

## Interaction

- Tap card: Open detail dialog (reuse ErrorDetailsDialog)
- Virtual scrolling: Infinite scroll with auto-fetch
- Pull to refresh: Supported via existing refresh logic

## Responsive Breakpoint

- `< 768px`: Card layout (mobile)
- `>= 768px`: Table layout (desktop)

Detection via `useIsMobile()` hook from `@/lib/hooks/use-mobile.ts`

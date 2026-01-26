# Mobile Leaderboard Optimization Design

## Problem

The leaderboard page has usability issues on mobile devices:

1. **Tab labels truncated** - "供应商缓存命中率排行" gets cut off, appearing as garbled text
2. **Table too cramped** - 4+ columns squeezed into narrow viewport
3. **Filter inputs crowded** - Two TagInputs side by side have limited width

## Solution Overview

Transform the leaderboard from table-based layout to card-based layout on mobile, with simplified tab labels and stacked filter inputs.

## Design Details

### 1. Tab Label Simplification

Use shorter labels on mobile (< 768px):

| Desktop | Mobile |
|---------|--------|
| 用户排行 | 用户 |
| 供应商排行 | 供应商 |
| 供应商缓存命中率排行 | 缓存率 |
| 模型排行 | 模型 |

Implementation: Use `useIsMobile()` hook to conditionally render tab labels.

### 2. Card-Based Layout

Replace table with expandable cards on mobile.

#### Default View (Collapsed)

```
┌─────────────────────────────────────┐
│ 🏆 #1   username            $18.01M │  → tap to expand
├─────────────────────────────────────┤
│ 🥈 #2   another_user         $5.32M │
├─────────────────────────────────────┤
│ 🥉 #3   test_account         $2.10M │
└─────────────────────────────────────┘
```

- Left: Rank badge (reuse existing Trophy/Medal/Award icons)
- Center: Name (user/provider/model depending on scope)
- Right: Primary metric (cost/tokens)
- Visual: Top 3 highlighted with `bg-muted/50`

#### Expanded View

```
┌─────────────────────────────────────┐
│ 🏆 #1   default              ▲ 收起 │
│─────────────────────────────────────│
│  请求数        Token数       消耗    │
│  299          18.01M       $12.50   │
└─────────────────────────────────────┘
```

Fields by scope:

| Scope | Expanded Fields |
|-------|-----------------|
| User | requests, tokens, cost |
| Provider | requests, cost, tokens, successRate, avgTtfbMs, avgTokensPerSecond |
| CacheHitRate | requests, cacheHitRate, cacheReadTokens, totalInputTokens |
| Model | requests, tokens, cost, successRate |

Layout:
- 3-4 fields: single row `grid-cols-3`
- 5-6 fields: two rows `grid-cols-3`

### 3. Filter Area

Mobile layout (stacked):

```
┌─────────────────────────────────────┐
│ [按用户标签筛选...               ]  │  ← full width
│ [按用户分组筛选...               ]  │  ← full width
├─────────────────────────────────────┤
│ [今日] [本周] [本月] [全部]         │  ← keep horizontal
│ [<] [2026-01-24              ] [>]  │
└─────────────────────────────────────┘
```

Changes:
- TagInputs stack vertically on mobile
- Each TagInput takes full width
- Date picker area remains unchanged

### 4. Responsive Switching

Use existing `useIsMobile()` hook from `src/lib/hooks/use-mobile.ts`:
- Breakpoint: 768px
- Mobile (< 768px): Render card components
- Desktop (>= 768px): Keep existing table

## Implementation Plan

### Files to Create

1. `src/app/[locale]/dashboard/leaderboard/_components/mobile-leaderboard-card.tsx`
   - Reusable card component for all scopes
   - Props: rank, data, scope, expanded, onToggle

### Files to Modify

1. `src/app/[locale]/dashboard/leaderboard/_components/leaderboard-view.tsx`
   - Add `useIsMobile()` hook
   - Conditionally render mobile tabs labels
   - Stack TagInputs on mobile
   - Render cards instead of table on mobile

2. `messages/*/dashboard/leaderboard.json` (all 5 languages)
   - Add short tab labels: `tabs.userRankingShort`, `tabs.providerRankingShort`, etc.

### Files Unchanged

- `leaderboard-table.tsx` - Desktop table component, no changes needed
- `date-range-picker.tsx` - Already works on mobile

## Related Work

This follows the same pattern as the mobile logs optimization:
- `src/app/[locale]/dashboard/logs/_components/mobile-log-card.tsx`
- `src/app/[locale]/dashboard/logs/_components/mobile-logs-list.tsx`

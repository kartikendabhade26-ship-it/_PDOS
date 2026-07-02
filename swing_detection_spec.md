# PDOS Swing Detection Engine Specification

This document provides a complete, mathematically precise description of the Swing Engine in the PDOS architecture. It is designed to serve as a self-contained logic specification and prompt template for AI models to reproduce or analyze the exact logic.

---

## 1. Core Philosophy: Preserve Information, Interpret Later

The swing engine is the foundational layer. Its responsibility is **not** to determine which swings are "important" or "nice-looking" for a chart, but to record every mathematically valid pivot.
- **Database**: Stores 100% of confirmed mathematical pivots.
- **Renderer**: Filters and displays only higher degrees (e.g., Degree 2+ or 3+).
- **Visibility != Existence**: Visibility must never determine existence. Information cannot be reconstructed once deleted.

---

## 2. Mathematical Definition of Swings

Swings are scanned using a windowed neighbor comparison. A bar index $i$ is compared to its left neighbors ($[i - \text{leftLen}, i - 1]$) and right neighbors ($[i + 1, i + \text{rightLen}]$).

### Swing High Candidates
A candle at index $i$ is a **Swing High Candidate** if:
1. No bar in the window has a higher price:
   $$\forall j \in [i - \text{leftLen}, i + \text{rightLen}], \quad \text{high}_j \le \text{high}_i$$
2. At least one neighbor in the window is strictly lower:
   $$\exists j \in [i - \text{leftLen}, i + \text{rightLen}], \quad \text{high}_j < \text{high}_i$$

*This allows equal neighboring wicks (resolving flat-tops), but requires it to be a local maximum.*

### Swing Low Candidates
A candle at index $i$ is a **Swing Low Candidate** if:
1. No bar in the window has a lower price:
   $$\forall j \in [i - \text{leftLen}, i + \text{rightLen}], \quad \text{low}_j \ge \text{low}_i$$
2. At least one neighbor in the window is strictly higher:
   $$\exists j \in [i - \text{leftLen}, i + \text{rightLen}], \quad \text{low}_j > \text{low}_i$$

*This allows equal neighboring wicks (resolving flat-bottoms), but requires it to be a local minimum.*

---

## 3. Flat Wick Run Resolution

When multiple consecutive candles have identical prices at their wicks and all qualify as swing candidates, they form a "flat run." They are resolved into a single pivot index using a priority score.

### Scoring Criteria
For each candidate index $idx$ in a flat run from $L$ to $R$:
- If index $idx$ qualifies as **both** a Swing High and a Swing Low candidate (e.g., an inside bar, doji, or pin-bar at a local extreme), it is assigned a score of `0`.
- Otherwise, it is assigned a score of `1`.

### Resolution Selection
- The candle with the **highest score** (preferring pure swing candles over dual-directional ones) is selected.
- If there is a score tie, the **last index** ($R$, the rightmost candle of the run) is chosen. This is the `flat_group_last` rule.
- The confirmation bar index for the chosen pivot is marked at $R + \text{rightLen}$.

---

## 4. Chronological Sequence & Outside Bar Resolution

Once pivots are finalized, they are sorted chronologically. In cases of extreme volatility, a single candle may register both a Swing High and a Swing Low (an Outside Bar conflict).

To prevent primary key/rendering conflicts, they are ordered dynamically to enforce strict alternation relative to the preceding swing:
- If the prior swing was a **Swing High**: the outside bar is ordered as `Swing High -> Swing Low` (ensures a High -> Low -> High flow).
- If the prior swing was a **Swing Low**: the outside bar is ordered as `Swing Low -> Swing High` (ensures a Low -> High -> Low flow).

---

## 5. Multi-Degree Hierarchy Builder (Recursive Promotion)

Higher-degree swings (Degree 2, Degree 3, etc.) represent larger market cycles. They are recursively built from underlying lower-degree swings of the same type.

### Promotion Rules
To build Degree $N$ swings:
1. Filter all Degree $N-1$ swings of a single type (e.g. all swing highs).
2. For three consecutive swings `[prev, middle, next]`:
   - **For Swing Highs**: Promoted if `middle.price > prev.price` AND `middle.price > next.price`.
   - **For Swing Lows**: Promoted if `middle.price < prev.price` AND `middle.price < next.price`.
3. If promoted, the parent-child relationships are linked:
   - `child.parentSwingIds` includes the parent ID.
   - `parent.childSwingIds` is populated with `[prev.id, middle.id, next.id]`.

---

## 6. Strength Score Calculation

The mathematical strength of a confirmed swing is calculated by expanding the left and right window until a bar violates the extreme:
- For **Swing Highs**: Strength $S$ is the maximum value where all wicks in $[i - S, i + S]$ satisfy $\text{high}_j < \text{price}$.
- For **Swing Lows**: Strength $S$ is the maximum value where all wicks in $[i - S, i + S]$ satisfy $\text{low}_j > \text{price}$.

---

## 7. AI System Prompt Template
Below is the system prompt configuration to replicate this logic in any environment:

```text
You are an expert quantitative developer. Implement a windowed swing high/low detector matching these rules:
1. Inputs: An array of OHLC bars, leftLen, rightLen.
2. Candidate Scan: 
   - A high candidate is when no bar in [i - leftLen, i + rightLen] has high > bar[i].high, and at least one has high < bar[i].high.
   - A low candidate is when no bar in [i - leftLen, i + rightLen] has low < bar[i].low, and at least one has low > bar[i].low.
3. Flat Runs Resolution:
   - Identify consecutive candidate wicks of the same type at identical prices.
   - Assign score = 0 if a bar is both a high and low candidate, else score = 1.
   - Choose the index in the flat run with max score, defaulting to the rightmost index on ties.
4. Sequence Alternation:
   - If an index has both a Swing High and Swing Low (Outside Bar), order them to alternate relative to the prior swing.
5. Hierarchy Promotion:
   - Generate degree N pivots by checking if middle degree N-1 pivot is an extreme relative to its immediate left and right neighbors. Link parent and child IDs.
```

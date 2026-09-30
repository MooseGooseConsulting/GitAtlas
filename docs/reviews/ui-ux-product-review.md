# Git Atlas UI/UX product review

Reviewed from the shipped frontend only (`src/app/page.tsx`, `src/components/*`, `src/app/globals.css`, `docs/thoughts.md`). No feature code was changed. There are no product screenshots in the repo; the inventory below is from the components that actually mount.

Comparison baseline (Patrick): Graphite’s merge inbox — attention sections such as Returned to you / Approved / Waiting for reviewers, dense rows, and a hover “Reviewed by” that names people and bots and says whether they commented or requested changes.

---

## 1. What the product UI is for

Git Atlas is a dark, single-screen memory tool for one GitHub account’s repositories. It loads a hardcoded user (`Coldaine` in `src/lib/store.ts`), draws those repos as a constellation, and lets you filter, compare, and open a side sheet that holds an AI summary, tech stack, file tree, dependencies, similar projects, notes, and a proposed README. The job, stated in `docs/thoughts.md` and the page metadata, is “do I already have something for this?” — recall of your own corpus, not triage of other people’s reviews. The whole product is one route: `/` renders `CockpitDashboard`. An older `AtlasDashboard` (search bar, tag sidebar, three views) still exists and is not mounted.

## 2. Screen and surface inventory

There is no router. Every “screen” is a center-pane mode, a rail, or a dialog on the same cockpit.

### Chrome that is always on

| Surface | What it shows | Empty / failure |
| --- | --- | --- |
| Header | Wordmark, live username dot, animated counts (repos, stars, forks, “active”, deep-analyzed), inline progress for analyze / deep analyze / README rewrite | Failed fetch sets loading off and leaves the cockpit empty. No error banner. Username is not editable in the UI. |
| Action row | Filter field, Filters popover, “Do I have…?”, AI Suggestions, Compare, Export, Org Repos (hidden once any org repo exists), Deep Analyze, Rewrite READMEs, Tune Graph, Settings, keyboard help, nine view icons, Show/Hide Cards | Filter placeholder says `⌘K`. `⌘K` opens the command palette. `/` opens smart search. The field itself has no shortcut. |
| Left rail (~18%) | Language donut, category bars, 12-month push chart, commit heatmap, concept groups, tag cloud (30), category chips again | Charts render empty series. Heatmap depends on `/api/github` activity for the username. |
| Right rail (~24%) | Tabs: Activity (All / Active / Stale / Analyzed) and Commits. Footer blocks: deep-analysis ring, Needs Attention (max 4), Most Starred (max 4) | Activity list is the 8 most recently pushed repos, or 10 if a filter is on. No “see all”. Refresh reloads projects only. |
| Floating pill | “N of M projects”, active tag count, search string, deep-analyzed count | Sits on top of the graph legend area. |
| Onboarding tour | Four steps: graph, Deep Analyze, smart search, detail sheet. Stored in `localStorage`. | First step targets the graph before data may exist. Spotlight math does not follow resize. |
| Bottom card strip | Horizontal project cards. Off by default. | None beyond an empty flex row. |

### Center views (⌘1–⌘9)

Icon-only. Selected state is an emerald (or amber/rose) tint. Tooltips still say things like `✅ Functional: Graph View (⌘1)`.

1. **Graph** (default). Force layout, zoom/pan, legend, minimap, hover card. Empty: “No projects to display”.
2. **Grid**. Cards with health bar, language, stars, forks, bookmark, lifespan, framework chips. Empty: “No projects match your filters”.
3. **Timeline**. Horizontal lifespan bars from `githubCreatedAt` to last push, with a “today” marker. Empty copy exists. Repos without `githubCreatedAt` disappear with no explanation.
4. **Stats**. Second set of language/category/activity charts plus gradient stat cards. Overlaps the left rail.
5. **Dependency network**. Shared-package graph. Click opens the sheet.
6. **Tech radar**. Fixed dimensions (AI, web, CLI, and so on) plus a gap list.
7. **Bookmarks**. Local-only (`git-atlas-bookmarks`). Real empty state: icon, “No Bookmarks Yet”, how to bookmark. Sort by name, health, last push, stars.
8. **Relationship map**. Tag and dependency edges between repos.
9. **Health**. Portfolio score ring, maturity label (Beginner → Expert), factor bars, recommendation rows, per-repo list sorted worst-first, stale / missing README / archived / no-stars groupings.

### Overlays

- **Detail sheet** (560px, right). The primary drill-in. Header: category glyph, name, health ring, bookmark, copy-share, open GitHub. Body, in order, when data exists: activity line, skill dots, tech-stack tiles, deep summary, short AI summary, code signature (frameworks / patterns / architecture — frameworks repeat the tech stack), GitHub description, category, tags, topics, file tree, dependencies (search + runtime/dev), similar projects, commit activity, notes, README with proposed / original / diff. Several sections are fetch-on-open and say “No file tree loaded”, “No dependencies detected”, “No similar projects computed”, “No README available”, or “No commit data available” in 10px muted text.
- **Smart search** (“Do I have…?”). The actual primary task. Dialog, not the header filter.
- **AI Suggestions**. Gap-filling project ideas. Button tooltip says the feature is partial and needs deep analysis.
- **Compare**. Two projects side by side.
- **Export**. Markdown or JSON of the portfolio.
- **Command palette** (`⌘K`). Navigate, projects, actions, tag filters. This one has `role="dialog"` and a listbox. Best accessibility in the app.
- **Keyboard help** (`?`). Lists the shortcuts. `?` is bound as Shift+`?`, so it does not match the overlay’s own label on every keyboard.
- **Settings**. Six tabs. General and graph controls are wired. Ingestion (and other rows) render dimmed with a “Planned” badge. The dialog says so; the header button does not.
- **Tune Graph**. Separate sheet for physics and which edge types draw. This is the control that matches the graph; much of Settings → Graph duplicates it.
- **Concept drilldown**. Imported in the cockpit and never rendered. The handler that would open it looks up `group.key`, and concept groups only have `id`.

### Dead or disconnected UI

- `HeroInput`, `SearchBar`, `ViewToggle`, `StatsBar`, `TagSidebar`, `LoadingOverlay`, and `AtlasDashboard` are not on the page.
- Concept chips write `activeConceptGroups` on the Zustand store. The graph filter reads a different `useState` in the cockpit that nothing in the render tree updates. Clicking “AI & Intelligence” highlights the chip and does not change the constellation.
- `AdvancedFilters` keeps its own state. `setAdvancedFilters` in the cockpit is never called, so language, min stars, “only analyzed”, “hide archived”, and the activity slider do not go through `applyAdvancedFilters`. Apply copies some choices into the search string and tag list instead. The badge on the button can show a count while the center view ignores half the popover.

## 3. Strengths

**The job is legible once you are inside a repo.** The detail sheet is the strongest surface. Name, health, one-line activity, stack, and an honest AI summary sit above the raw README. Proposed vs original vs diff is a real information-design idea, and it matches the product note that READMEs lie. Similar projects and shared-dependency counts answer “you already have this” better than another chart.

**Density exists, in the wrong place and the right one.** Grid cards and the right-rail activity rows pack name, summary, language, and recency into a small hit target. The activity row (11px name, two-line summary, 9px meta, category tick) is the closest thing in the app to a Graphite row. The command palette is denser still and grouped.

**One visual system.** Dark neutral ground, emerald as the single accent, amber for stars and AI, category color as a left border or node color. Geist, shadcn primitives, and a consistent card radius. Focus-visible is defined globally as an emerald ring. The command palette, sheets, and dialogs use Radix, so focus trap and Escape work there.

**Motion is used for state, not only decoration, in a few places.** View changes crossfade. The loading state is a skeleton of the card grid rather than a spinner alone. Deep-analyze progress is visible in the header and as a ring. Bookmark empty state is calm.

**Recall aids are scoped.** Concept groups (AI, devtools, web, data, infra, creative, security, memory, plus computed sets like Phoenix) are the right taxonomy for “what did I build?”. Tags and the smart-search dialog are aimed at the same question. Bookmarks are a personal shortlist with a real empty state.

**Graph semantics are explainable.** A one-line strip under the header states what size and color mean. The legend covers size, color, edges, icons, and badges. Tune Graph keeps that explanation live instead of burying it only in Settings.

## 4. Weaknesses and risks

**The header is a toolbar, not a hierarchy.** About a dozen peer buttons share the same height, outline, and icon-plus-label pattern, each in its own hue (amber, cyan, emerald, violet, orange). “Do I have…?” — the sentence the product is for — looks like Export. Deep Analyze and Rewrite READMEs are destructive-feeling batch jobs sitting in the same row as navigation. On a laptop width this row wraps or clips; several labels already hide below `sm`.

**Nine views, one unlabeled icon strip.** Graph, grid, timeline, stats, network, radar, bookmarks, relationships, and health are not named in the control. Three of them (graph, network, relationships) are variations of “nodes and edges.” Stats repeats the left rail. Nothing in the strip says which view answers the recall question. Power users get `⌘1`–`⌘9`; everyone else hunts tooltips that still contain implementation status (`✅ Functional`, `⚠️ Partial`).

**Attention is labeled and then defined as neglect.** “Needs Attention” is archived repos or anything not pushed in 180 days, capped at four rows, with no list page. The activity tab’s Stale filter is almost the same set, capped at ten. Health turns “repos with zero stars” into a recommendation. That is portfolio hygiene. It is not “returned to you” or “waiting on reviewers.” A person opening Git Atlas to decide what to merge will not find a queue.

**No review, bot, or PR information anywhere.** `Project` has stars, forks, open issue count, topics, and analysis fields. It has no pull requests, review state, CI, or commenters. Hover on a graph node (`ProjectHoverCard`) shows name, summary, a health ring, up to three frameworks, dependency count, and an 8-point sparkline. That sparkline is `Math.sin` plus a bump if the repo was pushed in the last month. It reads as history. It is not. There is no “Reviewed by,” no bot name, and no commented vs requested-changes distinction, because the data is not on the screen.

**Filters lie.** Concept groups look selected and do not filter the center. The advanced filter popover’s structured fields do not update the memo that actually filters projects. Category exists three times (bar chart, chip list, and again inside Filters) and the chip list calls `toggleTag`, so a category click and a tag click share one bag. Search is a single substring over a joined blob, so “react” matches a dependency, a topic, or a sentence in the deep summary with no indication which.

**Health is not one number.** The detail sheet, hover card, and health view share one formula (stars and open issues, archived = 0). Grid cards and bookmarks use another (forks bonus, no issue penalty, archived = 15). The same repo can be “Healthy” in the sheet and a different color on the card. The portfolio “Expert / Beginner” label scores how much of the corpus has been deep-analyzed, which is a product metric, not repo health.

**Type and contrast are below a working size.** Rails use 7–10px type at `muted-foreground` with 30–40% opacity on `oklch(0.145)` background. Section labels, timestamps, and “6mo+” badges fail ordinary contrast. Icon-only controls (nine views, refresh, keyboard help, bookmark, share) rely on `title`, not `aria-label` or `aria-pressed`. The view group is not a radiogroup. Emoji category and concept icons are text, not labeled images. Charts in the left rail have color and no pattern, and the donut has no text alternative.

**Motion does not yield.** The header gradient, right-rail aurora, pulsing dots, shimmer skeletons, and animated counters run continuously. `globals.css` does not check `prefers-reduced-motion`. The onboarding tour appears 1.5s after first visit and covers the graph.

**Trust leaks.** Settings shows controls that cannot be used. AI Suggestions is marked partial only in a tooltip. Org Repos is hardcoded to `ProjectBroadside`. Batch README rewrite sits one click from the primary chrome. Empty and error states for the initial GitHub fetch are silent. The tour’s fourth target is the first activity row’s id, not the detail sheet, so the step named “Explore Details” spotlights a feed row.

**Detail sheet is long, not layered.** Tech stack and code-signature frameworks repeat. Summary, deep summary, and description can all be on screen. There is no sticky “open GitHub / bookmark” once you scroll, and no in-sheet nav. Primary action after understanding a repo is a small GitHub button in the header.

## 5. Recommendations

Ranked for a UI pass. None of these require inventing a merge inbox unless that is a new product decision (see section 6).

### P0 — make the current product tell the truth

1. **One primary action in the header.** Keep “Do I have…?” as the only filled button. Move Deep Analyze, Rewrite READMEs, Export, Compare, Org Repos, and AI Suggestions into the command palette and a single “More” menu. Leave Settings and Tune Graph as quiet icons.
2. **Name the views, and cut the lookalikes.** Show a label (Graph, List, Timeline, Health, Saved). Park network and relationship map behind Graph (edge mode). Park Stats behind the left rail or drop it until it shows something the rail does not. Use `aria-pressed` and visible text, and delete the “Functional / Partial” tooltip prefixes.
3. **Wire or remove the filters that already look on.** Concept chips should drive the same list the graph uses. Advanced filters should call the existing `applyAdvancedFilters` state, including min stars and analyzed/archived, or those controls should not render. Show the active filters as removable chips next to the search field.
4. **Stop presenting a fake sparkline as activity.** Either plot real pushes or remove it from the hover card. Say “last push” in words; that value already exists.
5. **One health definition.** Pick the detail-panel formula, use it on cards, bookmarks, hover, and the health view, and label it “recency and maintenance,” not a moral score. Do not call zero stars a problem in the same voice as a stale repo.
6. **Replace the silent load failure.** If `/api/github/projects` and `/api/github/fetch` both fail, show that sentence and a retry, not an empty constellation.

### P1 — attention and density, still inside this product

7. **Rebuild the right rail as three explicit buckets, Graphite-style, for repos.** Suggested sections, each with a count and a “show all”: **Touch this week** (pushed in 7 days), **Stale** (180 days, not archived), **Archived**. Rows stay one line: name, language, relative time. Drop the two-line summary from the default row; put it on hover. Do not cap at four and hide the rest.
8. **Make the hover card answer “what is this and who else is like it.”** Name, one-line summary, last push, language, category, up to three similar repo names. That is the recall equivalent of “Reviewed by”: the identities that matter, not a decorative chart.
9. **Turn the grid into the dense list.** A compact row mode (name, category dot, language, stars, last push, bookmark) will scan faster than four-column cards for the “find the repo” job. Keep cards as a toggle.
10. **Layer the detail sheet.** Sticky header. First screen: summary, stack, similar projects, GitHub. Everything else (file tree, README diff, notes, skill dots) behind tabs. Remove the duplicate framework block.
11. **Type ramp.** Body and row text at 12–13px. Metadata at 11px. Nothing under 11px in interactive UI. Raise muted text to at least the current `--muted-foreground` with no extra opacity cut. Honor `prefers-reduced-motion` by disabling the header gradient, aurora, ping, and count-up.

### P2 — polish after the above is true

12. **Let the user pick the GitHub account** instead of the store default, and say which org “Org Repos” will load.
13. **Finish or hide Settings rows** marked Planned. Point graph tuning only at Tune Graph.
14. **Keyboard help should match the bindings**, include concept-filter and detail-sheet close, and be reachable from the command palette.
15. **Chart summaries.** A one-line “TypeScript 40%, Python 25%…” under the donut, not only color cells.
16. **Delete or quarantine unmounted dashboards** (`AtlasDashboard` and its children) so the next UI pass does not restyle a screen nobody sees. That is cleanup, not a feature.

## 6. Does this UI solve a coding attention board / PR merge inbox?

**Not at all.**

Git Atlas does not list pull requests. The data model has no review state, reviewer, bot, CI check, or comment. Nothing in the UI can show Returned to you, Approved, or Waiting for reviewers, and nothing can name a bot or distinguish “commented” from “requested changes.”

What it does solve is a **personal repo atlas**: see the corpus, ask whether a tool already exists, and read an AI summary before opening GitHub. The nearest *pattern* to Graphite is the right rail plus hover card — a side list and a preview — but the buckets are maintenance (stale, archived, most starred), the rows are repo names, and the hover preview is a synthetic sparkline. Health is a second, larger maintenance dashboard, not an inbox.

If the next product question is “what should I merge today,” this UI does not partially answer it. The pieces worth borrowing for a future inbox are already visible here as interaction ideas only: section counts, a dense row, and a hover that names actors. They are aimed at repositories and recall, and they are not wired to review events.

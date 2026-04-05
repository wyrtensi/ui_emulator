# This file outlines potential features we might add in the future.

## wyrtensi:
- Different versions of Windows, so each window can have a few different looks, so, for example, other users can post an interface under the name "inventory", and we can see their versions. Or I can add a new design for the inventory. We need to think about how to place them in the repository and how to paste them manually into the emulator or with a link.
- Milestone (April 2026): base version system implemented using `windows/{id}/{version}/` subfolders, single active version per window id, direct/GitHub import version picker, and optional GitHub hash targeting (`#window=...&version=...`).
- Milestone (April 2026): runtime version selector added to Control Panel Windows list for multi-version windows with persisted selection.
- Milestone (April 2026): export slicing v3 foundations implemented (multi-match highlights, dynamic refresh, count-aware export tree) with per-window granular `data-export` migration and interactive state hooks (`captureState` / `applyState`) for defaults.
- Milestone (April 2026): export state variants implemented (`variants` on export entries) for hover/click asset output and clip-path-aware rendering to preserve cut-corner shapes.
- Milestone (April 2026): hover/click variant coverage expanded across interactive built-in windows (inventory, action-bar, target-info, minimap, chat-box, character, abilities, example root/v1/v2) plus state-cycle export variants for race-indicator (attack/warning).
- Milestone (April 2026): export renderer now applies clip-path polygon masks directly on output canvases to keep chamfered/cut corners in PNG output.
- Milestone (April 2026): built-in window export lists normalized to element/cell slices; text-only export targets removed.
- After the Windows versions are implemented, it will be possible to enable a voting system for each window and version. It must be a friendly voting system. It should be run by the owner of the interface and cannot be taken over by other users.

## Raffi:
-
-

## Community:
-
-

import { taskStore } from "../stores/task-store";
import type { TaskCacheEntry } from "../../shared/types";
import { getCurrentUiZIndex } from "../utils/layer";
import { isProjectTask } from "../../shared/project-domain";

interface DragConfig {
    container: HTMLElement;
    getCardElement: (blockId: string) => HTMLElement | null;
    onReorder: (blockId: string, parentId: string | null, afterId: string | null) => Promise<void>;
}

export function createDragHandler(config: DragConfig) {
    let isDragging = false;
    let dragBlockId: string | null = null;
    let ghost: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;
    let pointerId: number = -1;
    const MOVE_THRESHOLD_PX = 5;

    function getIndentWidth(): number {
        const item = config.container.querySelector(".na-all-tasks__item");
        if (!item) return 20;
        const style = getComputedStyle(item);
        const pl = style.paddingLeft;
        if (pl && pl !== "0px") return parseFloat(pl) || 20;
        return 20;
    }

    function onPointerDown(e: PointerEvent, blockId: string) {
        if (e.button !== 0) return;
        e.preventDefault();
        startX = e.clientX;
        startY = e.clientY;
        dragBlockId = blockId;
        pointerId = e.pointerId;
        try {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        } catch {
            // Synthetic events and detached elements may not have an active pointer.
        }
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
    }

    function onPointerMove(e: PointerEvent) {
        if (!dragBlockId) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!isDragging) {
            if (Math.abs(dx) > MOVE_THRESHOLD_PX || Math.abs(dy) > MOVE_THRESHOLD_PX) {
                startDrag(e);
            }
            return;
        }
        if (ghost) {
            ghost.style.left = `${e.clientX - 10}px`;
            ghost.style.top = `${e.clientY - 10}px`;
        }
        updateDropTarget(e);
    }

    function suppressClick(e: Event) {
        e.stopPropagation();
        e.preventDefault();
        document.removeEventListener("click", suppressClick, true);
    }

    function startDrag(e: PointerEvent) {
        isDragging = true;
        const cardEl = config.getCardElement(dragBlockId!);
        if (!cardEl) return;
        ghost = cardEl.cloneNode(true) as HTMLElement;
        ghost.classList.add("na-drag-ghost");
        ghost.style.position = "fixed";
        ghost.style.width = `${cardEl.offsetWidth}px`;
        ghost.style.opacity = "0.7";
        ghost.style.pointerEvents = "none";
        ghost.style.zIndex = String(getCurrentUiZIndex(9));
        ghost.style.left = `${e.clientX - 10}px`;
        ghost.style.top = `${e.clientY - 10}px`;
        document.body.appendChild(ghost);
        cardEl.classList.add("na-drag-source");
        document.addEventListener("click", suppressClick, true);
        document.addEventListener("keydown", onKeyDown);
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") endDrag();
    }

    function onPointerUp(e: PointerEvent) {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        try {
            (e.target as HTMLElement).releasePointerCapture?.(pointerId);
        } catch {}
        if (!isDragging) {
            dragBlockId = null;
            return;
        }
        const target = getDropTarget(e);
        if (target) void config.onReorder(dragBlockId!, target.parentId, target.afterId);
        endDrag();
    }

    function endDrag() {
        isDragging = false;
        dragBlockId = null;
        if (ghost) {
            ghost.remove();
            ghost = null;
        }
        const source = config.container.querySelector(".na-drag-source");
        if (source) source.classList.remove("na-drag-source");
        clearIndicators();
        document.removeEventListener("keydown", onKeyDown);
    }

    function getIndentLevel(task: TaskCacheEntry, tasks: TaskCacheEntry[]): number {
        const taskMap = new Map(tasks.map((t) => [t.blockId, t]));
        let level = 0;
        let currentId: string | undefined = task.parentId;
        const visited = new Set<string>();
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            level++;
            const parent = taskMap.get(currentId);
            if (!parent) break;
            currentId = parent.parentId;
        }
        return level;
    }

    function getAncestorChain(task: TaskCacheEntry, tasks: TaskCacheEntry[]): string[] {
        const taskMap = new Map(tasks.map((t) => [t.blockId, t]));
        const chain: string[] = [task.blockId];
        let currentId: string | undefined = task.parentId;
        const visited = new Set<string>();
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            chain.unshift(currentId);
            const parent = taskMap.get(currentId);
            if (!parent) break;
            currentId = parent.parentId;
        }
        return chain;
    }

    /**
     * Find the best matching card at the given mouse position.
     *
     * When multiple cards overlap vertically (a parent and its children
     * are close together), we pick the one whose indent level best matches
     * the mouse X position. This prevents the common problem where
     * hovering near the bottom of a parent card accidentally selects
     * its child card.
     */
    function findCardAt(
        mouseX: number,
        mouseY: number,
        currentTasks: TaskCacheEntry[],
        indentWidth: number,
    ): HTMLElement | null {
        const cardItems = config.container.querySelectorAll("[data-task-block-id]");

        // Collect candidates whose Y range contains the mouse (with tolerance)
        const candidates: { el: HTMLElement; indent: number; midDist: number }[] = [];
        for (const item of cardItems) {
            const el = item as HTMLElement;
            if (el.dataset.taskBlockId === dragBlockId) continue;
            const rect = el.getBoundingClientRect();
            const midY = (rect.top + rect.bottom) / 2;
            const midDist = Math.abs(mouseY - midY);

            // Must be reasonably close in Y (within 1.5x card height)
            const cardHeight = rect.bottom - rect.top;
            if (midDist > cardHeight * 0.75) continue;

            const blockId = el.dataset.taskBlockId!;
            const task = currentTasks.find((t) => t.blockId === blockId);
            if (!task) continue;
            const indent = getIndentLevel(task, currentTasks);

            candidates.push({ el, indent, midDist });
        }

        if (candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0].el;

        // Determine which indent level the mouse X corresponds to
        // Use the leftmost card's rect as reference for container position
        const refRect = candidates[0].el.getBoundingClientRect();
        const relX = mouseX - refRect.left;
        const desiredIndent = Math.max(0, Math.round((relX + indentWidth / 2) / indentWidth));

        // Sort: prefer cards that match the desired indent, then by Y closeness
        candidates.sort((a, b) => {
            const aMatch = Math.abs(a.indent - desiredIndent);
            const bMatch = Math.abs(b.indent - desiredIndent);
            if (aMatch !== bMatch) return aMatch - bMatch;
            return a.midDist - b.midDist;
        });

        return candidates[0].el;
    }

    /**
     * Check if `candidateId` is a descendant of `ancestorId` in the task tree.
     */
    function isDescendantOf(candidateId: string, ancestorId: string, tasks: TaskCacheEntry[]): boolean {
        const taskMap = new Map(tasks.map((t) => [t.blockId, t]));
        let currentId: string | undefined = candidateId;
        const visited = new Set<string>();
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            const task = taskMap.get(currentId);
            if (!task) break;
            if (task.parentId === ancestorId) return true;
            currentId = task.parentId;
        }
        return false;
    }

    /**
     * Determine drop target based on mouse position.
     *
     * Three horizontal zones on the target card:
     *
     *   |<- indent gutter ->|<-- left half -->|<-- right half -->|
     *
     * 1. Indent gutter: promote to the level of the indent column.
     * 2. Left half (default): same level as target — reordering.
     * 3. Right half: become child of target.
     *
     * Left/right split uses the midpoint of the content area (after indent gutter),
     * not the midpoint of the full card width.
     *
     * Vertical position (top/bottom half) controls before/after ordering.
     */
    function getDropTarget(e: PointerEvent): { parentId: string | null; afterId: string | null } | null {
        let currentTasks: TaskCacheEntry[] = [];
        taskStore.subscribe((s) => {
            currentTasks = s.allTasks;
        })();

        const indentWidth = getIndentWidth();
        const cardItem = findCardAt(e.clientX, e.clientY, currentTasks, indentWidth);
        if (!cardItem) return null;

        const targetBlockId = cardItem.dataset.taskBlockId!;
        if (targetBlockId === dragBlockId) return null;

        const rect = cardItem.getBoundingClientRect();
        const relY = (e.clientY - rect.top) / rect.height;
        const relX = e.clientX - rect.left;

        const targetTask = currentTasks.find((t) => t.blockId === targetBlockId);
        if (!targetTask) return null;

        const targetIndent = getIndentLevel(targetTask, currentTasks);
        const ancestorChain = getAncestorChain(targetTask, currentTasks);
        const contentStartX = targetIndent * indentWidth;

        let desiredLevel: number;
        if (relX < contentStartX) {
            desiredLevel = Math.max(0, Math.floor((relX + indentWidth / 2) / indentWidth));
            desiredLevel = Math.min(desiredLevel, targetIndent);
        } else {
            const contentMidX = contentStartX + (rect.width - contentStartX) / 2;
            if (relX > contentMidX) {
                desiredLevel = targetIndent + 1;
            } else {
                desiredLevel = targetIndent;
            }
        }

        // Map desiredLevel to parentId
        let parentId: string | null;
        if (desiredLevel === 0) {
            parentId = null;
        } else if (desiredLevel <= targetIndent) {
            parentId = ancestorChain[desiredLevel - 1];
        } else {
            parentId = targetBlockId;
        }

        // Block: cannot drop under own descendant (cycle)
        if (parentId && dragBlockId && isDescendantOf(parentId, dragBlockId, currentTasks)) {
            return null;
        }

        // Block: project cannot become child of a non-project task
        if (parentId && dragBlockId) {
            const dragTask = currentTasks.find((t) => t.blockId === dragBlockId);
            const parentTask = currentTasks.find((t) => t.blockId === parentId);
            if (dragTask && isProjectTask(dragTask) && parentTask) {
                return null;
            }
        }

        // Determine afterId
        let afterId: string | null;
        if (desiredLevel > targetIndent) {
            afterId = null;
        } else {
            const referenceId = desiredLevel < targetIndent ? ancestorChain[desiredLevel] : targetBlockId;

            const siblings = currentTasks
                .filter((t) => (t.parentId || null) === parentId)
                .sort((a, b) => a.sort - b.sort || a.blockId.localeCompare(b.blockId));
            const refIdx = siblings.findIndex((t) => t.blockId === referenceId);

            if (relY < 0.5) {
                afterId = refIdx > 0 ? siblings[refIdx - 1].blockId : null;
            } else {
                afterId = referenceId;
            }
        }

        return { parentId, afterId };
    }

    function updateDropTarget(e: PointerEvent) {
        clearIndicators();

        let currentTasks: TaskCacheEntry[] = [];
        taskStore.subscribe((s) => {
            currentTasks = s.allTasks;
        })();

        const indentWidth = getIndentWidth();
        const cardItem = findCardAt(e.clientX, e.clientY, currentTasks, indentWidth);
        if (!cardItem) return;

        const rect = cardItem.getBoundingClientRect();
        const relY = (e.clientY - rect.top) / rect.height;
        const relX = e.clientX - rect.left;

        const targetBlockId = cardItem.dataset.taskBlockId!;
        const targetTask = currentTasks.find((t) => t.blockId === targetBlockId);
        if (!targetTask) return;

        const targetIndent = getIndentLevel(targetTask, currentTasks);
        const contentStartX = targetIndent * indentWidth;

        let desiredLevel: number;
        if (relX < contentStartX) {
            desiredLevel = Math.max(0, Math.floor((relX + indentWidth / 2) / indentWidth));
            desiredLevel = Math.min(desiredLevel, targetIndent);
        } else {
            const contentMidX = contentStartX + (rect.width - contentStartX) / 2;
            if (relX > contentMidX) {
                desiredLevel = targetIndent + 1;
            } else {
                desiredLevel = targetIndent;
            }
        }

        // Block: cannot drop under own descendant — show no indicator
        if (desiredLevel > targetIndent && dragBlockId && isDescendantOf(targetBlockId, dragBlockId, currentTasks)) {
            return;
        }

        // Block: project cannot become child of a non-project task — show no indicator
        if (desiredLevel > targetIndent && dragBlockId) {
            const dragTask = currentTasks.find((t) => t.blockId === dragBlockId);
            const targetAsParent = currentTasks.find((t) => t.blockId === targetBlockId);
            if (dragTask && isProjectTask(dragTask) && targetAsParent) {
                return;
            }
        }

        if (desiredLevel > targetIndent) {
            cardItem.classList.add("na-drop-target-child");
        } else if (desiredLevel < targetIndent) {
            cardItem.classList.add("na-drop-target-promote");
        } else if (relY < 0.5) {
            cardItem.classList.add("na-drop-target-before");
        } else {
            cardItem.classList.add("na-drop-target-after");
        }
    }

    function clearIndicators() {
        config.container
            .querySelectorAll(
                ".na-drop-target-before, .na-drop-target-after, .na-drop-target-child, .na-drop-target-promote",
            )
            .forEach((el) => {
                el.classList.remove(
                    "na-drop-target-before",
                    "na-drop-target-after",
                    "na-drop-target-child",
                    "na-drop-target-promote",
                );
            });
    }

    return { onPointerDown };
}

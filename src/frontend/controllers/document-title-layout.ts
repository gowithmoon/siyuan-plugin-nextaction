function cssLength(value: string): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function transformTranslateX(value: string): number {
    return value === "none" ? 0 : new DOMMatrixReadOnly(value).m41;
}

function pseudoLeadingEnd(
    element: HTMLElement,
    pseudo: "::before" | "::after",
    container: DOMRect,
    direction: string,
): number {
    const style = getComputedStyle(element, pseudo);
    if (style.content === "none" || style.content === "normal") return 0;
    const width =
        cssLength(style.width) +
        (style.boxSizing === "border-box"
            ? 0
            : cssLength(style.paddingLeft) +
              cssLength(style.paddingRight) +
              cssLength(style.borderLeftWidth) +
              cssLength(style.borderRightWidth));
    if (width <= 0) return 0;
    const elementRect = element.getBoundingClientRect();
    const translateX = transformTranslateX(style.transform);
    const marginStart = cssLength(direction === "rtl" ? style.marginRight : style.marginLeft);
    const marginEnd = cssLength(direction === "rtl" ? style.marginLeft : style.marginRight);
    const edge = direction === "rtl" ? style.right : style.left;
    if (edge === "auto") return 0;
    const edgeOffset = cssLength(edge);
    const leadingStart =
        direction === "rtl"
            ? elementRect.right - edgeOffset - width + translateX - marginStart
            : elementRect.left + edgeOffset + translateX + marginStart;
    const leadingEnd =
        direction === "rtl"
            ? container.right - leadingStart + marginEnd
            : leadingStart + width + marginEnd - container.left;
    return leadingEnd > 0 && leadingEnd < container.width / 2 ? leadingEnd : 0;
}

export function syncDocumentTitleLayout(title: HTMLElement): void {
    const titleRect = title.getBoundingClientRect();
    const computed = getComputedStyle(title);
    const direction = computed.direction;
    const leadingPadding = cssLength(direction === "rtl" ? computed.paddingRight : computed.paddingLeft);
    const leadingBorder = cssLength(direction === "rtl" ? computed.borderRightWidth : computed.borderLeftWidth);
    let leadingDecoration = Math.max(0, leadingPadding - 2) + leadingBorder;

    for (const pseudo of ["::before", "::after"] as const) {
        leadingDecoration = Math.max(leadingDecoration, pseudoLeadingEnd(title, pseudo, titleRect, direction));
    }

    const input = title.querySelector<HTMLElement>(".protyle-title__input");
    if (input) {
        for (const pseudo of ["::before", "::after"] as const) {
            leadingDecoration = Math.max(leadingDecoration, pseudoLeadingEnd(input, pseudo, titleRect, direction));
        }
    }

    const icon = title.querySelector<HTMLElement>(".protyle-title__icon");
    if (icon) {
        const iconRect = icon.getBoundingClientRect();
        const iconEnd = direction === "rtl" ? titleRect.right - iconRect.left : iconRect.right - titleRect.left;
        if (iconEnd > 0 && iconEnd < titleRect.width / 2) leadingDecoration = Math.max(leadingDecoration, iconEnd);
    }

    const statusGap = 6;
    const baseOffset = 2;
    const extraOffset = Math.max(0, Math.ceil(leadingDecoration + statusGap - baseOffset));
    title.style.setProperty("--nextaction-document-task-leading-offset", `${extraOffset}px`);
}

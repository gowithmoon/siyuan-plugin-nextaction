import type { ViewType } from "./constants";
import type { I18nStrings, I18nKey } from "../shared/i18n";

const definitions: { group: I18nKey; views: { view: ViewType; key: I18nKey; icon: string }[] }[] = [
    {
        group: "navFocus",
        views: [
            { view: "inbox", key: "inbox", icon: "iconInbox" },
            { view: "nextAction", key: "nextAction", icon: "iconListItem" },
            { view: "myDay", key: "myDay", icon: "iconCalendar" },
        ],
    },
    {
        group: "navOrganize",
        views: [
            { view: "all", key: "allTasks", icon: "iconList" },
            { view: "byProject", key: "byProject", icon: "iconFolder" },
            { view: "waiting", key: "waiting", icon: "iconClock" },
            { view: "someday", key: "someday", icon: "iconLight" },
        ],
    },
    {
        group: "navReflect",
        views: [
            { view: "review", key: "review", icon: "iconCheck" },
            { view: "statistics", key: "statistics", icon: "iconGraph" },
        ],
    },
];
export function getViewDirectory(i18n: I18nStrings) {
    return definitions.map((group) => ({
        label: i18n[group.group] || group.group,
        items: group.views.map((view) => ({ ...view, label: i18n[view.key] || view.key })),
    }));
}

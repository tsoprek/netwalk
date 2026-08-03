import type { ContextMenuItem } from "../components/ContextMenu";
import {
  groupTemplates,
  preconfiguredCommandTemplates,
  type CommandTemplate,
  type TemplateMenuNode,
} from "./templates";

interface TemplateMenuOptions {
  label?: string;
  hint?: string;
  userTemplates: CommandTemplate[];
  onSelect: (template: CommandTemplate) => void;
  onManage: () => void;
}

export function buildTemplateMenuItem({
  label = "Templates",
  hint,
  userTemplates,
  onSelect,
  onManage,
}: TemplateMenuOptions): ContextMenuItem | null {
  const builtin = groupTemplates(preconfiguredCommandTemplates());
  const personal = personalTemplateItems(groupTemplates(userTemplates), onSelect);
  if (builtin.length === 0 && personal.length === 0) return null;

  const personalChildren: ContextMenuItem[] = personal.length > 0
    ? [
        ...personal,
        { divider: true },
        { label: "Manage personal templates…", onClick: onManage },
      ]
    : [
        { label: "No personal templates yet", disabled: true },
        { label: "Manage personal templates…", onClick: onManage },
      ];

  return {
    label,
    hint,
    children: [
      {
        label: "Preconfigured",
        children: treeToItems(builtin, onSelect),
      },
      {
        label: "Personal",
        children: personalChildren,
      },
    ],
  };
}

function treeToItems(
  tree: TemplateMenuNode[],
  onSelect: (template: CommandTemplate) => void,
): ContextMenuItem[] {
  return tree.map((node) => ({
    label: node.category,
    children: groupsToItems(node.groups, onSelect),
  }));
}

function personalTemplateItems(
  tree: TemplateMenuNode[],
  onSelect: (template: CommandTemplate) => void,
): ContextMenuItem[] {
  if (tree.length === 1) return groupsToItems(tree[0].groups, onSelect);
  return treeToItems(tree, onSelect);
}

function groupsToItems(
  groups: TemplateMenuNode["groups"],
  onSelect: (template: CommandTemplate) => void,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  for (const group of groups) {
    if (group.subcategory) {
      items.push({
        label: group.subcategory,
        children: group.templates.map((template) => templateItem(template, onSelect)),
      });
    } else {
      items.push(...group.templates.map((template) => templateItem(template, onSelect)));
    }
  }
  return items;
}

function templateItem(
  template: CommandTemplate,
  onSelect: (template: CommandTemplate) => void,
): ContextMenuItem {
  return {
    label: `${template.name}…`,
    onClick: () => onSelect(template),
  };
}

/**
 * SortableRoleSelect — pick roles and drag to reorder priority.
 * First item in list = highest priority (priority value 1).
 */
import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Select, Space, Tag, Typography } from "antd";
import { DeleteOutlined, HolderOutlined, PlusOutlined } from "@ant-design/icons";
import { filterSelectOption, sortSelectOptions } from "../utils/selectOptions";

const { Text } = Typography;

interface Option {
  value: number;
  label: string;
}

interface Props {
  value?: number[];
  onChange?: (ids: number[]) => void;
  options: Option[];
  required?: boolean;
}

function SortableItem({
  id,
  label,
  onRemove,
}: {
  id: number;
  label: string;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: String(id) });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 8px",
        background: "var(--ant-color-bg-container, #fff)",
        border: "1px solid var(--ant-color-border, #d9d9d9)",
        borderRadius: 6,
        marginBottom: 4,
        cursor: "default",
      }}
    >
      <span
        {...attributes}
        {...listeners}
        style={{ cursor: "grab", color: "#999", fontSize: 16 }}
      >
        <HolderOutlined />
      </span>
      <Tag color="blue" style={{ margin: 0, flex: 1 }}>
        {label}
      </Tag>
      <Button
        type="text"
        size="small"
        danger
        icon={<DeleteOutlined />}
        onClick={onRemove}
      />
    </div>
  );
}

export default function SortableRoleSelect({
  value = [],
  onChange,
  options,
  required,
}: Props) {
  const [adding, setAdding] = useState<number | undefined>(undefined);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = value.indexOf(Number(active.id));
    const newIndex = value.indexOf(Number(over.id));
    onChange?.(arrayMove(value, oldIndex, newIndex));
  }

  function addRole() {
    if (adding != null && !value.includes(adding)) {
      onChange?.([...value, adding]);
    }
    setAdding(undefined);
  }

  function removeRole(id: number) {
    onChange?.(value.filter((v) => v !== id));
  }

  const available = sortSelectOptions(options.filter((o) => !value.includes(o.value)));
  const labelFor = (id: number) =>
    options.find((o) => o.value === id)?.label ?? String(id);

  return (
    <div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={value.map(String)}
          strategy={verticalListSortingStrategy}
        >
          {value.map((id, idx) => (
            <div
              key={id}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <Text
                type="secondary"
                style={{ width: 20, textAlign: "right", fontSize: 11 }}
              >
                {idx + 1}
              </Text>
              <div style={{ flex: 1 }}>
                <SortableItem
                  id={id}
                  label={labelFor(id)}
                  onRemove={() => removeRole(id)}
                />
              </div>
            </div>
          ))}
        </SortableContext>
      </DndContext>

      {value.length === 0 && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          No roles assigned{required ? " (required)" : ""}.
        </Text>
      )}

      <Space style={{ marginTop: 8 }}>
        <Select
          size="small"
          placeholder="Add role…"
          value={adding}
          onChange={setAdding}
          options={available}
          showSearch
          filterOption={filterSelectOption}
          style={{ minWidth: 200 }}
          allowClear
        />
        <Button
          size="small"
          icon={<PlusOutlined />}
          onClick={addRole}
          disabled={adding == null}
        >
          Add
        </Button>
      </Space>
    </div>
  );
}

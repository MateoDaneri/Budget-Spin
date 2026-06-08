"use client";

import { useState, useTransition } from "react";
import { reorderExpenseCategoriesAction } from "@/src/actions/forms";

type CategoryGroup = {
  id: number;
  name: string;
};

type Props = {
  categories: CategoryGroup[];
};

export function ExpenseCategoryGroupOrder({ categories }: Props) {
  const [items, setItems] = useState(categories);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  function moveCategory(targetId: number) {
    if (draggedId === null || draggedId === targetId) {
      return;
    }

    const draggedIndex = items.findIndex((item) => item.id === draggedId);
    const targetIndex = items.findIndex((item) => item.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) {
      return;
    }

    const next = [...items];
    const [dragged] = next.splice(draggedIndex, 1);
    next.splice(targetIndex, 0, dragged);
    setItems(next);

    startTransition(async () => {
      await reorderExpenseCategoriesAction(next.map((item) => item.id));
    });
  }

  return (
    <div className="group-order-list" aria-busy={isPending}>
      {items.map((item) => (
        <button
          className={`group-chip ${draggedId === item.id ? "group-chip-dragging" : ""}`}
          draggable
          key={item.id}
          onDragEnd={() => setDraggedId(null)}
          onDragOver={(event) => event.preventDefault()}
          onDragStart={() => setDraggedId(item.id)}
          onDrop={() => moveCategory(item.id)}
          type="button"
        >
          <span className="group-chip-handle">::</span>
          {item.name}
        </button>
      ))}
    </div>
  );
}

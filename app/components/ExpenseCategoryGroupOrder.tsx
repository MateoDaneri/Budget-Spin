"use client";

import { useState, useTransition } from "react";
import { reorderExpenseCategoriesAction } from "@/src/actions/forms";

type CategoryGroup = { id: number; name: string };
type Props = { categories: CategoryGroup[] };

export function ExpenseCategoryGroupOrder({ categories }: Props) {
  const [items, setItems] = useState(categories);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function moveCategory(from: number, to: number) {
    if (isPending || from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    const previous = items;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    setMessage("");
    startTransition(async () => {
      try {
        await reorderExpenseCategoriesAction(next.map((item) => item.id));
        setMessage(`${moved.name} moved to position ${to + 1} of ${next.length}.`);
      } catch {
        setItems(previous);
        setMessage("Could not save the order. Please try again.");
      }
    });
  }

  return (
    <div>
      <div className="group-order-list" aria-busy={isPending}>
        {items.map((item, index) => (
          <div className={`group-order-item ${draggedId === item.id ? "group-chip-dragging" : ""}`} key={item.id}
            draggable={!isPending}
            onDragStart={() => setDraggedId(item.id)}
            onDragEnd={() => setDraggedId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => { moveCategory(items.findIndex((entry) => entry.id === draggedId), index); setDraggedId(null); }}>
            <span className="group-order-name"><span className="group-chip-handle" aria-hidden="true">::</span> {item.name}</span>
            <button type="button" className="order-button" disabled={isPending || index === 0} onClick={() => moveCategory(index, index - 1)} aria-label={`Move ${item.name} earlier`}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5m-5 5 5-5 5 5" /></svg></button>
            <button type="button" className="order-button" disabled={isPending || index === items.length - 1} onClick={() => moveCategory(index, index + 1)} aria-label={`Move ${item.name} later`}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14m-5-5 5 5 5-5" /></svg></button>
          </div>
        ))}
      </div>
      <p className="order-status" role="status" aria-live="polite">{isPending ? "Saving order…" : message}</p>
    </div>
  );
}

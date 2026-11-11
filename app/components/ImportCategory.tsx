import { setImportCategoryAction } from "@/src/actions/import-categories";
import type { Category } from "@/src/db/repository";

export function ImportCategory({ source, id, categoryId, categories }: { source: "transaction" | "splitwise"; id: number; categoryId: number | null; categories: Category[] }) {
  return <form action={setImportCategoryAction} className="inline-actions">
    <input type="hidden" name="source" value={source} /><input type="hidden" name="id" value={id} />
    <label>Category <select name="category" defaultValue={categoryId ?? ""} required>
      <option value="" disabled>Select a category</option>
      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
    </select></label>
    <button type="submit" className="button button-secondary">Save</button>
  </form>;
}

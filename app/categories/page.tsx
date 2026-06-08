import { deactivateCategoryAction, saveCategoryAction } from "@/src/actions/forms";
import { listCategories } from "@/src/db/repository";

export const dynamic = "force-dynamic";

export default function CategoriesPage() {
  const categories = listCategories(undefined, false);

  return (
    <>
      <section className="page-hero">
        <div>
          <span className="eyebrow">Organization</span>
          <h1>Categories</h1>
          <p className="muted">Use categories to make dashboard breakdowns and trends readable at a glance.</p>
        </div>
      </section>

      <details className="create-panel">
        <summary className="button">Add category</summary>
        <form action={saveCategoryAction} className="panel form-grid">
          <div className="panel-header span-full">
            <div>
              <h2>Add category</h2>
              <p className="muted">Income categories appear on income rows. Expense categories power breakdown charts.</p>
            </div>
          </div>
          <div className="field span-3">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" placeholder="Groceries" required />
          </div>
          <div className="field">
            <label htmlFor="type">Type</label>
            <select id="type" name="type" required>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </div>
          <button className="button" type="submit">
            Add category
          </button>
        </form>
      </details>

      <section className="section-title">
        <div>
          <h2>Existing categories</h2>
          <p className="muted">Inactive categories stay available for historical references.</p>
        </div>
      </section>
      <div className="grid">
        {categories.map((category) => (
          <form action={saveCategoryAction} className="panel form-grid" key={category.id}>
            <input type="hidden" name="id" value={category.id} />
            <div className="field span-3">
              <label htmlFor={`name-${category.id}`}>Name</label>
              <input id={`name-${category.id}`} name="name" defaultValue={category.name} required />
            </div>
            <div className="field">
              <label htmlFor={`type-${category.id}`}>Type</label>
              <select id={`type-${category.id}`} name="type" defaultValue={category.type} required>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
              <span className={`status-pill ${category.type === "income" ? "status-income" : "status-expense"}`}>
                {category.type}
              </span>
            </div>
            <div className="field">
              <label>Status</label>
              <span className={`status-pill ${category.isActive ? "status-ok" : "status-inactive"}`}>
                {category.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            <button className="button" type="submit">
              Save
            </button>
            {category.isActive ? (
              <button
                className="button button-danger"
                formAction={deactivateCategoryAction}
                name="id"
                value={category.id}
                type="submit"
              >
                Deactivate
              </button>
            ) : null}
          </form>
        ))}
      </div>
    </>
  );
}

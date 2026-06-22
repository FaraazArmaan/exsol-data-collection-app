export function CategoryTabs(props: {
  categories: { id: string; name: string; productCount: number }[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <div role="tablist" className="pos-tabs">
      <button
        role="tab"
        onClick={() => props.onChange(null)}
        aria-selected={props.value === null}
      >
        All
      </button>
      {props.categories.map((c) => (
        <button
          key={c.id}
          role="tab"
          aria-selected={props.value === c.id}
          onClick={() => props.onChange(c.id)}
        >
          {c.name} ({c.productCount})
        </button>
      ))}
    </div>
  );
}

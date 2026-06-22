export function MenuSearchBar(props: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="search"
      placeholder="Filter menu…"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      className="pos-search"
    />
  );
}

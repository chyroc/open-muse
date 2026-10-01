// An on/off settings row. The label wraps the switch, so the whole row toggles it.
export function Switch({
  label,
  detail,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="settings-row settings-switch-row">
      <div>
        <strong>{label}</strong>
        {detail && <p>{detail}</p>}
      </div>
      <input
        type="checkbox"
        role="switch"
        className="settings-switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}
